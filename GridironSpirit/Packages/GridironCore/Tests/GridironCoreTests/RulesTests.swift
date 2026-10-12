import XCTest
@testable import GSRules

final class RulesTests: XCTestCase {
    func fresh() -> GameState { GameState(openingReceiver: 0) }

    func testDownsAndFirstDown() {
        var s = fresh()
        XCTAssertEqual(s.downAndDistance, "1ST & 10")
        Referee.apply(PlayResult(.down(spot: 29)), to: &s)
        XCTAssertEqual(s.downAndDistance, "2ND & 6")
        XCTAssertTrue(s.clockRunning)
        let r = Referee.apply(PlayResult(.down(spot: 36)), to: &s)
        XCTAssertTrue(r.firstDown)
        XCTAssertEqual(s.down, 1); XCTAssertEqual(s.lineToGain, 46)
        XCTAssertEqual(s.fieldPosition, "OWN 36")
    }

    func testTurnoverOnDownsMirrorsTheSpot() {
        var s = fresh()
        s.ballOn = 60; s.lineToGain = 70; s.down = 4
        let r = Referee.apply(PlayResult(.down(spot: 65)), to: &s)
        XCTAssertTrue(r.possessionChanged)
        XCTAssertEqual(s.possession, 1)
        XCTAssertEqual(s.ballOn, 35, accuracy: 1e-9, "their own 35 = our opponent's 35")
        XCTAssertEqual(r.callouts.last, "TURNOVER ON DOWNS")
    }

    func testTouchdownExtraPointAndKickoff() {
        var s = fresh()
        Referee.apply(PlayResult(.touchdown(byOffense: true)), to: &s)
        XCTAssertEqual(s.score, [6, 0])
        XCTAssertEqual(s.mode, .conversionChoice)
        Referee.chooseConversion(.kick, &s)
        XCTAssertEqual(s.ballOn, 85)
        XCTAssertEqual(s.downAndDistance, "EXTRA POINT")
        Referee.apply(PlayResult(.fieldGoal(made: true, kickSpot: 78)), to: &s)
        XCTAssertEqual(s.score, [7, 0])
        XCTAssertEqual(s.possession, 1); XCTAssertEqual(s.ballOn, 25); XCTAssertEqual(s.mode, .scrimmage)
    }

    func testTwoPointTry() {
        var s = fresh()
        Referee.apply(PlayResult(.touchdown(byOffense: true)), to: &s)
        Referee.chooseConversion(.twoPoint, &s)
        XCTAssertEqual(s.ballOn, 98)
        Referee.apply(PlayResult(.touchdown(byOffense: true)), to: &s)
        XCTAssertEqual(s.score, [8, 0])
        var f = fresh()
        Referee.apply(PlayResult(.touchdown(byOffense: true)), to: &f)
        Referee.chooseConversion(.twoPoint, &f)
        Referee.apply(PlayResult(.down(spot: 99)), to: &f)
        XCTAssertEqual(f.score, [6, 0], "stopped short: no points, kickoff")
        XCTAssertEqual(f.possession, 1)
    }

    func testSafety() {
        var s = fresh()
        s.ballOn = 3
        let r = Referee.apply(PlayResult(.down(spot: -0.5), sack: true), to: &s)
        XCTAssertEqual(s.score, [0, 2])
        XCTAssertEqual(r.callouts.first, "SAFETY!")
        XCTAssertEqual(s.possession, 1, "scoring team receives the free kick")
    }

    func testInterceptionTouchbackAndPuntRules() {
        var s = fresh()
        s.ballOn = 70
        Referee.apply(PlayResult(.turnover(spot: 104, interception: true)), to: &s)
        XCTAssertEqual(s.possession, 1); XCTAssertEqual(s.ballOn, 20)
        Referee.apply(PlayResult(.turnover(spot: 40, interception: true)), to: &s)
        XCTAssertEqual(s.possession, 0); XCTAssertEqual(s.ballOn, 60)
        Referee.apply(PlayResult(.punt(spot: 101)), to: &s)
        XCTAssertEqual(s.possession, 1); XCTAssertEqual(s.ballOn, 20)
        Referee.apply(PlayResult(.punt(spot: 70)), to: &s)
        XCTAssertEqual(s.possession, 0); XCTAssertEqual(s.ballOn, 30)
    }

    func testFieldGoals() {
        var s = fresh()
        s.ballOn = 70
        Referee.apply(PlayResult(.fieldGoal(made: true, kickSpot: 63)), to: &s)
        XCTAssertEqual(s.score, [3, 0]); XCTAssertEqual(s.possession, 1); XCTAssertEqual(s.ballOn, 25)
        s.ballOn = 75
        Referee.apply(PlayResult(.fieldGoal(made: false, kickSpot: 68)), to: &s)
        XCTAssertEqual(s.possession, 0); XCTAssertEqual(s.ballOn, 32, accuracy: 1e-9, "spot of the kick")
        s.ballOn = 95
        Referee.apply(PlayResult(.fieldGoal(made: false, kickSpot: 88)), to: &s)
        XCTAssertEqual(s.ballOn, 20, "never inside the 20")
    }

