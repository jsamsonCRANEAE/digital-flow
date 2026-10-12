/// How a play ended, already converted to the offense's frame.
public struct PlayResult: Sendable, Equatable {
    public enum Kind: Sendable, Equatable {
        /// Runner down / tackled at a spot (yards from offense goal).
        case down(spot: Double)
        case outOfBounds(spot: Double)
        case incomplete
        case touchdown(byOffense: Bool)
        /// Defense gained possession at `spot` (offense frame).
        case turnover(spot: Double, interception: Bool)
        case falseStart
        /// Punt came to rest at `spot` (offense frame); > 100 = in the end zone.
        case punt(spot: Double)
        case fieldGoal(made: Bool, kickSpot: Double)
    }
    public var kind: Kind
    /// Defensive pass interference spot (offense frame), if flagged.
    public var passInterference: Double?
    public var sack: Bool

    public init(_ kind: Kind, passInterference: Double? = nil, sack: Bool = false) {
        self.kind = kind; self.passInterference = passInterference; self.sack = sack
    }
}

public struct Ruling: Sendable, Equatable {
    public var callouts: [String] = []
    public var points: (team: Int, points: Int)? {
        get { pointsTeam.map { ($0, pointsValue) } }
        set { pointsTeam = newValue?.team; pointsValue = newValue?.points ?? 0 }
    }
    var pointsTeam: Int?
    var pointsValue = 0
    public var possessionChanged = false
    public var stopsClock = false
    public var firstDown = false
    public static func == (a: Ruling, b: Ruling) -> Bool {
        a.callouts == b.callouts && a.pointsTeam == b.pointsTeam && a.pointsValue == b.pointsValue
            && a.possessionChanged == b.possessionChanged && a.stopsClock == b.stopsClock && a.firstDown == b.firstDown
    }
}

/// Applies football rules (the 7v7 arcade subset) to the game state.
public enum Referee {
    public static let touchbackSpot = 20.0
    /// Simulated huddle time charged between plays while the clock runs.
    public static let runoffBetweenPlays = 6.0

    @discardableResult
    public static func apply(_ r: PlayResult, to s: inout GameState) -> Ruling {
        var ruling = Ruling()
        let lastMinute = s.inLastMinuteOfHalf
        let offense = s.possession

        // Conversion tries: one snap, then kickoff no matter what.
        if case .conversion(let kind) = s.mode {
            var good = false
            switch (kind, r.kind) {
            case (.twoPoint, .touchdown(byOffense: true)): good = true
            case (.kick, .fieldGoal(made: true, _)): good = true
            case (_, .falseStart):
                s.ballOn = max(1, s.ballOn - min(5, s.ballOn / 2))
                ruling.callouts = ["FALSE START"]
                return ruling
            default: break
            }
            if case .touchdown(byOffense: false) = r.kind {
                score(&s, team: s.defense, 2, &ruling)                 // defensive two on a return
            }
            if good { score(&s, team: offense, kind == .twoPoint ? 2 : 1, &ruling) }
            ruling.callouts.append(good ? (kind == .twoPoint ? "2-PT GOOD!" : "IT'S GOOD!") : "NO GOOD")
            s.kickoff(receiving: 1 - offense)
            ruling.possessionChanged = true
            ruling.stopsClock = true
            return ruling
        }

        // Defensive pass interference: offense takes the better of the play or the spot foul.
        if let pi = r.passInterference {
            let playSpot: Double?
            switch r.kind {
            case .down(let sp), .outOfBounds(let sp): playSpot = sp
            case .touchdown(byOffense: true): playSpot = 101
            default: playSpot = nil
            }
            if playSpot == nil || playSpot! < pi || playSpot! < s.lineToGain {
                s.firstDown(at: min(99, max(pi, s.ballOn)))
                ruling.callouts = ["FLAG!", "PASS INTERFERENCE"]
                ruling.firstDown = true
                ruling.stopsClock = true
                return ruling
            }
        }

        switch r.kind {
        case .falseStart:
            let yards = min(5, s.ballOn / 2)                         // half the distance near the goal
            s.ballOn -= yards
            ruling.callouts = ["FALSE START", "5 YD PENALTY"]

        case .down(let spot), .outOfBounds(let spot):
            var oob = false
            if case .outOfBounds = r.kind { oob = true }
            if spot <= 0 {
                score(&s, team: s.defense, 2, &ruling)
                ruling.callouts = ["SAFETY!"]
                s.kickoff(receiving: s.defense)
                ruling.possessionChanged = true
                ruling.stopsClock = lastMinute
                break
            }
            if r.sack { ruling.callouts.append("SACK!") }
            advance(&s, to: spot, &ruling)
            if oob && lastMinute { ruling.stopsClock = true }

        case .incomplete:
            ruling.callouts = ["INCOMPLETE"]
            ruling.stopsClock = true
            nextDown(&s, spot: s.ballOn, &ruling)

        case .touchdown(let byOffense):
            let team = byOffense ? offense : s.defense
            score(&s, team: team, 6, &ruling)
            ruling.callouts = ["TOUCHDOWN!"]
            if !byOffense { s.possession = team; ruling.possessionChanged = true }
            s.mode = .conversionChoice
            ruling.stopsClock = lastMinute

        case .turnover(let spot, let pick):
            ruling.callouts = [pick ? "INTERCEPTION!" : "TURNOVER!"]
            let theirs = 100 - spot
            s.changePossession(ballOn: theirs <= 0 ? touchbackSpot : theirs)
            if theirs <= 0 { ruling.callouts.append("TOUCHBACK") }
            ruling.possessionChanged = true

        case .punt(let spot):
            let theirs = 100 - spot
            s.changePossession(ballOn: theirs <= 0 ? touchbackSpot : theirs)
            ruling.callouts = theirs <= 0 ? ["TOUCHBACK"] : ["PUNT"]
            ruling.possessionChanged = true

        case .fieldGoal(let made, let kickSpot):
            if made {
                score(&s, team: offense, 3, &ruling)
                ruling.callouts = ["FIELD GOAL!"]
                s.kickoff(receiving: s.defense)
                ruling.stopsClock = lastMinute
            } else {
                ruling.callouts = ["NO GOOD!"]
                s.changePossession(ballOn: max(touchbackSpot, 100 - kickSpot))
            }
            ruling.possessionChanged = true
        }
        s.clockRunning = !ruling.stopsClock
        return ruling
    }

