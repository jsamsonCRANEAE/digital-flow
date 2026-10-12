import Foundation
import GSFoundation
import GSData
import GSAI

/// Everything that persists between launches (M5). Codable JSON so the app
/// stores one blob in UserDefaults and tests round-trip it in memory.
public struct Profile: Codable, Sendable, Equatable {
    public struct Settings: Codable, Sendable, Equatable {
        /// 0...10 steps.
        public var music = 7
        public var sfx = 8
        public var haptics = true
        /// 0 rookie, 1 pro, 2 legend.
        public var difficulty = 1
        /// Seconds per quarter: one of `quarterOptions`.
        public var quarterLength = 180.0
        /// false = integer scale + letterbox (pixel perfect); true = fill height, sharp bilinear.
        public var sharpFit = false
        public init() {}
        public static let quarterOptions: [Double] = [120, 180, 300]
        public var difficultyValue: Difficulty { [Difficulty.rookie, .pro, .legend][max(0, min(2, difficulty))] }
    }

    public struct CupRun: Codable, Sendable, Equatable {
        public var teamID: String
        /// Opponent ids per round; the final is the "shadow" of your own team.
        public var opponents: [String]
        public var round = 0
        public var results: [String] = []
    }

    public var coins = 0
    public var gamesPlayed = 0
    public var wins = 0
    public var bestGrade = "-"
    public var owned: [String] = []
    /// category rawValue -> item id
    public var equipped: [String: String] = [:]
    public var teamID: String?
    public var cup: CupRun?
    /// Team ids that have won a Spirit Cup (one trophy each on the shop wall).
    public var trophies: [String] = []
    public var settings = Settings()

    public init() {}

    public var equippedIDs: [String] { GearCategory.allCases.compactMap { equipped[$0.rawValue] } }
    public func owns(_ id: String) -> Bool { owned.contains(id) }

    public enum PurchaseResult: Equatable { case bought, equipped, unequipped, tooExpensive }

    /// Tapping BUY/EQUIP in the shop: buy if affordable, else toggle equip.
    @discardableResult
    public mutating func buyOrEquip(_ item: GearItem) -> PurchaseResult {
        let key = item.category.rawValue
        if owns(item.id) {
            if equipped[key] == item.id { equipped[key] = nil; return .unequipped }
            equipped[key] = item.id
            return .equipped
        }
        guard coins >= item.price else { return .tooExpensive }
        coins -= item.price
        owned.append(item.id)
        equipped[key] = item.id            // buying equips immediately: instant gratification
        return .bought
    }
}

/// Spirit Cup: a 3-round ladder (M5). Rounds 1-2 face the other clubs; the
/// final is a mirror match against your team's "Shadow" (dark palette,
/// boosted ratings) — an anime rival trope that works with any roster size.
public enum SpiritCup {
    public static let rounds = ["QUARTERFINAL", "SEMIFINAL", "SHADOW FINAL"]
    public static let winBonus = 500
    public static let shadowBoost = 4

    public static func start(team: String, league: League, seed: UInt64) -> Profile.CupRun {
        var rng = SplitMix64(seed: seed)
        var others = league.teams.map(\.id).filter { $0 != team }
        if others.count > 1, rng.unit() < 0.5 { others.swapAt(0, 1) }
        while others.count < 2 { others.append(others.first ?? team) }
        return Profile.CupRun(teamID: team, opponents: Array(others.prefix(2)) + ["shadow_" + team])
    }

    /// Resolves a team id, synthesizing the shadow team for the final.
    public static func team(_ id: String, league: League) -> TeamData? {
        if let t = league.team(id: id) { return t }
        guard id.hasPrefix("shadow_"), let base = league.team(id: String(id.dropFirst(7))) else { return nil }
        var t = base
        t.id = id
        t.city = "SHADOW"
        t.abbreviation = String(("S" + base.abbreviation).prefix(4))
        t.colors.primary = "#2A1B3D"; t.colors.secondary = "#0E0B14"; t.colors.accent = "#C23BFF"
        for i in t.roster.indices {
            t.roster[i].id = "sh_" + t.roster[i].id
            var r = t.roster[i].ratings
            for kp in [\PlayerRatings.speed, \.acceleration, \.agility, \.strength, \.balance, \.catching, \.throwPower, \.throwAccuracy] {
                r[keyPath: kp] = min(99, r[keyPath: kp] + shadowBoost)
            }
            t.roster[i].ratings = r
        }
        return t
    }

    public enum Outcome: Equatable { case advanced(next: Int), champion, eliminated }

    /// Records a cup game. Ties count as losses (the cup needs a winner;
    /// overtime makes ties rare anyway).
    public static func record(_ p: inout Profile, won: Bool, scoreLine: String) -> Outcome {
        guard var run = p.cup else { return .eliminated }
        run.results.append((won ? "W " : "L ") + scoreLine)
        guard won else { p.cup = nil; return .eliminated }
        run.round += 1
        if run.round >= rounds.count {
            p.cup = nil
            p.trophies.append(run.teamID)
            p.coins += winBonus
            return .champion
        }
        p.cup = run
        return .advanced(next: run.round)
    }
}

/// ProgressStore backed by a Profile, persisted through a closure (the app
/// writes UserDefaults; tests capture the data).
public final class ProfileStore: ProgressStore {
    public var profile: Profile
    let persist: (Data) -> Void

    public init(data: Data?, persist: @escaping (Data) -> Void) {
        profile = data.flatMap { try? JSONDecoder().decode(Profile.self, from: $0) } ?? Profile()
        self.persist = persist
    }

    public var coins: Int { get { profile.coins } set { profile.coins = newValue } }
    public var gamesPlayed: Int { get { profile.gamesPlayed } set { profile.gamesPlayed = newValue } }
    public var wins: Int { get { profile.wins } set { profile.wins = newValue } }
    public var bestGrade: String { get { profile.bestGrade } set { profile.bestGrade = newValue } }
    public func save() { if let d = try? JSONEncoder().encode(profile) { persist(d) } }
}
