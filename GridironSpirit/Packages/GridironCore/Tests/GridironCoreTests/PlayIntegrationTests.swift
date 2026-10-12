import XCTest
@testable import GSFoundation
@testable import GSData
@testable import GSSimulation
@testable import GSInput
@testable import GSAI
@testable import GSRenderCore
@testable import GSGame

final class PlayIntegrationTests: XCTestCase {
    let dt = 1.0 / 120
    var league: League!
    override func setUpWithError() throws { league = try DataLoader.bundledLeague() }

    func run(_ w: inout World, ai: inout PlayAI, seconds: Double, until: (World) -> Bool = { _ in false }) {
        for _ in 0..<Int(seconds * 120) {
            let i = ai.intents(for: w, human: w.controlledID, humanMove: .zero, dt: dt)
            w.step(intents: i, dt: dt)
            if until(w) { return }
        }
    }

    func testSnapReachesQB() {
        var w = Formation.sandbox(offense: league.teams[0], defense: league.teams[1])
        var ai = PlayAI(); ai.setup(for: w)
        w.snap()
        XCTAssertEqual(w.ball.phase, .inFlight)
        run(&w, ai: &ai, seconds: 1) { $0.carrierID != nil }
        XCTAssertEqual(w.carrierID, w.quarterback?.id)
    }

    /// Statistical sanity over many seeded plays: passes resolve into
    /// completions, incompletions and the occasional pick — never hang.
    func testPassPlaysResolveWithPlausibleRates() {
        var complete = 0, incomplete = 0, picks = 0, other = 0, drops = 0, tips = 0
        for seed in 0..<60 {
            var w = Formation.sandbox(offense: league.teams[0], defense: league.teams[1], seed: UInt64(seed + 1))
            var ai = PlayAI(); ai.setup(for: w)
            w.snap()
            run(&w, ai: &ai, seconds: 1) { $0.carrierID == $0.quarterback?.id }
            run(&w, ai: &ai, seconds: Double(seed % 4) * 0.25 + 0.6)
            let receivers = w.players.filter(\.isEligibleReceiver)
            let target = receivers[seed % receivers.count]
            XCTAssertTrue(w.requestThrow(to: target.id, kind: seed % 2 == 0 ? .bullet : .lob))
            var caught = false
            run(&w, ai: &ai, seconds: 6) { world in
                for e in world.events {
                    switch e {
                    case .drop: drops += 1
                    case .deflection: tips += 1
                    default: break
                    }
                }
                if world.events.contains(where: { if case .catchMade(_, _, _, false) = $0 { return true }; return false }) { caught = true }
                return world.phase.isDead
            }
            switch w.phase {
            case .dead(.incomplete): incomplete += 1
            case .dead(.interception): picks += 1
            case .dead: if caught { complete += 1 } else { other += 1 }
            default: if caught { complete += 1 } else { other += 1 }
            }
        }
        print("pass sim: complete \(complete) incomplete \(incomplete) picks \(picks) other \(other) drops \(drops) tips \(tips)")
        XCTAssertGreaterThan(complete, 15)
        XCTAssertGreaterThan(incomplete, 2)
        XCTAssertLessThan(picks, 15)
    }

    func testRunnerGetsTackledAndPlayEnds() {
        var tackled = 0
        for seed in 0..<20 {
            var w = Formation.sandbox(offense: league.teams[0], defense: league.teams[1], seed: UInt64(seed + 100))
            var ai = PlayAI(); ai.setup(for: w)
            let rb = w.players.first { $0.data.position == .rb }!.id
            w.debugGiveBall(to: rb)
            // Human-free: the RB runs straight upfield.
            for _ in 0..<(8 * 120) {
                var i = ai.intents(for: w, human: rb, humanMove: Vec2(0.15, 1), dt: dt)
                i[rb] = Vec2(0.15, 1)
                w.step(intents: i, dt: dt)
                if w.phase.isDead { break }
            }
            if case .dead = w.phase { tackled += 1 }
        }
        XCTAssertGreaterThanOrEqual(tackled, 17, "pursuit + tackling should end almost every run")
    }