    static func score(_ s: inout GameState, team: Int, _ pts: Int, _ r: inout Ruling) {
        s.score[team] += pts
        r.points = (team, pts)
    }

    static func advance(_ s: inout GameState, to spot: Double, _ r: inout Ruling) {
        if spot >= s.lineToGain {
            s.firstDown(at: spot)
            r.firstDown = true
            r.callouts.append("FIRST DOWN!")
        } else {
            nextDown(&s, spot: spot, &r)
        }
    }

    static func nextDown(_ s: inout GameState, spot: Double, _ r: inout Ruling) {
        s.ballOn = spot
        s.down += 1
        if s.down > 4 {
            r.callouts.append("TURNOVER ON DOWNS")
            s.changePossession(ballOn: 100 - spot)
            r.possessionChanged = true
        }
    }

    /// The scoring team's choice after a touchdown.
    public static func chooseConversion(_ kind: GameState.ConversionKind, _ s: inout GameState) {
        s.mode = .conversion(kind)
        s.ballOn = kind == .kick ? 85 : 98         // PAT from the 15, two from the 2
        s.down = 1
        s.lineToGain = 100
        s.clockRunning = false
    }

    /// Advances the game clock; returns true when the quarter just expired.
    public static func tick(_ s: inout GameState, dt: Double, live: Bool) -> Bool {
        guard !s.isFinal, !s.isConversion, s.mode != .conversionChoice else { return false }
        guard live || s.clockRunning else { return false }
        let before = s.clock
        s.clock = max(0, s.clock - dt)
        return before > 0 && s.clock == 0
    }

    /// Call between plays once the clock reads 0:00 (and no try is pending).
    /// Returns a banner ("END OF Q1", "HALFTIME", "FINAL").
    public static func endQuarterIfExpired(_ s: inout GameState) -> String? {
        guard s.clock <= 0, !s.isFinal, s.mode == .scrimmage else { return nil }
        if s.quarter >= 4 { s.isFinal = true; return "FINAL" }
        let ending = s.quarter
        s.quarter += 1
        s.clock = s.quarterLength
        s.clockRunning = false
        if ending == 2 {
            s.kickoff(receiving: 1 - s.openingReceiver)
            return "HALFTIME"
        }
        return "END OF Q\(ending)"
    }
}
