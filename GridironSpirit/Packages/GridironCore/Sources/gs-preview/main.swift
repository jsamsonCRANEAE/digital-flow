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

let outDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."
let league = try DataLoader.bundledLeague()
let rt = GameRuntime(league: league)
let style = FieldStyle(homeEndZone: rt.offenseTeam.colors.primaryRGBA, awayEndZone: rt.defenseTeam.colors.primaryRGBA)
let field = FieldRasterizer(style: style, backdrop: StadiumBackdrop(horizonRow: Int(rt.cameraConfig.horizonRow),
                                                                    home: style.homeEndZone, away: style.awayEndZone))

var shadowCache: [Int: PixelBuffer] = [:]
func composite(_ f: RenderFrame, joystick: VirtualJoystick?) -> PixelBuffer {
    var canvas = PixelBuffer(width: Canvas.width, height: Canvas.height)
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
            var spr = PlaceholderSprites.player(height: s.height, look: rt.looks[s.teamIndex], view: s.view, pose: s.pose, squash: s.squash)
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
        let spr = FXSprites.receiverIcon(slot: icon.slot, charging: f.chargingReceiver == icon.receiverID)
        canvas.blit(spr, x: snapToPixel(icon.center.x) - spr.width / 2, y: snapToPixel(icon.center.y) - spr.height / 2)
    }
    for (i, b) in f.buttons.enumerated() where b.action != nil {
        let spr = FXSprites.button(radius: Int(b.radius), slot: i, label: b.label, enabled: b.enabled, pressed: b.pressed)
        canvas.blit(spr, x: snapToPixel(b.center.x) - spr.width / 2, y: snapToPixel(b.center.y) - spr.height / 2)
    }
    if let j = joystick, j.isActive {
        let r = Int(j.config.radius)
        let base = PlaceholderSprites.joystickBase(radius: r), knob = PlaceholderSprites.joystickKnob(radius: 9)
        canvas.blit(base, x: snapToPixel(j.base.x) - base.width / 2, y: snapToPixel(j.base.y) - base.height / 2)
        canvas.blit(knob, x: snapToPixel(j.knob.x) - knob.width / 2, y: snapToPixel(j.knob.y) - knob.height / 2)
    }
    if let c = f.callout {
        canvas.drawText(c, x: (Canvas.width - PixelFont.width(of: c)) / 2, y: 104, .init(hex: 0xFFE45C), shadow: Palette.outline)
    }
    canvas.drawText("\(rt.offenseTeam.abbreviation) VS \(rt.defenseTeam.abbreviation)  PLAY \(rt.playCount)", x: 6, y: 6, .init(hex: 0xFFFFFF), shadow: Palette.outline)
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

// --- Scripted plays through the real runtime ---
func touchStick(_ dir: Vec2) {
    // Hold the joystick: base at (110, 220), knob offset by dir * radius.
    if !rt.touches.joystick.isActive { rt.handle(TouchEvent(id: 1, phase: .began, location: Vec2(110, 220))) }
    rt.handle(TouchEvent(id: 1, phase: .moved, location: Vec2(110 + dir.x * 22, 220 - dir.y * 22)))
}
func releaseStick() { rt.handle(TouchEvent(id: 1, phase: .ended, location: Vec2(110, 220))) }