    func testPenalties() {
        var s = fresh()
        s.ballOn = 30; s.lineToGain = 40
        Referee.apply(PlayResult(.falseStart), to: &s)
        XCTAssertEqual(s.ballOn, 25); XCTAssertEqual(s.down, 1); XCTAssertEqual(s.downAndDistance, "1ST & 15")
        s.ballOn = 4
        Referee.apply(PlayResult(.falseStart), to: &s)
        XCTAssertEqual(s.ballOn, 2, "half the distance to the goal")

        var p = fresh()
        p.down = 3; p.ballOn = 40; p.lineToGain = 48
        let r = Referee.apply(PlayResult(.incomplete, passInterference: 62), to: &p)
        XCTAssertEqual(r.callouts, ["FLAG!", "PASS INTERFERENCE"])
        XCTAssertEqual(p.ballOn, 62); XCTAssertEqual(p.down, 1)
        var d = fresh()
        d.ballOn = 40; d.lineToGain = 50
        Referee.apply(PlayResult(.down(spot: 75), passInterference: 55), to: &d)
        XCTAssertEqual(d.ballOn, 75, "offense declines when the play was better")
    }

    func testClockRules() {
        var s = fresh()
        Referee.apply(PlayResult(.incomplete), to: &s)
        XCTAssertFalse(s.clockRunning, "incompletions always stop the clock")
        Referee.apply(PlayResult(.outOfBounds(spot: 30)), to: &s)
        XCTAssertTrue(s.clockRunning, "out of bounds keeps it running outside the last minute")
        s.quarter = 2; s.clock = 45
        Referee.apply(PlayResult(.outOfBounds(spot: 35)), to: &s)
        XCTAssertFalse(s.clockRunning, "but stops it in the last minute of a half")
        s.quarter = 1; s.clock = 3
        XCTAssertFalse(Referee.tick(&s, dt: 1, live: false), "stopped clock doesn't run between plays")
        XCTAssertTrue(Referee.tick(&s, dt: 5, live: true))
        XCTAssertEqual(Referee.endQuarterIfExpired(&s), "END OF Q1")
        XCTAssertEqual(s.quarter, 2); XCTAssertEqual(s.clock, 180)
    }

    func testHalftimeAndFinal() {
        var s = fresh()
        s.quarter = 2; s.clock = 0; s.possession = 0
        XCTAssertEqual(Referee.endQuarterIfExpired(&s), "HALFTIME")
        XCTAssertEqual(s.possession, 1, "team that didn't open receives the second half")
        s.quarter = 4; s.clock = 0; s.score = [7, 3]
        XCTAssertEqual(Referee.endQuarterIfExpired(&s), "FINAL")
        XCTAssertTrue(s.isFinal)
        // A pending try is played even with 0:00 on the clock.
        var t = fresh()
        t.quarter = 4; t.clock = 0
        Referee.apply(PlayResult(.touchdown(byOffense: true)), to: &t)
        XCTAssertNil(Referee.endQuarterIfExpired(&t))
    }

    func testStrings() {
        var s = fresh()
        s.ballOn = 93; s.lineToGain = 100; s.down = 3
        XCTAssertEqual(s.downAndDistance, "3RD & GOAL")
        XCTAssertEqual(s.fieldPosition, "OPP 7")
        s.clock = 65
        XCTAssertEqual(s.clockText, "1:05")
    }

    func testOvertimeAlternatesFromThe25AndSettlesAfterBothPossessions() {
        var s = fresh()
        s.quarter = 4; s.clock = 0; s.score = [10, 10]
        XCTAssertEqual(Referee.endQuarterIfExpired(&s), "OVERTIME")
        XCTAssertTrue(s.isOvertime); XCTAssertEqual(s.possession, 0); XCTAssertEqual(s.ballOn, 75)
        XCTAssertEqual(s.clockText, "OT1")
        XCTAssertFalse(Referee.tick(&s, dt: 30, live: true), "overtime is untimed")
        // Team 0 scores a TD + PAT.
        Referee.apply(PlayResult(.touchdown(byOffense: true)), to: &s)
        Referee.chooseConversion(.kick, &s)
        Referee.apply(PlayResult(.fieldGoal(made: true, kickSpot: 78)), to: &s)
        XCTAssertFalse(s.isFinal, "the other team still gets its possession")
        XCTAssertEqual(s.possession, 1); XCTAssertEqual(s.ballOn, 75)
        // Team 1 only manages a field goal: game over.
        Referee.apply(PlayResult(.fieldGoal(made: true, kickSpot: 65)), to: &s)
        XCTAssertTrue(s.isFinal)
        XCTAssertEqual(s.score, [17, 13])
    }

    func testSecondOvertimeForcesTwoPointTries() {
        var s = fresh()
        s.quarter = 4; s.clock = 0; s.score = [3, 3]
        _ = Referee.endQuarterIfExpired(&s)
        Referee.apply(PlayResult(.turnover(spot: 80, interception: true)), to: &s)   // team 0's possession ends
        XCTAssertEqual(s.possession, 1); XCTAssertEqual(s.ballOn, 75, "turnovers don't keep field position in OT")
        s.down = 4
        Referee.apply(PlayResult(.down(spot: 77)), to: &s)                          // team 1 fails on downs
        XCTAssertFalse(s.isFinal)
        XCTAssertEqual(s.overtimePeriod, 2)
        XCTAssertEqual(s.possession, 1, "the period-2 opener alternates")
        XCTAssertTrue(s.mustGoForTwo)
        Referee.apply(PlayResult(.touchdown(byOffense: true)), to: &s)
        Referee.chooseConversion(.kick, &s)
        XCTAssertEqual(s.mode, .conversion(.twoPoint), "no kicked PATs from OT2 on")
    }
}
