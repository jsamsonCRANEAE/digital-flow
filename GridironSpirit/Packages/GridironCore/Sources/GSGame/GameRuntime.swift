import GSFoundation
import GSData
import GSSimulation
import GSInput
import GSAI
import GSRenderCore

/// Platform-independent heart of the game: owns the fixed-timestep loop,
/// world, AI, camera rig, input routing and presentation effects, and
/// produces RenderFrames. The iOS layer calls `handle(_:)` for touches and
/// `advance(frameTime:)` once per display refresh.
public final class GameRuntime {
    public let league: League
    public let offenseTeam: TeamData
    public let defenseTeam: TeamData
    public private(set) var world: World
    public private(set) var ai: PlayAI
    public private(set) var rig: CameraRig
    public var touches: TouchRouter
    public let looks: [PlayerLook]
    public private(set) var playCount = 0
    public private(set) var lastPlayGain: Double?

    var timestep = FixedTimestep(hz: 120)
    var prevPlayers: [PlayerState] = []
    var currPlayers: [PlayerState] = []
    var prevRig: CameraRig.State
    var prevBall: Vec3 = .zero
    var currBall: Vec3 = .zero
    var sprites: [ProjectedSprite] = []
    var fx = FXState()
    var receiverSlots: [Int: Int] = [:]
    var seedCounter: UInt64 = 0xF00D

    public init(league: League, offenseID: String? = nil, defenseID: String? = nil, difficulty: Difficulty = .pro) {
        self.league = league
        let off = league.teams.first { $0.id == offenseID } ?? league.teams[0]
        let def = league.teams.first { $0.id == defenseID } ?? league.teams[min(1, league.teams.count - 1)]
        offenseTeam = off
        defenseTeam = def
        world = Formation.sandbox(offense: off, defense: def)
        ai = PlayAI(difficulty: difficulty)
        rig = CameraRig(focus: world.controlled.body.position.ground)
        prevRig = rig.state
        touches = TouchRouter(safeArea: Canvas.bounds)
        looks = [off, def].map { t in
            PlayerLook(jersey: t.colors.primaryRGBA, trim: t.colors.accentRGBA, pants: t.colors.secondaryRGBA,
                       helmet: t.colors.secondaryRGBA, skin: Palette.skinTones[1])
        }
        startPlay(lineOfScrimmage: world.lineOfScrimmage, lateral: Field.centerX)
    }

    public var cameraConfig: CameraConfig { rig.config }
    public func handle(_ e: TouchEvent) { touches.handle(e) }
    public func setSafeArea(_ r: Rect) { touches.safeArea = r }
    public func setMinTouchSize(canvasPixels: Double) { touches.minTouchSize = canvasPixels }

    /// Scripted input for tests, the preview tool and (later) replays.
    public func perform(_ c: InputCommand) { pendingCommands.append(c) }
    var pendingCommands: [InputCommand] = []

    // MARK: Play lifecycle

    func startPlay(lineOfScrimmage los: Double, lateral: Double) {
        seedCounter &+= 0x9E37_79B9
        let ownYard = clamp(los, Field.homeGoalLine + 1, Field.awayGoalLine - 1) - Field.homeGoalLine
        world = Formation.sandbox(offense: offenseTeam, defense: defenseTeam, ballOn: ownYard,
                                  lateral: clamp(lateral, Field.leftHash, Field.rightHash), seed: seedCounter)
        ai.setup(for: world)
        // Receiver icon slots: left to right at the snap.
        let eligible = world.players.filter(\.isEligibleReceiver).sorted { $0.body.position.x < $1.body.position.x }
        receiverSlots = Dictionary(uniqueKeysWithValues: eligible.enumerated().map { ($1.id, $0) })
        world.snapshot(into: &currPlayers)
        prevPlayers = currPlayers
        currBall = world.ball.position
        prevBall = currBall
        rig.mode = .follow
        fx.resetForPlay()
        playCount += 1
    }

