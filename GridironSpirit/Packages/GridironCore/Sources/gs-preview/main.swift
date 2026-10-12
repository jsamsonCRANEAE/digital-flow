// Dev tool: renders M1 frames entirely on the CPU (same core code the game
// uses, composited like the SpriteKit layer) and writes PNGs for review.
//   swift run -c release gs-preview <output-dir>
import Foundation
import GSFoundation
import GSData
import GSInput
import GSRenderCore
import GSGame

let outDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."
let league = try DataLoader.bundledLeague()
let rt = GameRuntime(league: league)
let style = FieldStyle(homeEndZone: rt.offenseTeam.colors.primaryRGBA, awayEndZone: rt.defenseTeam.colors.primaryRGBA)
let field = FieldRasterizer(style: style, backdrop: StadiumBackdrop(horizonRow: Int(rt.cameraConfig.horizonRow),
                                                                    home: style.homeEndZone, away: style.awayEndZone))

func composite(_ f: RenderFrame, joystick: VirtualJoystick?) -> PixelBuffer {
    var canvas = PixelBuffer(width: Canvas.width, height: Canvas.height)
    field.render(into: &canvas, camera: f.camera, crowdFrame: f.crowdFrame)
    // Shadows (alpha ~0.45 approximated by darkening).
    for s in f.sprites where s.visible {
        let sh = PlaceholderSprites.shadow(width: s.shadowWidth)
        for y in 0..<sh.height { for x in 0..<sh.width where sh.isOpaque(x, y) {
            let cx = s.shadowX - sh.width / 2 + x, cy = s.shadowY - sh.height / 2 + y
            guard canvas.contains(cx, cy) else { continue }
            canvas.set(cx, cy, canvas.color(cx, cy).mixed(with: Palette.shadow, 0.45))
        } }
    }
    for s in f.sprites where s.visible {
        var spr = PlaceholderSprites.player(height: s.height, look: rt.looks[s.teamIndex], view: s.view, frame: s.frame)
        if s.flipX {
            var flipped = spr
            for y in 0..<spr.height { for x in 0..<spr.width { flipped[x, y] = spr[spr.width - 1 - x, y] } }
            spr = flipped
        }
        canvas.blit(spr, x: s.footX - spr.width / 2, y: s.footY - spr.height + 1)
        if s.isControlled {
            let m = PlaceholderSprites.controlMarker()
            canvas.blit(m, x: s.footX - m.width / 2, y: s.footY - spr.height - m.height - 1)
        }
    }
    if let j = joystick, j.isActive {
        let r = Int(j.config.radius)
        let base = PlaceholderSprites.joystickBase(radius: r), knob = PlaceholderSprites.joystickKnob(radius: 9)
        canvas.blit(base, x: snapToPixel(j.base.x) - base.width / 2, y: snapToPixel(j.base.y) - base.height / 2)
        canvas.blit(knob, x: snapToPixel(j.knob.x) - knob.width / 2, y: snapToPixel(j.knob.y) - knob.height / 2)
    }
    canvas.drawText("M1 PREVIEW  \(rt.offenseTeam.abbreviation) VS \(rt.defenseTeam.abbreviation)", x: 6, y: 6, .init(hex: 0xFFFFFF), shadow: Palette.outline)
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

// Scenario: idle lineup, then the RB sprints up-right with the joystick.
var frames: [(String, RenderFrame, VirtualJoystick?)] = []
frames.append(("01_lineup", rt.advance(frameTime: 1.0 / 60), nil))
rt.handle(TouchEvent(id: 1, phase: .began, location: Vec2(110, 220)))
rt.handle(TouchEvent(id: 1, phase: .moved, location: Vec2(122, 200)))
var f = rt.advance(frameTime: 1.0 / 60)
for _ in 0..<50 { f = rt.advance(frameTime: 1.0 / 60) }
frames.append(("02_running", f, rt.touches.joystick))
for _ in 0..<110 { f = rt.advance(frameTime: 1.0 / 60) }
frames.append(("03_open_field", f, rt.touches.joystick))

var timings: [Double] = []
for (name, frame, j) in frames {
    let t0 = Date()
    let c = composite(frame, joystick: j)
    timings.append(Date().timeIntervalSince(t0))
    try writePNG(c, to: "\(outDir)/\(name)_640x296.png")
    try writePNG(upscaled(c, 3, letterbox: (2532, 1170)), to: "\(outDir)/\(name)_iphone12_3x.png")
}
let t0 = Date()
var scratch = PixelBuffer(width: Canvas.width, height: Canvas.height)
for i in 0..<240 { field.render(into: &scratch, camera: f.camera, crowdFrame: i & 1) }
print(String(format: "field raster: %.3f ms/frame (release, this machine)", Date().timeIntervalSince(t0) / 240 * 1000))
print("wrote \(frames.count * 2) PNGs to \(outDir)")
