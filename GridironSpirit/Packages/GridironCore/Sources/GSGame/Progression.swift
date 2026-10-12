import GSFoundation

/// Per-team box score accumulated during a game.
public struct TeamGameStats: Sendable, Equatable {
    public var passYards = 0.0
    public var rushYards = 0.0
    public var passAttempts = 0
    public var completions = 0
    public var touchdowns = 0
    public var interceptionsThrown = 0
    public var sacksMade = 0
    public var interceptionsMade = 0
    public var fumblesRecovered = 0
    public var bigHits = 0
    public var fieldGoalsMade = 0
    public var longestFieldGoal = 0
    public var firstDowns = 0
    public var brokenTackles = 0
    public var spiritPlaysUsed = 0
    public var spiritTouchdowns = 0
    /// Largest deficit this team faced (for comeback trials).
    public var largestDeficit = 0
    public init() {}
    public var takeaways: Int { interceptionsMade + fumblesRecovered }
}

public struct PlayerGameStats: Sendable, Equatable {
    public var name: String
    public var team: Int
    public var yards = 0.0
    public var touchdowns = 0
    public var tackles = 0
    public var sacks = 0
    public var picks = 0
    /// Simple impact score used to pick the MVP.
    public var impact: Double { yards / 10 + Double(touchdowns) * 6 + Double(tackles) * 0.8 + Double(sacks) * 3 + Double(picks) * 5 }
}

/// A daily challenge. `check` sees the human team's view of the game.
public struct Trial: Sendable, Identifiable {
    public enum Tier: Int, Sendable { case easy = 0, medium, hard }
    public let id: String
    public let text: String
    public let tier: Tier
    public var reward: Int { [50, 100, 200][tier.rawValue] }
    let check: @Sendable (_ me: TeamGameStats, _ them: TeamGameStats, _ myScore: Int, _ theirScore: Int) -> Bool

    public func passed(me: TeamGameStats, them: TeamGameStats, myScore: Int, theirScore: Int) -> Bool {
        check(me, them, myScore, theirScore)
    }
}

/// "Spirit Trials": three fresh goals every day (one per tier), seeded by date
/// so everyone shares the same set on the same day, plus a pool large enough
/// that a week rarely repeats.
public enum Trials {
    public static let pool: [Trial] = [
        Trial(id: "win", text: "WIN THE GAME", tier: .easy) { _, _, a, b in a > b },
        Trial(id: "score14", text: "SCORE 14+ POINTS", tier: .easy) { _, _, a, _ in a >= 14 },
        Trial(id: "sacks2", text: "RECORD 2 SACKS", tier: .easy) { m, _, _, _ in m.sacksMade >= 2 },
        Trial(id: "rush40", text: "RUSH FOR 40+ YARDS", tier: .easy) { m, _, _, _ in m.rushYards >= 40 },
        Trial(id: "pass100", text: "PASS FOR 100+ YARDS", tier: .easy) { m, _, _, _ in m.passYards >= 100 },
        Trial(id: "takeaway", text: "FORCE A TURNOVER", tier: .easy) { m, _, _, _ in m.takeaways >= 1 },
        Trial(id: "rush80", text: "RUSH FOR 80+ YARDS", tier: .medium) { m, _, _, _ in m.rushYards >= 80 },
        Trial(id: "pass180", text: "PASS FOR 180+ YARDS", tier: .medium) { m, _, _, _ in m.passYards >= 180 },
        Trial(id: "picks2", text: "INTERCEPT 2 PASSES", tier: .medium) { m, _, _, _ in m.interceptionsMade >= 2 },
        Trial(id: "fg40", text: "KICK A 40+ YARD FIELD GOAL", tier: .medium) { m, _, _, _ in m.longestFieldGoal >= 40 },
        Trial(id: "hold10", text: "HOLD THEM TO 10 OR LESS", tier: .medium) { _, _, _, b in b <= 10 },
        Trial(id: "bighits3", text: "LAND 3 BIG HITS", tier: .medium) { m, _, _, _ in m.bigHits >= 3 },
        Trial(id: "spiritTD", text: "SCORE DURING A SPIRIT PLAY", tier: .medium) { m, _, _, _ in m.spiritTouchdowns >= 1 },
        Trial(id: "win21", text: "WIN BY 21+", tier: .hard) { _, _, a, b in a - b >= 21 },
        Trial(id: "shutout", text: "SHUT THEM OUT", tier: .hard) { _, _, a, b in b == 0 && a > 0 },
        Trial(id: "comeback", text: "WIN AFTER TRAILING BY 10+", tier: .hard) { m, _, a, b in a > b && m.largestDeficit >= 10 },
        Trial(id: "tds5", text: "SCORE 5 TOUCHDOWNS", tier: .hard) { m, _, _, _ in m.touchdowns >= 5 },
        Trial(id: "clean", text: "WIN WITHOUT A TURNOVER", tier: .hard) { m, t, a, b in a > b && m.interceptionsThrown == 0 && t.fumblesRecovered == 0 },
        Trial(id: "broken5", text: "BREAK 5 TACKLES", tier: .hard) { m, _, _, _ in m.brokenTackles >= 5 },
    ]

