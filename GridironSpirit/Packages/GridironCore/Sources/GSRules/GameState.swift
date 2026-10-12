/// Score, clock, possession and down state for one game. Positions are in
/// the *offense's* frame: `ballOn` = yards from the possessing team's own
/// goal line (0...100), so nothing here needs to know which way the field
/// is drawn.
public struct GameState: Sendable, Equatable {
    public enum Mode: Sendable, Equatable {
        case scrimmage
        /// Try after a touchdown (untimed).
        case conversion(ConversionKind)
        /// Touchdown scored; the scoring team picks kick or two.
        case conversionChoice
    }
    public enum ConversionKind: Sendable, Equatable { case kick, twoPoint }

    public var score = [0, 0]
    public var quarter = 1
    public let quarterLength: Double
    public var clock: Double
    /// Whether the game clock keeps running between plays.
    public var clockRunning = false
    public var possession: Int
    public var down = 1
    public var ballOn: Double = 25
    public var lineToGain: Double = 35
    public var mode: Mode = .scrimmage
    public let openingReceiver: Int
    public var isFinal = false
    // Overtime (college style): alternating possessions from the opponent's 25.
    public var isOvertime = false
    public var overtimePeriod = 0
    /// Possessions completed in the current OT period (0, 1, 2).
    public var overtimePossessions = 0
    /// Team that started the current OT period with the ball.
    public var overtimeFirst = 0
    /// From the 2nd period on, teams must go for two (no kicked PATs).
    public var mustGoForTwo: Bool { isOvertime && overtimePeriod >= 2 }

    public init(openingReceiver: Int = 0, quarterLength: Double = 180) {
        self.openingReceiver = openingReceiver
        self.quarterLength = quarterLength
        clock = quarterLength
        possession = openingReceiver
    }

    public var defense: Int { 1 - possession }
    public var distance: Double { max(0, lineToGain - ballOn) }
    public var goalToGo: Bool { lineToGain >= 100 }
    public var isHalfEnding: Bool { quarter == 2 || quarter == 4 }
    /// Clock stops after out-of-bounds plays and scores only in this window.
    public var inLastMinuteOfHalf: Bool { isHalfEnding && clock <= 60 }
    public var isConversion: Bool { if case .conversion = mode { return true }; return false }

    public var downAndDistance: String {
        if isConversion { return mode == .conversion(.twoPoint) ? "2-PT TRY" : "EXTRA POINT" }
        if mode == .conversionChoice { return "TRY" }
        let ord = ["1ST", "2ND", "3RD", "4TH"][min(3, max(0, down - 1))]
        if goalToGo { return "\(ord) & GOAL" }
        let d = Int(distance.rounded(.up))
        return "\(ord) & \(d < 1 ? "INCHES" : String(d))"
    }

    /// "OWN 32", "OPP 18", "50".
    public var fieldPosition: String {
        let y = Int(ballOn.rounded())
        if y == 50 { return "50" }
        return y < 50 ? "OWN \(y)" : "OPP \(100 - y)"
    }

    public var clockText: String {
        if isOvertime { return "OT\(overtimePeriod)" }
        let t = max(0, Int(clock.rounded(.up)))
        return "\(t / 60):" + (t % 60 < 10 ? "0" : "") + "\(t % 60)"
    }

    mutating func firstDown(at spot: Double) {
        ballOn = spot
        down = 1
        lineToGain = min(100, spot + 10)
    }

    mutating func changePossession(ballOn spot: Double) {
        if isOvertime { return overtimePossessionEnded() }   // turnovers end the OT possession
        possession = 1 - possession
        mode = .scrimmage
        firstDown(at: min(99, max(1, spot)))
    }

    /// Kickoffs are simplified to an automatic touchback (see DECISIONS.md).
    mutating func kickoff(receiving team: Int) {
        if isOvertime { return overtimePossessionEnded() }
        possession = team
        mode = .scrimmage
        firstDown(at: 25)
    }

    /// Ends the current OT possession: hand the ball to the other team at the
    /// opponent's 25, or settle the period once both teams have had it.
    mutating func overtimePossessionEnded() {
        overtimePossessions += 1
        mode = .scrimmage
        if overtimePossessions >= 2 {
            if score[0] != score[1] { isFinal = true; return }
            overtimePeriod += 1
            overtimePossessions = 0
            overtimeFirst = 1 - overtimeFirst
            possession = overtimeFirst
        } else {
            possession = 1 - overtimeFirst
        }
        firstDown(at: 75)
        lineToGain = 85
    }

    mutating func startOvertime() {
        isOvertime = true
        overtimePeriod = 1
        overtimePossessions = 0
        overtimeFirst = openingReceiver      // the opening receiver gets the ball first
        possession = overtimeFirst
        clock = 0
        clockRunning = false
        mode = .scrimmage
        firstDown(at: 75)
        lineToGain = 85
    }
}
