import XCTest
@testable import GSFoundation
@testable import GSSimulation
@testable import GSRenderCore

final class M2RenderTests: XCTestCase {
    let look = PlayerLook(jersey: RGBA(hex: 0xD8452B), trim: RGBA(hex: 0xF1E6C8), pants: RGBA(hex: 0x25233A),
                          helmet: RGBA(hex: 0x25233A), skin: Palette.skinTones[1])

    func assertOutlined(_ b: PixelBuffer, _ msg: String) {
        for y in 0..<b.height {
            for x in 0..<b.width where b.isOpaque(x, y) {
                let edge = !b.isOpaque(x - 1, y) || !b.isOpaque(x + 1, y) || !b.isOpaque(x, y - 1) || !b.isOpaque(x, y + 1)
                if edge { XCTAssertEqual(b[x, y], Palette.outline.argb, "\(msg) (\(x),\(y))"); return }
            }
        }
    }

    func testAllPosesAndSquashKeepOnePixelOutline() {
        for h in [16, 32, 48, 64] {
            for pose in SpritePose.allCases {
                for sq in [-1, 0, 1] {
                    let b = PlaceholderSprites.player(height: h, look: look, view: .back, pose: pose, squash: sq)
                    XCTAssertGreaterThan(b.distinctOpaqueColors, 3)
                    assertOutlined(b, "h\(h) \(pose) sq\(sq)")
                }
            }
        }
        let lying = PlaceholderSprites.player(height: 48, look: look, view: .back, pose: .down, squash: 0)
        XCTAssertGreaterThan(lying.width, lying.height, "down pose lies horizontally")
        let sq = PlaceholderSprites.player(height: 48, look: look, view: .back, pose: .idle, squash: -1)
        XCTAssertLessThan(sq.height, 48)
    }

    func testBallSpriteOrientationAndSpin() {
        let flat = FXSprites.ball(length: 10, angleBucket: 0, spinFrame: 0)
        let up = FXSprites.ball(length: 10, angleBucket: 4, spinFrame: 0)
        func extent(_ b: PixelBuffer) -> (Int, Int) {
            var xs = Set<Int>(), ys = Set<Int>()
            for y in 0..<b.height { for x in 0..<b.width where b.isOpaque(x, y) { xs.insert(x); ys.insert(y) } }
            return (xs.count, ys.count)
        }
        XCTAssertGreaterThan(extent(flat).0, extent(flat).1)
        XCTAssertGreaterThan(extent(up).1, extent(up).0, "90 degrees: long axis vertical")
        XCTAssertNotEqual(FXSprites.ball(length: 10, angleBucket: 0, spinFrame: 0).pixels,
                          FXSprites.ball(length: 10, angleBucket: 0, spinFrame: 2).pixels, "laces rotate with spin")
    }

    /// Height must be readable from the shadow alone.
    func testBallShadowShrinksAndThinsWithHeight() {
        let cam = CameraRig.camera(for: .init(focus: Vec2(26.67, 35), zoom: 1), config: CameraConfig())
        func shadowPixels(z: Double) -> Int {
            var buf = PixelBuffer(width: Canvas.width, height: Canvas.height, fill: Palette.turfLight)
            var fx = EffectsFrame()
            fx.ballForShadow = Vec3(26.67, 38, z)
            EffectsRasterizer.render(fx, camera: cam, into: &buf)
            return buf.pixels.filter { $0 != Palette.turfLight.argb }.count
        }
        let low = shadowPixels(z: 0.5), mid = shadowPixels(z: 6), high = shadowPixels(z: 14)
        XCTAssertGreaterThan(low, mid); XCTAssertGreaterThan(mid, high); XCTAssertGreaterThan(high, 0, "never disappears")
    }

    func testSpeedLinesLeaveTheRunnerClear() {
        var buf = PixelBuffer(width: Canvas.width, height: Canvas.height, fill: Palette.turfLight)
        var fx = EffectsFrame()
        fx.speedLines = (320, 200, 1, 7)
        EffectsRasterizer.render(fx, camera: CameraRig.camera(for: .init(focus: Vec2(26, 30), zoom: 1), config: CameraConfig()), into: &buf)
        var near = 0, total = 0
        for y in 0..<buf.height { for x in 0..<buf.width where buf[x, y] != Palette.turfLight.argb {
            total += 1
            if (Double(x) - 320) * (Double(x) - 320) + (Double(y) - 200) * (Double(y) - 200) < 60 * 60 { near += 1 }
        } }
        XCTAssertGreaterThan(total, 300)
        XCTAssertEqual(near, 0)
    }

    func testControlSpritesExist() {
        for slot in 0..<3 {
            XCTAssertGreaterThan(FXSprites.receiverIcon(slot: slot, charging: true).width, FXSprites.receiverIcon(slot: slot, charging: false).width)
            let b = FXSprites.button(radius: 22, slot: slot, label: "JUKE", enabled: true, pressed: false)
            XCTAssertEqual(b.width, 47)
        }
        for f in 0..<3 { XCTAssertGreaterThan(FXSprites.starburst(size: 21, frame: f).distinctOpaqueColors, 2) }
    }
}
