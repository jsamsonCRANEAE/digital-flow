import GSFoundation
import GSData
import GSSimulation

/// Difficulty is expressed only through perception and decision quality,
/// never through stat boosts: reaction time, pursuit-angle quality and,
/// later (M3), QB read speed and accuracy.
public struct Difficulty: Sendable, Equatable {
    public var name: String
    /// Seconds of lag in perceiving a target's velocity change.
    public var reactionTime: Double
    /// 0 = chase the current position, 1 = perfect lead-angle intercept.
    public var pursuitQuality: Double
    /// Throttle defenders use in coverage before the ball is thrown.
    public var coverageEffort: Double
    /// Man-coverage position along the field relative to the receiver:
    /// negative = trailing underneath, positive = over the top.
    public var coverageCushion: Double

    public static let rookie = Difficulty(name: "ROOKIE", reactionTime: 0.45, pursuitQuality: 0.35, coverageEffort: 0.8, coverageCushion: -1.6)
    public static let pro = Difficulty(name: "PRO", reactionTime: 0.25, pursuitQuality: 0.7, coverageEffort: 0.88, coverageCushion: -0.7)
    public static let legend = Difficulty(name: "LEGEND", reactionTime: 0.12, pursuitQuality: 0.95, coverageEffort: 1.0, coverageCushion: 0.9)
}

public enum Assignment: Sendable, Equatable {
    case passer
    case route([Vec2])          // absolute waypoints, generated at the snap
    case passBlock
    case passRush
    case man(Int)
    case zone(Vec2)
}

public enum Pursuit {
    /// Earliest time a chaser at `from` with `speed` can reach a target moving
    /// linearly from `target` at `velocity`. Nil if it can never catch up.
    public static func interceptTime(from: Vec2, speed: Double, target: Vec2, velocity: Vec2) -> Double? {
        let r = target - from
        let a = velocity.dot(velocity) - speed * speed
        let b = 2 * r.dot(velocity)
        let c = r.dot(r)
        if abs(a) < 1e-9 { return b < 0 ? -c / b : nil }
        let disc = b * b - 4 * a * c
        guard disc >= 0 else { return nil }
        let sq = disc.squareRoot()
        let t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a)
        let ts = [t1, t2].filter { $0 > 0 }
        return ts.min()
    }

    /// Aim point for a pursuer: the lead-angle intercept point, blended toward
    /// the target's current position by (1 - quality).
    public static func aimPoint(from: Vec2, speed: Double, target: Vec2, velocity: Vec2, quality: Double) -> Vec2 {
        let lead: Vec2
        if let t = interceptTime(from: from, speed: speed, target: target, velocity: velocity) {
            lead = target + velocity * min(t, 4)
        } else {
            lead = target + velocity * 1.0
        }
        return lerp(target, lead, clamp(quality, 0, 1))
    }
}

/// Assignment-driven AI for every player the human doesn't control.
public struct PlayAI: Sendable {
    public var difficulty: Difficulty
    public private(set) var assignments: [Assignment] = []
    var waypoint: [Int] = []
    /// Low-passed velocity estimates: this lag *is* the reaction time.
    var perceived: [Vec2] = []

    public init(difficulty: Difficulty = .pro) { self.difficulty = difficulty }

    /// Sandbox play for M2: left WR go route, right WR slant, RB swing,
    /// man-to-man outside, LB zone + RB man, single-high safety.
    public mutating func setup(for world: World) {
        let los = world.lineOfScrimmage
        let cx = Field.centerX
        var a = [Assignment](repeating: .passBlock, count: world.players.count)
        let offense = world.players.filter { $0.side == .offense }
        let defense = world.players.filter { $0.side == .defense }
        var receivers: [Int] = []
        for p in offense {
            let s = p.body.position.ground
            switch p.data.position {
            case .qb: a[p.id] = .passer
            case .wr:
                receivers.append(p.id)
                if s.x < cx {
                    a[p.id] = .route([Vec2(s.x, los + 18), Vec2(s.x + 1.5, los + 60)])                      // go
                } else {
                    a[p.id] = .route([Vec2(s.x, los + 3), Vec2(s.x - 9, los + 12), Vec2(s.x - 28, los + 32)])  // slant
                }
            case .rb, .te:
                receivers.append(p.id)
                a[p.id] = .route([Vec2(s.x + 6, s.y + 1), Vec2(s.x + 11, los + 4), Vec2(s.x + 11, los + 40)]) // swing
            default: a[p.id] = .passBlock
            }
        }
        var unassigned = receivers
        for d in defense {
            let s = d.body.position.ground
            switch d.data.position {
            case .dl: a[d.id] = .passRush
            case .cb:
                // Man on the nearest receiver.
                if let r = unassigned.min(by: { (world.player($0).body.position.ground - s).length
                                               < (world.player($1).body.position.ground - s).length }) {
                    a[d.id] = .man(r); unassigned.removeAll { $0 == r }
                } else { a[d.id] = .zone(Vec2(s.x, los + 10)) }
            case .lb:
                if let rb = unassigned.first(where: { world.player($0).data.position == .rb }), s.x > cx {
                    a[d.id] = .man(rb); unassigned.removeAll { $0 == rb }
                } else { a[d.id] = .zone(Vec2(s.x, los + 7)) }
            case .s: a[d.id] = .zone(Vec2(cx, los + 17))
            default: a[d.id] = .zone(Vec2(s.x, los + 8))
            }
        }
        assignments = a
        waypoint = [Int](repeating: 0, count: world.players.count)
        perceived = world.players.map { $0.body.velocity }
    }

