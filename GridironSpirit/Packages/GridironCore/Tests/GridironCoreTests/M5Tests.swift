import XCTest
@testable import GSFoundation
@testable import GSData
@testable import GSInput
@testable import GSGame
@testable import GSAudio
@testable import GSUI
@testable import GSRenderCore

final class M5Tests: XCTestCase {
    var league: League!
    var gear: GearCatalog!
    override func setUpWithError() throws {
        league = try DataLoader.bundledLeague()
        gear = try DataLoader.bundledGear()
    }

    // MARK: Gear

    func testCatalogIsA5x4Grid() {
        XCTAssertEqual(gear.items.count, 20)
        for c in GearCategory.allCases {
            XCTAssertEqual(gear.items(in: c).map(\.tier), [1, 2, 3, 4, 5], c.rawValue)
        }
        XCTAssertEqual(gear.items.map(\.price).min(), 120)
        XCTAssertEqual(gear.items.map(\.price).max(), 2600)
        for it in gear.items {
            XCTAssertLessThanOrEqual(PixelFontWidth.of(it.name), 96, "\(it.name) too wide for the preview")
            XCTAssertFalse(it.bestFor.isEmpty)
            XCTAssertFalse(it.appliesTo.isEmpty)
        }
    }

    func testGearBoostsOnlyListedPositionsAndClamps() {
        let team = league.teams[0]
        let boosted = gear.boosted(team, equipped: ["cleat2"])
        for (a, b) in zip(team.roster, boosted.roster) {
            if [.rb, .wr, .cb, .s].contains(a.position) {
                XCTAssertEqual(b.ratings.speed, min(99, a.ratings.speed + 2))
                XCTAssertEqual(b.ratings.acceleration, min(99, a.ratings.acceleration + 2))
            } else {
                XCTAssertEqual(a.ratings, b.ratings, "\(a.position) should be unchanged")
            }
        }
        let maxed = gear.boosted(team, equipped: ["cleat5", "glove5", "helm5", "train5"])
        for p in maxed.roster {
            let r = p.ratings
            for v in [r.speed, r.acceleration, r.agility, r.strength, r.balance, r.catching, r.throwPower, r.throwAccuracy] {
                XCTAssertLessThanOrEqual(v, 99)
            }
        }
        XCTAssertEqual(gear.spiritChargeBonus(equipped: ["cleat5", "train5"]), 0.20, accuracy: 1e-9)
    }

    // MARK: Profile

    func testBuyEquipToggleAndAfford() {
        var p = Profile()
        p.coins = 400
        let c1 = gear.item("cleat1")!, c2 = gear.item("cleat2")!, c5 = gear.item("cleat5")!
        XCTAssertEqual(p.buyOrEquip(c5), .tooExpensive)
        XCTAssertEqual(p.coins, 400)
        XCTAssertEqual(p.buyOrEquip(c1), .bought)
        XCTAssertEqual(p.coins, 280)
        XCTAssertEqual(p.equipped["cleats"], "cleat1")
        XCTAssertEqual(p.buyOrEquip(c1), .unequipped)
        XCTAssertNil(p.equipped["cleats"])
        XCTAssertEqual(p.buyOrEquip(c1), .equipped)
        XCTAssertEqual(p.buyOrEquip(c2), .tooExpensive)   // 280 < 300
        p.coins += 20
        XCTAssertEqual(p.buyOrEquip(c2), .bought)
        XCTAssertEqual(p.equipped["cleats"], "cleat2", "one item per category")
        XCTAssertEqual(p.coins, 0)
    }

    func testProfileRoundTripsThroughStore() {
        var saved: Data?
        let s = ProfileStore(data: nil, persist: { saved = $0 })
        s.profile.coins = 999; s.profile.owned = ["glove1"]; s.profile.settings.sharpFit = true
        s.profile.cup = SpiritCup.start(team: league.teams[0].id, league: league, seed: 1)
        s.save()
        let r = ProfileStore(data: saved, persist: { _ in })
        XCTAssertEqual(r.profile, s.profile)
        XCTAssertEqual(ProfileStore(data: Data("garbage".utf8), persist: { _ in }).profile, Profile(), "corrupt save falls back cleanly")
    }

    // MARK: Spirit Cup

    func testCupLadderEndsWithShadowFinal() throws {
        let me = league.teams[1].id
        let run = SpiritCup.start(team: me, league: league, seed: 7)
        XCTAssertEqual(run.opponents.count, 3)
        XCTAssertFalse(run.opponents.prefix(2).contains(me))
        XCTAssertEqual(Set(run.opponents.prefix(2)).count, 2)
        XCTAssertEqual(run.opponents[2], "shadow_" + me)
        let shadow = try XCTUnwrap(SpiritCup.team(run.opponents[2], league: league))
        let base = league.team(id: me)!
        XCTAssertEqual(shadow.roster.count, base.roster.count)
        XCTAssertTrue(zip(shadow.roster, base.roster).allSatisfy { $0.ratings.speed == min(99, $1.ratings.speed + SpiritCup.shadowBoost) })
        XCTAssertTrue(Set(shadow.roster.map(\.id)).isDisjoint(with: base.roster.map(\.id)), "ids must not collide in one match")
        XCTAssertLessThanOrEqual(shadow.abbreviation.count, 4)
    }

