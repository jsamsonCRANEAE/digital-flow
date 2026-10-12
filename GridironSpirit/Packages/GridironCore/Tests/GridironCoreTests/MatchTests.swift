import XCTest
@testable import GSFoundation
@testable import GSData
@testable import GSSimulation
@testable import GSInput
@testable import GSAI
@testable import GSRules
@testable import GSGame

final class MatchTests: XCTestCase {
    var league: League!
    var book: Playbook!
    override func setUpWithError() throws {
        league = try DataLoader.bundledLeague()
        book = try DataLoader.bundledPlaybook()
    }

    func testPlaybookShape() {
        XCTAssertEqual(book.offense.count, 6)
        XCTAssertEqual(book.defense.count, 6)
        XCTAssertEqual(book.offensePages.map(\.count), [3, 3], "3 cards per page: run, short, deep")
        XCTAssertEqual(book.offensePages[0].map(\.category), [.run, .shortPass, .deepPass])
        XCTAssertEqual(book.defensePages.map(\.count), [3, 3])
    }

    /// Acceptance: "a full game can be played start to finish with no crashes".
    func testFullCPUGameCompletes() {
        for seed: UInt64 in [1, 2] {
            let rt = GameRuntime(league: league, playbook: book, humanTeam: nil, seed: seed)
            var frames = 0
            while rt.phase != .final && frames < 60 * 60 * 40 {
                _ = rt.advance(frameTime: 1.0 / 60)
                frames += 1
            }
            XCTAssertEqual(rt.phase, .final, "seed \(seed) did not finish; last: \(rt.playLog.suffix(3))")
            XCTAssertEqual(rt.state.quarter, 4)
            let plays = rt.playLog.filter { !$0.hasPrefix("==") }
            print("GAME seed \(seed): \(rt.teams[0].abbreviation) \(rt.state.score[0]) - \(rt.teams[1].abbreviation) \(rt.state.score[1]), \(plays.count) plays")
            XCTAssertGreaterThan(plays.count, 30)
            let poss = Set(rt.playLog.compactMap { line -> String? in line.split(separator: " ").dropFirst(2).first.map(String.init) })
            XCTAssertTrue(poss.contains(rt.teams[0].abbreviation) && poss.contains(rt.teams[1].abbreviation), "both teams had the ball")
            for (k, v) in rt.stats.sorted(by: { $0.key < $1.key }) {
                print(String(format: "   %@: %d plays, %.1f yd/play", k, v.plays, v.yards / Double(max(1, v.plays))))
            }
            let flags = rt.playLog.filter { $0.contains("PASS INTERFERENCE") }.count
            let tos = rt.playLog.filter { $0.contains("TURNOVER!") || $0.contains("INTERCEPTION") }.count
            print("   PI flags \(flags), turnovers \(tos), TDs \(rt.playLog.filter { $0.contains("TOUCHDOWN") }.count), sacks \(rt.playLog.filter { $0.contains("SACK") }.count), FGs \(rt.playLog.filter { $0.contains("FIELD GOAL!") }.count), punts \(rt.playLog.filter { $0.contains("PUNT ->") }.count)")
            if seed == 1 && ProcessInfo.processInfo.environment["LOG"] != nil { rt.playLog.forEach { print("  " + $0) } }
        }
    }

    func testHumanOffenseFlowCardsSnapAndFourthDown() {
        let rt = GameRuntime(league: league, playbook: book, humanTeam: 0)
        var f = rt.advance(frameTime: 1.0 / 60)
        XCTAssertEqual(f.phase, .playCall)
        XCTAssertEqual(f.playCall?.cards.count, 3)
        XCTAssertEqual(f.playCall?.cards.map(\.title), ["HB DIVE", "SLANTS", "VERTICALS"])
        rt.perform(.page(1))
        f = rt.advance(frameTime: 1.0 / 60)
        XCTAssertEqual(f.playCall?.page, 1)
        rt.perform(.selectCard(1))         // CURL FLAT
        _ = rt.advance(frameTime: 1.0 / 60)
        XCTAssertEqual(rt.phase, .preSnap)
        XCTAssertEqual(rt.world.controlled.slot, "QB")
        XCTAssertEqual(rt.touches.context, .preSnap)
        rt.perform(.button(.snap))
        for _ in 0..<40 { _ = rt.advance(frameTime: 1.0 / 60) }
        XCTAssertEqual(rt.phase, .live)
        // Fourth down shows the kicking page first.
        rt.state.down = 4
        rt.enterPlayCall()
        f = rt.advance(frameTime: 1.0 / 60)
        XCTAssertEqual(f.playCall?.cards.map(\.title), ["PUNT", "FIELD GOAL"])
    }

    func testHumanDefenseSwitchAndRunPlayHandoff() {
        let rt = GameRuntime(league: league, playbook: book, humanTeam: 0, openingReceiver: 1)
        var f = rt.advance(frameTime: 1.0 / 60)
        XCTAssertTrue(f.playCall?.header.hasPrefix("DEFENSE") ?? false)
        rt.perform(.selectCard(2))
        f = rt.advance(frameTime: 1.0 / 60)
        XCTAssertEqual(rt.world.controlled.side, .defense)
        for _ in 0..<150 { f = rt.advance(frameTime: 1.0 / 60) }
        XCTAssertEqual(rt.touches.context, .defense)
        XCTAssertEqual(rt.touches.buttons.map(\.label), ["DIVE", "SWTCH", "JUMP"])
        let before = rt.world.controlledID
        rt.perform(.button(.switchPlayer))
        _ = rt.advance(frameTime: 1.0 / 60)
        XCTAssertNotEqual(rt.world.controlledID, before)
        XCTAssertEqual(rt.world.controlled.side, .defense)
    }

