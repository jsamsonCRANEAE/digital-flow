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
        let t = max(0, Int(clock.rounded(.up)))
        return "\(t / 60):" + (t % 60 < 10 ? "0" : "") + "\(t % 60)"
    }

    mutating func firstDown(at spot: Double) {
        ballOn = spot
        down = 1
        lineToGain = min(100, spot + 10)
    }

    mutating func changePossession(ballOn spot: Double) {
        possession = 1 - possession
        mode = .scrimmage
        firstDown(at: min(99, max(1, spot)))
    }

    /// Kickoffs are simplified to an automatic touchback (see DECISIONS.md).
    mutating func kickoff(receiving team: Int) {
        possession = team
        mode = .scrimmage
        firstDown(at: 25)
    }
}
