import GSFoundation
import GSData

public enum TeamSide: Int, Sendable { case offense = 0, defense = 1 }

public enum PlayerStatus: Sendable, Equatable {
    case normal
    /// Off balance: slowed, can't make plays (seconds remaining).
    case stumbling(Double)
    /// On the turf after a missed or made tackle; gets back up.
    case stunned(Double)
    /// Pushed-forward pile: carrier keeps churning before going down.
    case driven(Double)
    /// Tackled. Out of the play until the next snap.
    case down

    public var canMakePlays: Bool {
        switch self { case .normal, .driven: return true; default: return false }
    }
    public var isOnGround: Bool {
        switch self { case .stunned, .down: return true; default: return false }
    }
}

public struct ActiveMove: Sendable, Equatable {
    public var kind: MoveKind
    public var age: Double
    public var duration: Double
    /// Juke side: -1 left, +1 right (relative to heading).
    public var side: Double

    public static func duration(of k: MoveKind) -> Double {
        switch k { case .juke: return 0.28; case .spin: return 0.42; case .stiffArm: return 0.5; case .dive: return 1.2; case .jump: return 0.8 }
    }
}

public struct SimPlayer: Sendable {
    public let id: Int
    public let data: PlayerData
    public let side: TeamSide
    public let teamIndex: Int
    /// Playbook slot ("QB", "WR1", "CB2" ...).
    public var slot: String = ""
    public var body: PlayerBody
    public var status: PlayerStatus = .normal
    public var move: ActiveMove?
    public var tackleCooldown: Double = 0
    public var catchAttempted = false
    /// > 0 while the throwing animation plays (wind-up then follow-through).
    public var throwTimer: Double = 0
    /// In contact with a blocker / rusher this tick.
    public var engaged = false

    public init(id: Int, data: PlayerData, side: TeamSide, teamIndex: Int, body: PlayerBody) {
        self.id = id; self.data = data; self.side = side; self.teamIndex = teamIndex; self.body = body
    }

    public var isEligibleReceiver: Bool {
        side == .offense && [.wr, .rb, .te].contains(data.position)
    }
}

public enum PlayPhase: Sendable, Equatable {
    case preSnap
    case live
    case dead(DeadBallReason)
    public var isLive: Bool { self == .live }
    public var isDead: Bool { if case .dead = self { return true }; return false }
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

/// The deterministic game world: bodies, ball, contact resolution and
/// dead-ball rules for a single play. No rendering or platform types.
public struct World: Sendable {
    public private(set) var players: [SimPlayer] = []
    public var controlledID: Int
    /// Which side the human plays (nil = CPU vs CPU). Control only follows
    /// the ball (catches, handoffs, recoveries) for the human's own side.
    public var humanSide: TeamSide? = .offense
    public private(set) var tick: UInt64 = 0
    public private(set) var time: Double = 0
    public private(set) var ball: Ball
    public private(set) var phase: PlayPhase = .preSnap
    public let lineOfScrimmage: Double
    public var wind: Vec2 = .zero
    public private(set) var events: [GameEvent] = []
    /// Where the play ended (for the next line of scrimmage).
    public private(set) var deadSpot: Vec2?
    public private(set) var timeSinceWhistle: Double = 0
    /// Predicted point where the current pass comes down (for the reticle).
    public private(set) var passLanding: Vec3?
    /// Seconds the current pass has left in the air (prediction).
    public private(set) var passTimeRemaining: Double = 0
    var rng: SplitMix64
    var pendingThrow: (target: Int?, point: Vec2?, kind: ThrowKind, timer: Double)?
    /// Short tosses (snap, pitch) that the target catches automatically.
    var snapTarget: Int?
    /// True once a forward pass has left the QB's hand this play.
    public private(set) var passThrown = false
    /// True while a kicked ball is live (no catches, no recoveries).
    public private(set) var isKickInFlight = false
    public private(set) var kickRested = false
    /// Defensive pass interference flagged this play (accept/decline in rules).
    public private(set) var passInterference: (defender: Int, receiver: Int, spot: Vec2)?
    public private(set) var falseStartFlag = false
    /// Defenders already judged for interference on the current pass.
    var piJudged = Set<Int>()
    /// Time since the snap.
    public private(set) var playTime: Double = 0
    /// Who had the ball when the play went dead (for turnovers / safeties).
    public private(set) var lastCarrierSide: TeamSide?

