import GSFoundation
import GSData
import GSSimulation
import GSInput
import GSRenderCore

/// Platform-independent heart of the game: owns the fixed-timestep loop,
/// world, camera rig and input routing, and produces RenderFrames.
/// The iOS layer calls `handle(_:)` for touches and `advance(frameTime:)`
/// once per display refresh.
public final class GameRuntime {
    public let league: League
    public let offenseTeam: TeamData
    public let defenseTeam: TeamData
    public private(set) var world: World
    public private(set) var rig: CameraRig
    public var touches: TouchRouter
    public let looks: [PlayerLook]

    var timestep = FixedTimestep(hz: 120)
    var prevPlayers: [PlayerState] = []
    var currPlayers: [PlayerState] = []
    var prevRig: CameraRig.State
    var lastRightTapCount = 0
    var sprites: [ProjectedSprite] = []

    /// Hard-cut events since the last frame (particles / haptics hook, M2+).
    public private(set) var pendingHardCuts: [Vec2] = []

    public init(league: League, offenseID: String? = nil, defenseID: String? = nil) {
        self.league = league
        let off = league.teams.first { $0.id == offenseID } ?? league.teams[0]
        let def = league.teams.first { $0.id == defenseID } ?? league.teams[min(1, league.teams.count - 1)]
        offenseTeam = off
        defenseTeam = def
        world = Formation.sandbox(offense: off, defense: def)
        rig = CameraRig(focus: world.controlled.body.position.ground)
        prevRig = rig.state
        touches = TouchRouter(safeArea: Canvas.bounds)
        looks = [off, def].map { t in
            PlayerLook(jersey: t.colors.primaryRGBA, trim: t.colors.accentRGBA, pants: t.colors.secondaryRGBA,
                       helmet: t.colors.secondaryRGBA, skin: Palette.skinTones[1])
        }
        world.snapshot(into: &currPlayers)
        prevPlayers = currPlayers
    }

    public var cameraConfig: CameraConfig { rig.config }

    public func handle(_ e: TouchEvent) { touches.handle(e) }

    public func setSafeArea(_ r: Rect) { touches.safeArea = r }

    /// Advance real time; runs 0...N fixed sim ticks then builds the frame.
    public func advance(frameTime: Double) -> RenderFrame {
        var steps = 0
        let alpha = timestep.advance(by: frameTime) { dt in
            self.tick(dt)
            steps += 1
        }
        return buildFrame(alpha: alpha, steps: steps)
    }

    func tick(_ dt: Double) {
        swap(&prevPlayers, &currPlayers)
        prevRig = rig.state

        if touches.rightTapCount != lastRightTapCount {   // M1 debug: test screen shake
            lastRightTapCount = touches.rightTapCount
            rig.addShake(amplitude: 3, duration: 0.15)
        }
        world.step(SimInput(move: touches.worldMove), dt: dt)
        for (id, ev) in world.lastEvents where ev.contains(.hardCut) {
            pendingHardCuts.append(world.player(id).body.position.ground)
        }
        let c = world.controlled.body
        rig.update(dt: dt, carrier: c.position.ground, carrierVelocity: c.velocity)
        world.snapshot(into: &currPlayers)
    }

    public func drainHardCuts() -> [Vec2] {
        defer { pendingHardCuts.removeAll(keepingCapacity: true) }
        return pendingHardCuts
    }

    func buildFrame(alpha: Double, steps: Int) -> RenderFrame {
        let rs = CameraRig.State.lerped(prevRig, rig.state, alpha)
        let camera = CameraRig.camera(for: rs, config: rig.config, shake: rig.shakeOffset)
        sprites.removeAll(keepingCapacity: true)
        for i in currPlayers.indices {
            let s = PlayerState.lerped(prevPlayers[i], currPlayers[i], alpha)
            let sim = world.players[i]
            sprites.append(Self.project(s, sim: sim, camera: camera, controlled: sim.id == world.controlledID))
        }
        sprites.sort { $0.drawOrder < $1.drawOrder }
        // Crowd animates at ~2.5 Hz.
        let crowdFrame = Int(world.time * 2.5) & 1
        return RenderFrame(camera: camera, sprites: sprites, crowdFrame: crowdFrame,
                           simTime: world.time, alpha: alpha, stepsThisFrame: steps)
    }

    static func project(_ s: PlayerState, sim: SimPlayer, camera: Camera, controlled: Bool) -> ProjectedSprite {
        var out = ProjectedSprite(id: s.id, teamIndex: sim.teamIndex, visible: false, footX: 0, footY: 0,
                                  shadowX: 0, shadowY: 0, height: 0, shadowWidth: 0, drawOrder: 0,
                                  frame: 0, view: .back, flipX: false, isControlled: controlled)
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
        let speed = s.velocity.length
        out.frame = speed < 0.35 ? 0 : 1 + (Int(s.stridePhase.rounded(.down)) % PlaceholderSprites.runFrames)
        // Facing away from the camera (downfield) shows the back.
        out.view = sinD(s.facing) > -0.25 ? .back : .front
        out.flipX = cosD(s.facing) < -0.3
        return out
    }
}
