import XCTest
@testable import GSFoundation
@testable import GSData
@testable import GSSimulation
@testable import GSInput
@testable import GSAI
@testable import GSRules
@testable import GSRenderCore
@testable import GSGame

final class M4Tests: XCTestCase {
    var league: League!
    override func setUpWithError() throws { league = try DataLoader.bundledLeague() }

    func testEveryStarHasAValidUniqueSpiritPlay() throws {
        let cat = try DataLoader.bundledSpirits()
        let ids = league.teams.flatMap(\.roster).compactMap(\.spiritPlay)
        XCTAssertEqual(Set(ids).count, ids.count)
        for id in ids { XCTAssertNotNil(cat.play(id), "missing spirit \(id)") }
        for t in league.teams {
            let sides = Set(t.roster.compactMap { cat.play($0.spiritPlay)?.side })
            XCTAssertEqual(sides, [.offense, .defense], "\(t.id) needs an offensive and a defensive Spirit Play")
        }
    }

    func testSpiritActivationCutInFreezeAndEffects() {
        let rt = GameRuntime(league: league, humanTeam: 0)
        rt.debugCall(offense: "slants", defense: "cover2")
        XCTAssertFalse(rt.activateSpirit(team: 0), "needs a full meter")
        rt.spiritMeter[0] = 1
        _ = rt.advance(frameTime: 1.0 / 60)
        XCTAssertTrue(rt.touches.spiritReady)
        XCTAssertEqual(rt.touches.buttons[2].label, "SPRT")
        XCTAssertTrue(rt.touches.buttons[2].enabled)
        rt.perform(.button(.spirit))
        var f = rt.advance(frameTime: 1.0 / 60)
        XCTAssertNotNil(f.cutIn, "cut-in plays")
        XCTAssertEqual(f.cutIn?.spiritName, "IAI STRIKE", "QB Takashiro on a pass play")
        XCTAssertEqual(rt.spiritMeter[0], 0)
        XCTAssertEqual(rt.world.spirit[0]?.perfectPass, true)
        let t0 = rt.world.time
        for _ in 0..<60 { f = rt.advance(frameTime: 1.0 / 60) }
        XCTAssertEqual(rt.world.time, t0, accuracy: 1e-9, "world holds during the cut-in")
        for _ in 0..<40 { f = rt.advance(frameTime: 1.0 / 60) }
        XCTAssertNil(f.cutIn, "1.5 s and done")
        XCTAssertNotNil(f.sprites.first { $0.aura != nil }, "the star glows")
    }

    func testRunPlayPicksTheRunningBacksSpirit() {
        let rt = GameRuntime(league: league, humanTeam: 0)
        rt.debugCall(offense: "hb_dive", defense: "cover2")
        rt.spiritMeter[0] = 1
        XCTAssertTrue(rt.activateSpirit(team: 0))
        XCTAssertEqual(rt.activeSpirit.first?.play.name, "KAGE STEP")
    }

    func testCPUUsesSpiritInCriticalSituations() {
        let rt = GameRuntime(league: league, humanTeam: nil)
        rt.debugSetSituation(down: 3, ballOn: 50, lineToGain: 58)
        rt.spiritMeter = [1, 0]
        for _ in 0..<40 { _ = rt.advance(frameTime: 1.0 / 60) }
        XCTAssertEqual(rt.teamStats[0].spiritPlaysUsed, 1)
    }

    func testComebackCharging() {
        let rt = GameRuntime(league: league, humanTeam: 0)
        rt.state.score = [0, 14]
        rt.charge(0, 0.1); rt.charge(1, 0.1)
        XCTAssertGreaterThan(rt.spiritMeter[0], rt.spiritMeter[1], "the trailing team charges faster")
    }

    func testSpiritEffectsChangeResolution() {
        var c = TackleContext(tacklerMass: 240, tacklerStrength: 90, tacklerSpeed: 8, carrierMass: 200, carrierStrength: 50,
                              carrierBalance: 50, closingSpeed: 8, frontalness: 0, carrierSpeed: 8, move: .spin, moveAge: 0.2)
        c.unbreakableMoves = true
        XCTAssertEqual(TackleResolver.resolve(c, rolls: (0.99, 0.99, 0.99)).outcome, .whiff)
        var p = CatchContext(catching: 70, isOffense: true, isIntendedReceiver: true, ballSpeed: 25, ballHeight: 1.3,
                             centered: 0.3, contest: 0.8, diving: false)
        let base = CatchResolver.probabilities(p).catch
        p.bonus = 0.25
        XCTAssertGreaterThan(CatchResolver.probabilities(p).catch, base + 0.2)
    }

    func testDailyTrialsAreDeterministicOnePerTierAndRotate() {
        let a = Trials.daily(dayKey: 20261012), b = Trials.daily(dayKey: 20261012)
        XCTAssertEqual(a.map(\.id), b.map(\.id))
        XCTAssertEqual(a.map(\.tier), [.easy, .medium, .hard])
        let week = Set((0..<7).flatMap { Trials.daily(dayKey: 20261012 + $0).map(\.id) })
        XCTAssertGreaterThanOrEqual(week.count, 8, "a week should feel varied")
    }

