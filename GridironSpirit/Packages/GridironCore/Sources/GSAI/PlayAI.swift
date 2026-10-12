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
    /// Seconds the CPU QB spends on each read before moving on (clean pocket).
    public var readTime: Double
    /// Separation (yd) the CPU QB wants before pulling the trigger.
    public var openThreshold: Double
    /// Kick meter error (fraction of the meter) for CPU kickers.
    public var kickError: Double
    /// How long second-level defenders take to diagnose a run after the exchange.
    public var runReadDelay: Double = 0.45
    /// Chance the CPU QB feels a collapsing pocket and gets rid of the ball
    /// (the rest of the time he holds on and may be sacked).
    public var pocketAwareness: Double = 0.6

    public static let rookie = Difficulty(name: "ROOKIE", reactionTime: 0.45, pursuitQuality: 0.35, coverageEffort: 0.8,
                                          coverageCushion: -1.6, readTime: 1.0, openThreshold: 3.2, kickError: 0.09,
                                          runReadDelay: 0.65, pocketAwareness: 0.35)
    public static let pro = Difficulty(name: "PRO", reactionTime: 0.25, pursuitQuality: 0.7, coverageEffort: 0.88,
                                       coverageCushion: -0.7, readTime: 0.7, openThreshold: 2.6, kickError: 0.05,
                                       runReadDelay: 0.45, pocketAwareness: 0.6)
    public static let legend = Difficulty(name: "LEGEND", reactionTime: 0.12, pursuitQuality: 0.95, coverageEffort: 1.0,
                                          coverageCushion: 0.9, readTime: 0.5, openThreshold: 2.2, kickError: 0.025,
                                          runReadDelay: 0.3, pocketAwareness: 0.85)
}

public enum Assignment: Sendable, Equatable {
    case passer
    case route([Vec2], settle: Bool)   // absolute waypoints, generated at the snap
    case runPath([Vec2])               // ball carrier path on runs
    case passBlock
    case runBlock
    case stalkBlock
    case passRush
    case man(Int)
    case zone(Vec2)
    case spy(Vec2)
}

/// Discrete decisions the AI makes for CPU-controlled players.
public enum AIAction: Sendable, Equatable {
    case handoff(to: Int)
    case pitch(to: Int)
    case throwTo(receiver: Int, kind: ThrowKind)
    case throwAway(point: Vec2)
    case carrierMove(player: Int, kind: MoveKind)
    case defenderAction(player: Int, kind: MoveKind)
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
    /// Spirit Play: defense reads everything instantly with perfect angles.
    public var spiritInstantReads = false
    public private(set) var assignments: [Assignment] = []
    var waypoint: [Int] = []
    /// Low-passed velocity estimates: this lag *is* the reaction time.
    var perceived: [Vec2] = []

    public private(set) var offensePlay: OffensivePlay?
    public private(set) var defensePlay: DefensivePlay?
    var progression: [Int] = []
    var readIndex = 0
    var readTimer = 0.0
    public private(set) var exchanged = false
    var exchangeTime = 0.0
    /// Rolled once per play: does the QB sense the rush this time?
    var feelsPressure: Bool?
    var dived = Set<Int>()
    var lastMoveTime: [Int: Double] = [:]
    var rng = SplitMix64(seed: 0xA1)
    /// Blocker -> defender, re-solved each tick so no two blockers take the same man.
    var blockTargets: [Int: Int] = [:]

    public init(difficulty: Difficulty = .pro) { self.difficulty = difficulty }

