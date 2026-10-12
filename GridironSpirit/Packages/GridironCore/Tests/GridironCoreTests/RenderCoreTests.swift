import XCTest
@testable import GSFoundation
@testable import GSSimulation
@testable import GSRenderCore

final class RenderCoreTests: XCTestCase {
    let config = CameraConfig()
    var camera: Camera { CameraRig.camera(for: .init(focus: Vec2(26.67, 35), zoom: 1), config: config) }

    func testHorizonMatchesConfig() {
        XCTAssertEqual(camera.horizonY, config.horizonRow, accuracy: 1e-9)
        XCTAssertNil(camera.groundRow(Int(config.horizonRow) - 1))
        XCTAssertNotNil(camera.groundRow(Int(config.horizonRow)))
    }

    /// Projecting a ground point and casting the ray back for its row/column
    /// must land on the same point (the field and sprites agree).
    func testProjectionAndGroundRaysAgree() {
        let cam = camera
        for p in [Vec2(26, 40), Vec2(5, 60), Vec2(48, 31), Vec2(30, 90)] {
            guard let s = cam.project(Vec3(p)) else { return XCTFail("not visible \(p)") }
            let row = Int(s.y.rounded(.down))
            guard let g = cam.groundRow(row) else { return XCTFail() }
            let worldX = g.xAtColumn0 + (s.x - 0.5) * g.yardsPerPixelX
            let ppy = s.pixelsPerYard
            XCTAssertEqual(g.worldY, p.y, accuracy: 1.5 / ppy * (p.y - cam.position.y) / 3 + 0.5)
            XCTAssertEqual(worldX, p.x, accuracy: 0.05)
        }
    }

    func testFocusSitsInLowerHalfAndPlayerIsArcadeSized() {
        let cam = camera
        let p = cam.project(Vec3(26.67, 35, 0))!
        XCTAssertGreaterThan(p.y, 180)
        XCTAssertLessThan(p.y, 250)
        let h = SpriteMetrics.playerHeight(pixelsPerYard: p.pixelsPerYard)
        XCTAssert((40...56).contains(h), "player at focus is \(h) px tall")
    }

    func testYardLinesConvergeTowardHorizon() {
        let cam = camera
        func spacing(_ y: Double) -> Double { cam.project(Vec3(26, y, 0))!.y - cam.project(Vec3(26, y + 5, 0))!.y }
        XCTAssertGreaterThan(spacing(30), spacing(50))
        XCTAssertGreaterThan(spacing(50), spacing(80))
        // Sidelines converge: field is narrower in pixels further away.
        func width(_ y: Double) -> Double { cam.project(Vec3(Field.width, y, 0))!.x - cam.project(Vec3(0, y, 0))!.x }
        XCTAssertGreaterThan(width(30), width(70))
    }

    func testShadowStaysOnGroundWhenHeightChanges() {
        let cam = camera
        let ground = cam.project(Vec3(26, 40, 0))!, air = cam.project(Vec3(26, 40, 1.5))!
        XCTAssertLessThan(air.y, ground.y - 10, "airborne body must rise on screen")
        // Height changes view depth slightly (pitched camera) but not the column.
        XCTAssertEqual(air.x, ground.x, accuracy: 0.5)
    }

    func testIntegerScaleOnRealDevices() {
        // (device, landscape native drawable px, expected scale)
        let cases: [(String, Int, Int, Int)] = [
            ("iPhone 12 mini", 2340, 1080, 3), ("iPhone 12/13/14", 2532, 1170, 3),
            ("iPhone 15 Pro", 2556, 1179, 3), ("iPhone 14 Pro Max", 2796, 1290, 4),
            ("iPhone 16 Pro Max", 2868, 1320, 4), ("iPhone SE 3", 1334, 750, 2),
        ]
        for (name, w, h, s) in cases {
            let l = CanvasLayout(drawableWidth: w, drawableHeight: h)
            XCTAssertEqual(l.scale, s, name)
            XCTAssertLessThanOrEqual(l.scaledWidth + 2 * l.originX, w)
            XCTAssertGreaterThanOrEqual(l.originX, 0)
            // Round-trip a touch through the layout.
            let p = l.canvasPoint(drawableX: Double(l.originX + 10 * s + 1), drawableY: Double(l.originY + 5 * s + 1))
            XCTAssertEqual(Int(p.x), 10, name); XCTAssertEqual(Int(p.y), 5, name)
        }
    }

    func testSafeRectExcludesInsets() {
        let l = CanvasLayout(drawableWidth: 2796, drawableHeight: 1290)
        // 59 pt side insets at 3x and 21 pt home indicator.
        let r = l.safeRect(insetTop: 0, insetLeft: 177, insetBottom: 63, insetRight: 177)
        XCTAssertGreaterThan(r.minX, 0)
        XCTAssertLessThan(r.maxX, Double(Canvas.width))
        XCTAssertLessThan(r.maxY, Double(Canvas.height))
    }

    func testSnapIsStableAndIntegral() {
        XCTAssertEqual(snapToPixel(10.49), 10)
        XCTAssertEqual(snapToPixel(10.5), 11)
        XCTAssertEqual(snapToPixel(-0.5), 0)
        XCTAssertEqual(snapToPixel(-0.51), -1)
    }