/// Plays one snap with a simple "human" script. Returns frames (every 2nd at 60 Hz = 30 fps).
func playScripted(lob: Bool, targetPos: Position, targetSide: Int, record: Bool) -> (frames: [PixelBuffer], summary: String) {
    var out: [PixelBuffer] = []
    var summary: [String] = []
    let startPlay = rt.playCount
    var t = 0
    var thrown = false, juked = false
    var stills: [(String, PixelBuffer)] = []
    while rt.playCount == startPlay && t < 60 * 14 {
        let w = rt.world
        if t == 20 { rt.perform(.button(.snap)) }
        if w.canThrow {
            if t > 20 && t < 60 { touchStick(Vec2(0, -0.6)) } else { releaseStick() }   // drop back
            if t >= 70 && !thrown {
                let rcv = w.players.filter { $0.data.position == targetPos }
                    .sorted { $0.body.position.x < $1.body.position.x }
                let target = rcv[min(targetSide, rcv.count - 1)]
                rt.perform(.throwTo(receiver: target.id, lob: lob))
                thrown = true
            }
        } else if let c = w.carrierID, c == w.controlledID, w.phase.isLive, w.player(c).data.position != .qb {
            // After the catch: run to daylight, juke the first close defender.
            let me = w.player(c).body.position.ground
            let threats = w.players.filter { $0.side == .defense && $0.status.canMakePlays }
            let near = threats.map { ($0.body.position.ground - me).length }.min() ?? 99
            let dodge = threats.min { ($0.body.position.ground - me).length < ($1.body.position.ground - me).length }
            let away = dodge.map { (me - $0.body.position.ground).normalized } ?? .zero
            touchStick((Vec2(0, 1) + away * (near < 6 ? 0.6 : 0)).normalized)
            if near < 3.2 && !juked { rt.perform(.button(.juke)); juked = true }
        }
        let f = rt.advance(frameTime: 1.0 / 60)
        if let c = f.callout, summary.last != c { summary.append(c) }
        if record && t % 2 == 0 { out.append(composite(f, joystick: rt.touches.joystick)) }
        if record, f.impactFrame || (f.callout != nil && stills.count < 6 && stills.last?.0 != f.callout) {
            stills.append((f.callout ?? "IMPACT", composite(f, joystick: rt.touches.joystick)))
        }
        if record && t == 84 { stills.append(("in_flight", composite(f, joystick: rt.touches.joystick))) }
        t += 1
    }
    releaseStick()
    for (i, s) in stills.enumerated() {
        let name = s.0.lowercased().filter { $0.isLetter || $0 == "_" }
        try? writePNG(upscaled(s.1, 3), to: "\(outDir)/still_p\(startPlay)_\(i)_\(name).png")
    }
    return (out, summary.joined(separator: " > "))
}

func writeRaw(_ frames: [PixelBuffer], to path: String) throws {
    var bytes: [UInt8] = []
    bytes.reserveCapacity(frames.count * Canvas.width * Canvas.height * 3)
    for f in frames { for v in f.pixels { let c = RGBA(argb: v); bytes += [c.r, c.g, c.b] } }
    try Data(bytes).write(to: URL(fileURLWithPath: path))
}

let scripts: [(String, Bool, Position, Int)] = [
    ("bullet_slant", false, .wr, 1),
    ("lob_go", true, .wr, 0),
    ("swing_rb", false, .rb, 0),
]
for (name, lob, pos, side) in scripts {
    let (frames, summary) = playScripted(lob: lob, targetPos: pos, targetSide: side, record: true)
    try writeRaw(frames, to: "\(outDir)/\(name).rgb")
    print("\(name): \(frames.count) frames  [\(summary)]")
    // Let the dead-ball pause finish so the next script starts at a fresh snap.
    while rt.world.phase != .preSnap { _ = rt.advance(frameTime: 1.0 / 60) }
}

// Breakaway: open-field sprint to show speed lines and lead-angle pursuit.
do {
    rt.debugBreakaway()
    var frames: [PixelBuffer] = []
    var still: PixelBuffer?
    for t in 0..<(60 * 5) {
        touchStick(Vec2(0.25, 1).normalized)
        let f = rt.advance(frameTime: 1.0 / 60)
        if t % 2 == 0 { frames.append(composite(f, joystick: rt.touches.joystick)) }
        if still == nil && f.effects.speedLines != nil && f.effects.speedLines!.intensity > 0.9 {
            still = composite(f, joystick: rt.touches.joystick)
        }
        if rt.world.phase.isDead && rt.world.timeSinceWhistle > 1 { break }
    }
    releaseStick()
    try writeRaw(frames, to: "\(outDir)/breakaway.rgb")
    if let s = still { try writePNG(upscaled(s, 3), to: "\(outDir)/still_breakaway_speedlines.png") }
    print("breakaway: \(frames.count) frames, speed lines \(still != nil ? "shown" : "NOT shown")")
}

let t0 = Date()
var scratch = PixelBuffer(width: Canvas.width, height: Canvas.height)
let cam = rt.advance(frameTime: 1.0 / 60).camera
for i in 0..<240 { field.render(into: &scratch, camera: cam, crowdFrame: i & 1) }
print(String(format: "field raster: %.3f ms/frame (release, this machine)", Date().timeIntervalSince(t0) / 240 * 1000))