    /// Next line of scrimmage from how the play ended (sandbox rules; downs
    /// and possession arrive in M3).
    func nextLineOfScrimmage() -> (Double, Double) {
        let spot = world.deadSpot ?? Vec2(Field.centerX, world.lineOfScrimmage)
        switch world.phase {
        case .dead(.tackled), .dead(.outOfBounds): return (spot.y, spot.x)
        case .dead(.touchdown), .dead(.safety): return (Field.worldY(ownYardLine: 25), Field.centerX)
        default: return (world.lineOfScrimmage, spot.x)
        }
    }

    // MARK: Frame

    public func advance(frameTime: Double) -> RenderFrame {
        var steps = 0
        touches.now = world.time
        let alpha = timestep.advance(by: frameTime) { dt in
            self.tick(dt)
            steps += 1
        }
        return buildFrame(alpha: alpha, steps: steps)
    }

    func tick(_ dt: Double) {
        // Hit-stop: the world freezes, the camera keeps shaking.
        if fx.hitStop > 0 {
            fx.hitStop -= dt
            rig.tickShake(dt: dt)
            prevPlayers = currPlayers
            prevBall = currBall
            prevRig = rig.state
            return
        }
        swap(&prevPlayers, &currPlayers)
        prevRig = rig.state
        prevBall = currBall

        updateContext()
        for c in touches.drainCommands() + pendingCommands { apply(c) }
        pendingCommands.removeAll()

        let human = world.controlledID
        let intents = ai.intents(for: world, human: human, humanMove: touches.worldMove, dt: dt)
        world.step(intents: intents, dt: dt)
        fx.handle(world.events, world: world, rig: &rig, gainFrom: world.lineOfScrimmage)
        fx.update(dt: dt, world: world)
        updateCamera(dt: dt)
        world.snapshot(into: &currPlayers)
        currBall = world.ball.position

        if world.phase.isDead && world.timeSinceWhistle > 2.2 {
            if case .dead(let r) = world.phase, r == .tackled || r == .outOfBounds, let s = world.deadSpot {
                lastPlayGain = s.y - world.lineOfScrimmage
            } else { lastPlayGain = 0 }
            let (los, x) = nextLineOfScrimmage()
            startPlay(lineOfScrimmage: los, lateral: x)
        }
    }

    func apply(_ c: InputCommand) {
        switch c {
        case .button(.snap): world.snap()
        case .button(.juke): world.requestMove(.juke, for: world.controlledID, side: touches.worldMove.x >= 0 ? 1 : -1)
        case .button(.spin): world.requestMove(.spin, for: world.controlledID)
        case .button(.stiffArm): world.requestMove(.stiffArm, for: world.controlledID)
        case .button(.dive): world.requestMove(.dive, for: world.controlledID)
        case .button(.audible), .button(.spirit): break     // M3 / M4
        case .throwTo(let r, let lob): world.requestThrow(to: r, kind: lob ? .lob : .bullet)
        }
    }

    func updateContext() {
        switch world.phase {
        case .preSnap: touches.context = .preSnap
        case .live:
            if world.canThrow && world.carrierID == world.controlledID { touches.context = .passing }
            else if world.carrierID == world.controlledID { touches.context = .ballCarrier }
            else { touches.context = .none }
        case .dead: touches.context = .none
        }
    }

    func updateCamera(dt: Double) {
        let ball = world.ball
        if ball.phase == .inFlight && ball.isForwardPass, let land = world.passLanding, let t = ball.thrower {
            // Frame thrower + landing spot, with the near edge of the frame
            // travelling with the ball so a deep catch arrives big and readable.
            let progress = ball.airTime / max(1e-3, ball.airTime + world.passTimeRemaining)
            let near = lerp(world.player(t).body.position.ground, land.ground, clamp(progress * 0.9, 0, 0.85))
            rig.mode = .frame(near, land.ground)
            rig.update(dt: dt, carrier: land.ground, carrierVelocity: .zero)
        } else if let h = ball.holder {
            rig.mode = .follow
            let b = world.player(h).body
            rig.update(dt: dt, carrier: b.position.ground, carrierVelocity: b.velocity)
        } else {
            rig.mode = .follow
            rig.update(dt: dt, carrier: ball.position.ground, carrierVelocity: ball.velocity.ground * 0.5)
        }
    }