    public init(players: [SimPlayer], controlledID: Int, lineOfScrimmage: Double, seed: UInt64 = 0xF00D) {
        self.players = players
        self.controlledID = controlledID
        self.lineOfScrimmage = lineOfScrimmage
        rng = SplitMix64(seed: seed)
        let center = players.first { $0.data.position == .c } ?? players[0]
        ball = Ball(heldBy: center.id, at: center.body.position + Vec3(0, 0.4, 0.15))
    }

    public var controlled: SimPlayer { players[controlledID] }
    public func player(_ id: Int) -> SimPlayer { players[id] }
    public var carrierID: Int? { ball.holder }
    public var quarterback: SimPlayer? { players.first { $0.data.position == .qb && $0.side == .offense } }

    /// True while the QB still holds the ball behind the line: receivers are targetable.
    public var canThrow: Bool {
        guard phase.isLive, pendingThrow == nil, let h = ball.holder, let qb = quarterback, h == qb.id else { return false }
        return !passThrown && players[h].body.position.y < lineOfScrimmage && snapTarget == nil
    }

    // MARK: Commands

    public mutating func snap() {
        guard phase == .preSnap, let qb = quarterback, let c = ball.holder else { return }
        phase = .live
        playTime = 0
        let from = players[c].body.position + Vec3(0, -0.3, 0.45)
        let s = ThrowSolver.solve(from: from, receiver: qb.body.position.ground, receiverVelocity: .zero,
                                  kind: .bullet, maxSpeed: 13)
        ball.launch(from: from, velocity: s.velocity, wobble: 0, tumbling: false)
        ball.thrower = c
        ball.target = qb.id
        ball.isForwardPass = false
        snapTarget = qb.id
        events.append(.snap)
    }

    /// Starts the throwing motion; the ball leaves the hand after a short,
    /// exaggerated wind-up (the pose shows immediately, so it still feels instant).
    @discardableResult
    public mutating func requestThrow(to target: Int, kind: ThrowKind) -> Bool {
        guard canThrow, players.indices.contains(target), players[target].isEligibleReceiver,
              let qb = ball.holder else { return false }
        pendingThrow = (target, nil, kind, 0.1)
        players[qb].throwTimer = 0.32
        return true
    }

    /// Throw it away toward a spot (usually out of bounds) to avoid a sack.
    @discardableResult
    public mutating func requestThrowAway(to point: Vec2) -> Bool {
        guard canThrow, let qb = ball.holder else { return false }
        pendingThrow = (nil, point, .bullet, 0.08)
        players[qb].throwTimer = 0.28
        return true
    }

    /// QB hands the ball to a runner standing next to him.
    @discardableResult
    public mutating func handoff(to id: Int) -> Bool {
        guard phase.isLive, let qb = ball.holder, qb != id, players[qb].side == players[id].side,
              players[qb].body.position.y < lineOfScrimmage + 0.5 else { return false }
        ball.phase = .held(by: id)
        if humanSide == players[id].side { controlledID = id }
        events.append(.handoff(from: qb, to: id))
        return true
    }

    /// Underhand lateral toss (not a forward pass): auto-caught like a snap,
    /// but a ball that hits the turf is a live fumble.
    @discardableResult
    public mutating func pitch(to id: Int) -> Bool {
        guard phase.isLive, let qb = ball.holder, players[qb].side == players[id].side else { return false }
        let from = players[qb].body.position + Vec3(0, 0, 1.1)
        let r = players[id]
        let s = ThrowSolver.solve(from: from, receiver: r.body.position.ground, receiverVelocity: r.body.velocity,
                                  kind: .bullet, maxSpeed: 10)
        ball.launch(from: from, velocity: s.velocity, wobble: 0, tumbling: false)
        ball.isForwardPass = false
        ball.thrower = qb
        ball.target = id
        snapTarget = id
        if humanSide == players[id].side { controlledID = id }
        events.append(.handoff(from: qb, to: id))
        return true
    }

