import XCTest
@testable import GSFoundation
@testable import GSSimulation
@testable import GSAI

final class ResolverTests: XCTestCase {
    func ctx(catching: Int = 85, offense: Bool = true, contest: Double = 0, centered: Double = 0.7, speed: Double = 18) -> CatchContext {
        CatchContext(catching: catching, isOffense: offense, isIntendedReceiver: true, ballSpeed: speed,
                     ballHeight: 1.3, centered: centered, contest: contest, diving: false)
    }

    func testCatchProbabilityResponds() {
        XCTAssertGreaterThan(CatchResolver.probabilities(ctx(catching: 95)).catch, CatchResolver.probabilities(ctx(catching: 45)).catch)
        XCTAssertLessThan(CatchResolver.probabilities(ctx(contest: 1)).catch, CatchResolver.probabilities(ctx()).catch - 0.3)
        XCTAssertGreaterThan(CatchResolver.probabilities(ctx()).catch, 0.8, "open, centered catch by a good WR")
        let d = CatchResolver.probabilities(ctx(catching: 70, offense: false))
        XCTAssertGreaterThan(d.deflect, d.catch, "defenders break up more than they pick")
    }

    func tackle(tacklerMass: Double = 210, carrierMass: Double = 200, closing: Double = 7, frontal: Double = 1,
                move: MoveKind? = nil, moveAge: Double = 0.1) -> TackleContext {
        TackleContext(tacklerMass: tacklerMass, tacklerStrength: 75, tacklerSpeed: 7, carrierMass: carrierMass,
                      carrierStrength: 65, carrierBalance: 75, closingSpeed: closing, frontalness: frontal,
                      carrierSpeed: 8, move: move, moveAge: moveAge)
    }

    func rate(_ c: TackleContext, _ pred: (TackleResult) -> Bool) -> Double {
        var rng = SplitMix64(seed: 11)
        var n = 0
        for _ in 0..<2000 where pred(TackleResolver.resolve(c, rolls: (rng.unit(), rng.unit(), rng.unit()))) { n += 1 }
        return Double(n) / 2000
    }

    func testImpactUsesReducedMassAndClosingSpeed() {
        XCTAssertGreaterThan(TackleResolver.impact(tackle(tacklerMass: 300, closing: 10)), TackleResolver.bigHitImpact)
        XCTAssertLessThan(TackleResolver.impact(tackle(tacklerMass: 185, carrierMass: 185, closing: 3)), 3)
    }

    func testOutcomesShiftWithMovesAndAngles() {
        let downed: (TackleResult) -> Bool = { $0.outcome == .clean || $0.outcome == .pushedForward }
        let base = rate(tackle(frontal: 0), downed)
        XCTAssertLessThan(rate(tackle(frontal: 0, move: .spin), downed), base - 0.15, "spin beats side tackles")
        XCTAssertLessThan(rate(tackle(frontal: 0.8, move: .stiffArm), downed), rate(tackle(frontal: 0.8), downed) - 0.15)
        XCTAssertGreaterThan(rate(tackle(frontal: -1), downed), base, "wrap-up from behind")
        XCTAssertGreaterThan(rate(tackle(frontal: 0.5, move: .juke, moveAge: 0.05)) { $0.outcome == .whiff }, 0.4)
        XCTAssertEqual(rate(tackle(frontal: 0.5, move: .juke, moveAge: 0.4)) { $0.outcome == .whiff }, 0, "commitment window over")
        XCTAssertGreaterThan(rate(tackle(tacklerMass: 300, closing: 11), \.fumble), 0.02)
        XCTAssertEqual(rate(tackle(closing: 2), \.fumble), 0)
    }

    func testPursuitLeadsTheCarrier() {
        let from = Vec2(10, 40), target = Vec2(30, 30), vel = Vec2(0, 8)
        let t = try! XCTUnwrap(Pursuit.interceptTime(from: from, speed: 9.5, target: target, velocity: vel))
        let meet = target + vel * t
        XCTAssertEqual((meet - from).length, 9.5 * t, accuracy: 1e-6)
        let aim = Pursuit.aimPoint(from: from, speed: 9.5, target: target, velocity: vel, quality: 1)
        XCTAssertGreaterThan(aim.y, target.y + 5, "aims ahead of the carrier, not at them")
        XCTAssertNil(Pursuit.interceptTime(from: Vec2(0, 0), speed: 5, target: Vec2(0, 10), velocity: Vec2(0, 9)))
    }
}