    /// Data-driven setup from the called plays.
    public mutating func setup(for world: World, offense: OffensivePlay, defense: DefensivePlay, seed: UInt64 = 0xA1) {
        offensePlay = offense
        defensePlay = defense
        rng = SplitMix64(seed: seed)
        var a = [Assignment](repeating: .passBlock, count: world.players.count)
        var bySlot: [String: Int] = [:]
        for p in world.players where p.side == .offense { bySlot[p.slot] = p.id }
        let isRun = offense.category == .run
        let blockers = Set(offense.blockers ?? [])
        for p in world.players {
            let start = p.body.position.ground
            if p.side == .offense {
                if p.slot == "QB" { a[p.id] = .passer; continue }
                if p.slot == "RB", isRun, let path = offense.runPath {
                    a[p.id] = .runPath(path.waypoints.map { start + $0 }); continue
                }
                if let r = offense.routes[p.slot], !blockers.contains(p.slot) {
                    a[p.id] = .route(r.waypoints.map { start + $0 }, settle: r.settle ?? false); continue
                }
                if blockers.contains(p.slot) { a[p.id] = .stalkBlock; continue }
                a[p.id] = isRun ? .runBlock : .passBlock
            } else {
                guard let asg = defense.assignments[p.slot] else { a[p.id] = .zone(start); continue }
                let ball = Vec2(world.ball.position.x, world.lineOfScrimmage)
                switch asg.role {
                case .rush: a[p.id] = .passRush
                case .man: a[p.id] = asg.target.flatMap { bySlot[$0] }.map { .man($0) } ?? .zone(start)
                case .zone: a[p.id] = .zone(ball + (asg.zonePoint ?? .zero))
                case .spy: a[p.id] = .spy(ball + (asg.zonePoint ?? Vec2(0, 5)))
                }
            }
        }
        assignments = a
        progression = offense.progression.compactMap { bySlot[$0] }
        exchangeTime = 0
        feelsPressure = nil
        readIndex = 0
        readTimer = 0
        exchanged = false
        dived = []
        lastMoveTime = [:]
        waypoint = [Int](repeating: 0, count: world.players.count)
        perceived = world.players.map { $0.body.velocity }
    }

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
                    a[p.id] = .route([Vec2(s.x, los + 18), Vec2(s.x + 1.5, los + 60)], settle: false)       // go
                } else {
                    a[p.id] = .route([Vec2(s.x, los + 3), Vec2(s.x - 9, los + 12), Vec2(s.x - 28, los + 32)], settle: false)
                }
            case .rb, .te:
                receivers.append(p.id)
                a[p.id] = .route([Vec2(s.x + 6, s.y + 1), Vec2(s.x + 11, los + 4), Vec2(s.x + 11, los + 40)], settle: false)
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
        offensePlay = nil
        defensePlay = nil
        progression = receivers
        readIndex = 0; readTimer = 0; exchanged = false; dived = []
        waypoint = [Int](repeating: 0, count: world.players.count)
        perceived = world.players.map { $0.body.velocity }
    }

    /// Movement intents for every player. `human` (if any) gets `humanMove`.
    public mutating func intents(for world: World, human: Int?, humanMove: Vec2, dt: Double) -> [Vec2] {
        if assignments.count != world.players.count { setup(for: world) }
        // Perception lag (first-order filter with time constant = reaction time).
        let k = 1 - expD(-dt / max(0.02, difficulty.reactionTime))
        for i in world.players.indices {
            let kk = spiritInstantReads && world.players[i].side == .offense ? 1 : k
            perceived[i] = lerp(perceived[i], world.players[i].body.velocity, kk)
        }

        var out = [Vec2](repeating: .zero, count: world.players.count)
        guard world.phase.isLive else { return out }
        for p in world.players {
            switch assignments[safe: p.id] {
            case .route(let pts, _)?, .runPath(let pts)?: _ = advanceWaypointMut(p.id, pts, p.body.position.ground)
            default: break
            }
        }
        let carrier = world.carrierID.map { world.player($0) }
        assignBlocks(world: world, carrier: carrier)
        let qbHasBall = carrier.map { $0.slot == "QB" && $0.body.position.y < world.lineOfScrimmage && !world.passThrown } ?? false
        let preExchange = isRunPlay && !exchanged
        let passInAir = world.ball.phase == .inFlight && world.ball.isForwardPass
        let looseBall = world.ball.phase == .loose && !world.isKickInFlight
        let kick = world.isKickInFlight

        for p in world.players where p.id != human {
            let pos = p.body.position.ground
            func toward(_ t: Vec2, arrive: Double = 1.2, throttle: Double = 1) -> Vec2 {
                let d = t - pos
                return d.normalized * (min(1, d.length / arrive) * throttle)
            }
            func pursue(_ id: Int) -> Vec2 {
                let t = world.player(id)
                let aim = Pursuit.aimPoint(from: pos, speed: p.body.profile.topSpeed, target: t.body.position.ground,
                                           velocity: perceived[id], quality: spiritInstantReads && p.side == .defense ? 1 : difficulty.pursuitQuality)
                return toward(aim, arrive: 0.3)
            }
            if kick {
                // Coverage team runs down the field; returners drift to the ball.
                out[p.id] = p.side == .offense ? toward(world.ball.position.ground, arrive: 3, throttle: 0.8)
                                               : toward(world.ball.position.ground, arrive: 4, throttle: 0.5)
                continue
            }
            if looseBall {
                out[p.id] = toward(world.ball.position.ground, arrive: 0.2)
                continue
            }
            if p.side == .defense {
                out[p.id] = defenseIntent(p, world: world, carrier: carrier, qbHasBall: qbHasBall && !preExchange,
                                          passInAir: passInAir, toward: toward, pursue: pursue)
            } else {
                out[p.id] = offenseIntent(p, world: world, carrier: carrier, qbHasBall: qbHasBall,
                                          passInAir: passInAir, toward: toward)
            }
        }
        if let h = human { out[h] = humanMove }
        return out
    }

    var isRunPlay: Bool { offensePlay?.category == .run }

    func defenseIntent(_ p: SimPlayer, world: World, carrier: SimPlayer?, qbHasBall: Bool, passInAir: Bool,
                       toward: (Vec2, Double, Double) -> Vec2, pursue: (Int) -> Vec2) -> Vec2 {
        let pos = p.body.position.ground
        if passInAir, let land = world.passLanding {
            // Break on the ball if we can get there in time, else take the receiver.
            let reachable = (land.ground - pos).length < p.body.profile.topSpeed * world.passTimeRemaining + 2.5
            if reachable { return toward(land.ground, 0.6, 1) }
            if let tgt = world.ball.target { return pursue(tgt) }
        }
        if let c = carrier, c.side == .offense, !qbHasBall {
            // Linemen react at once; the second level needs a beat to read
            // run (unless the runner is already past the line).
            let diagnosed = assignments[p.id] == .passRush || !isRunPlay
                || world.playTime - exchangeTime > (spiritInstantReads ? 0 : difficulty.runReadDelay)
                || c.body.position.y > world.lineOfScrimmage + 1
            if diagnosed { return pursue(c.id) }
        }
        switch assignments[p.id] {
        case .passRush:
            if let c = carrier { return pursue(c.id) }
            if let qb = world.quarterback { return pursue(qb.id) }
        case .man(let r):
            let rp = world.player(r).body.position.ground
            // Trail with a cushion; difficulty decides under vs over the top.
            return toward(rp + perceived[r] * 0.2 + Vec2(0, difficulty.coverageCushion), 1.0, difficulty.coverageEffort)
        case .zone(let spot):
            // Drift toward the deepest threat in our area.
            let threats = world.players.filter { $0.isEligibleReceiver && ($0.body.position.ground - spot).length < 9 }
            if let t = threats.max(by: { $0.body.position.y < $1.body.position.y }) {
                return toward(lerp(spot, t.body.position.ground + Vec2(0, 2), 0.55), 1.5, difficulty.coverageEffort)
            }
            return toward(spot, 1.5, 0.7)
        case .spy(let spot):
            if let qb = world.quarterback { return toward(Vec2(qb.body.position.x, spot.y), 1.0, 0.9) }
            return toward(spot, 1.5, 0.7)
        default: break
        }
        return .zero
    }

    func offenseIntent(_ p: SimPlayer, world: World, carrier: SimPlayer?, qbHasBall: Bool, passInAir: Bool,
                       toward: (Vec2, Double, Double) -> Vec2) -> Vec2 {
        let pos = p.body.position.ground
        // Ball carrier (CPU-controlled): run for daylight.
        if let c = carrier, c.id == p.id, !(p.slot == "QB" && qbHasBall) {
            // Follow the designed path to the line, but read the blocks: blend
            // in the daylight heading so the back bounces off a clogged hole.
            if case .runPath(let pts) = assignments[p.id], let w = advanceWaypoint(p.id, pts, pos), w < pts.count - 1,
               pos.y < world.lineOfScrimmage + 2 {
                let path = (pts[w] - pos).normalized
                return (path * 0.55 + daylight(for: p, world: world) * 0.45).normalized
            }
            return daylight(for: p, world: world)
        }
        if p.slot == "QB" {
            guard qbHasBall || preExchangeQB(world) else { return .zero }
            return qbIntent(p, world: world, toward: toward)
        }
        if let c = carrier, c.side == .offense, !qbHasBall, c.id != p.id {
            // Escort: get between the carrier and the closest defender.
            let threat = world.players.filter { $0.side == .defense && $0.status.canMakePlays }
                .min { ($0.body.position.ground - c.body.position.ground).length
                     < ($1.body.position.ground - c.body.position.ground).length }
            if let t = threat, (t.body.position.ground - pos).length < 12 {
                return toward(lerp(c.body.position.ground, t.body.position.ground, 0.6), 0.5, 1)
            }
            return toward(c.body.position.ground + Vec2(0, 6), 2, 0.7)
        }
        switch assignments[p.id] {
        case .route(let pts, let settle):
            if passInAir && world.ball.target == p.id, let land = world.passLanding {
                return toward(land.ground, 0.4, 1)                        // adjust to the ball
            }
            let w = advanceWaypoint(p.id, pts, pos) ?? 0
            if settle && w == pts.count - 1 { return toward(pts[w], 0.8, 1) }
            return (pts[w] - pos).normalized
        case .runPath(let pts):
            let w = advanceWaypoint(p.id, pts, pos) ?? 0
            return (pts[w] - pos).normalized
        case .passBlock:
            if let qb = world.quarterback {
                let rushers = world.players.filter { $0.side == .defense && $0.status.canMakePlays
                    && ($0.body.position.ground - qb.body.position.ground).length < 9 }
                if let r = rushers.min(by: { ($0.body.position.ground - pos).length < ($1.body.position.ground - pos).length }) {
                    return toward(lerp(r.body.position.ground, qb.body.position.ground, 0.3), 0.8, 1)
                }
            }
        case .runBlock, .stalkBlock:
            let carrierPos = carrier?.body.position.ground ?? Vec2(world.ball.position.x, world.lineOfScrimmage - 3)
            if let t = blockTargets[p.id] {
                let d = world.player(t).body.position.ground
                // Fit between the defender and the runner.
                return toward(lerp(d, carrierPos, 0.2), 0.3, 1)
            }
            return Vec2(0, 0.6)
        default: break
        }
        return .zero
    }

    /// Greedy unique blocking assignment: each run blocker takes the most
    /// dangerous unclaimed defender in reach (linemen first, then WR stalks).
    mutating func assignBlocks(world: World, carrier: SimPlayer?) {
        blockTargets.removeAll(keepingCapacity: true)
        guard isRunPlay else { return }
        let carrierPos = carrier?.body.position.ground ?? Vec2(world.ball.position.x, world.lineOfScrimmage - 3)
        var claimed = Set<Int>()
        let blockers = world.players.filter { assignments[safe: $0.id] == .runBlock }
            + world.players.filter { assignments[safe: $0.id] == .stalkBlock }
        for b in blockers {
            let pos = b.body.position.ground
            let range = assignments[b.id] == .runBlock ? 7.0 : 12.0
            let cands = world.players.filter { $0.side == .defense && $0.status.canMakePlays && !claimed.contains($0.id)
                && ($0.body.position.ground - pos).length < range }
            if let d = cands.min(by: { ($0.body.position.ground - carrierPos).length * 0.6 + ($0.body.position.ground - pos).length
                                     < ($1.body.position.ground - carrierPos).length * 0.6 + ($1.body.position.ground - pos).length }) {
                blockTargets[b.id] = d.id
                claimed.insert(d.id)
            }
        }
    }

    func preExchangeQB(_ world: World) -> Bool { isRunPlay && !exchanged && world.carrierID == world.quarterback?.id }

    /// Returns the current waypoint index after advancing past reached ones.
    mutating func advanceWaypointMut(_ id: Int, _ pts: [Vec2], _ pos: Vec2) -> Int {
        var w = waypoint[id]
        while w < pts.count - 1 && (pts[w] - pos).length < 1.2 { w += 1 }
        waypoint[id] = w
        return w
    }

    func advanceWaypoint(_ id: Int, _ pts: [Vec2], _ pos: Vec2) -> Int? {
        guard !pts.isEmpty else { return nil }
        var w = waypoint[id]
        while w < pts.count - 1 && (pts[w] - pos).length < 1.2 { w += 1 }
        return w
    }

    /// Pick the heading (within 70 deg of upfield) that keeps the most room
    /// between the runner and the defense over the next ~1 s.
    func daylight(for p: SimPlayer, world: World) -> Vec2 {
        let pos = p.body.position.ground
        let defenders = world.players.filter { $0.side != p.side && $0.status.canMakePlays }
        let upfield = p.side == .offense ? 1.0 : -1.0
        var best = Vec2(0, upfield), bestScore = -1e9
        for k in -7...7 {
            let a = Double.pi / 2 * upfield + Double(k) * 0.17
            let dir = Vec2.fromAngle(a)
            let probe = pos + dir * (p.body.profile.topSpeed * 0.8)
            var room = 99.0
            for d in defenders {
                let dp = d.body.position.ground + perceived[d.id] * 0.5
                room = min(room, (dp - probe).length)
            }
            // Stay in bounds and prefer north-south.
            let edge = min(probe.x, Field.width - probe.x)
            // Only nearby threats matter; otherwise get north-south (no dancing).
            let score = min(room, 5) + dir.y * upfield * 3.0 - (edge < 2 ? (2 - edge) * 4 : 0)
            if score > bestScore { bestScore = score; best = dir }
        }
        return best
    }

    func qbIntent(_ p: SimPlayer, world: World, toward: (Vec2, Double, Double) -> Vec2) -> Vec2 {
        let pos = p.body.position.ground
        let los = world.lineOfScrimmage
        if isRunPlay {
            // Turn and present the ball to the runner.
            if let rb = world.players.first(where: { $0.slot == "RB" && $0.side == .offense }) {
                return toward(lerp(pos, rb.body.position.ground, 0.4), 1.5, 0.4)
            }
            return .zero
        }
        // Drop back, then slide away from pressure.
        if world.playTime < 0.7 { return toward(Vec2(pos.x, los - 7.5), 0.6, 1) }
        let rushers = world.players.filter { $0.side == .defense && $0.status.canMakePlays }
        if let r = rushers.min(by: { ($0.body.position.ground - pos).length < ($1.body.position.ground - pos).length }) {
            let d = pos - r.body.position.ground
            if d.length < 3.5 { return Vec2(d.normalized.x, -0.2).normalized * 0.8 }
        }
        return .zero
    }

    // MARK: Decisions

    /// Discrete CPU decisions this tick. `cpuOffense` / `cpuDefense` say which
    /// sides the AI is calling for; the exchange (handoff / pitch) is always
    /// automatic, even when the human runs the offense.
    public mutating func decide(world: World, cpuOffense: Bool, cpuDefense: Bool, human: Int?, dt: Double) -> [AIAction] {
        var actions: [AIAction] = []
        guard world.phase.isLive else { return actions }
        guard let carrierID = world.carrierID else { return actions }
        let carrier = world.player(carrierID)

        // Run exchange.
        if isRunPlay && !exchanged && carrier.slot == "QB",
           let rb = world.players.first(where: { $0.slot == "RB" && $0.side == .offense }) {
            let d = (rb.body.position.ground - carrier.body.position.ground).length
            switch offensePlay?.exchange {
            case .handoff? where d < 1.4 || world.playTime > 1.2:
                actions.append(.handoff(to: rb.id)); exchanged = true; exchangeTime = world.playTime
            case .pitch? where world.playTime > 0.45:
                actions.append(.pitch(to: rb.id)); exchanged = true; exchangeTime = world.playTime
            default: break
            }
        }

        if cpuOffense && carrier.side == .offense {
            if world.canThrow && !isRunPlay { actions += qbDecision(world: world, qb: carrier, dt: dt) }
            // CPU ball carrier moves.
            if carrierID != human && !(carrier.slot == "QB" && world.canThrow) {
                let near = world.players.filter { $0.side == .defense && $0.status.canMakePlays }
                    .map { ($0, ($0.body.position.ground - carrier.body.position.ground).length) }.min { $0.1 < $1.1 }
                if let (d, dist) = near, dist < 2.6, carrier.move == nil, world.time - (lastMoveTime[carrierID] ?? -9) > 1.5 {
                    let frontal = (d.body.position.y - carrier.body.position.y) > 0
                    if rng.unit() < 0.35 * dt * 120 / 30 {
                        let kind: MoveKind = frontal ? (rng.unit() < 0.5 ? .stiffArm : .juke) : .spin
                        actions.append(.carrierMove(player: carrierID, kind: kind))
                        lastMoveTime[carrierID] = world.time
                    }
                }
            }
        }
        if cpuDefense {
            for d in world.players where d.side == .defense && d.id != human && d.status == .normal && !dived.contains(d.id) {
                // Dive at a carrier pulling away, from just out of reach.
                let rel = carrier.body.position.ground - d.body.position.ground
                let dist = rel.length
                if carrier.side == .offense && dist > 1.4 && dist < 2.4
                    && carrier.body.velocity.dot(rel.normalized) > 0 && rng.unit() < 0.04 {
                    actions.append(.defenderAction(player: d.id, kind: .dive)); dived.insert(d.id)
                }
            }
        }
        return actions
    }

    mutating func qbDecision(world: World, qb: SimPlayer, dt: Double) -> [AIAction] {
        guard world.playTime > 0.75, !progression.isEmpty else { return [] }
        let pressure = world.pressureOn(qb.id)
        readTimer += dt * (1 + 1.6 * pressure)                  // clock speeds up under pressure
        func openness(_ r: SimPlayer) -> (Double, Vec2) {
            let t = (r.body.position.ground - qb.body.position.ground).length / 22
            let catchPoint = r.body.position.ground + r.body.velocity * t
            let sep = world.players.filter { $0.side == .defense && $0.status.canMakePlays }
                .map { (($0.body.position.ground + perceived[$0.id] * t * 0.6) - catchPoint).length }.min() ?? 99
            return (sep, catchPoint)
        }
        let current = world.player(progression[readIndex % progression.count])
        let (sep, cp) = openness(current)
        if sep >= difficulty.openThreshold && current.status.canMakePlays {
            let deep = cp.y - world.lineOfScrimmage > 17
            return [.throwTo(receiver: current.id, kind: deep && sep < 5 ? .lob : .bullet)]
        }
        if readTimer > difficulty.readTime {
            readTimer = 0
            readIndex += 1
        }
        // Out of time: best available, else throw it away.
        if (pressure > 0.75 && feelsPressure != false) || world.playTime > 4.2 || readIndex >= progression.count * 2 {
            let options = progression.map { world.player($0) }.filter(\.status.canMakePlays).map { ($0, openness($0).0) }
            if let (r, s) = options.max(by: { $0.1 < $1.1 }), s > 1.6 {
                return [.throwTo(receiver: r.id, kind: .bullet)]
            }
            if pressure > 0.6 && feelsPressure == nil { feelsPressure = rng.unit() < difficulty.pocketAwareness }
            if (pressure > 0.6 && feelsPressure == true) || world.playTime > 5.5 {
                let side = qb.body.position.x < Field.centerX ? -3.0 : Field.width + 3
                return [.throwAway(point: Vec2(side, world.lineOfScrimmage + 4))]
            }
        }
        return []
    }
}

extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}