    /// Place-kick or punt: the ball leaves the kicker's foot tumbling.
    public mutating func kickBall(from p: Vec3, velocity v: Vec3) {
        guard phase.isLive else { return }
        ball.launch(from: p, velocity: v, wobble: 0, tumbling: true)
        ball.isForwardPass = false
        ball.thrower = nil
        ball.target = nil
        isKickInFlight = true
        kickRested = false
        events.append(.kick(at: p))
    }

    /// Called by the rules layer once a kick is decided (FG through / punt downed).
    public mutating func endKick(spot: Vec2) {
        isKickInFlight = false
        whistle(.kickDead, spot: spot)
    }

    /// Offense moved before the snap.
    public mutating func flagFalseStart(by id: Int) {
        guard phase == .preSnap else { return }
        falseStartFlag = true
        events.append(.flag(.falseStart(player: id)))
        phase = .dead(.falseStart)
        deadSpot = Vec2(ball.position.x, lineOfScrimmage)
        timeSinceWhistle = 0
        events.append(.whistle(.falseStart, spot: deadSpot!))
    }

    /// Defender actions: dive tackle (lunge) or jump to deflect.
    @discardableResult
    public mutating func requestDefenderAction(_ kind: MoveKind, for id: Int) -> Bool {
        guard phase.isLive, ball.holder != id, players[id].status == .normal, !players[id].body.isAirborne,
              players[id].move == nil else { return false }
        var p = players[id]
        if kind == .dive {
            p.move = ActiveMove(kind: .dive, age: 0, duration: ActiveMove.duration(of: .dive), side: 1)
            let fwd = Vec2.fromAngle(p.body.facing, length: max(p.body.speed, 4) + 2.2)
            p.body.velocity = fwd
            p.body.jump(verticalSpeed: 2.6)
            events.append(.move(player: id, kind: .dive))
        } else {
            p.body.jump(verticalSpeed: 4.2)          // ~0.8 yd rise: tips high passes
            events.append(.jump(player: id))
        }
        players[id] = p
        return true
    }

    @discardableResult
    public mutating func requestMove(_ kind: MoveKind, for id: Int, side: Double = 1) -> Bool {
        guard phase.isLive, ball.holder == id, pendingThrow == nil else { return false }
        var p = players[id]
        guard p.status == .normal, p.move == nil || p.move?.kind != .dive, !p.body.isAirborne else { return false }
        if let m = p.move, m.kind != .dive, kind != .dive { return false }   // commitment window
        p.move = ActiveMove(kind: kind, age: 0, duration: ActiveMove.duration(of: kind), side: side >= 0 ? 1 : -1)
        switch kind {
        case .juke:
            let perp = Vec2.fromAngle(p.body.facing + (side >= 0 ? -Double.pi / 2 : Double.pi / 2), length: 4.6)
            p.body.velocity = (p.body.velocity * 0.82 + perp).clampedLength(p.body.profile.topSpeed * 1.05)
        case .spin:
            p.body.velocity = p.body.velocity * 0.85
        case .stiffArm:
            break
        case .dive:
            let fwd = Vec2.fromAngle(p.body.facing, length: max(p.body.speed, 4) + 1.6)
            p.body.velocity = fwd
            p.body.jump(verticalSpeed: 3.1)
        case .jump:
            p.body.jump(verticalSpeed: 3.8)
        }
        players[id] = p
        events.append(.move(player: id, kind: kind))
        return true
    }

    // MARK: Step

    /// - Parameter intents: desired move per player id (length <= 1).
    public mutating func step(intents: [Vec2], dt: Double) {
        events.removeAll(keepingCapacity: true)
        if phase.isDead { timeSinceWhistle += dt }
        if phase.isLive { playTime += dt }

        updateThrow(dt: dt)
        movePlayers(intents: intents, dt: dt)
        resolveOverlaps()
        updateBall(dt: dt)
        if phase.isLive {
            resolveCatches()
            resolveRecoveries()
            resolveTackles()
            checkBoundaries()
        }
        tick += 1
        time += dt
    }

