import Foundation

/// Gear shop items (M5). Gear is cosmetic-free stat equipment for the
/// human team: one item equipped per category; boosts stack across categories.
public enum GearCategory: String, Codable, Sendable, CaseIterable {
    case cleats, gloves, helmets, training
    public var title: String { rawValue.uppercased() }
}

public struct GearItem: Codable, Sendable, Identifiable, Equatable {
    public var id: String
    public var name: String
    public var category: GearCategory
    /// 1...5 (5 = legendary).
    public var tier: Int
    /// Rating name -> bonus points (keys match PlayerRatings properties).
    public var boost: [String: Int]
    public var appliesTo: [Position]
    public var bestFor: String
    /// Extra Spirit meter charge rate (0.08 = +8%).
    public var spiritCharge: Double?
    /// Filled from tierPrices on load.
    public var price: Int = 0

    enum CodingKeys: String, CodingKey { case id, name, category, tier, boost, appliesTo, bestFor, spiritCharge }

    public var tierNumeral: String { ["I", "II", "III", "IV", "V"][max(0, min(4, tier - 1))] }
    /// Short stat summary for the shop panel, e.g. "SPD+2 ACC+2".
    public var boostSummary: String {
        let short = ["speed": "SPD", "acceleration": "ACC", "agility": "AGI", "strength": "STR", "balance": "BAL",
                     "catching": "CTH", "throwPower": "THP", "throwAccuracy": "THA"]
        var s = GearCatalog.statOrder.compactMap { k in boost[k].map { "\(short[k] ?? k)+\($0)" } }
        if let c = spiritCharge { s.append("SPIRIT+\(Int((c * 100).rounded()))%") }
        return s.joined(separator: " ")
    }
}

public struct GearCatalog: Codable, Sendable {
    public var version: Int
    public var tierPrices: [Int]
    public var items: [GearItem]

    static let statOrder = ["speed", "acceleration", "agility", "strength", "balance", "catching", "throwPower", "throwAccuracy"]

    public func item(_ id: String) -> GearItem? { items.first { $0.id == id } }
    public func items(in c: GearCategory) -> [GearItem] { items.filter { $0.category == c }.sorted { $0.tier < $1.tier } }

    /// Applies equipped gear to a team's roster. Ratings clamp at 99.
    public func boosted(_ team: TeamData, equipped: [String]) -> TeamData {
        let gear = equipped.compactMap(item)
        var t = team
        for i in t.roster.indices {
            var r = t.roster[i].ratings
            for g in gear where g.appliesTo.contains(t.roster[i].position) {
                for (k, v) in g.boost {
                    func bump(_ x: inout Int) { x = min(99, x + v) }
                    switch k {
                    case "speed": bump(&r.speed)
                    case "acceleration": bump(&r.acceleration)
                    case "agility": bump(&r.agility)
                    case "strength": bump(&r.strength)
                    case "balance": bump(&r.balance)
                    case "catching": bump(&r.catching)
                    case "throwPower": bump(&r.throwPower)
                    case "throwAccuracy": bump(&r.throwAccuracy)
                    default: break
                    }
                }
            }
            t.roster[i].ratings = r
        }
        return t
    }

    public func spiritChargeBonus(equipped: [String]) -> Double {
        equipped.compactMap(item).compactMap(\.spiritCharge).reduce(0, +)
    }
}

extension DataLoader {
    public static func decodeGear(from data: Data) throws -> GearCatalog {
        var cat = try JSONDecoder().decode(GearCatalog.self, from: data)
        var ids = Set<String>()
        for i in cat.items.indices {
            let it = cat.items[i]
            guard ids.insert(it.id).inserted else { throw DataLoaderError.invalid("duplicate gear id \(it.id)") }
            guard (1...cat.tierPrices.count).contains(it.tier) else { throw DataLoaderError.invalid("bad tier \(it.id)") }
            guard Set(it.boost.keys).isSubset(of: GearCatalog.statOrder) else { throw DataLoaderError.invalid("bad stat in \(it.id)") }
            cat.items[i].price = cat.tierPrices[it.tier - 1]
        }
        return cat
    }

    public static func bundledGear() throws -> GearCatalog {
        guard let url = Bundle.module.url(forResource: "gear", withExtension: "json") else {
            throw DataLoaderError.missingResource("gear.json")
        }
        return try decodeGear(from: Data(contentsOf: url))
    }
}