    /// Day key like 20261012 -> one trial per tier.
    public static func daily(dayKey: Int) -> [Trial] {
        var rng = SplitMix64(seed: UInt64(dayKey) &* 0x9E37_79B9_7F4A_7C15)
        return [Trial.Tier.easy, .medium, .hard].map { tier in
            let options = pool.filter { $0.tier == tier }
            return options[rng.int(options.count)]
        }
    }
}

/// End-of-game summary: result, grade, MVP, trials and coins.
public struct GameReport: Sendable {
    public var headline: String
    public var scoreLine: String
    public var grade: String
    public var mvp: String
    public var statLines: [String]
    public var trialLines: [(text: String, passed: Bool, reward: Int)]
    public var coins: Int

    public static func build(humanTeam me: Int, abbreviations: [String], score: [Int], stats: [TeamGameStats],
                             players: [String: PlayerGameStats], trials: [Trial]) -> GameReport {
        let them = 1 - me
        let mine = score[me], theirs = score[them]
        let headline = mine > theirs ? "VICTORY!" : mine < theirs ? "DEFEAT" : "TIE GAME"
        let s = stats[me]
        // Grade: margin plus how complete the performance was.
        var points = Double(mine - theirs) / 7
        points += s.rushYards / 60 + s.passYards / 120 + Double(s.takeaways) * 0.7 - Double(s.interceptionsThrown) * 0.6
        var grade = points >= 5 ? "S" : points >= 3 ? "A" : points >= 1.5 ? "B" : points >= 0 ? "C" : "D"
        // A loss can't grade above B, a tie above A.
        if mine < theirs && ["S", "A"].contains(grade) { grade = "B" }
        if mine == theirs && grade == "S" { grade = "A" }
        let mvpP = players.values.filter { $0.team == me }.max { $0.impact < $1.impact }
        let mvp = mvpP.map { p -> String in
            var bits: [String] = []
            if p.yards >= 10 { bits.append("\(Int(p.yards)) YDS") }
            if p.touchdowns > 0 { bits.append("\(p.touchdowns) TD") }
            if p.tackles > 0 { bits.append("\(p.tackles) TKL") }
            if p.sacks > 0 { bits.append("\(p.sacks) SACK") }
            if p.picks > 0 { bits.append("\(p.picks) INT") }
            return "MVP  \(p.name)  " + bits.prefix(3).joined(separator: " ")
        } ?? "MVP  TEAM EFFORT"
        let statLines = [
            "PASS \(Int(s.passYards)) YDS  \(s.completions)/\(s.passAttempts)   RUSH \(Int(s.rushYards)) YDS",
            "TAKEAWAYS \(s.takeaways)   SACKS \(s.sacksMade)   BIG HITS \(s.bigHits)",
        ]
        let results = trials.map { t in (t.text, t.passed(me: s, them: stats[them], myScore: mine, theirScore: theirs), t.reward) }
        var coins = mine > theirs ? 150 : mine == theirs ? 90 : 60
        coins += 15 * s.touchdowns + min(60, 10 * (s.takeaways + s.sacksMade + s.bigHits))
        coins += results.filter { $0.1 }.map { $0.2 }.reduce(0, +)
        return GameReport(headline: headline, scoreLine: "\(abbreviations[0]) \(score[0])  -  \(score[1]) \(abbreviations[1])",
                          grade: grade, mvp: mvp, statLines: statLines,
                          trialLines: results.map { ($0.0, $0.1, $0.2) }, coins: coins)
    }
}

/// Persistent player progress (coins, records). The app supplies a store
/// backed by UserDefaults; tests use the in-memory one.
public protocol ProgressStore: AnyObject {
    var coins: Int { get set }
    var gamesPlayed: Int { get set }
    var wins: Int { get set }
    var bestGrade: String { get set }
    func save()
}

public final class MemoryProgressStore: ProgressStore {
    public var coins = 0, gamesPlayed = 0, wins = 0
    public var bestGrade = "-"
    public init() {}
    public func save() {}
}