    mutating func updateThrow(dt: Double) {
        for i in players.indices where players[i].throwTimer > 0 {
            players[i].throwTimer = max(0, players[i].throwTimer - dt)
        }
        guard var pt = pendingThrow else { return }
        pt.timer -= dt
        pendingThrow = pt
        guard pt.timer <= 0 else { return }
        pendingThrow = nil
        guard phase.isLive, let qbID = ball.holder else { return }
        let qb = players[qbID]
        let release = qb.body.position + Vec3(Vec2.fromAngle(qb.body.facing, length: 0.35), z: 1.95)
        let arm = 21.5 + 7 * Double(qb.data.ratings.throwPower) / 99    // 21.5 ... 28.5 yd/s
        let aimPos = pt.target.map { players[$0].body.position.ground } ?? pt.point ?? release.ground
        let aimVel = pt.target.map { players[$0].body.velocity } ?? .zero
        let sol = ThrowSolver.solve(from: release, receiver: aimPos,
                                    receiverVelocity: aimVel, kind: pt.kind, maxSpeed: arm, wind: wind)
        let pressure = pressureOn(qbID)
        let (v, wobble) = ThrowSolver.applyError(sol.velocity, accuracy: qb.data.ratings.throwAccuracy,
                                                 pressure: pressure, kind: pt.kind, rng: &rng)
        ball.launch(from: release, velocity: v, wobble: wobble, tumbling: false)
        ball.isForwardPass = true
        passThrown = true
        ball.thrower = qbID
        ball.target = pt.target
        ball.kind = pt.kind
        let landing = ThrowSolver.descentPoint(through: ThrowSolver.catchHeight, from: release, velocity: v,
                                               wobble: wobble, wind: wind)
        passLanding = landing.point
        passTimeRemaining = landing.time
        for i in players.indices { players[i].catchAttempted = false }
        piJudged.removeAll()
        events.append(.throwRelease(player: qbID, kind: pt.kind, wobble: wobble))
    }

    /// 0 = clean pocket, 1 = defender in the QB's face.
    public func pressureOn(_ id: Int) -> Double {
        let p = players[id].body.position.ground
        let d = players.filter { $0.side != players[id].side && $0.status.canMakePlays }
            .map { ($0.body.position.ground - p).length }.min() ?? 99
        return clamp((3.5 - d) / 2.5, 0, 1)
    }

    mutating func movePlayers(intents: [Vec2], dt: Double) {
        for i in players.indices {
            var p = players[i]
            var intent = phase == .live && i < intents.count ? intents[i] : .zero
            var speedScale = 1.0
            // Status effects.
            switch p.status {
            case .normal: break
            case .stumbling(let t):
                speedScale = 0.5
                p.status = t - dt > 0 ? .stumbling(t - dt) : .normal
            case .stunned(let t):
                intent = .zero
                speedScale = 0.25
                p.status = t - dt > 0 ? .stunned(t - dt) : .normal
            case .driven(let t):
                intent = Vec2.fromAngle(p.body.facing)
                speedScale = 0.42
                if t - dt <= 0 {
                    p.status = .down
                    if ball.holder == p.id { whistle(.tackled, spot: p.body.position.ground) }
                } else { p.status = .driven(t - dt) }
            case .down:
                intent = .zero
                speedScale = 0.2
            }
            if p.engaged { speedScale *= p.side == .defense ? 0.3 : 0.45 }
            if p.throwTimer > 0 { speedScale *= 0.35 }
            // Moves lock the stick during their commitment window.
            if var m = p.move {
                switch m.kind {
                case .juke: intent = p.body.velocity.normalized
                case .spin: intent = Vec2.fromAngle(p.body.facing); speedScale *= 0.92
                case .stiffArm: speedScale *= 0.94
                case .dive: intent = Vec2.fromAngle(p.body.facing); speedScale *= 1.25
                case .jump: break
                }
                m.age += dt
                p.move = m.age >= m.duration && m.kind != .dive ? nil : m
            }
            if phase.isDead { intent = intent * 0.0; speedScale = min(speedScale, 0.6) }

            let wasAirborne = p.body.isAirborne
            let ev = p.body.step(intent: intent, dt: dt, speedScale: speedScale)
            if ev.contains(.hardCut) { events.append(.hardCut(player: p.id, at: p.body.position.ground)) }
            if ev.contains(.reachedTopSpeed) { events.append(.reachedTopSpeed(player: p.id)) }
            if wasAirborne && !p.body.isAirborne {
                events.append(.landing(player: p.id, at: p.body.position))
                if p.move?.kind == .dive {
                    p.move = nil
                    p.body.velocity = p.body.velocity * 0.3
                    if ball.holder == p.id {
                        p.status = .down
                        if phase.isLive { whistle(.tackled, spot: p.body.position.ground) }
                    } else {
                        p.status = .stunned(0.9)            // missed dive tackle: on the turf
                    }
                }
            }
            p.tackleCooldown = max(0, p.tackleCooldown - dt)
            p.engaged = false
            players[i] = p
        }
    }