    // MARK: Dev scenarios (preview tool / on-device debug menu)

    /// Puts the human on a ball carrier in open field so speed lines, top-speed
    /// running and pursuit angles can be inspected without setting up a play.
    public func debugBreakaway() {
        world.snap()
        let rb = world.players.first { $0.data.position == .rb }!.id
        world.debugGiveBall(to: rb)
        let p = world.player(rb).body.position.ground
        world.debugSetPlayer(rb, position: Vec2(p.x + 4, world.lineOfScrimmage + 6), velocity: Vec2(0, 6))
        for d in world.players where d.side == .defense {
            let q = d.body.position.ground
            world.debugSetPlayer(d.id, position: Vec2(q.x, q.y - 11))  // defense caught behind the play
        }
        world.snapshot(into: &currPlayers)
        prevPlayers = currPlayers
    }

    // MARK: Projection

    func buildFrame(alpha: Double, steps: Int) -> RenderFrame {
        let rs = CameraRig.State.lerped(prevRig, rig.state, alpha)
        let camera = CameraRig.camera(for: rs, config: rig.config, shake: rig.shakeOffset)
        sprites.removeAll(keepingCapacity: true)
        var icons: [ReceiverIcon] = []
        let passing = touches.context == .passing
        for i in currPlayers.indices {
            let s = PlayerState.lerped(prevPlayers[i], currPlayers[i], alpha)
            let sim = world.players[i]
            let sp = Self.project(s, sim: sim, camera: camera, controlled: sim.id == world.controlledID,
                                  squash: fx.squashLevel(for: sim.id), time: world.time)
            sprites.append(sp)
            if passing, sp.visible, let slot = receiverSlots[sim.id], sim.status.canMakePlays {
                icons.append(ReceiverIcon(receiverID: sim.id, center: Vec2(Double(sp.footX), Double(sp.footY - sp.height - 9)),
                                          slot: slot))
            }
        }
        sprites.sort { $0.drawOrder < $1.drawOrder }
        touches.icons = icons

        // Ball.
        let bpos = lerp(prevBall, currBall, alpha)
        var pball: ProjectedBall?
        if let q = camera.project(bpos) {
            let len = clamp(Int((0.3 * 1.7 * q.pixelsPerYard).rounded()), 4, 14)
            let b = world.ball
            // Screen-space long-axis angle: in flight the nose follows the
            // trajectory; loose balls tumble with their pitch.
            let dir = b.holder == nil && b.velocity.ground.length > 0.2 ? b.velocity.ground.normalized : Vec2(1, 0)
            let axis = Vec3(dir.x * cosD(b.pitch), dir.y * cosD(b.pitch), sinD(b.pitch)) * 0.5
            var bucket = 0
            if let tip = camera.project(bpos + axis) {
                let a = atan2Safe(tip.y - q.y, tip.x - q.x)
                bucket = (Int((a / (2 * Double.pi) * Double(FXSprites.angleBuckets)).rounded()) % FXSprites.angleBuckets
                          + FXSprites.angleBuckets) % FXSprites.angleBuckets
            }
            let spinFrame = Int((b.spin / (Double.pi / 2)).rounded(.down)) & 3
            var order = -q.depth
            if let h = b.holder, let carrierSprite = sprites.first(where: { $0.id == h }) { order = carrierSprite.drawOrder + 0.01 }
            pball = ProjectedBall(x: snapToPixel(q.x), y: snapToPixel(q.y), length: len, angleBucket: bucket,
                                  spinFrame: b.holder == nil ? spinFrame : 0, drawOrder: order)
        }

        var effects = EffectsFrame()
        effects.particles = fx.particles
        if world.ball.holder == nil { effects.ballForShadow = bpos }
        effects.trail = fx.trail + [bpos]
        effects.trailKind = world.ball.kind
        if world.ball.phase == .inFlight && world.ball.isForwardPass { effects.reticle = world.passLanding }
        effects.reticlePulse = world.time
        if fx.speedLineIntensity > 0.02, let c = sprites.first(where: { $0.id == world.controlledID }) {
            effects.speedLines = (Double(c.footX), Double(c.footY - c.height / 2), fx.speedLineIntensity, Int(world.time * 30))
        }

        let overlays = fx.overlays.compactMap { o -> OverlayItem? in
            guard let q = camera.project(o.at) else { return nil }
            let size = clamp(Int((o.sizeYards * q.pixelsPerYard).rounded()), 9, 64)
            return OverlayItem(kind: o.kind, x: snapToPixel(q.x), y: snapToPixel(q.y), size: size,
                               frame: min(2, Int((o.age / o.duration) * 3)))
        }
        let frame = RenderFrame(camera: camera, sprites: sprites, ball: pball, effects: effects, overlays: overlays,
                                icons: icons, chargingReceiver: touches.charging?.receiverID, buttons: touches.buttons,
                                impactFrame: fx.consumeImpactFrame(), callout: fx.callout?.text,
                                haptics: fx.drainHaptics(), crowdFrame: Int(world.time * (fx.crowdHype > 0 ? 6 : 2.5)) & 1,
                                simTime: world.time, hitStopped: fx.hitStop > 0, alpha: alpha, stepsThisFrame: steps)
        return frame
    }

