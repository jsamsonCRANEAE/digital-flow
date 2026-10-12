// Dev tool: renders M1 frames entirely on the CPU (same core code the game
// uses, composited like the SpriteKit layer) and writes PNGs for review.
//   swift run -c release gs-preview <output-dir>
import Foundation
import GSFoundation
import GSData
import GSInput
import GSSimulation
import GSRenderCore
import GSGame
import GSAudio
import GSUI

extension String {
    /// FNV-1a: stable across runs (Swift's hashValue is randomly seeded).
    var hashValueStable: Int {
        var h: UInt64 = 0xcbf29ce484222325
        for b in utf8 { h = (h ^ UInt64(b)) &* 0x100000001b3 }
        return Int(truncatingIfNeeded: h)
    }
}

let outDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."

// --- Audio export: one full loop of each song + an SFX reel (22.05 kHz mono WAV) ---
if CommandLine.arguments.contains("--audio") {
    let sr = 22_050.0
    for song in Soundtrack.all {
        let core = AudioCore(sampleRate: sr)
        core.setCrowd(0.05)
        core.play(song)
        let pcm = core.renderSeconds(song.duration + (song.loops ? 0 : 1))
        let peak = pcm.map { abs($0) }.max() ?? 0
        let rms = (pcm.reduce(0) { $0 + $1 * $1 } / Float(pcm.count)).squareRoot()
        let file = song.name.lowercased().replacingOccurrences(of: " ", with: "_")
        try AudioCore.wav(pcm, sampleRate: Int(sr)).write(to: URL(fileURLWithPath: "\(outDir)/\(file).wav"))
        print(String(format: "%@  %.1fs  peak %.2f  rms %.3f", song.name, song.duration, peak, rms))
    }
    // Real-time budget check: 10 s of the densest song at the device rate.
    let bench = AudioCore(sampleRate: 48_000)
    bench.play(Soundtrack.title)
    let t0 = Date()
    _ = bench.renderSeconds(10)
    let el = Date().timeIntervalSince(t0)
    print(String(format: "realtime: 10 s of SPIRIT RISING @48k rendered in %.2f s (%.1f%% of one core)", el, el / 10 * 100))
    let core = AudioCore(sampleRate: sr)
    var reel: [Float] = []
    let effects: [SoundEffect] = [.whistle, .snap, .footstep(1), .footstep(0.8), .footstep(1), .throwWhoosh, .catchPop,
                                  .hit(0.5), .hit(1.2), .kick, .cheer(1), .spirit, .uiTap, .uiBack, .uiBuy, .uiError]
    for e in effects { core.play(e); reel += core.renderSeconds(0.55) }
    try AudioCore.wav(reel, sampleRate: Int(sr)).write(to: URL(fileURLWithPath: "\(outDir)/sfx_reel.wav"))
    print("sfx reel \(effects.count) effects")
    exit(0)
}
let league = try DataLoader.bundledLeague()
var rt = GameRuntime(league: league)
let style = FieldStyle(homeEndZone: rt.offenseTeam.colors.primaryRGBA, awayEndZone: rt.defenseTeam.colors.primaryRGBA)
let field = FieldRasterizer(style: style, backdrop: StadiumBackdrop(horizonRow: Int(rt.cameraConfig.horizonRow),
                                                                    home: style.homeEndZone, away: style.awayEndZone))