    /// Circle-vs-circle separation, mass-weighted so linemen shove skill
    /// players more than the reverse. Opponent contacts away from the ball
    /// are blocks: both players get bogged down.
    mutating func resolveOverlaps() {
        let n = players.count
        guard n > 1 else { return }
        let carrier = ball.holder
        for i in 0..<(n - 1) {
            for j in (i + 1)..<n {
                let a = players[i].body, b = players[j].body
                if players[i].status == .down || players[j].status == .down { continue }
                let d = b.position.ground - a.position.ground
                let minDist = a.profile.radius + b.profile.radius
                let dist2 = d.lengthSquared
                guard dist2 < minDist * minDist else { continue }
                if players[i].side != players[j].side && players[i].id != carrier && players[j].id != carrier && phase.isLive {
                    // Blocks bog both players down; receivers vs. DBs in coverage
                    // just bump (no engagement) unless the receiver is blocking on a run.
                    let off = players[i].side == .offense ? players[i] : players[j]
                    let runBlocking = carrier.map { players[$0].slot != "QB" } ?? false
                    if !off.isEligibleReceiver || runBlocking {
                        players[i].engaged = true
                        players[j].engaged = true
                    }
                    checkPassInterference(i, j)
                }
                // The carrier vs a tackler is resolved by the tackle model, not pushed apart.
                if (players[i].id == carrier || players[j].id == carrier) && players[i].side != players[j].side
                    && phase.isLive { continue }
                let dist = dist2.squareRoot()
                let normal = dist > 1e-6 ? d / dist : Vec2(1, 0)
                let overlap = minDist - dist
                var wa = b.profile.mass / (a.profile.mass + b.profile.mass)
                // The ball carrier slips through his own teammates (they give way).
                if players[i].side == players[j].side {
                    if players[i].id == carrier { wa = 0.12 } else if players[j].id == carrier { wa = 0.88 }
                }
                let push = normal * overlap
                players[i].body.position.x -= push.x * wa
                players[i].body.position.y -= push.y * wa
                players[j].body.position.x += push.x * (1 - wa)
                players[j].body.position.y += push.y * (1 - wa)
            }
        }
    }

    /// Defensive pass interference: a defender runs through an eligible
    /// receiver while a catchable forward pass is on its way to him.
    mutating func checkPassInterference(_ i: Int, _ j: Int) {
        guard passInterference == nil, ball.phase == .inFlight, ball.isForwardPass, passTimeRemaining > 0.4 else { return }
        let (d, r) = players[i].side == .defense ? (i, j) : (j, i)
        let rec = players[r], def = players[d]
        guard rec.isEligibleReceiver, !rec.catchAttempted else { return }
        guard rec.id == ball.target else { return }
        // One judgement per defender per pass (contact lasts many ticks).
        guard !piJudged.contains(def.id) else { return }
        piJudged.insert(def.id)
        let n = (rec.body.position.ground - def.body.position.ground).normalized
        let closing = (def.body.velocity - rec.body.velocity).dot(n)
        // A defender running to the ball is playing it, not the man.
        if let land = passLanding {
            let toBall = (land.ground - def.body.position.ground).normalized
            if def.body.velocity.dot(toBall) > def.body.speed * 0.7 { return }
        }
        guard closing > 2.5, rng.unit() < 0.1 else { return }      // incidental contact isn't a foul
        let spot = rec.body.position.ground
        passInterference = (def.id, rec.id, spot)
        events.append(.flag(.passInterference(defender: def.id, receiver: rec.id, spot: spot)))
    }