    static func project(_ s: PlayerState, sim: SimPlayer, camera: Camera, controlled: Bool, squash: Int, time: Double) -> ProjectedSprite {
        var out = ProjectedSprite(id: s.id, teamIndex: sim.teamIndex, visible: false, footX: 0, footY: 0,
                                  shadowX: 0, shadowY: 0, height: 0, shadowWidth: 0, drawOrder: 0,
                                  pose: .idle, squash: squash, view: .back, flipX: false, isControlled: controlled)
        guard let ground = camera.project(Vec3(s.position.ground)),
              let body = camera.project(s.position) else { return out }
        let h = SpriteMetrics.playerHeight(pixelsPerYard: ground.pixelsPerYard)
        out.visible = body.y > -Double(h) && body.x > -Double(h) && body.x < Double(Canvas.width + h)
        out.footX = snapToPixel(body.x)
        out.footY = snapToPixel(body.y)
        out.shadowX = snapToPixel(ground.x)
        out.shadowY = snapToPixel(ground.y)
        out.height = h
        out.shadowWidth = SpriteMetrics.shadowWidth(forPlayerHeight: h)
        out.drawOrder = -ground.depth
        // Facing away from the camera (downfield) shows the back.
        out.view = sinD(s.facing) > -0.25 ? .back : .front
        out.flipX = cosD(s.facing) < -0.3
        let speed = s.velocity.length
        let runPose = speed < 0.35 ? SpritePose.idle : .run(Int(s.stridePhase.rounded(.down)))
        switch sim.status {
        case .down, .stunned: out.pose = .down
        case .stumbling: out.pose = .stumble
        default:
            if sim.move?.kind == .dive { out.pose = .dive }
            else if sim.throwTimer > 0 { out.pose = .throwing }
            else if sim.move?.kind == .stiffArm { out.pose = .stiffArm }
            else if let m = sim.move, m.kind == .spin {
                out.pose = runPose
                out.view = Int(m.age / 0.07) % 2 == 0 ? .front : .back
                out.flipX = Int(m.age / 0.14) % 2 == 0
            } else { out.pose = runPose }
        }
        if out.pose == .down || out.pose == .dive { out.flipX = cosD(s.facing) < 0 }
        return out
    }
}
