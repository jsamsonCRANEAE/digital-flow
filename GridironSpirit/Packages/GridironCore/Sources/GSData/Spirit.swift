import Foundation
import GSFoundation

/// Gameplay modifiers a Spirit Play grants its side for one snap.
/// Every field defaults to "no change" so plays only list what they alter.
public struct SpiritEffects: Codable, Sendable, Equatable {
    public var speed: Double?
    public var tackleResist: Double?
    public var tacklePower: Double?
    public var perfectPass: Bool?
    public var throwSpeed: Double?
    public var catchBonus: Double?
    public var pickBonus: Double?
    /// Offense: blockers win every rep. Defense: rushers shed blocks.
    public var blockWin: Bool?
    /// Jukes/spins always beat the tackler in their window.
    public var unbreakableMoves: Bool?
    public var fumbleMultiplier: Double?
    /// Defense AI reacts instantly with perfect pursuit.
    public var instantReads: Bool?
    /// Every tackle on the carrier becomes a forward-falling pile.
    public var pushPile: Bool?
    public init() {}
}

public struct SpiritPlay: Codable, Sendable, Equatable, Identifiable {
    public enum Side: String, Codable, Sendable { case offense, defense }
    public enum PlayType: String, Codable, Sendable { case pass, run, any }
    public var id: String
    public var name: String
    public var side: Side
    public var playType: PlayType
    public var flavor: String
    /// Decorative brush-glyph motif used by the cut-in art.
    public var motif: Int
    public var effects: SpiritEffects
}

public struct SpiritCatalog: Codable, Sendable {
    public var spirits: [SpiritPlay]
    public init(spirits: [SpiritPlay]) { self.spirits = spirits }
    public func play(_ id: String?) -> SpiritPlay? { id.flatMap { i in spirits.first { $0.id == i } } }
}

extension DataLoader {
    public static func bundledSpirits() throws -> SpiritCatalog {
        guard let url = Bundle.module.url(forResource: "spirits", withExtension: "json") else {
            throw DataLoaderError.missingResource("spirits.json")
        }
        return try JSONDecoder().decode(SpiritCatalog.self, from: Data(contentsOf: url))
    }
}