    func testFumbleProducesLooseBallThatResolves() {
        var w = Formation.sandbox(offense: league.teams[0], defense: league.teams[1], seed: 77)
        var ai = PlayAI(); ai.setup(for: w)
        let rb = w.players.first { $0.data.position == .rb }!.id
        w.debugGiveBall(to: rb)
        w.apply(TackleResult(outcome: .clean, impact: 9, fumble: true), carrier: rb, tackler: 7, normal: Vec2(0, 1))
        XCTAssertEqual(w.ball.phase, .loose)
        XCTAssertTrue(w.phase.isLive, "fumbles are live balls")
        run(&w, ai: &ai, seconds: 8) { $0.phase.isDead || $0.ball.holder != nil }
        XCTAssertTrue(w.ball.holder != nil || w.phase.isDead)
    }

    func testRuntimeHitStopFreezesSimButNotFrames() throws {
        let rt = GameRuntime(league: league)
        rt.debugCall(offense: "slants", defense: "cover3")
        rt.perform(.button(.snap))
        for _ in 0..<30 { _ = rt.advance(frameTime: 1.0 / 60) }
        rt.fx.hitStop = 6.0 / 60
        let t0 = rt.world.time
        var stoppedFrames = 0
        for _ in 0..<6 { if rt.advance(frameTime: 1.0 / 60).hitStopped { stoppedFrames += 1 } }
        XCTAssertEqual(rt.world.time, t0, accuracy: 1e-9, "world frozen during hit-stop")
        XCTAssertGreaterThanOrEqual(stoppedFrames, 5)
        _ = rt.advance(frameTime: 1.0 / 60); _ = rt.advance(frameTime: 1.0 / 60)
        XCTAssertGreaterThan(rt.world.time, t0)
    }

    func testBigHitTriggersImpactFrameShakeAndHaptics() throws {
        let rt = GameRuntime(league: league)
        var rig = rt.rig
        let r = TackleResult(outcome: .clean, impact: 8, fumble: false)
        rt.fx.handle([.tackle(r, carrier: 1, tackler: 8, at: Vec3(26, 40, 0))], world: rt.world, rig: &rig, gainFrom: 35)
        XCTAssertEqual(rt.fx.hitStop, 6.0 / 60, accuracy: 1e-9)
        XCTAssertTrue(rt.fx.consumeImpactFrame())
        XCTAssertFalse(rt.fx.consumeImpactFrame(), "exactly one impact frame")
        XCTAssertEqual(rt.fx.callout?.text, "BIG HIT!")
        XCTAssertFalse(rt.fx.drainHaptics().isEmpty)
        XCTAssertFalse(rt.fx.overlays.isEmpty)
    }

    func testFullPlayLoopThroughRuntimeResetsForNextSnap() throws {
        let rt = GameRuntime(league: league)
        rt.debugCall(offense: "verticals", defense: "cover2")
        rt.perform(.button(.snap))
        var sawIcons = false
        for _ in 0..<50 { let f = rt.advance(frameTime: 1.0 / 60); if !f.icons.isEmpty { sawIcons = true } }
        XCTAssertTrue(sawIcons, "receiver icons appear once the QB has the ball")
        let target = rt.world.players.first { $0.data.position == .wr }!.id
        rt.perform(.throwTo(receiver: target, lob: false))
        var sawReticle = false, sawTrail = false
        for _ in 0..<(60 * 12) {
            let f = rt.advance(frameTime: 1.0 / 60)
            if f.effects.reticle != nil { sawReticle = true }
            if f.effects.trail.count > 3 { sawTrail = true }
            if rt.phase == .playCall { break }
        }
        XCTAssertTrue(sawReticle); XCTAssertTrue(sawTrail)
        XCTAssertNotNil(rt.lastRuling, "the play was ruled on")
        XCTAssertEqual(rt.phase, .playCall, "back to the huddle for the next call")
    }
}