    mutating func updateBall(dt: Double) {
        if let h = ball.holder {
            let b = players[h].body
            ball.position = b.position + Vec3(Vec2.fromAngle(b.facing, length: 0.25), z: 1.05)
            ball.velocity = Vec3(b.velocity, z: 0)
            ball.pitch = 0
            return
        }
        passTimeRemaining = max(0, passTimeRemaining - dt)
        let ev = ball.step(dt: dt, wind: wind, rng: &rng)
        if ev.contains(.bounced) && ball.lastBounceStrength > 0.8 {
            events.append(.ballBounce(at: ball.position, strength: ball.lastBounceStrength))
        }
        if isKickInFlight {
            if ev.contains(.cameToRest) || (ball.holder == nil && ball.velocity.length < 0.05 && ball.isOnGround) {
                kickRested = true
            }
            return
        }
        if ev.contains(.groundContact) {
            if snapTarget != nil {
                // Bad snap on the turf: live loose ball.
                snapTarget = nil
                ball.isForwardPass = false
            }
            if ball.isForwardPass && phase.isLive {
                whistle(.incomplete, spot: Vec2(ball.position.x, lineOfScrimmage))
            }
            ball.isForwardPass = false
            passLanding = nil
            if ball.phase == .inFlight { ball.phase = .loose }
        }
    }

    mutating func resolveCatches() {
        guard ball.phase == .inFlight, ball.airTime > 0.08, !isKickInFlight else { return }
        // Snaps are automatic unless the QB is somehow out of reach.
        if let qb = snapTarget {
            let d = (ball.position.ground - players[qb].body.position.ground).length
            if d < 1.0 && ball.position.z < 2.4 {
                ball.phase = .held(by: qb)
                snapTarget = nil
            }
            return
        }
        for i in players.indices where players[i].id != ball.thrower && !players[i].catchAttempted
            && players[i].status.canMakePlays && (players[i].side == .defense || players[i].isEligibleReceiver) {
            let p = players[i]
            let diving = p.move?.kind == .dive
            let radius = 0.78 + 0.22 * Double(p.data.ratings.agility) / 99 + (diving ? 0.55 : 0)
            let reach = 2.35 + p.body.position.z + (diving ? 0.2 : 0)
            let hd = (ball.position.ground - p.body.position.ground).length
            guard hd <= radius, ball.position.z >= 0.15, ball.position.z <= reach else { continue }
            // Wait for the closest approach: hands meet the ball at its nearest
            // point, not the instant it grazes the edge of the catch radius.
            let dt = 1.0 / 120
            let nextBall = ball.position + ball.velocity * dt
            let nextBody = p.body.position.ground + p.body.velocity * dt
            let nextHD = (nextBall.ground - nextBody).length
            if nextHD < hd - 1e-4 && nextBall.z >= 0.15 && nextBall.z <= reach { continue }
            players[i].catchAttempted = true
            let opponents = players.filter { $0.side != p.side && $0.status.canMakePlays }
            let nearest = opponents.map { ($0.body.position.ground - ball.position.ground).length }.min() ?? 9
            let ctx = CatchContext(catching: p.data.ratings.catching, isOffense: p.side == .offense,
                                   isIntendedReceiver: p.id == ball.target, ballSpeed: ball.velocity.length,
                                   ballHeight: ball.position.z - p.body.position.z, centered: 1 - hd / radius,
                                   contest: clamp((1.6 - nearest) / 1.6, 0, 1), diving: diving)
            let outcome = CatchResolver.resolve(ctx, roll: rng.unit())
            let at = ball.position
            switch outcome {
            case .caught:
                ball.phase = .held(by: p.id)
                ball.isForwardPass = false
                passLanding = nil
                let pick = p.side == .defense
                events.append(.catchMade(player: p.id, at: at, contested: ctx.contest > 0.3, interception: pick))
                if pick {
                    whistle(.interception, spot: p.body.position.ground)
                } else if humanSide == .offense {
                    controlledID = p.id
                }
                return
            case .deflected:
                // Tipped ball stays live and can be caught by anyone else.
                let away = Vec2.fromAngle(ball.velocity.ground.angle + rng.signed() * 1.4, length: ball.velocity.ground.length * 0.35)
                ball.velocity = Vec3(away.x, away.y, 2.2 + 2.5 * rng.unit())
                ball.pitchRate = rng.signed() * 14
                ball.spinRate = 0
                for j in players.indices where j != i { players[j].catchAttempted = false }
                passLanding = nil
                events.append(.deflection(player: p.id, at: at))
                return
            case .dropped:
                ball.velocity = Vec3(ball.velocity.x * 0.25, ball.velocity.y * 0.25, 1.2 + rng.unit())
                ball.pitchRate = rng.signed() * 10
                ball.spinRate = 0
                passLanding = nil
                events.append(.drop(player: p.id, at: at))
                whistle(.incomplete, spot: Vec2(at.x, lineOfScrimmage))
                ball.isForwardPass = false
                return
            case .missed:
                continue
            }
        }
    }

