import GSFoundation
import GSData

/// Lines up both teams from playbook data.
public enum Formation {
    /// Fallback plays used by the M1/M2 sandbox and tests.
    static let sandboxOffense = OffensivePlay(
        id: "sandbox", name: "SANDBOX", category: .shortPass,
        formation: ["QB": [0, -4.5], "RB": [0, -7.0], "WR1": [-14, -0.8], "WR2": [13, -0.8],
                    "C": [0, -0.6], "LG": [-1.4, -0.7], "RG": [1.4, -0.7]],
        routes: [:], runPath: nil, exchange: .none, progression: [], blockers: nil)
    static let sandboxDefense = DefensivePlay(
        id: "sandbox", name: "SANDBOX", category: .man,
        formation: ["DL1": [-1.0, 1.0], "DL2": [1.6, 1.0], "LB1": [-4, 5], "LB2": [4, 5],
                    "CB1": [-14, 6], "CB2": [13, 6], "S": [0, 13]],
        assignments: [:])

    /// Which roster position fills each slot.
    static let slotPositions: [Slot: Position] = [
        "QB": .qb, "RB": .rb, "WR1": .wr, "WR2": .wr, "C": .c, "LG": .og, "RG": .og,
        "DL1": .dl, "DL2": .dl, "LB1": .lb, "LB2": .lb, "CB1": .cb, "CB2": .cb, "S": .s,
    ]

    /// - Parameters:
    ///   - ballOn: yards from the offense's own goal line (0...100).
    ///   - teamIndices: league-level team index of (offense, defense), used for looks/HUD.
    public static func lineUp(offense off: TeamData, offensePlay: OffensivePlay,
                              defense def: TeamData, defensePlay: DefensivePlay,
                              ballOn: Double, lateral: Double = Field.centerX,
                              teamIndices: (Int, Int) = (0, 1), controlled: Slot = "QB",
                              seed: UInt64 = 0xF00D) -> World {
        let ball = Vec2(lateral, Field.worldY(ownYardLine: ballOn))
        var players: [SimPlayer] = []
        func add(_ team: TeamData, _ teamIndex: Int, _ side: TeamSide, slots: [Slot], align: (Slot) -> Vec2?, facing: Double) {
            var used = Set<String>()
            for slot in slots {
                guard let pos = slotPositions[slot], let offset = align(slot) else { continue }
                guard let data = team.roster.first(where: { $0.position == pos && !used.contains($0.id) })
                    ?? team.roster.first(where: { !used.contains($0.id) }) else { continue }
                used.insert(data.id)
                // Defense mirrors left/right so CB1 always lines up over WR1.
                var p = ball + offset
                p.x = clamp(p.x, 0.8, Field.width - 0.8)
                let body = PlayerBody(position: p, facing: facing, profile: MovementProfile.from(data.ratings))
                var sp = SimPlayer(id: players.count, data: data, side: side, teamIndex: teamIndex, body: body)
                sp.slot = slot
                players.append(sp)
            }
        }
        add(off, teamIndices.0, .offense, slots: Playbook.offenseSlots, align: offensePlay.alignment, facing: Double.pi / 2)
        add(def, teamIndices.1, .defense, slots: Playbook.defenseSlots, align: defensePlay.alignment, facing: -Double.pi / 2)
        let controlledID = players.first { $0.side == .offense && $0.slot == controlled }?.id ?? 0
        return World(players: players, controlledID: controlledID, lineOfScrimmage: ball.y, seed: seed)
    }

    /// The M1/M2 sandbox lineup (kept for tests and the preview tool).
    public static func sandbox(offense off: TeamData, defense def: TeamData,
                               ballOn ownYardLine: Double = 25,
                               lateral: Double = Field.centerX,
                               controlled: Position = .qb, seed: UInt64 = 0xF00D) -> World {
        let slot = slotPositions.first { $0.value == controlled && Playbook.offenseSlots.contains($0.key) }?.key ?? "QB"
        return lineUp(offense: off, offensePlay: sandboxOffense, defense: def, defensePlay: sandboxDefense,
                      ballOn: ownYardLine, lateral: lateral, controlled: slot, seed: seed)
    }
}
