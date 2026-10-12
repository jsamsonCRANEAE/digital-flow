import XCTest
@testable import GSFoundation
@testable import GSData
@testable import GSInput
@testable import GSSimulation
@testable import GSRenderCore
@testable import GSGame

final class GameRuntimeTests: XCTestCase {
    func makeRuntime() throws -> GameRuntime { GameRuntime(league: try DataLoader.bundledLeague()) }

    func testJoystickMovesControlledPlayerDownfield() throws {
        let rt = try makeRuntime()
        snapAndSettle(rt)
        let startY = rt.world.controlled.body.position.y
        rt.handle(TouchEvent(id: 1, phase: .began, location: Vec2(120, 220)))
        rt.handle(TouchEvent(id: 1, phase: .moved, location: Vec2(140, 190)))
        for _ in 0..<120 { _ = rt.advance(frameTime: 1.0 / 60) }
        XCTAssertGreaterThan(rt.world.controlled.body.position.y, startY + 6)
        XCTAssertGreaterThan(rt.world.controlled.body.position.x, Field.centerX)
    }

    func snapAndSettle(_ rt: GameRuntime) {
        rt.perform(.button(.snap))
        for _ in 0..<40 { _ = rt.advance(frameTime: 1.0 / 60) }
        XCTAssertEqual(rt.world.carrierID, rt.world.quarterback?.id, "QB should have the snap")
    }

    func testInputAppliedOnTheVeryNextFrame() throws {
        let rt = try makeRuntime()
        snapAndSettle(rt)
        rt.handle(TouchEvent(id: 1, phase: .began, location: Vec2(120, 220)))
        rt.handle(TouchEvent(id: 1, phase: .moved, location: Vec2(120, 180)))
        _ = rt.advance(frameTime: 1.0 / 60)
        XCTAssertGreaterThan(rt.world.controlled.body.velocity.y, 0.1, "touch must affect the frame being built")
    }

    func testFrameSpritesAreSnappedSortedAndShadowed() throws {
        let rt = try makeRuntime()
        var last: RenderFrame?
        for _ in 0..<90 { last = rt.advance(frameTime: 1.0 / 120 * 1.37) }   // odd frame time -> non-zero alpha
        let f = try XCTUnwrap(last)
        XCTAssertEqual(f.sprites.count, 14)
        let orders = f.sprites.map(\.drawOrder)
        XCTAssertEqual(orders, orders.sorted())
        for s in f.sprites where s.visible {
            XCTAssertEqual(s.footX, s.shadowX)      // everyone on the ground pre-snap
            XCTAssertEqual(s.footY, s.shadowY)
            XCTAssert(s.height % 2 == 0)
        }
        XCTAssertEqual(f.sprites.filter(\.isControlled).count, 1)
        XCTAssertEqual(f.camera.horizonY, rt.cameraConfig.horizonRow, accuracy: 1e-9)
    }

    func testGovernorDropsTo60WhenOverBudget() {
        var g = FrameRateGovernor(displayMaxFPS: 120)
        XCTAssertEqual(g.targetFPS, 120)
        for _ in 0..<119 { XCTAssertNil(g.record(frameWork: 0.003)) }
        XCTAssertNil(g.record(frameWork: 0.003))
        for _ in 0..<119 { _ = g.record(frameWork: 0.008) }
        XCTAssertEqual(g.record(frameWork: 0.008), 60)
        XCTAssertEqual(FrameRateGovernor(displayMaxFPS: 60).targetFPS, 60)
    }

    /// Software-side performance budget for the per-frame CPU field raster.
    /// (Reported, not asserted tightly: CI machines vary. Release build on an
    /// A14 is the real target; see MILESTONES.md.)
    func testFieldRasterTiming() throws {
        let rt = try makeRuntime()
        let style = FieldStyle(homeEndZone: rt.offenseTeam.colors.primaryRGBA, awayEndZone: rt.defenseTeam.colors.primaryRGBA)
        let r = FieldRasterizer(style: style, backdrop: StadiumBackdrop(horizonRow: 96, home: style.homeEndZone, away: style.awayEndZone))
        var buf = PixelBuffer(width: Canvas.width, height: Canvas.height)
        let f = rt.advance(frameTime: 1.0 / 60)
        let t0 = Date()
        for i in 0..<60 { r.render(into: &buf, camera: f.camera, crowdFrame: i & 1) }
        let ms = Date().timeIntervalSince(t0) / 60 * 1000
        print("Field raster: \(String(format: "%.2f", ms)) ms/frame")
        XCTAssertLessThan(ms, 40)
    }
}