var shadowCache: [Int: PixelBuffer] = [:]
func composite(_ f: RenderFrame, joystick: VirtualJoystick?, runtime: GameRuntime? = nil, extraUI: [UIItem] = []) -> PixelBuffer {
    let rt = runtime ?? rt
    var canvas = PixelBuffer(width: Canvas.width, height: Canvas.height)
    field.setEndZones(near: f.endZones.near, far: f.endZones.far)
    field.render(into: &canvas, camera: f.camera, crowdFrame: f.crowdFrame)
    EffectsRasterizer.render(f.effects, camera: f.camera, into: &canvas)
    // Player shadows (node alpha 0.45 in the app; approximated by mixing).
    for s in f.sprites where s.visible {
        let sh = shadowCache[s.shadowWidth] ?? PlaceholderSprites.shadow(width: s.shadowWidth)
        shadowCache[s.shadowWidth] = sh
        for y in 0..<sh.height { for x in 0..<sh.width where sh.isOpaque(x, y) {
            let cx = s.shadowX - sh.width / 2 + x, cy = s.shadowY - sh.height / 2 + y
            guard canvas.contains(cx, cy) else { continue }
            canvas.set(cx, cy, canvas.color(cx, cy).mixed(with: Palette.shadow, 0.45))
        } }
    }
    // Players and ball in painter's order (same rules as WorldRenderer).
    enum Item { case player(ProjectedSprite), ball(ProjectedBall) }
    var items: [(Double, Item)] = f.sprites.filter(\.visible).map { ($0.drawOrder, .player($0)) }
    if let b = f.ball { items.append((b.drawOrder, .ball(b))) }
    items.sort { $0.0 < $1.0 }
    for (_, it) in items {
        switch it {
        case .player(let s):
            var spr = PlaceholderSprites.player(height: s.height, look: rt.looks[s.teamIndex], view: s.view, pose: s.pose,
                                                squash: s.squash, number: s.height >= 44 ? s.number : nil, big: s.big, aura: s.aura)
            if s.flipX { spr = spr.flippedHorizontally() }
            canvas.blit(spr, x: s.footX - spr.width / 2, y: s.footY - spr.height + 1)
            if s.isControlled {
                let m = PlaceholderSprites.controlMarker()
                canvas.blit(m, x: s.footX - m.width / 2, y: s.footY - spr.height - m.height - 1)
            }
        case .ball(let b):
            let spr = FXSprites.ball(length: b.length, angleBucket: b.angleBucket, spinFrame: b.spinFrame)
            canvas.blit(spr, x: b.x - spr.width / 2, y: b.y - spr.height / 2)
        }
    }
    for o in f.overlays {
        let spr = o.kind == .starburst ? FXSprites.starburst(size: o.size, frame: o.frame) : FXSprites.catchFlash(size: o.size, frame: o.frame)
        canvas.blit(spr, x: o.x - spr.width / 2, y: o.y - spr.height / 2)
    }
    for icon in f.icons {
        let spr = FXSprites.receiverIcon(slot: icon.slot, charging: f.chargingReceiver == icon.receiverID, glyph: f.receiverGlyph(slot: icon.slot))
        canvas.blit(spr, x: snapToPixel(icon.center.x) - spr.width / 2, y: snapToPixel(icon.center.y) - spr.height / 2)
    }
    for (i, b) in f.buttons.enumerated() where b.action != nil {
        let spr = FXSprites.button(radius: Int(b.radius), slot: i, label: b.label, enabled: b.enabled, pressed: b.pressed, glyph: b.padGlyph)
        canvas.blit(spr, x: snapToPixel(b.center.x) - spr.width / 2, y: snapToPixel(b.center.y) - spr.height / 2)
    }
    if let j = joystick, j.isActive {
        let r = Int(j.config.radius)
        let base = PlaceholderSprites.joystickBase(radius: r), knob = PlaceholderSprites.joystickKnob(radius: 9)
        canvas.blit(base, x: snapToPixel(j.base.x) - base.width / 2, y: snapToPixel(j.base.y) - base.height / 2)
        canvas.blit(knob, x: snapToPixel(j.knob.x) - knob.width / 2, y: snapToPixel(j.knob.y) - knob.height / 2)
    }
    for item in UILayout.items(for: f, safeArea: Canvas.bounds, accent: rt.teams[0].colors.primaryRGBA) {
        canvas.blit(item.make(), x: item.x, y: item.y)
    }
    for item in extraUI { canvas.blit(item.make(), x: item.x, y: item.y) }
    if f.impactFrame {
        // Same math as the Metal impact pass: invert + contrast boost.
        for i in canvas.pixels.indices {
            let c = RGBA(argb: canvas.pixels[i])
            func k(_ v: UInt8) -> UInt8 { UInt8(clamp((255 - Double(v) - 128) * 1.8 + 128, 0, 255)) }
            canvas.pixels[i] = RGBA(r: k(c.r), g: k(c.g), b: k(c.b)).argb
        }
    }
    return canvas
}