    func testCupRecording() {
        var p = Profile()
        p.cup = SpiritCup.start(team: league.teams[0].id, league: league, seed: 3)
        XCTAssertEqual(SpiritCup.record(&p, won: true, scoreLine: "A"), .advanced(next: 1))
        XCTAssertEqual(SpiritCup.record(&p, won: true, scoreLine: "B"), .advanced(next: 2))
        XCTAssertEqual(SpiritCup.record(&p, won: true, scoreLine: "C"), .champion)
        XCTAssertNil(p.cup)
        XCTAssertEqual(p.trophies, [league.teams[0].id])
        XCTAssertEqual(p.coins, SpiritCup.winBonus)
        p.cup = SpiritCup.start(team: league.teams[0].id, league: league, seed: 3)
        XCTAssertEqual(SpiritCup.record(&p, won: false, scoreLine: "D"), .eliminated)
        XCTAssertNil(p.cup)
        XCTAssertEqual(p.trophies.count, 1)
    }

    // MARK: Economy

    /// Decision: a top-tier item costs about five strong wins.
    func testTopTierCostsAboutFiveStrongWins() {
        var s = TeamGameStats()
        s.touchdowns = 4; s.interceptionsMade = 1; s.sacksMade = 2; s.bigHits = 1; s.rushYards = 90; s.passYards = 150
        let trials = [Trials.pool.first { $0.id == "win" }!, Trials.pool.first { $0.id == "rush80" }!, Trials.pool.first { $0.id == "shutout" }!]
        let r = GameReport.build(humanTeam: 0, abbreviations: ["A", "B"], score: [28, 10], stats: [s, TeamGameStats()],
                                 players: [:], trials: trials)
        let wins = Double(gear.items.map(\.price).max()!) / Double(r.coins)
        XCTAssertGreaterThan(wins, 4, "top tier too cheap (\(r.coins)/win)")
        XCTAssertLessThan(wins, 7, "top tier too grindy (\(r.coins)/win)")
        XCTAssertLessThanOrEqual(gear.items.map(\.price).min()!, r.coins, "first purchase after one good game")
    }

    // MARK: Flow

    func makeFlow() -> (AppFlow, () -> Data?) {
        var saved: Data?
        let f = AppFlow(league: league, gear: gear, savedProfile: nil, persist: { saved = $0 }, audio: AudioCore(), seed: 9)
        return (f, { saved })
    }

    func testEveryScreenRendersAndNavigates() {
        let (flow, saved) = makeFlow()
        _ = flow.advance(frameTime: 1 / 60)
        XCTAssertEqual(flow.screen, .title)
        flow.handle(TouchEvent(id: 1, phase: .ended, location: Vec2(300, 150)))
        XCTAssertEqual(flow.screen, .title, "ignores taps during the first moment")
        for _ in 0..<40 { _ = flow.advance(frameTime: 1 / 60) }
        flow.handle(TouchEvent(id: 1, phase: .ended, location: Vec2(300, 150)))
        XCTAssertEqual(flow.screen, .mainMenu)
        for (id, screen) in [("exhibition", AppFlow.Screen.teamSelect), ("back", .mainMenu), ("settings", .settings),
                             ("back", .mainMenu), ("shop", .shop), ("back", .mainMenu)] {
            flow.tap(id)
            XCTAssertEqual(flow.screen, screen, id)
            if case .menu(let b) = flow.advance(frameTime: 1 / 60) {
                XCTAssertEqual(b.width, 640); XCTAssertEqual(b.height, 296)
            } else { XCTFail("\(screen) should be a menu frame") }
        }
        flow.tap("settings"); flow.tap("set.music.-1"); flow.tap("set.fit.1"); flow.tap("back")
        XCTAssertEqual(flow.profile.settings.music, 6)
        XCTAssertTrue(flow.sharpFit)
        XCTAssertNotNil(saved(), "settings persist immediately")
    }

    func testRealTouchesHitButtons() {
        let (flow, _) = makeFlow()
        for _ in 0..<40 { _ = flow.advance(frameTime: 1 / 60) }
        flow.handle(TouchEvent(id: 1, phase: .ended, location: Vec2(300, 150)))
        _ = flow.advance(frameTime: 1 / 60)          // lays out main menu hit regions
        // GEAR SHOP button is 180x24 at (230, 184).
        flow.handle(TouchEvent(id: 2, phase: .began, location: Vec2(320, 196)))
        flow.handle(TouchEvent(id: 2, phase: .ended, location: Vec2(321, 197)))
        XCTAssertEqual(flow.screen, .shop)
        _ = flow.advance(frameTime: 1 / 60)
        // Drag off a button cancels it.
        flow.handle(TouchEvent(id: 3, phase: .began, location: Vec2(560, 274)))     // BACK
        flow.handle(TouchEvent(id: 3, phase: .moved, location: Vec2(100, 100)))
        flow.handle(TouchEvent(id: 3, phase: .ended, location: Vec2(100, 100)))
        XCTAssertEqual(flow.screen, .shop)
    }

