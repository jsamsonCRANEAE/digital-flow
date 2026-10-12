import XCTest
@testable import GSFoundation
@testable import GSSimulation

final class BallPhysicsTests: XCTestCase {
    let dt = 1.0 / 120

    func fly(_ v: Vec3, wobble: Double = 0, wind: Vec2 = .zero, tumbling: Bool = false) -> (land: Vec3, apex: Double, time: Double) {
        var b = Ball(heldBy: -1, at: .zero)
        b.launch(from: Vec3(0, 0, 2), velocity: v, wobble: wobble, tumbling: tumbling)
        var rng = SplitMix64(seed: 1)
        var apex = 0.0, t = 0.0
        while t < 10 {
            apex = max(apex, b.position.z)
            t += dt
            if b.step(dt: dt, wind: wind, rng: &rng).contains(.groundContact) { break }
        }
        return (b.position, apex, t)
    }

    func testDragShortensRangeVersusVacuum() {
        let v = Vec3(0, 18, 12)
        let r = fly(v).land.y
        // Vacuum range from z0 = 2.
        let g = BallPhysics.gravity
        let t = (v.z + (v.z * v.z + 2 * g * 2).squareRoot()) / g
        XCTAssertLessThan(r, v.y * t)
        XCTAssertGreaterThan(r, v.y * t * 0.8, "spiral drag is mild, not a brick wall")
    }

    func testWobblyDuckFallsShortAndTailwindCarries() {
        let v = Vec3(0, 20, 10)
        let clean = fly(v).land.y, duck = fly(v, wobble: 1).land.y
        XCTAssertLessThan(duck, clean - 1.5)
        XCTAssertGreaterThan(fly(v, wind: Vec2(0, 6)).land.y, clean + 0.8)
        XCTAssertLessThan(fly(v, wind: Vec2(0, -6)).land.y, clean - 0.8)
        XCTAssertGreaterThan(fly(v, wind: Vec2(5, 0)).land.x, 0.5, "crosswind drifts the ball")
    }

    /// The defining prolate-spheroid property: identical impacts produce very
    /// different hops depending on how the ball meets the turf.
    func testLooseBallBouncesAreIrregular() {
        var outDirs: [Double] = [], outVz: [Double] = []
        for i in 0..<24 {
            var b = Ball(heldBy: -1, at: .zero)
            b.launch(from: Vec3(0, 0, 0.5), velocity: Vec3(0, 6, -4), wobble: 0, tumbling: true)
            b.pitch = Double(i) * 0.27
            var rng = SplitMix64(seed: UInt64(i))
            for _ in 0..<60 { if b.step(dt: dt, wind: .zero, rng: &rng).contains(.bounced) { break } }
            outDirs.append(b.velocity.ground.angle)
            outVz.append(b.velocity.z)
        }
        func spread(_ a: [Double]) -> Double { a.max()! - a.min()! }
        XCTAssertGreaterThan(spread(outDirs), 0.8, "hop direction must vary (a round ball would not)")
        XCTAssertGreaterThan(spread(outVz), 1.0, "hop height must vary with contact orientation")
    }

    func testLooseBallLosesEnergyAndComesToRest() {
        var b = Ball(heldBy: -1, at: .zero)
        b.launch(from: Vec3(10, 10, 1), velocity: Vec3(3, 8, 3), wobble: 0, tumbling: true)
        var rng = SplitMix64(seed: 9)
        var rested = false
        for _ in 0..<(120 * 12) {
            if b.step(dt: dt, wind: .zero, rng: &rng).contains(.cameToRest) { rested = true; break }
        }
        XCTAssertTrue(rested)
        XCTAssertEqual(b.velocity.length, 0)
        XCTAssertLessThan((b.position.ground - Vec2(10, 10)).length, 30)
    }

    func testThrowSolverHitsMovingReceiverWithDragAndWind() {
        for kind in [ThrowKind.bullet, .lob] {
            for wind in [Vec2.zero, Vec2(4, -3)] {
                let release = Vec3(26, 30, 1.95)
                let recv = Vec2(36, 42), rv = Vec2(-3, 8)
                let s = ThrowSolver.solve(from: release, receiver: recv, receiverVelocity: rv, kind: kind,
                                          maxSpeed: 26, wind: wind)
                let p = ThrowSolver.positionAfter(s.flightTime, from: release, velocity: s.velocity, wobble: 0, wind: wind)
                let receiverThen = recv + rv * s.flightTime
                XCTAssertLessThan((p.ground - receiverThen).length, 0.35, "\(kind) wind \(wind)")
                XCTAssertEqual(p.z, ThrowSolver.catchHeight, accuracy: 0.35)
                XCTAssertLessThanOrEqual(s.velocity.length, 26 * 1.1)
            }
        }
    }

    func testLobIsHigherAndSlowerThanBullet() {
        let release = Vec3(26, 30, 1.95)
        let b = ThrowSolver.solve(from: release, receiver: Vec2(26, 52), receiverVelocity: .zero, kind: .bullet, maxSpeed: 26)
        let l = ThrowSolver.solve(from: release, receiver: Vec2(26, 52), receiverVelocity: .zero, kind: .lob, maxSpeed: 26)
        XCTAssertGreaterThan(l.flightTime, b.flightTime + 0.4)
        XCTAssertGreaterThan(l.velocity.z, b.velocity.z * 1.5)
    }

    func testPressureCausesWobbleAndScatter() {
        var rng = SplitMix64(seed: 3)
        let v = Vec3(0, 24, 4)
        var calmErr = 0.0, hotErr = 0.0, hotWobble = 0.0
        for _ in 0..<400 {
            let c = ThrowSolver.applyError(v, accuracy: 85, pressure: 0, kind: .bullet, rng: &rng)
            let h = ThrowSolver.applyError(v, accuracy: 85, pressure: 1, kind: .bullet, rng: &rng)
            calmErr += abs(c.velocity.ground.angle - v.ground.angle)
            hotErr += abs(h.velocity.ground.angle - v.ground.angle)
            hotWobble += h.wobble
        }
        XCTAssertGreaterThan(hotErr, calmErr * 2)
        XCTAssertGreaterThan(hotWobble / 400, 0.6)
    }

    func testKickPowerAngleAndWind() {
        let p = Vec3(26, 30, 0.2)
        func dist(_ power: Double, _ wind: Vec2 = .zero, el: Double = 40) -> Vec3 {
            KickPhysics.landing(from: p, velocity: KickPhysics.launchVelocity(power: power, elevationDegrees: el,
                                                                               yaw: Double.pi / 2, legRating: 85), wind: wind)
        }
        XCTAssertGreaterThan(dist(1).y, dist(0.6).y + 10)
        XCTAssertLessThan(dist(1, Vec2(0, -6)).y, dist(1).y - 3)
        XCTAssertGreaterThan(abs(dist(1, Vec2(6, 0)).x - 26), 2)
        XCTAssertGreaterThan(dist(1).y - 30, 45, "full power kick should travel 45+ yards")
    }
}
