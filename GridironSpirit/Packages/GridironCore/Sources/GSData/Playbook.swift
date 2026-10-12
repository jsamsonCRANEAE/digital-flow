import Foundation
import GSFoundation

/// Offensive personnel slots (7v7): QB, RB, WR1 (left), WR2 (right), C, LG, RG.
/// Defensive slots: DL1, DL2, LB1, LB2, CB1 (left), CB2 (right), S.
public typealias Slot = String

public enum PlayCategory: String, Codable, Sendable, CaseIterable {
    case run, shortPass, deepPass          // offense
    case zone, man, pressure               // defense
    case special                           // punts, kicks, conversions

    public var label: String {
        switch self {
        case .run: return "RUN"
        case .shortPass: return "SHORT PASS"
        case .deepPass: return "DEEP PASS"
        case .zone: return "ZONE"
        case .man: return "MAN"
        case .pressure: return "PRESSURE"
        case .special: return "SPECIAL"
        }
    }
}

/// A route or run path: waypoints relative to the player's own alignment
/// (x right, y downfield, yards). `settle` = stop at the last point and
/// sit in the zone (curls, check-downs).
public struct RouteSpec: Codable, Sendable, Equatable {
    public var points: [[Double]]
    public var settle: Bool?
    public var waypoints: [Vec2] { points.map { Vec2($0[0], $0[1]) } }
    public init(points: [[Double]], settle: Bool? = nil) { self.points = points; self.settle = settle }
}

public enum Exchange: String, Codable, Sendable { case none, handoff, pitch }

public struct OffensivePlay: Codable, Sendable, Identifiable, Equatable {
    public var id: String
    public var name: String
    public var category: PlayCategory
    /// Slot -> alignment relative to the ball [x, y].
    public var formation: [Slot: [Double]]
    public var routes: [Slot: RouteSpec]
    /// Ball carrier path for runs (relative to the RB's alignment).
    public var runPath: RouteSpec?
    public var exchange: Exchange
    /// Read order for the QB.
    public var progression: [Slot]
    /// Slots that block instead of running routes (WR stalk blocks on runs).
    public var blockers: [Slot]?

    public func alignment(_ slot: Slot) -> Vec2? { formation[slot].map { Vec2($0[0], $0[1]) } }

    public init(id: String, name: String, category: PlayCategory, formation: [Slot: [Double]], routes: [Slot: RouteSpec],
                runPath: RouteSpec?, exchange: Exchange, progression: [Slot], blockers: [Slot]?) {
        self.id = id; self.name = name; self.category = category; self.formation = formation; self.routes = routes
        self.runPath = runPath; self.exchange = exchange; self.progression = progression; self.blockers = blockers
    }
}

public enum DefensiveRole: String, Codable, Sendable { case rush, man, zone, spy }

public struct DefensiveAssignment: Codable, Sendable, Equatable {
    public var role: DefensiveRole
    /// Offensive slot to cover (man) .
    public var target: Slot?
    /// Zone landmark relative to the ball [x, depth].
    public var zone: [Double]?
    public var zonePoint: Vec2? { zone.map { Vec2($0[0], $0[1]) } }
    public init(role: DefensiveRole, target: Slot? = nil, zone: [Double]? = nil) { self.role = role; self.target = target; self.zone = zone }
}

public struct DefensivePlay: Codable, Sendable, Identifiable, Equatable {
    public var id: String
    public var name: String
    public var category: PlayCategory
    public var formation: [Slot: [Double]]
    public var assignments: [Slot: DefensiveAssignment]

    public init(id: String, name: String, category: PlayCategory, formation: [Slot: [Double]],
                assignments: [Slot: DefensiveAssignment]) {
        self.id = id; self.name = name; self.category = category; self.formation = formation; self.assignments = assignments
    }
    public func alignment(_ slot: Slot) -> Vec2? { formation[slot].map { Vec2($0[0], $0[1]) } }
}

public struct Playbook: Codable, Sendable {
    public var offense: [OffensivePlay]
    public var defense: [DefensivePlay]

    public init(offense: [OffensivePlay], defense: [DefensivePlay]) { self.offense = offense; self.defense = defense }

    public static let offenseSlots: [Slot] = ["QB", "RB", "WR1", "WR2", "C", "LG", "RG"]
    public static let defenseSlots: [Slot] = ["DL1", "DL2", "LB1", "LB2", "CB1", "CB2", "S"]

    public func offense(_ id: String) -> OffensivePlay? { offense.first { $0.id == id } }
    public func defense(_ id: String) -> DefensivePlay? { defense.first { $0.id == id } }

    /// Play-call pages: 3 cards at a time, one per category.
    public var offensePages: [[OffensivePlay]] { Self.pages(offense.map { ($0.category, $0) }, [.run, .shortPass, .deepPass]) }
    public var defensePages: [[DefensivePlay]] { Self.pages(defense.map { ($0.category, $0) }, [.zone, .man, .pressure]) }

    static func pages<P>(_ items: [(PlayCategory, P)], _ cats: [PlayCategory]) -> [[P]] {
        let byCat = cats.map { c in items.filter { $0.0 == c }.map(\.1) }
        let n = byCat.map(\.count).max() ?? 0
        return (0..<n).map { i in byCat.compactMap { i < $0.count ? $0[i] : nil } }
    }
}

extension DataLoader {
    public static func decodePlaybook(from data: Data) throws -> Playbook {
        let book = try JSONDecoder().decode(Playbook.self, from: data)
        for p in book.offense {
            for s in Playbook.offenseSlots where p.formation[s] == nil {
                throw DataLoaderError.invalid("\(p.id) missing alignment for \(s)")
            }
            for s in p.progression where p.routes[s] == nil {
                throw DataLoaderError.invalid("\(p.id) progression slot \(s) has no route")
            }
            if p.category == .run && (p.runPath == nil || p.exchange == .none) {
                throw DataLoaderError.invalid("\(p.id) run play needs runPath and exchange")
            }
        }
        for p in book.defense {
            for s in Playbook.defenseSlots where p.formation[s] == nil || p.assignments[s] == nil {
                throw DataLoaderError.invalid("\(p.id) missing \(s)")
            }
            for (s, a) in p.assignments {
                if a.role == .man && a.target == nil { throw DataLoaderError.invalid("\(p.id) \(s) man without target") }
                if a.role == .zone && a.zone == nil { throw DataLoaderError.invalid("\(p.id) \(s) zone without landmark") }
            }
        }
        return book
    }

    public static func bundledPlaybook() throws -> Playbook {
        guard let url = Bundle.module.url(forResource: "plays", withExtension: "json") else {
            throw DataLoaderError.missingResource("plays.json")
        }
        return try decodePlaybook(from: Data(contentsOf: url))
    }
}