    mutating func resolveRecoveries() {
        guard ball.phase == .loose, ball.position.z < 0.6, !isKickInFlight else { return }
        var best: (Int, Double)?
        for p in players where p.status.canMakePlays {
            let d = (p.body.position.ground - ball.position.ground).length
            let reach = 0.7 + (p.move?.kind == .dive ? 0.5 : 0)
            if d < reach && (best == nil || d < best!.1) { best = (p.id, d) }
        }
        guard let (id, _) = best, rng.unit() < 0.3 else { return }   // scramble for it
        ball.phase = .held(by: id)
        let offense = players[id].side == .offense
        events.append(.recovery(player: id, offense: offense))
        if offense {
            if humanSide == .offense { controlledID = id }
        } else { whistle(.turnover, spot: players[id].body.position.ground) }
    }

    mutating func resolveTackles() {
        guard let cid = ball.holder, ball.phase != .inFlight else { return }
        let carrier = players[cid]
        guard carrier.status != .down, !carrier.status.isOnGround else { return }
        for i in players.indices where players[i].side != carrier.side && players[i].status.canMakePlays
            && players[i].tackleCooldown <= 0 {
            let t = players[i]
            let d = carrier.body.position.ground - t.body.position.ground
            let diving = t.move?.kind == .dive
            let reach = carrier.body.profile.radius + t.body.profile.radius + 0.1 + (diving ? 0.55 : 0)
            guard d.length < reach else { continue }
            // Second hit on an already wrapped / stumbling carrier: gang tackle.
            if case .driven = carrier.status { return finishGangTackle(cid, i) }
            if case .stumbling = carrier.status { return finishGangTackle(cid, i) }

            let n = d.normalized
            let closing = (t.body.velocity - carrier.body.velocity).dot(n)
            let heading = carrier.body.speed > 0.3 ? carrier.body.velocity.normalized : Vec2.fromAngle(carrier.body.facing)
            let ctx = TackleContext(tacklerMass: t.body.profile.mass, tacklerStrength: t.data.ratings.strength,
                                    tacklerSpeed: t.body.speed, carrierMass: carrier.body.profile.mass,
                                    carrierStrength: carrier.data.ratings.strength,
                                    carrierBalance: carrier.data.ratings.balance, closingSpeed: max(closing, 1.0),
                                    frontalness: heading.dot(-n), carrierSpeed: carrier.body.speed,
                                    move: carrier.move?.kind, moveAge: carrier.move?.age ?? 0, tacklerDiving: diving)
            var c2 = ctx
            c2.tacklerEngaged = t.engaged
            let r = TackleResolver.resolve(c2, rolls: (rng.unit(), rng.unit(), rng.unit()))
            apply(r, carrier: cid, tackler: i, normal: n)
            return
        }
    }

    mutating func finishGangTackle(_ cid: Int, _ tackler: Int) {
        let r = TackleResult(outcome: .clean, impact: 2.5, fumble: false)
        apply(r, carrier: cid, tackler: tackler, normal: (players[cid].body.position.ground - players[tackler].body.position.ground).normalized)
    }

