import XCTest
@testable import GSFoundation
@testable import GSData
@testable import GSSimulation

final class SimulationTests: XCTestCase {
    let dt = 1.0 / 120
    func ratings(speed: Int = 85, agility: Int = 85, weight: Int = 190) -> PlayerRatings {
        PlayerRatings(speed: speed, acceleration: 85, agility: agility, strength: 60, balance: 70,
                      catching: 60, throwPower: 30, throwAccuracy: 30, weightLbs: weight)
    }

    func testReachesTopSpeedAndNoFurther() {
        let p = MovementProfile.from(ratings())
        var b = PlayerBody(position: Vec2(20, 20), facing: .pi / 2, profile: p)
        var reachedAt: Double?
        for i in 0..<(120 * 4) {
            let ev = b.step(intent: Vec2(0, 1), dt: dt)
            if ev.contains(.reachedTopSpeed) && reachedAt == nil { reachedAt = Double(i) * dt }
        }
        XCTAssertEqual(b.speed, p.topSpeed, accuracy: 1e-6)
        XCTAssertNotNil(reachedAt)
        XCTAssertLessThan(reachedAt!, 2.5, "should hit top speed within ~2.5 s")
        XCTAssertGreaterThan(reachedAt!, 0.6, "acceleration must not be instant")
    }

    func testFasterRatingMeansHigherTopSpeed() {
        XCTAssertGreaterThan(MovementProfile.from(ratings(speed: 95)).topSpeed,
                             MovementProfile.from(ratings(speed: 60)).topSpeed)
    }

    /// Momentum: a heavy lineman at full speed needs a wider arc to turn 90°
    /// than a light receiver.
    func testHeavyPlayersTurnWider() {
        func turnRadius(weight: Int, agility: Int) -> Double {
            var b = PlayerBody(position: Vec2(20, 20), facing: .pi / 2,
                               profile: MovementProfile.from(ratings(speed: 80, agility: agility, weight: weight)))
            for _ in 0..<(120 * 3) { b.step(intent: Vec2(0, 1), dt: dt) }
            let start = b.position.ground
            var steps = 0
            while abs(wrapAngle(b.velocity.angle - 0)) > 0.1 && steps < 1200 {
                b.step(intent: Vec2(1, 0), dt: dt); steps += 1
            }
            return b.position.y - start.y   // downfield drift while turning
        }
        let light = turnRadius(weight: 180, agility: 92)
        let heavy = turnRadius(weight: 320, agility: 45)
        XCTAssertGreaterThan(heavy, light * 1.5, "heavy \(heavy) vs light \(light)")
    }

    func testReversalBrakesAndFlagsHardCut() {
        var b = PlayerBody(position: Vec2(20, 20), facing: .pi / 2, profile: MovementProfile.from(ratings()))
        for _ in 0..<240 { b.step(intent: Vec2(0, 1), dt: dt) }
        var cut = false
        var minSpeed = b.speed
        for _ in 0..<120 {
            if b.step(intent: Vec2(0, -1), dt: dt).contains(.hardCut) { cut = true }
            minSpeed = min(minSpeed, b.speed)
        }
        XCTAssertTrue(cut)
        XCTAssertLessThan(minSpeed, 1.0, "must decelerate to plant before reversing")
        XCTAssertLessThan(b.velocity.y, 0, "eventually runs the other way")
    }

    func testStopsWithoutInput() {
        var b = PlayerBody(position: Vec2(20, 20), facing: .pi / 2, profile: MovementProfile.from(ratings()))
        for _ in 0..<240 { b.step(intent: Vec2(1, 1), dt: dt) }
        for _ in 0..<240 { b.step(intent: .zero, dt: dt) }
        XCTAssertEqual(b.speed, 0, accuracy: 1e-9)
    }

    func testJumpReturnsToGround() {
        var b = PlayerBody(position: Vec2(20, 20), facing: 0, profile: MovementProfile.from(ratings()))
        b.jump(verticalSpeed: 4)
        var peak = 0.0
        for _ in 0..<240 { b.step(intent: .zero, dt: dt); peak = max(peak, b.position.z) }
        XCTAssertGreaterThan(peak, 0.5)
        XCTAssertEqual(b.position.z, 0)
    }

    func testDeterministicReplay() throws {
        let league = try DataLoader.bundledLeague()
        func run() -> [Vec3] {
            var w = Formation.sandbox(offense: league.teams[0], defense: league.teams[1])
            w.snap()
            for i in 0..<600 {
                let a = Double(i) * 0.03
                var intents = [Vec2](repeating: Vec2(0.2, 0.4), count: w.players.count)
                intents[w.controlledID] = Vec2(cos(a), sin(a) * 0.5 + 0.5)
                w.step(intents: intents, dt: dt)
            }
            return w.players.map(\.body.position)
        }
        XCTAssertEqual(run(), run())
    }

    func testSandboxIs7v7AndNoOneOverlaps() throws {
        let league = try DataLoader.bundledLeague()
        var w = Formation.sandbox(offense: league.teams[0], defense: league.teams[1])
        XCTAssertEqual(w.players.filter { $0.side == .offense }.count, 7)
        XCTAssertEqual(w.players.filter { $0.side == .defense }.count, 7)
        XCTAssertEqual(w.controlled.data.position, .qb)
        // Everyone charges straight ahead.
        w.debugGiveBall(to: w.players.first { $0.data.position == .rb }!.id)
        for _ in 0..<360 {
            w.step(intents: w.players.map { $0.side == .offense ? Vec2(0, 1) : Vec2(0, -1) }, dt: dt)
        }
        for i in 0..<w.players.count {
            for j in (i + 1)..<w.players.count where w.players[i].status != .down && w.players[j].status != .down
                && w.players[i].id != w.carrierID && w.players[j].id != w.carrierID {
                let a = w.players[i].body, b = w.players[j].body
                let d = (a.position.ground - b.position.ground).length
                XCTAssertGreaterThan(d, (a.profile.radius + b.profile.radius) * 0.8)
            }
        }
    }
}
