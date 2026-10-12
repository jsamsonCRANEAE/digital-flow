import GSFoundation
import GSData

public enum TeamSide: Int, Sendable { case offense = 0, defense = 1 }

public struct SimPlayer: Sendable {
    public let id: Int
    public let data: PlayerData
    public let side: TeamSide
    public let teamIndex: Int
    public var body: PlayerBody
}

/// Per-tick inputs for the simulation (sampled from GSInput).
public struct SimInput: Sendable {
    /// Desired move in world space (x lateral, y downfield), length <= 1.
    public var move: Vec2
    public init(move: Vec2 = .zero) { self.move = move }
}

/// Minimal render-facing copy of a player, interpolated between sim ticks.
public struct PlayerState: Sendable {
    public var id: Int
    public var position: Vec3
    public var velocity: Vec2
    public var facing: Double
    public var stridePhase: Double
    public var topSpeed: Double

    public static func lerped(_ a: PlayerState, _ b: PlayerState, _ t: Double) -> PlayerState {
        PlayerState(id: b.id,
                    position: lerp(a.position, b.position, t),
                    velocity: lerp(a.velocity, b.velocity, t),
                    facing: lerpAngle(a.facing, b.facing, t),
                    stridePhase: lerp(a.stridePhase, b.stridePhase, t),
                    topSpeed: b.topSpeed)
    }
}

/// The deterministic game world. No rendering or platform types here.
public struct World: Sendable {
    public private(set) var players: [SimPlayer] = []
    public var controlledID: Int
    public private(set) var tick: UInt64 = 0
    public private(set) var time: Double = 0
    public private(set) var lastEvents: [(id: Int, events: MovementEvents)] = []

    public init(players: [SimPlayer], controlledID: Int) {
        self.players = players
        self.controlledID = controlledID
    }

    public var controlled: SimPlayer { players[controlledID] }

    public mutating func step(_ input: SimInput, dt: Double) {
        lastEvents.removeAll(keepingCapacity: true)
        for i in players.indices {
            let intent = players[i].id == controlledID ? input.move : .zero
            let ev = players[i].body.step(intent: intent, dt: dt)
            if !ev.isEmpty { lastEvents.append((players[i].id, ev)) }
        }
        resolveOverlaps()
        tick += 1
        time += dt
    }

    /// Circle-vs-circle separation on the ground plane, mass-weighted so
    /// linemen shove skill players more than the reverse.
    mutating func resolveOverlaps() {
        let n = players.count
        guard n > 1 else { return }
        for i in 0..<(n - 1) {
            for j in (i + 1)..<n {
                let a = players[i].body, b = players[j].body
                let d = b.position.ground - a.position.ground
                let minDist = a.profile.radius + b.profile.radius
                let dist2 = d.lengthSquared
                guard dist2 < minDist * minDist else { continue }
                let dist = dist2.squareRoot()
                let normal = dist > 1e-6 ? d / dist : Vec2(1, 0)
                let overlap = minDist - dist
                let wa = b.profile.mass / (a.profile.mass + b.profile.mass)
                let push = normal * overlap
                players[i].body.position.x -= push.x * wa
                players[i].body.position.y -= push.y * wa
                players[j].body.position.x += push.x * (1 - wa)
                players[j].body.position.y += push.y * (1 - wa)
            }
        }
    }

    public func snapshot(into out: inout [PlayerState]) {
        out.removeAll(keepingCapacity: true)
        for p in players {
            out.append(PlayerState(id: p.id, position: p.body.position, velocity: p.body.velocity,
                                   facing: p.body.facing, stridePhase: p.body.stridePhase,
                                   topSpeed: p.body.profile.topSpeed))
        }
    }

    public func player(_ id: Int) -> SimPlayer { players[id] }
}
