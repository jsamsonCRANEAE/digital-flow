import Foundation
import GSGame

/// Persists coins and records between launches (feeds the M5 gear shop).
final class UserDefaultsProgressStore: ProgressStore {
    private let d = UserDefaults.standard
    var coins: Int
    var gamesPlayed: Int
    var wins: Int
    var bestGrade: String

    init() {
        coins = d.integer(forKey: "gs.coins")
        gamesPlayed = d.integer(forKey: "gs.games")
        wins = d.integer(forKey: "gs.wins")
        bestGrade = d.string(forKey: "gs.bestGrade") ?? "-"
    }

    func save() {
        d.set(coins, forKey: "gs.coins")
        d.set(gamesPlayed, forKey: "gs.games")
        d.set(wins, forKey: "gs.wins")
        d.set(bestGrade, forKey: "gs.bestGrade")
    }
}
