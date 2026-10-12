import GSFoundation
import GSData

/// Game situation as the play caller sees it (offense's point of view).
public struct Situation: Sendable, Equatable {
    public var down: Int
    public var distance: Double
    /// Yards from the offense's own goal line.
    public var ballOn: Double
    /// Offense score minus defense score.
    public var scoreDiff: Int
    public var quarter: Int
    public var clock: Double
    public var isConversion: Bool

    public init(down: Int, distance: Double, ballOn: Double, scoreDiff: Int, quarter: Int, clock: Double, isConversion: Bool = false) {
        self.down = down; self.distance = distance; self.ballOn = ballOn; self.scoreDiff = scoreDiff
        self.quarter = quarter; self.clock = clock; self.isConversion = isConversion
    }

    public var lateAndTrailing: Bool { quarter == 4 && clock < 120 && scoreDiff < 0 }
    /// Field goal distance: line of scrimmage to the posts (end line) + 7 yd snap/hold.
    public var fieldGoalDistance: Double { (100 - ballOn) + 17 }
}

public enum FourthDownCall: Sendable, Equatable { case punt, fieldGoal, goForIt }
public enum ConversionCall: Sendable, Equatable { case kick, twoPoint }

/// CPU coordinator: situational play calling with a little randomness.
public struct PlayCaller: Sendable {
    var rng: SplitMix64
    public init(seed: UInt64) { rng = SplitMix64(seed: seed) }

    public mutating func fourthDown(_ s: Situation, kickerRange: Double = 52) -> FourthDownCall {
        if s.lateAndTrailing && (s.scoreDiff < -3 || s.fieldGoalDistance > kickerRange) { return .goForIt }
        if s.fieldGoalDistance <= kickerRange && !(s.distance <= 1 && s.ballOn > 95) { return .fieldGoal }
        if s.distance <= 1.5 && s.ballOn >= 45 { return .goForIt }
        return .punt
    }

    /// The classic chart: go for two when it changes the margin in a useful
    /// way late in the game.
    public mutating func conversion(scoreDiffAfterTD d: Int, quarter: Int) -> ConversionCall {
        guard quarter >= 4 else { return .kick }
        return [-2, -5, -10, 1, 5, -9].contains(d) ? .twoPoint : .kick
    }

    public mutating func offense(_ s: Situation, from book: Playbook) -> OffensivePlay {
        var w: [PlayCategory: Double]
        if s.isConversion || s.distance <= 2 { w = [.run: 0.55, .shortPass: 0.4, .deepPass: 0.05] }
        else if s.distance >= 8 && s.down >= 2 { w = [.run: 0.12, .shortPass: 0.43, .deepPass: 0.45] }
        else { w = [.run: 0.42, .shortPass: 0.38, .deepPass: 0.2] }
        if s.lateAndTrailing { w[.run] = 0.05; w[.deepPass] = (w[.deepPass] ?? 0) + 0.2 }
        if s.ballOn > 88 { w[.deepPass] = 0.1 }   // compressed field
        let cat = pick(w)
        let options = book.offense.filter { $0.category == cat }
        return options.isEmpty ? book.offense[0] : options[rng.int(options.count)]
    }

    public mutating func defense(_ s: Situation, from book: Playbook) -> DefensivePlay {
        var w: [PlayCategory: Double]
        if s.distance <= 2 { w = [.zone: 0.2, .man: 0.35, .pressure: 0.45] }
        else if s.distance >= 10 { w = [.zone: 0.5, .man: 0.3, .pressure: 0.2] }
        else { w = [.zone: 0.4, .man: 0.35, .pressure: 0.25] }
        let cat = pick(w)
        var options = book.defense.filter { $0.category == cat }
        // Prevent only when protecting a lead late.
        if !(s.quarter == 4 && s.scoreDiff < 0 && s.clock < 120) { options.removeAll { $0.id == "prevent" } }
        if options.isEmpty { options = book.defense.filter { $0.id != "prevent" } }
        return options[rng.int(options.count)]
    }

    mutating func pick(_ w: [PlayCategory: Double]) -> PlayCategory {
        let total = w.values.reduce(0, +)
        var r = rng.unit() * total
        for c in PlayCategory.allCases { if let v = w[c] { r -= v; if r <= 0 { return c } } }
        return w.keys.first!
    }
}

/// CPU kicker: picks meter values for a target, with difficulty-scaled error.
public enum KickAI {
    public static func fieldGoal(distance: Double, error: Double, rng: inout SplitMix64) -> (power: Double, aim: Double) {
        // Power needed rises with distance; aim error is symmetric.
        let base = clamp(0.48 + distance / 75, 0.5, 1)
        return (clamp(base + 0.04 + rng.gaussian() * error, 0, 1), clamp(rng.gaussian() * error * 1.6, -1, 1))
    }
    public static func punt(error: Double, rng: inout SplitMix64) -> (power: Double, aim: Double) {
        (clamp(0.9 + rng.gaussian() * error, 0, 1), clamp(rng.gaussian() * error, -1, 1))
    }
}