    mutating func apply(_ r: TackleResult, carrier cid: Int, tackler tid: Int, normal n: Vec2) {
        let at = players[cid].body.position
        events.append(.tackle(r, carrier: cid, tackler: tid, at: at))
        players[tid].tackleCooldown = 1.0
        switch r.outcome {
        case .clean:
            players[cid].status = .down
            // Momentum transfer: pile moves along the hit direction a little.
            players[cid].body.velocity = players[cid].body.velocity * 0.25 + n * min(3, r.impact * 0.3)
            players[tid].status = .stunned(1.2)
            players[tid].body.velocity = players[tid].body.velocity * 0.3
            players[cid].move = nil
            if !r.fumble { whistle(.tackled, spot: at.ground) }
        case .pushedForward:
            players[cid].status = .driven(0.5)
            players[tid].status = .stunned(1.4)
        case .stumble:
            players[cid].status = .stumbling(0.55)
            players[cid].body.velocity = players[cid].body.velocity * 0.6
            players[tid].status = .stunned(0.9)
        case .broken:
            players[cid].body.velocity = players[cid].body.velocity * 0.85
            players[tid].status = .stunned(1.3)
            players[tid].body.velocity = players[tid].body.velocity * 0.4 - n * 1.5
        case .whiff:
            players[tid].status = .stumbling(0.6)
            players[tid].tackleCooldown = 0.7
        }
        if r.fumble {
            let pop = Vec2.fromAngle(rng.unit() * 2 * Double.pi, length: 2 + 3 * rng.unit())
            ball.phase = .loose
            ball.position = at + Vec3(0, 0, 1.0)
            ball.velocity = Vec3(pop.x + players[cid].body.velocity.x, pop.y + players[cid].body.velocity.y, 2.5 + 2 * rng.unit())
            ball.pitchRate = rng.signed() * 15
            ball.spinRate = 0
            ball.isForwardPass = false
            events.append(.fumble(player: cid, at: at))
        }
    }

    mutating func checkBoundaries() {
        if let cid = ball.holder {
            let p = players[cid].body.position
            if p.x < 0 || p.x > Field.width {
                whistle(.outOfBounds, spot: Vec2(clamp(p.x, 0, Field.width), p.y))
            } else if players[cid].side == .offense && p.y >= Field.awayGoalLine {
                whistle(.touchdown, spot: p.ground)
            } else if players[cid].side == .defense && p.y <= Field.homeGoalLine {
                whistle(.touchdown, spot: p.ground)          // defensive score (recovered fumble etc.)
            }
        } else if ball.phase == .loose {
            let p = ball.position
            if p.x < 0 || p.x > Field.width || p.y < 0 || p.y > Field.length {
                whistle(.outOfBounds, spot: Vec2(clamp(p.x, 0, Field.width), clamp(p.y, 0, Field.length)))
            }
        }
    }

    mutating func whistle(_ reason: DeadBallReason, spot: Vec2) {
        guard !phase.isDead else { return }
        lastCarrierSide = ball.holder.map { players[$0].side }
        phase = .dead(reason)
        deadSpot = spot
        timeSinceWhistle = 0
        pendingThrow = nil
        events.append(.whistle(reason, spot: spot))
    }

    public func snapshot(into out: inout [PlayerState]) {
        out.removeAll(keepingCapacity: true)
        for p in players {
            out.append(PlayerState(id: p.id, position: p.body.position, velocity: p.body.velocity,
                                   facing: p.body.facing, stridePhase: p.body.stridePhase,
                                   topSpeed: p.body.profile.topSpeed))
        }
    }

    // MARK: Test hooks
    public mutating func debugSetPlayer(_ id: Int, position: Vec2? = nil, velocity: Vec2? = nil) {
        if let position { players[id].body.position = Vec3(position) }
        if let velocity { players[id].body.velocity = velocity; players[id].body.facing = velocity.angle }
    }
    public mutating func debugGiveBall(to id: Int) {
        phase = .live
        snapTarget = nil
        ball.phase = .held(by: id)
        controlledID = id
    }
}