    /// Every 5-yard line within view must cover at least one row: thin lines
    /// never vanish (the main cause of flicker in pseudo-3D fields).
    func testEveryVisibleYardLineHitsAPixelRow() {
        let backdrop = StadiumBackdrop(horizonRow: 96, home: RGBA(hex: 0xD8452B), away: RGBA(hex: 0xE83E9C))
        let r = FieldRasterizer(style: FieldStyle(homeEndZone: RGBA(hex: 0xD8452B), awayEndZone: RGBA(hex: 0xE83E9C)),
                                backdrop: backdrop)
        var buf = PixelBuffer(width: Canvas.width, height: Canvas.height)
        for focusY in stride(from: 25.0, through: 45.0, by: 0.37) {   // camera moves continuously
            let cam = CameraRig.camera(for: .init(focus: Vec2(26.67, focusY), zoom: 1), config: config)
            r.render(into: &buf, camera: cam, crowdFrame: 0)
            let col = Canvas.width / 2 + 7
            var lineRows = Set<Int>()
            for row in 0..<Canvas.height where buf[col, row] == Palette.line.argb || buf[col, row] == Palette.lineHaze.argb {
                lineRows.insert(row)
            }
            for yl in stride(from: 10.0, through: 110.0, by: 5) {
                guard let p0 = cam.project(Vec3(26.67, yl, 0)),
                      let p = cam.project(Vec3(26.67 + 7 / p0.pixelsPerYard, yl, 0)),
                      p.y < Double(Canvas.height) - 1, p.y > config.horizonRow + 2, p.depth < 80 else { continue }
                let row = Int(p.y)
                XCTAssertTrue(lineRows.contains(row) || lineRows.contains(row - 1) || lineRows.contains(row + 1),
                              "yard line \(yl) missing at focus \(focusY) (row \(row))")
            }
        }
    }

    func testPlaceholderSpritesFollowPixelRules() {
        let look = PlayerLook(jersey: RGBA(hex: 0xD8452B), trim: RGBA(hex: 0xF1E6C8), pants: RGBA(hex: 0x25233A),
                              helmet: RGBA(hex: 0x25233A), skin: Palette.skinTones[1])
        for h in stride(from: SpriteMetrics.minHeight, through: SpriteMetrics.maxHeight, by: 2) {
            for f in 0..<PlaceholderSprites.frameCount {
                let b = PlaceholderSprites.player(height: h, look: look, view: .front, frame: f)
                XCTAssertEqual(b.height, h)
                // Every opaque edge pixel touching transparency must be the outline color.
                for y in 0..<b.height {
                    for x in 0..<b.width where b.isOpaque(x, y) {
                        let edge = !b.isOpaque(x - 1, y) || !b.isOpaque(x + 1, y) || !b.isOpaque(x, y - 1) || !b.isOpaque(x, y + 1)
                        if edge { XCTAssertEqual(b[x, y], Palette.outline.argb, "h\(h) f\(f) (\(x),\(y))") }
                    }
                }
                if h >= 40 { XCTAssert((8...28).contains(b.distinctOpaqueColors), "h\(h): \(b.distinctOpaqueColors) colors") }
            }
        }
    }

    func testFontCoversSponsorsAndUI() {
        for s in StadiumBackdrop.sponsors + ["GRIDIRON SPIRIT", "3RD & 4", "TOUCHDOWN!", "FIRST DOWN!", "SACK!", "INTERCEPTION!", "SPD POW CATCH"] {
            for ch in s { XCTAssertNotNil(PixelFont.glyph(ch), "missing glyph '\(ch)'") }
        }
        XCTAssertTrue(PixelFont.digitBit(1, 2, 0))
        XCTAssertFalse(PixelFont.digitBit(1, 0, 0))
    }

    func testShakeDecaysToZeroWithinBounds() {
        var rig = CameraRig(focus: Vec2(26, 30))
        rig.addShake(amplitude: 4, duration: 0.15)
        var maxAbs = 0
        for _ in 0..<30 {
            rig.update(dt: 1.0 / 120, carrier: Vec2(26, 30), carrierVelocity: .zero)
            maxAbs = max(maxAbs, abs(rig.shakeOffset.x), abs(rig.shakeOffset.y))
        }
        XCTAssertLessThanOrEqual(maxAbs, 4)
        XCTAssertGreaterThanOrEqual(maxAbs, 1)
        XCTAssertEqual(rig.shakeOffset.x, 0); XCTAssertEqual(rig.shakeOffset.y, 0)
    }

    func testCameraLeadsCarrier() {
        var rig = CameraRig(focus: Vec2(26, 30))
        var carrier = Vec2(26, 30)
        for _ in 0..<240 {
            carrier.y += 9.0 / 120
            rig.update(dt: 1.0 / 120, carrier: carrier, carrierVelocity: Vec2(0, 9))
        }
        XCTAssertGreaterThan(rig.state.focus.y, carrier.y, "camera should look ahead of a sprinting carrier")
        XCTAssertLessThan(rig.state.focus.y - carrier.y, CameraConfig().maxLookAhead + 0.01)
    }

    func testFramingZoomsOutForDistantPair() {
        var rig = CameraRig(focus: Vec2(26, 30))
        rig.mode = .frame(Vec2(26, 30), Vec2(45, 65))
        for _ in 0..<480 { rig.update(dt: 1.0 / 120, carrier: .zero, carrierVelocity: .zero) }
        XCTAssertGreaterThan(rig.state.zoom, 1.1)
    }
}