    public mutating func intents(for world: World, human: Int, humanMove: Vec2, dt: Double) -> [Vec2] {
        if assignments.count != world.players.count { setup(for: world) }
        // Perception lag (first-order filter with time constant = reaction time).
        let k = 1 - expD(-dt / max(0.02, difficulty.reactionTime))
        for i in world.players.indices { perceived[i] = lerp(perceived[i], world.players[i].body.velocity, k) }

        var out = [Vec2](repeating: .zero, count: world.players.count)
        guard world.phase.isLive else { return out }
        let carrier = world.carrierID.map { world.player($0) }
        let qbHasBall = carrier.map { $0.data.position == .qb && $0.body.position.y < world.lineOfScrimmage } ?? false
        let passInAir = world.ball.phase == .inFlight && world.ball.isForwardPass
        let looseBall = world.ball.phase == .loose

        for p in world.players where p.id != human {
            let pos = p.body.position.ground
            func toward(_ t: Vec2, arrive: Double = 1.2, throttle: Double = 1) -> Vec2 {
                let d = t - pos
                return d.normalized * (min(1, d.length / arrive) * throttle)
            }
            func pursue(_ id: Int) -> Vec2 {
                let t = world.player(id)
                let aim = Pursuit.aimPoint(from: pos, speed: p.body.profile.topSpeed, target: t.body.position.ground,
                                           velocity: perceived[id], quality: difficulty.pursuitQuality)
                return toward(aim, arrive: 0.3)
            }

            if looseBall {
                out[p.id] = toward(world.ball.position.ground, arrive: 0.2)
                continue
            }
            if p.side == .defense {
                if passInAir, let land = world.passLanding {
                    // Break on the ball if we can get there in time, else take the receiver.
                    let reachable = (land.ground - pos).length < p.body.profile.topSpeed * world.passTimeRemaining + 2.5
                    if reachable { out[p.id] = toward(land.ground, arrive: 0.6); continue }
                    if let tgt = world.ball.target { out[p.id] = pursue(tgt); continue }
                }
                if let c = carrier, c.side == .offense, !qbHasBall {
                    out[p.id] = pursue(c.id)
                    continue
                }
                switch assignments[p.id] {
                case .passRush:
                    if let c = carrier { out[p.id] = pursue(c.id) }
                case .man(let r):
                    let rp = world.player(r).body.position.ground
                    // Trail with a cushion on the downfield side.
                    let spot = rp + perceived[r] * 0.2 + Vec2(0, difficulty.coverageCushion)
                    out[p.id] = toward(spot, arrive: 1.0, throttle: difficulty.coverageEffort)
                case .zone(let spot):
                    // Drift toward the deepest threat in our area.
                    let threats = world.players.filter { $0.isEligibleReceiver && ($0.body.position.ground - spot).length < 9 }
                    if let t = threats.max(by: { $0.body.position.y < $1.body.position.y }) {
                        out[p.id] = toward(lerp(spot, t.body.position.ground + Vec2(0, 2), 0.55), arrive: 1.5,
                                           throttle: difficulty.coverageEffort)
                    } else {
                        out[p.id] = toward(spot, arrive: 1.5, throttle: 0.7)
                    }
                default: break
                }
            } else {
                // Offense.
                if let c = carrier, c.id != p.id, c.side == .offense, !qbHasBall {
                    // Escort: get between the carrier and the closest defender.
                    let threat = world.players.filter { $0.side == .defense && $0.status.canMakePlays }
                        .min { ($0.body.position.ground - c.body.position.ground).length
                             < ($1.body.position.ground - c.body.position.ground).length }
                    if let t = threat, (t.body.position.ground - pos).length < 12 {
                        out[p.id] = toward(lerp(c.body.position.ground, t.body.position.ground, 0.6), arrive: 0.5)
                    } else {
                        out[p.id] = toward(c.body.position.ground + Vec2(0, 6), arrive: 2, throttle: 0.7)
                    }
                    continue
                }
                switch assignments[p.id] {
                case .route(let pts):
                    var w = waypoint[p.id]
                    while w < pts.count - 1 && (pts[w] - pos).length < 1.2 { w += 1 }
                    waypoint[p.id] = w
                    let target = pts[w]
                    // Past the last cut: keep running through it.
                    out[p.id] = (target - pos).normalized
                    if passInAir && world.ball.target == p.id, let land = world.passLanding {
                        out[p.id] = toward(land.ground, arrive: 0.4)   // adjust to the ball
                    }
                case .passBlock:
                    // Step between the nearest rusher and the QB.
                    if let qb = world.quarterback {
                        let rushers = world.players.filter { $0.side == .defense && $0.data.position == .dl }
                        if let r = rushers.min(by: { ($0.body.position.ground - pos).length < ($1.body.position.ground - pos).length }) {
                            let spot = lerp(r.body.position.ground, qb.body.position.ground, 0.3)
                            out[p.id] = toward(spot, arrive: 0.8)
                        }
                    }
                default: break
                }
            }
        }
        out[human] = humanMove
        return out
    }
}
