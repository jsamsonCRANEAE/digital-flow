import XCTest
@testable import GSFoundation

final class FoundationTests: XCTestCase {
    func testFixedTimestepRuns120HzRegardlessOfDisplayRate() {
        for fps in [30.0, 60.0, 120.0, 144.0] {
            var ts = FixedTimestep(hz: 120)
            var steps = 0
            for _ in 0..<Int(fps * 2) { ts.advance(by: 1 / fps) { _ in steps += 1 } }
            XCTAssertEqual(steps, 240, accuracy: 1, "fps \(fps)")
        }
    }

    func testFixedTimestepAt60HzIsExactlyTwoStepsEveryFrame() {
        var ts = FixedTimestep(hz: 120)
        for _ in 0..<600 {
            var steps = 0
            ts.advance(by: 1.0 / 60) { _ in steps += 1 }
            XCTAssertEqual(steps, 2)
        }
    }

    func testFixedTimestepClampsStalls() {
        var ts = FixedTimestep(hz: 120, maxFrameTime: 0.1)
        var steps = 0
        let alpha = ts.advance(by: 5.0) { _ in steps += 1 }
        XCTAssertEqual(steps, 12)
        XCTAssert(alpha >= 0 && alpha < 1)
    }

    func testAlphaIsLeftoverFraction() {
        var ts = FixedTimestep(hz: 100)
        let a = ts.advance(by: 0.015) { _ in }
        XCTAssertEqual(a, 0.5, accuracy: 1e-6)
    }

    func testRNGDeterministic() {
        var a = SplitMix64(seed: 42), b = SplitMix64(seed: 42)
        for _ in 0..<100 { XCTAssertEqual(a.next(), b.next()) }
        XCTAssertEqual(SplitMix64.hash(3, 4), SplitMix64.hash(3, 4))
        XCTAssertNotEqual(SplitMix64.hash(3, 4), SplitMix64.hash(4, 3))
    }

    func testWrapAngle() {
        XCTAssertEqual(wrapAngle(3 * .pi), .pi, accuracy: 1e-9)
        XCTAssertEqual(wrapAngle(-3 * .pi / 2), .pi / 2, accuracy: 1e-9)
        XCTAssertEqual(lerpAngle(.pi - 0.1, -.pi + 0.1, 0.5).magnitude, .pi, accuracy: 1e-9)
    }

    func testHueShiftDirections() {
        let red = RGBA(hex: 0xD8452B)
        let shadow = red.hueShifted(-0.6), light = red.hueShifted(0.6)
        XCTAssertLessThan(shadow.hsv.v, red.hsv.v)
        XCTAssertGreaterThan(light.hsv.v, red.hsv.v)
        // Shadow hue moves toward purple (wraps past 360), highlight toward yellow.
        XCTAssertTrue(shadow.hsv.h > 300 || shadow.hsv.h < red.hsv.h - 1)
        XCTAssertGreaterThan(light.hsv.h, red.hsv.h)
        XCTAssertEqual(RGBA(hexString: "#12AB34")?.hexString, "#12AB34")
        XCTAssertNil(RGBA(hexString: "zz"))
    }
}
