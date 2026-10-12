import GSFoundation
import GSData

/// Builds the M1 sandbox: a 7v7 lineup at a line of scrimmage, one
/// human-controlled ball carrier. Plays/AI arrive in M3.
public enum Formation {
    /// Offset from the ball (x lateral, y toward own end zone is negative).
    static let offense: [(Position, Vec2)] = [
        (.c, Vec2(0, -0.6)), (.og, Vec2(-1.4, -0.7)), (.og, Vec2(1.4, -0.7)),
        (.qb, Vec2(0, -4.5)), (.rb, Vec2(0, -7.0)),
        (.wr, Vec2(-14, -0.8)), (.wr, Vec2(13, -0.8)),
    ]
    static let defense: [(Position, Vec2)] = [
        (.dl, Vec2(-1.0, 1.0)), (.dl, Vec2(1.6, 1.0)),
        (.lb, Vec2(-4, 5)), (.lb, Vec2(4, 5)),
        (.cb, Vec2(-14, 6)), (.cb, Vec2(13, 6)), (.s, Vec2(0, 13)),
    ]

    public static func sandbox(offense off: TeamData, defense def: TeamData,
                               ballOn ownYardLine: Double = 25,
                               lateral: Double = Field.centerX,
                               controlled: Position = .rb) -> World {
        let ball = Vec2(lateral, Field.worldY(ownYardLine: ownYardLine))
        var players: [SimPlayer] = []
        var used = Set<String>()
        func add(_ team: TeamData, _ teamIndex: Int, _ side: TeamSide, _ slots: [(Position, Vec2)], facing: Double) {
            for (pos, offset) in slots {
                guard let data = team.roster.first(where: { $0.position == pos && !used.contains($0.id) })
                    ?? team.roster.first(where: { !used.contains($0.id) }) else { continue }
                used.insert(data.id)
                let body = PlayerBody(position: ball + offset, facing: facing,
                                      profile: MovementProfile.from(data.ratings))
                players.append(SimPlayer(id: players.count, data: data, side: side, teamIndex: teamIndex, body: body))
            }
        }
        add(off, 0, .offense, offense, facing: Double.pi / 2)
        add(def, 1, .defense, defense, facing: -Double.pi / 2)
        let controlledID = players.first { $0.side == .offense && $0.data.position == controlled }?.id ?? 0
        return World(players: players, controlledID: controlledID)
    }
}
