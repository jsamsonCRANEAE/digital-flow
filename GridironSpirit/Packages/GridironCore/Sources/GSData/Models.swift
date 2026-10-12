import GSFoundation

public enum Position: String, Codable, Sendable, CaseIterable {
    case qb, rb, wr, te, c, og, dl, lb, cb, s, k

    public var isOffense: Bool {
        switch self {
        case .qb, .rb, .wr, .te, .c, .og: return true
        case .dl, .lb, .cb, .s: return false
        case .k: return true
        }
    }
}

/// Ratings are 1...99. Physical movement parameters are derived from these in
/// GSSimulation.MovementProfile so balancing lives in one place.
public struct PlayerRatings: Codable, Sendable, Equatable {
    public var speed: Int
    public var acceleration: Int
    public var agility: Int
    public var strength: Int
    public var balance: Int
    public var catching: Int
    public var throwPower: Int
    public var throwAccuracy: Int
    public var weightLbs: Int

    public init(speed: Int, acceleration: Int, agility: Int, strength: Int, balance: Int,
                catching: Int, throwPower: Int, throwAccuracy: Int, weightLbs: Int) {
        self.speed = speed; self.acceleration = acceleration; self.agility = agility
        self.strength = strength; self.balance = balance; self.catching = catching
        self.throwPower = throwPower; self.throwAccuracy = throwAccuracy; self.weightLbs = weightLbs
    }
}

public struct PlayerData: Codable, Sendable, Identifiable {
    public var id: String
    public var firstName: String
    public var lastName: String
    public var number: Int
    public var position: Position
    public var ratings: PlayerRatings
    /// Id of this player's unique Spirit Play (M4). Nil for non-stars.
    public var spiritPlay: String?

    public var displayName: String { lastName.uppercased() }
}

public enum TeamArchetype: String, Codable, Sendable {
    /// Precise, disciplined, samurai-inspired: great timing routes and tackling.
    case disciplined
    /// Flashy street style: speed, jukes, risky deep shots.
    case flashy
    /// Giant linemen: power running and a wall of a pass rush.
    case powerhouse
}

public struct TeamColors: Codable, Sendable {
    public var primary: String
    public var secondary: String
    public var accent: String
    public var skinTones: [String]?

    public var primaryRGBA: RGBA { RGBA(hexString: primary) ?? RGBA(hex: 0xFF00FF) }
    public var secondaryRGBA: RGBA { RGBA(hexString: secondary) ?? RGBA(hex: 0xFF00FF) }
    public var accentRGBA: RGBA { RGBA(hexString: accent) ?? RGBA(hex: 0xFF00FF) }
}

public struct TeamData: Codable, Sendable, Identifiable {
    public var id: String
    public var city: String
    public var name: String
    /// 2-4 letter scorebug abbreviation.
    public var abbreviation: String
    public var archetype: TeamArchetype
    public var colors: TeamColors
    public var roster: [PlayerData]

    public var fullName: String { "\(city) \(name)" }

    public func players(at position: Position) -> [PlayerData] { roster.filter { $0.position == position } }
}

public struct League: Codable, Sendable {
    public var version: Int
    public var teams: [TeamData]

    public func team(id: String) -> TeamData? { teams.first { $0.id == id } }
}