func upscaled(_ b: PixelBuffer, _ s: Int, letterbox: (Int, Int)? = nil) -> PixelBuffer {
    let (W, H) = letterbox ?? (b.width * s, b.height * s)
    var o = PixelBuffer(width: W, height: H, fill: Palette.letterbox)
    let ox = (W - b.width * s) / 2, oy = (H - b.height * s) / 2
    for y in 0..<(b.height * s) { for x in 0..<(b.width * s) { o[ox + x, oy + y] = b[x / s, y / s] } }
    return o
}

// --- Minimal PNG writer (stored deflate blocks) ---
func crc32(_ data: [UInt8]) -> UInt32 {
    var table = [UInt32](repeating: 0, count: 256)
    for i in 0..<256 { var c = UInt32(i); for _ in 0..<8 { c = c & 1 != 0 ? 0xEDB88320 ^ (c >> 1) : c >> 1 }; table[i] = c }
    var crc: UInt32 = 0xFFFF_FFFF
    for b in data { crc = table[Int((crc ^ UInt32(b)) & 0xFF)] ^ (crc >> 8) }
    return crc ^ 0xFFFF_FFFF
}
func writePNG(_ b: PixelBuffer, to path: String) throws {
    var raw: [UInt8] = []
    raw.reserveCapacity((b.width * 3 + 1) * b.height)
    for y in 0..<b.height {
        raw.append(0)
        for x in 0..<b.width { let c = b.color(x, y); raw += [c.r, c.g, c.b] }
    }
    var z: [UInt8] = [0x78, 0x01]
    var i = 0
    while i < raw.count {
        let n = min(65535, raw.count - i)
        z.append(i + n == raw.count ? 1 : 0)
        z += [UInt8(n & 0xFF), UInt8(n >> 8), UInt8(~n & 0xFF), UInt8((~n >> 8) & 0xFF)]
        z += raw[i..<(i + n)]
        i += n
    }
    var a: UInt32 = 1, bb: UInt32 = 0
    for v in raw { a = (a + UInt32(v)) % 65521; bb = (bb + a) % 65521 }
    let adler = (bb << 16) | a
    z += [UInt8(adler >> 24), UInt8((adler >> 16) & 0xFF), UInt8((adler >> 8) & 0xFF), UInt8(adler & 0xFF)]
    func be(_ v: UInt32) -> [UInt8] { [UInt8(v >> 24), UInt8((v >> 16) & 0xFF), UInt8((v >> 8) & 0xFF), UInt8(v & 0xFF)] }
    func chunk(_ type: String, _ d: [UInt8]) -> [UInt8] {
        let t = Array(type.utf8)
        return be(UInt32(d.count)) + t + d + be(crc32(t + d))
    }
    var png: [UInt8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
    png += chunk("IHDR", be(UInt32(b.width)) + be(UInt32(b.height)) + [8, 2, 0, 0, 0])
    png += chunk("IDAT", z)
    png += chunk("IEND", [])
    try Data(png).write(to: URL(fileURLWithPath: path))
}

// --- Portrait sheet: every star, three expressions ---
do {
    var cells: [PixelBuffer] = []
    for (ti, team) in league.teams.enumerated() {
        for p in team.roster.prefix(5) {
            let spec = PortraitSpec(seed: SplitMix64.hash(p.id.hashValueStable), jersey: team.colors.primaryRGBA,
                                    trim: team.colors.accentRGBA, number: p.number, archetype: ti,
                                    big: [.og, .c, .dl].contains(p.position))
            for e in Expression.allCases {
                cells.append(Portraits.framed(Portraits.render(spec, e), name: p.lastName.uppercased(), accent: team.colors.primaryRGBA))
            }
        }
    }
    let cw = cells[0].width, ch = cells[0].height, cols = 9
    let rows = (cells.count + cols - 1) / cols
    var sheet = PixelBuffer(width: cols * (cw + 4), height: rows * (ch + 4), fill: Palette.letterbox)
    for (i, c) in cells.enumerated() { sheet.blit(c, x: (i % cols) * (cw + 4) + 2, y: (i / cols) * (ch + 4) + 2) }
    try writePNG(upscaled(sheet, 2), to: "\(outDir)/portrait_sheet.png")
    if CommandLine.arguments.contains("--portraits-only") { exit(0) }
}

// --- M5 menus: drive the real AppFlow and save each screen ---
if CommandLine.arguments.contains("--menus") {
    var saved: Data?
    let flow = AppFlow(league: league, gear: try DataLoader.bundledGear(), savedProfile: nil, persist: { saved = $0 },
                       audio: AudioCore(), seed: 42)
    func shot(_ name: String, warm: Int = 4) throws {
        var out: FlowOutput = flow.advance(frameTime: 1.0 / 60)
        for _ in 0..<warm { out = flow.advance(frameTime: 1.0 / 60) }
        let img: PixelBuffer
        switch out {
        case .menu(let b): img = b
        case .game(let f, let r, let ui, _): img = composite(f, joystick: r.touches.joystick, runtime: r, extraUI: ui)
        }
        try writePNG(upscaled(img, 2), to: "\(outDir)/menu_\(name).png")
        print("menu \(name) -> \(flow.screen)")
    }
    try shot("title", warm: 240)
    flow.handle(TouchEvent(id: 1, phase: .ended, location: Vec2(320, 150)))
    flow.store.profile.coins = 1840; flow.store.profile.wins = 7; flow.store.profile.gamesPlayed = 9; flow.store.profile.bestGrade = "A"
    try shot("main")
    flow.tap("exhibition"); try shot("teamselect")
    flow.tap("back"); flow.tap("settings"); try shot("settings")
    flow.tap("back"); flow.tap("shop")
    flow.store.profile.trophies = ["kurogane_ronin"]
    for id in ["cleat1", "cleat2", "glove1", "helm2", "train1"] { flow.tap("item." + id); flow.tap("buy") }
    flow.tap("item.cleat3"); try shot("shop")
    flow.tap("item.helm5"); flow.tap("buy"); try shot("shop_broke")
    flow.tap("back"); flow.tap("cup"); flow.tap("play"); try shot("cup")
    flow.tap("cup.play"); try shot("game", warm: 30)
    flow.tap("pause"); try shot("pause")
    // Controller: same flow, driven by a pad.
    func pad(_ b: PadButton..., style: PadStyle = .xbox) -> GamepadState { GamepadState(connected: true, style: style, pressed: Set(b)) }
    func press(_ b: PadButton, style: PadStyle = .xbox, hold: Int = 1) {
        for _ in 0..<hold { flow.handle(pad: pad(b, style: style)); _ = flow.advance(frameTime: 1.0 / 60) }
        flow.handle(pad: pad(style: style)); _ = flow.advance(frameTime: 1.0 / 60)
    }
    press(.b)                                       // resume
    press(.l2); try shot("pad_playcall", warm: 2)   // any press switches the HUD to controller glyphs
    press(.x)                                       // call the left card
    for _ in 0..<80 { flow.handle(pad: pad()); _ = flow.advance(frameTime: 1.0 / 60) }
    press(.l2); try shot("pad_presnap", warm: 2)
    press(.a, style: .playstation)                  // snap
    for _ in 0..<70 { flow.handle(pad: pad(style: .playstation)); _ = flow.advance(frameTime: 1.0 / 60) }
    try shot("pad_passing", warm: 1)
    press(.menu, style: .playstation); press(.down, style: .playstation); press(.down, style: .playstation)
    try shot("pad_pause", warm: 1)
    press(.a, style: .playstation)                  // QUIT TO MENU
    press(.down, style: .playstation); press(.down, style: .playstation)
    try shot("pad_menu", warm: 1)
    print("profile bytes \(saved?.count ?? 0)")
    exit(0)
}

// --- Scripted scenarios through the real runtime ---
func touchStick(_ dir: Vec2) {
    if !rt.touches.joystick.isActive { rt.handle(TouchEvent(id: 1, phase: .began, location: Vec2(110, 220))) }
    rt.handle(TouchEvent(id: 1, phase: .moved, location: Vec2(110 + dir.x * 22, 220 - dir.y * 22)))
}
func releaseStick() { rt.handle(TouchEvent(id: 1, phase: .ended, location: Vec2(110, 220))) }
func still(_ name: String, _ f: RenderFrame) throws {
    try writePNG(upscaled(composite(f, joystick: rt.touches.joystick), 3), to: "\(outDir)/still_\(name).png")
}
func writeRaw(_ frames: [PixelBuffer], to path: String) throws {
    var bytes: [UInt8] = []
    bytes.reserveCapacity(frames.count * Canvas.width * Canvas.height * 3)
    for f in frames { for v in f.pixels { let c = RGBA(argb: v); bytes += [c.r, c.g, c.b] } }
    try Data(bytes).write(to: URL(fileURLWithPath: path))
}

// 1. Human on offense: the play-call screen, both pages.
var f = rt.advance(frameTime: 1.0 / 60)
try still("playcall_offense_p1", f)
rt.perform(.page(1))
f = rt.advance(frameTime: 1.0 / 60)
try still("playcall_offense_p2", f)

// 2. Call SLANTS, snap, throw to the first read; record the play.
rt.perform(.page(1)); _ = rt.advance(frameTime: 1.0 / 60)
rt.perform(.selectCard(1))
var frames: [PixelBuffer] = []
var thrown = false
rt.debugFillSpirit(team: 0)
var cutShots = 0
var snapAt = -1
for t in 0..<(60 * 11) {
    if t == 4 { rt.perform(.button(.spirit)) }
    if t == 130 { rt.perform(.button(.snap)); snapAt = t }
    if rt.world.canThrow && t > snapAt + 50 && snapAt > 0 && !thrown {
        if let r = rt.world.players.first(where: { $0.slot == "WR2" }) { rt.perform(.throwTo(receiver: r.id, lob: false)); thrown = true }
    }
    if let c = rt.world.carrierID, c == rt.world.controlledID, rt.world.player(c).slot != "QB", rt.world.phase.isLive {
        touchStick(Vec2(-0.3, 1).normalized)
    }
    f = rt.advance(frameTime: 1.0 / 60)
    if t % 2 == 0 { frames.append(composite(f, joystick: rt.touches.joystick)) }
    if let c = f.cutIn, (c.t > 0.5 && cutShots == 0) || (c.t > 0.1 && cutShots == -1) { try still("spirit_cutin", f); cutShots = 1 }
    if t == 120 { try still("presnap_hud", f) }
    if snapAt > 0 && t == snapAt + 20 { try still("snap_matchup", f) }
    if f.replay && t % 30 == 0 { try still("replay", f) }
    if rt.phase == .playCall && t > 140 { break }
}
releaseStick()
try writeRaw(frames, to: "\(outDir)/m3_slants.rgb")
print("slants: \(frames.count) frames  [\(rt.playLog.last ?? "")]")

// 3. Fourth down: kicking page, then a field goal with the meter.
rt.debugSetSituation(down: 4, ballOn: 72, lineToGain: 80)
f = rt.advance(frameTime: 1.0 / 60)
try still("playcall_fourth_down", f)
rt.perform(.selectCard(1))                // FIELD GOAL
frames = []
var taps = 0
var meterShot = false
for t in 0..<(60 * 8) {
    if t == 20 { rt.perform(.button(.snap)) }
    if let k = f.kickMeter {
        // Tap near full power, then near the centre of the aim sweep.
        if taps == 0 && k.stage == 0 && k.power > 0.86 { rt.perform(.kickTap); taps = 1 }
        else if taps == 1 && k.stage == 1 && abs(k.aim) < 0.12 { rt.perform(.kickTap); taps = 2 }
        if !meterShot && k.stage == 1 { try still("kick_meter", f); meterShot = true }
    }
    f = rt.advance(frameTime: 1.0 / 60)
    if t % 2 == 0 { frames.append(composite(f, joystick: nil)) }
    if f.callout == "FIELD GOAL!" || f.callout == "NO GOOD!" { try still("field_goal_result", f) }
    if rt.phase == .playCall && t > 40 { break }
}
try writeRaw(frames, to: "\(outDir)/m3_field_goal.rgb")
print("field goal: \(frames.count) frames  [\(rt.playLog.last ?? "")]")

// 4. Human on defense: the defensive play-call screen.
do {
    let d = GameRuntime(league: league, humanTeam: 0, openingReceiver: 1)
    rt = d
    try still("playcall_defense", rt.advance(frameTime: 1.0 / 60))
}

// 5. Full CPU vs CPU game: box score, play-by-play, highlight stills.
do {
    rt = GameRuntime(league: league, humanTeam: nil, seed: 7)
    var shots = Set<String>()
    var n = 0
    var highlight: [PixelBuffer] = []
    var ring: [PixelBuffer] = []
    while (rt.phase != .final || n % 60 != 0 || !shots.contains("report")) && n < 60 * 60 * 45 {
        let fr = rt.advance(frameTime: 1.0 / 60)
        n += 1
        if n % 2 == 0 && rt.phase == .live {
            ring.append(composite(fr, joystick: nil))
            if ring.count > 150 { ring.removeFirst() }
        }
        if fr.cutIn != nil && fr.cutIn!.t > 0.6 && !shots.contains("cutin") { shots.insert("cutin"); try still("game_cutin", fr) }
        if fr.replay && !shots.contains("replay") && fr.calloutAge > 0 { shots.insert("replay"); try still("game_replay", fr) }
        if let m = fr.matchup, m.leftExpression != .neutral, m.slide >= 1, !shots.contains("react") { shots.insert("react"); try still("game_reaction", fr) }
        if fr.report != nil && !shots.contains("report") { shots.insert("report"); try still("game_report", fr) }
        if let c = fr.callout, ["TOUCHDOWN!", "INTERCEPTION!", "FIELD GOAL!", "SACK!", "FIRST DOWN!", "PUNT", "HALFTIME", "FINAL"].contains(c),
           !shots.contains(c), fr.calloutAge > 0.3 {
            shots.insert(c)
            try still("game_" + c.lowercased().filter { $0.isLetter }, fr)
            if c == "TOUCHDOWN!" && highlight.isEmpty { highlight = ring }
        }
    }
    try writeRaw(highlight, to: "\(outDir)/m3_touchdown.rgb")
    print("FULL GAME: \(rt.teams[0].abbreviation) \(rt.state.score[0]) - \(rt.teams[1].abbreviation) \(rt.state.score[1])  (\(rt.playLog.count) log lines, \(n) frames)")
    try rt.playLog.joined(separator: "\n").write(toFile: "\(outDir)/m3_play_by_play.txt", atomically: true, encoding: .utf8)
    for (k, v) in rt.stats.sorted(by: { $0.key < $1.key }) {
        print(String(format: "  %@: %d plays, %.1f yd/play", k, v.plays, v.yards / Double(max(1, v.plays))))
    }
}

// 6. Breakaway speed-lines scene (M2) for regression.
do {
    rt = GameRuntime(league: league)
    rt.debugBreakaway()
    var still2: PixelBuffer?
    for _ in 0..<(60 * 3) {
        touchStick(Vec2(0.25, 1).normalized)
        let fr = rt.advance(frameTime: 1.0 / 60)
        if still2 == nil, let sl = fr.effects.speedLines, sl.intensity > 0.9 { still2 = composite(fr, joystick: rt.touches.joystick) }
    }
    releaseStick()
    if let s2 = still2 { try writePNG(upscaled(s2, 3), to: "\(outDir)/still_breakaway.png") }
}

let t0 = Date()
var scratch = PixelBuffer(width: Canvas.width, height: Canvas.height)
let cam = rt.advance(frameTime: 1.0 / 60).camera
for i in 0..<240 { field.render(into: &scratch, camera: cam, crowdFrame: i & 1) }
print(String(format: "field raster: %.3f ms/frame (release, this machine)", Date().timeIntervalSince(t0) / 240 * 1000))