    func testRunPlayHandsOffToTheRunningBack() {
        let rt = GameRuntime(league: league, playbook: book, humanTeam: 0)
        rt.debugCall(offense: "hb_dive", defense: "cover2")
        rt.perform(.button(.snap))
        var handed = false
        for _ in 0..<150 {
            _ = rt.advance(frameTime: 1.0 / 60)
            if let c = rt.world.carrierID, rt.world.player(c).slot == "RB" { handed = true; break }
        }
        XCTAssertTrue(handed)
        XCTAssertEqual(rt.world.controlled.slot, "RB", "control follows the handoff")
    }

    func testFalseStartWhenHumanMovesBeforeSnap() {
        let rt = GameRuntime(league: league, playbook: book, humanTeam: 0)
        rt.debugCall(offense: "slants", defense: "cover2")
        let los = rt.state.ballOn
        rt.handle(TouchEvent(id: 1, phase: .began, location: Vec2(110, 220)))
        rt.handle(TouchEvent(id: 1, phase: .moved, location: Vec2(110, 190)))
        for _ in 0..<30 { _ = rt.advance(frameTime: 1.0 / 60) }
        XCTAssertEqual(rt.lastRuling?.callouts.first, "FALSE START")
        XCTAssertEqual(rt.state.ballOn, los - 5)
    }

    func testCPUQuarterbackGetsRidOfTheBall() {
        var thrown = 0, sacks = 0, total = 0
        for seed in 0..<30 {
            let rt = GameRuntime(league: league, playbook: book, humanTeam: nil, seed: UInt64(seed + 10))
            rt.debugCall(offense: ["slants", "curl_flat", "verticals", "post_corner"][seed % 4],
                         defense: ["cover2", "cover3", "man_press", "lb_blitz", "zero_blitz"][seed % 5])
            for _ in 0..<(60 * 7) {
                _ = rt.advance(frameTime: 1.0 / 60)
                if rt.world.passThrown || rt.phase != .live && rt.phase != .preSnap { break }
            }
            total += 1
            if rt.world.passThrown { thrown += 1 }
            if rt.lastRuling?.callouts.contains("SACK!") == true { sacks += 1 }
        }
        print("CPU QB: thrown \(thrown)/\(total), sacks \(sacks)")
        XCTAssertGreaterThan(thrown, total * 2 / 3)
    }

    func testFieldGoalPhysicsAndMeter() {
        func attempt(ballOn: Double, power: Double, aim: Double, wind: Vec2 = .zero) -> Bool {
            var w = Formation.lineUp(offense: league.teams[0], offensePlay: SpecialPlays.offense(.fieldGoal),
                                     defense: league.teams[1], defensePlay: SpecialPlays.defense(.fieldGoal), ballOn: ballOn)
            w.wind = wind
            let holder = w.players.first { $0.slot == "QB" }!.body.position
            let toPosts = atan2Safe(Field.length - holder.y, Field.centerX - holder.x)
            let v = KickPhysics.launchVelocity(power: power, elevationDegrees: 36, yaw: toPosts + aim * 0.11, legRating: 85)
            var b = Ball(heldBy: -1, at: holder)
            b.launch(from: holder + Vec3(0, 0.6, 0.25), velocity: v, wobble: 0, tumbling: true)
            var rng = SplitMix64(seed: 1)
            var last = b.position.y
            for _ in 0..<(120 * 8) {
                _ = b.step(dt: 1.0 / 120, wind: wind, rng: &rng)
                if last < Field.length && b.position.y >= Field.length {
                    return abs(b.position.x - Field.centerX) <= 18.5 / 6 && b.position.z >= 10.0 / 3
                }
                if b.position.z <= BallPhysics.groundZ + 0.01 && b.airTime > 0.4 { return false }
                last = b.position.y
            }
            return false
        }
        XCTAssertTrue(attempt(ballOn: 75, power: 0.85, aim: 0), "42-yarder down the middle")
        XCTAssertFalse(attempt(ballOn: 75, power: 0.85, aim: 1), "hooked wide")
        XCTAssertFalse(attempt(ballOn: 40, power: 0.85, aim: 0), "77 yards is out of range")
        XCTAssertTrue(attempt(ballOn: 85, power: 0.7, aim: 0), "PAT")
        XCTAssertFalse(attempt(ballOn: 70, power: 0.8, aim: 0, wind: Vec2(0, -7)), "into a stiff headwind it falls short")
    }

    func testCPUKickersMakeMostShortKicks() {
        var made = 0
        for seed in 0..<20 {
            var rng = SplitMix64(seed: UInt64(seed))
            let (p, a) = KickAI.fieldGoal(distance: 32, error: Difficulty.pro.kickError, rng: &rng)
            if p > 0.6 && abs(a) < 0.5 { made += 1 }
        }
        XCTAssertGreaterThan(made, 15)
    }
}