    func testStartingAMatchAppliesGearAndPauses() throws {
        let (flow, _) = makeFlow()
        flow.store.profile.coins = 5000
        flow.tap("shop"); flow.tap("item.cleat3"); flow.tap("buy"); flow.tap("item.train4"); flow.tap("buy")
        XCTAssertEqual(flow.profile.equippedIDs.sorted(), ["cleat3", "train4"])
        XCTAssertEqual(flow.profile.coins, 5000 - 650 - 1300)
        flow.tap("back"); flow.tap("exhibition"); flow.tap("team.0"); flow.tap("play")
        XCTAssertEqual(flow.screen, .game)
        let rt = try XCTUnwrap(flow.runtime)
        let base = league.teams[0].roster.first { $0.position == .wr }!
        let inGame = rt.teams[0].roster.first { $0.id == base.id }!
        XCTAssertEqual(inGame.ratings.agility, min(99, base.ratings.agility + 3))
        XCTAssertEqual(rt.spiritChargeBonus[0], 0.05, accuracy: 1e-9)
        guard case .game(_, _, let ui, _) = flow.advance(frameTime: 1 / 60) else { return XCTFail() }
        XCTAssertTrue(ui.contains { "\($0.key)".contains("pause") })
        flow.tap("pause")
        XCTAssertEqual(flow.screen, .pause)
        let t0 = rt.state.clock
        for _ in 0..<120 { _ = flow.advance(frameTime: 1 / 60) }
        XCTAssertEqual(rt.state.clock, t0, "paused game must not advance")
        flow.tap("resume")
        XCTAssertEqual(flow.screen, .game)
        flow.tap("pause"); flow.tap("quit")
        XCTAssertEqual(flow.screen, .mainMenu)
        XCTAssertNil(flow.runtime)
    }

    func testCupFlowStartsFromBracket() throws {
        let (flow, _) = makeFlow()
        flow.tap("cup"); XCTAssertEqual(flow.screen, .teamSelect)
        flow.tap("team.2"); flow.tap("play")
        XCTAssertEqual(flow.screen, .cupBracket)
        let run = try XCTUnwrap(flow.profile.cup)
        XCTAssertEqual(run.teamID, league.teams[2].id)
        flow.tap("cup.play")
        XCTAssertEqual(flow.runtime?.teams[1].id, run.opponents[0])
        flow.tap("pause"); flow.tap("quit")
        flow.tap("cup"); XCTAssertEqual(flow.screen, .cupBracket, "a run in progress resumes at the bracket")
        flow.tap("cup.forfeit"); XCTAssertNil(flow.profile.cup)
    }

    // MARK: Sharp fit

    func testSharpFitFillsTheScreenAndKeepsTouchesAligned() {
        let pp = CanvasLayout(drawableWidth: 2556, drawableHeight: 1179)
        let sf = CanvasLayout(drawableWidth: 2556, drawableHeight: 1179, sharpFit: true)
        XCTAssertFalse(pp.sharpFit); XCTAssertEqual(pp.pixelScale, 3)
        XCTAssertTrue(sf.sharpFit)
        XCTAssertGreaterThan(sf.scaledHeight, 1170, "fills the height")
        XCTAssertLessThanOrEqual(sf.scaledWidth, 2556)
        let p = sf.canvasPoint(drawableX: Double(sf.originX) + 320.5 * sf.pixelScale, drawableY: Double(sf.originY) + 100.5 * sf.pixelScale)
        XCTAssertEqual(p.x, 320.5, accuracy: 1e-9); XCTAssertEqual(p.y, 100.5, accuracy: 1e-9)
        // Exactly-integer screens stay pixel perfect even when sharp fit is on.
        XCTAssertFalse(CanvasLayout(drawableWidth: 1920, drawableHeight: 888, sharpFit: true).sharpFit)
    }

    // MARK: Sound cues

    func testMatchEmitsSoundCues() {
        let rt = GameRuntime(league: league, humanTeam: nil, seed: 5, quarterLength: 60)
        var cues: [SoundCue] = []
        for _ in 0..<(60 * 40) { cues += rt.advance(frameTime: 1 / 60).sounds }
        XCTAssertTrue(cues.contains(.snap))
        XCTAssertTrue(cues.contains(.whistle) || cues.contains(.touchdown))
        XCTAssertTrue(cues.contains { if case .tackle = $0 { return true }; return false })
        XCTAssertTrue(cues.contains { if case .footstep = $0 { return true }; return false })
    }
}

/// Width helper (avoids importing GSRenderCore symbols by name in assertions).
enum PixelFontWidth { static func of(_ s: String) -> Int { s.count * 6 - 1 } }