    func testReportGradesCoinsAndTrials() {
        var me = TeamGameStats(); me.rushYards = 120; me.touchdowns = 4; me.interceptionsMade = 2
        let them = TeamGameStats()
        let trials = Trials.pool.filter { ["win", "rush80", "shutout"].contains($0.id) }
        let r = GameReport.build(humanTeam: 0, abbreviations: ["KGR", "NEO"], score: [28, 0], stats: [me, them],
                                 players: ["x": PlayerGameStats(name: "MIBU", team: 0, yards: 120, touchdowns: 3)], trials: trials)
        let loss = GameReport.build(humanTeam: 0, abbreviations: ["KGR", "NEO"], score: [34, 38], stats: [me, them], players: [:], trials: [])
        XCTAssertEqual(loss.grade, "B", "a loss caps at B")
        XCTAssertEqual(r.headline, "VICTORY!")
        XCTAssertEqual(r.grade, "S")
        XCTAssertTrue(r.mvp.contains("MIBU"))
        XCTAssertTrue(r.trialLines.allSatisfy(\.passed))
        XCTAssertGreaterThan(r.coins, 150 + 50 + 100 + 200)
    }

    func testPortraitsAreDeterministicAndExpressive() {
        let spec = PortraitSpec(seed: stableHash("kurogane_ronin_7"), jersey: RGBA(hex: 0xD8452B), trim: RGBA(hex: 0xF1E6C8),
                                number: 7, archetype: 0, big: false)
        let n = Portraits.render(spec, .neutral), c = Portraits.render(spec, .confident), s = Portraits.render(spec, .shocked)
        XCTAssertEqual(n.pixels, Portraits.render(spec, .neutral).pixels)
        XCTAssertNotEqual(n.pixels, c.pixels); XCTAssertNotEqual(n.pixels, s.pixels); XCTAssertNotEqual(c.pixels, s.pixels)
        XCTAssertEqual(n.width, Portraits.size)
        let framed = Portraits.framed(n, name: "TAKASHIRO", accent: RGBA(hex: 0xD8452B))
        XCTAssertEqual(framed.width, 96)
        XCTAssertEqual(Portraits.scaled(framed, 2).width, 192)
    }

    func testChromeCalloutPopsInIntegerSteps() {
        XCTAssertEqual(ArcadeArt.calloutScale(age: 0.01, life: 2, base: 4), 2)
        XCTAssertEqual(ArcadeArt.calloutScale(age: 0.08, life: 2, base: 4), 5, "overshoot")
        XCTAssertEqual(ArcadeArt.calloutScale(age: 0.5, life: 2, base: 4), 4)
        let b = ArcadeArt.callout("TOUCHDOWN!", scale: 4, style: .rainbow)
        XCTAssertLessThan(b.width, Canvas.width)
        XCTAssertGreaterThan(b.distinctOpaqueColors, 6, "gradient bands")
    }

    func testHighlightTriggersSlowMotionReplayThatCanBeSkipped() {
        let rt = GameRuntime(league: league, humanTeam: 0)
        rt.debugCall(offense: "slants", defense: "cover2")
        rt.perform(.button(.snap))
        for _ in 0..<60 { _ = rt.advance(frameTime: 1.0 / 60) }
        // Force a touchdown: put the receiver on the goal line with the ball.
        let wr = rt.world.players.first { $0.slot == "WR2" }!.id
        rt.world.debugGiveBall(to: wr)
        rt.world.debugSetPlayer(wr, position: Vec2(30, Field.awayGoalLine - 1), velocity: Vec2(0, 8))
        var sawReplay = false, replayFrames = 0
        for _ in 0..<(60 * 12) {
            let f = rt.advance(frameTime: 1.0 / 60)
            if f.replay { sawReplay = true; replayFrames += 1; XCTAssertNil(f.hud); if replayFrames == 60 { rt.perform(.skip) } }
            if rt.phase == .playCall { break }
        }
        XCTAssertTrue(sawReplay)
        XCTAssertLessThan(replayFrames, 90, "skip works")
        XCTAssertEqual(rt.state.score[0], 6)
    }

    func testFullGameProducesReportAndUsesSpirit() {
        let rt = GameRuntime(league: league, humanTeam: nil, seed: 3)
        let store = MemoryProgressStore()
        rt.progress = store
        var frames = 0
        while rt.phase != .final && frames < 60 * 60 * 45 { _ = rt.advance(frameTime: 1.0 / 60); frames += 1 }
        XCTAssertEqual(rt.phase, .final)
        XCTAssertNotNil(rt.report)
        let used = rt.teamStats.map(\.spiritPlaysUsed).reduce(0, +)
        print("FULL M4 GAME: \(rt.state.score) spirit plays \(used) report \(rt.report?.headline ?? "") \(rt.report?.grade ?? "") OT \(rt.state.isOvertime)")
        XCTAssertGreaterThan(used, 0, "Spirit Plays should show up in a normal game")
        XCTAssertEqual(store.coins, 0, "CPU vs CPU awards nothing")
    }
}
