import Foundation

public enum DataLoaderError: Error, CustomStringConvertible {
    case missingResource(String)
    case invalid(String)

    public var description: String {
        switch self {
        case .missingResource(let n): return "Missing bundled resource \(n)"
        case .invalid(let m): return "Invalid game data: \(m)"
        }
    }
}

public enum DataLoader {
    public static func decodeLeague(from data: Data) throws -> League {
        let league = try JSONDecoder().decode(League.self, from: data)
        try validate(league)
        return league
    }

    /// Loads Resources/teams.json bundled with this package.
    public static func bundledLeague() throws -> League {
        guard let url = Bundle.module.url(forResource: "teams", withExtension: "json") else {
            throw DataLoaderError.missingResource("teams.json")
        }
        return try decodeLeague(from: Data(contentsOf: url))
    }

    static func validate(_ league: League) throws {
        var ids = Set<String>()
        for team in league.teams {
            guard (2...4).contains(team.abbreviation.count) else {
                throw DataLoaderError.invalid("\(team.id) abbreviation must be 2-4 chars")
            }
            for p in team.roster {
                guard ids.insert(p.id).inserted else { throw DataLoaderError.invalid("duplicate player id \(p.id)") }
                let r = p.ratings
                for v in [r.speed, r.acceleration, r.agility, r.strength, r.balance, r.catching, r.throwPower, r.throwAccuracy]
                    where !(1...99).contains(v) {
                    throw DataLoaderError.invalid("\(p.id) rating \(v) out of 1...99")
                }
                guard (140...380).contains(r.weightLbs) else {
                    throw DataLoaderError.invalid("\(p.id) weight \(r.weightLbs) out of range")
                }
            }
        }
    }
}
