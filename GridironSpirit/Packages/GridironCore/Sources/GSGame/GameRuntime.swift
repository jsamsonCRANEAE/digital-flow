import GSFoundation
import GSData
import GSSimulation
import GSInput
import GSAI
import GSRules
import GSRenderCore

/// Platform-independent heart of the game: owns the fixed-timestep loop,
/// the match flow (play call -> snap -> whistle -> ruling), world, AI,
/// camera rig, input routing and presentation effects, and produces
/// RenderFrames. The iOS layer calls `handle(_:)` for touches and
/// `advance(frameTime:)` once per display refresh.
public final class GameRuntime {
    public let league: League
    public let playbook: Playbook
    /// teams[0] is the human's team (when there is a human).
    public let teams: [TeamData]
    public let humanTeam: Int?
    public internal(set) var state: GameState
    public private(set) var phase: MatchPhase = .playCall
    public private(set) var world: World
    public private(set) var ai: PlayAI
    public private(set) var rig: CameraRig
    public var touches: TouchRouter
    public let looks: [PlayerLook]
    public private(set) var playCount = 0
    public private(set) var lastPlayGain: Double?
    public private(set) var lastRuling: Ruling?
    public private(set) var playLog: [String] = []
    /// Per play-category (plays, net yards) for balancing.
    public private(set) var stats: [String: (plays: Int, yards: Double)] = [:]
    /// Wind in team 0's frame (team 0 attacking +y), yd/s.
    public let wind: Vec2

    // Backwards-compatible names used by M1/M2 code.
    public var offenseTeam: TeamData { teams[state.possession] }
    public var defenseTeam: TeamData { teams[state.defense] }

    var timestep = FixedTimestep(hz: 120)
    var prevPlayers: [PlayerState] = []
    var currPlayers: [PlayerState] = []
    var prevRig: CameraRig.State
    var prevBall: Vec3 = .zero
    var currBall: Vec3 = .zero
    var sprites: [ProjectedSprite] = []
    var fx = FXState()
    var receiverSlots: [Int: Int] = [:]
    var seedCounter: UInt64
    var callers: [PlayCaller]
    var pendingCommands: [InputCommand] = []

    // Match flow.
    enum MenuItem: Sendable, Equatable {
        case offense(OffensivePlay), defense(DefensivePlay), special(SpecialPlays.Kind), conversion(GameState.ConversionKind)
    }
    var menuPages: [[MenuItem]] = []
    var menuPage = 0
    var menuHeader = ""
    var offenseCall: MenuItem?
    var defenseCall: DefensivePlay?
    var playClock = 20.0
    var phaseTimer = 0.0
    var kick: KickMeter?
    var kicked = false
    var kickResult: PlayResult.Kind?
    var nextLateral = Field.centerX
    var falseStartTimer = 0.0
    var lastBallY = 0.0
    var currentOffensePlay: OffensivePlay?

    public static let cardRects: [Rect] = (0..<3).map { i in
        Rect(x: Double(81 + i * 164), y: 92, width: Double(UIArt.cardSize.w), height: Double(UIArt.cardSize.h))
    }

    /// - Parameters:
    ///   - humanTeam: 0 for a human playing teams[0]; nil for CPU vs CPU.
    public init(league: League, playbook: Playbook? = nil, offenseID: String? = nil, defenseID: String? = nil,
                difficulty: Difficulty = .pro, humanTeam: Int? = 0, seed: UInt64 = 0xF00D,
                quarterLength: Double = 180, openingReceiver: Int = 0) {
        self.league = league
        self.playbook = playbook ?? (try? DataLoader.bundledPlaybook()) ?? Playbook(offense: [], defense: [])
        let a = league.teams.first { $0.id == offenseID } ?? league.teams[0]
        let b = league.teams.first { $0.id == defenseID } ?? league.teams[min(1, league.teams.count - 1)]
        teams = [a, b]
        self.humanTeam = humanTeam
        seedCounter = seed
        var rng = SplitMix64(seed: seed ^ 0x5EED)
        let mph = rng.unit() * 14
        wind = Vec2.fromAngle(rng.unit() * 2 * Double.pi, length: mph * 0.4889)
        callers = [PlayCaller(seed: seed &+ 1), PlayCaller(seed: seed &+ 2)]
        state = GameState(openingReceiver: openingReceiver, quarterLength: quarterLength)
        world = Formation.sandbox(offense: a, defense: b)
        ai = PlayAI(difficulty: difficulty)
        rig = CameraRig(focus: world.controlled.body.position.ground)
        prevRig = rig.state
        touches = TouchRouter(safeArea: Canvas.bounds)
        touches.cardRects = Self.cardRects
        looks = teams.map { t in
            PlayerLook(jersey: t.colors.primaryRGBA, trim: t.colors.accentRGBA, pants: t.colors.secondaryRGBA,
                       helmet: t.colors.secondaryRGBA, skin: Palette.skinTones[1])
        }
        enterPlayCall()
    }

    public var cameraConfig: CameraConfig { rig.config }
    public func handle(_ e: TouchEvent) { touches.handle(e) }
    public func setSafeArea(_ r: Rect) { touches.safeArea = r }
    public func setMinTouchSize(canvasPixels: Double) { touches.minTouchSize = canvasPixels }
    /// Scripted input for tests, the preview tool and (later) replays.
    public func perform(_ c: InputCommand) { pendingCommands.append(c) }

    var humanOnOffense: Bool { humanTeam == state.possession }
    var humanOnDefense: Bool { humanTeam == state.defense }

    // MARK: Play calling

    func situation(for team: Int) -> Situation {
        Situation(down: state.down, distance: state.distance, ballOn: state.ballOn,
                  scoreDiff: state.score[team] - state.score[1 - team], quarter: state.quarter,
                  clock: state.clock, isConversion: state.isConversion)
    }

    func enterPlayCall() {
        phase = .playCall
        playClock = 20
        offenseCall = nil
        defenseCall = nil
        menuPages = []
        menuPage = 0
        let off = state.possession

        if state.mode == .conversionChoice {
            if humanOnOffense {
                menuPages = [[.conversion(.kick), .conversion(.twoPoint)]]
                menuHeader = "TOUCHDOWN! CHOOSE THE TRY"
                return
            }
            let diff = state.score[off] - state.score[1 - off]
            let c = callers[off].conversion(scoreDiffAfterTD: diff, quarter: state.quarter)
            Referee.chooseConversion(c == .twoPoint ? .twoPoint : .kick, &state)
        }
        if state.mode == .conversion(.kick) {
            offenseCall = .special(.extraPoint)
            defenseCall = SpecialPlays.defense(.extraPoint)
            return setupPlay()
        }
        let sit = situation(for: off)
        // Offense.
        if !humanOnOffense {
            if state.down == 4 && !state.isConversion {
                switch callers[off].fourthDown(sit) {
                case .punt: offenseCall = .special(.punt)
                case .fieldGoal: offenseCall = .special(.fieldGoal)
                case .goForIt: offenseCall = .offense(callers[off].offense(sit, from: playbook))
                }
            } else {
                offenseCall = .offense(callers[off].offense(sit, from: playbook))
            }
        }
        // Defense.
        if case .special(let k)? = offenseCall {
            defenseCall = SpecialPlays.defense(k)
        } else if !humanOnDefense {
            defenseCall = callers[state.defense].defense(situation(for: off), from: playbook)
        }
        // Human menu.
        if humanOnOffense {
            var pages = playbook.offensePages.map { $0.map { MenuItem.offense($0) } }
            if state.down == 4 && !state.isConversion { pages.insert([.special(.punt), .special(.fieldGoal)], at: 0) }
            menuPages = pages
            menuHeader = "OFFENSE  \(state.downAndDistance)  \(state.fieldPosition)"
        } else if humanOnDefense && defenseCall == nil {
            menuPages = playbook.defensePages.map { $0.map { MenuItem.defense($0) } }
            menuHeader = "DEFENSE  \(state.downAndDistance)  \(state.fieldPosition)"
        }
        if menuPages.isEmpty { setupPlay() }
    }

    func choose(_ item: MenuItem) {
        switch item {
        case .conversion(let k):
            Referee.chooseConversion(k, &state)
            enterPlayCall()
            return
        case .defense(let d): defenseCall = d
        case .offense, .special:
            offenseCall = item
            if case .special(let k) = item { defenseCall = SpecialPlays.defense(k) }
        }
        let needDefense = defenseCall == nil
        if needDefense && !humanOnDefense { defenseCall = callers[state.defense].defense(situation(for: state.possession), from: playbook) }
        if offenseCall != nil && defenseCall != nil {
            menuPages = []
            setupPlay()
        }
    }

    func setupPlay() {
        guard let oc = offenseCall, let dc = defenseCall else { return }
        seedCounter &+= 0x9E37_79B9
        var offensePlay: OffensivePlay
        kick = nil
        kicked = false
        kickResult = nil
        switch oc {
        case .offense(let p): offensePlay = p
        case .special(let k):
            offensePlay = SpecialPlays.offense(k)
            kick = KickMeter(kind: k)
        default: offensePlay = playbook.offense.first!
        }
        currentOffensePlay = offensePlay
        let off = state.possession, def = state.defense
        let humanSlot = humanOnDefense ? "LB1" : (offensePlay.category == .run ? "RB" : "QB")
        world = Formation.lineUp(offense: teams[off], offensePlay: offensePlay, defense: teams[def], defensePlay: dc,
                                 ballOn: state.ballOn, lateral: clamp(nextLateral, Field.leftHash, Field.rightHash),
                                 teamIndices: (off, def), controlled: "QB", seed: seedCounter)
        world.humanSide = humanTeam == nil ? nil : (humanOnOffense ? .offense : .defense)
        world.wind = off == 0 ? wind : -wind
        if humanTeam != nil, let id = world.players.first(where: { $0.slot == humanSlot && $0.side == (humanOnOffense ? .offense : .defense) })?.id,
           humanOnDefense {
            world.controlledID = id
        }
        ai.setup(for: world, offense: offensePlay, defense: dc, seed: seedCounter)
        let eligible = world.players.filter(\.isEligibleReceiver).sorted { $0.body.position.x < $1.body.position.x }
        receiverSlots = Dictionary(uniqueKeysWithValues: eligible.enumerated().map { ($1.id, $0) })
        world.snapshot(into: &currPlayers)
        prevPlayers = currPlayers
        currBall = world.ball.position
        prevBall = currBall
        lastBallY = currBall.y
        rig.mode = .follow
        fx.resetForPlay()
        phase = .preSnap
        phaseTimer = 0
        falseStartTimer = 0
        playCount += 1
    }

    // MARK: Frame

    public func advance(frameTime: Double) -> RenderFrame {
        var steps = 0
        let alpha = timestep.advance(by: frameTime) { dt in
            self.tick(dt)
            steps += 1
        }
        touches.now = world.time
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
        touches.now = world.time
        updateContext()
        let commands = touches.drainCommands() + pendingCommands
        pendingCommands.removeAll()

        switch phase {
        case .playCall:
            playClock -= dt
            for c in commands { applyMenu(c) }
            if phase == .playCall && playClock <= 0, let first = menuPages.first?.first {
                choose(menuPages[menuPage].count > 1 ? menuPages[menuPage][1] : first)   // auto-call
            }
            stepWorld(dt: dt, intents: nil)
        case .preSnap:
            playClock -= dt
            phaseTimer += dt
            for c in commands { apply(c) }
            // False start: the human's player moves before the snap.
            if humanOnOffense && kick == nil && touches.worldMove.length > 0.75 { falseStartTimer += dt } else { falseStartTimer = 0 }
            if falseStartTimer > 0.15 { world.flagFalseStart(by: world.controlledID) }
            if !humanOnOffense && phaseTimer > 1.3 { world.snap() }
            if playClock <= 0 { world.snap() }
            stepWorld(dt: dt, intents: nil)
            if world.phase.isLive { phase = .live; phaseTimer = 0 }
            if world.phase.isDead { endPlay() }
        case .live:
            for c in commands { apply(c) }
            liveStep(dt: dt)
            _ = Referee.tick(&state, dt: dt, live: true)
            if world.phase.isDead { endPlay() }
        case .postPlay:
            phaseTimer += dt
            stepWorld(dt: dt, intents: nil)
            if phaseTimer > 2.0 { finishPostPlay() }
        case .banner:
            phaseTimer += dt
            if phaseTimer > 2.4 { state.isFinal ? (phase = .final) : enterPlayCall() }
        case .final:
            break
        }
        fx.update(dt: dt, world: world)
        updateCamera(dt: dt)
        world.snapshot(into: &currPlayers)
        currBall = world.ball.position
    }

    func stepWorld(dt: Double, intents: [Vec2]?) {
        world.step(intents: intents ?? [Vec2](repeating: .zero, count: world.players.count), dt: dt)
        fx.handle(world.events, world: world, rig: &rig, gainFrom: world.lineOfScrimmage)
    }

    /// The human steers their player unless the play is in a scripted phase
    /// (run exchange, kicks).
    var humanControlID: Int? {
        guard humanTeam != nil else { return nil }
        if humanOnOffense {
            if kick != nil { return nil }
            if currentOffensePlay?.category == .run && !ai.exchanged { return nil }
        }
        return world.controlledID
    }

    func liveStep(dt: Double) {
        let human = humanControlID
        let intents = ai.intents(for: world, human: human, humanMove: touches.worldMove, dt: dt)
        let actions = ai.decide(world: world, cpuOffense: !humanOnOffense, cpuDefense: !humanOnDefense, human: human, dt: dt)
        for a in actions {
            switch a {
            case .handoff(let id): world.handoff(to: id)
            case .pitch(let id): world.pitch(to: id)
            case .throwTo(let r, let k): world.requestThrow(to: r, kind: k)
            case .throwAway(let p): world.requestThrowAway(to: p)
            case .carrierMove(let id, let k): world.requestMove(k, for: id, side: 1)
            case .defenderAction(let id, let k): world.requestDefenderAction(k, for: id)
            }
        }
        if kick != nil { updateKick(dt: dt) }
        stepWorld(dt: dt, intents: intents)
        monitorKick()
        lastBallY = world.ball.position.y
    }

    func applyMenu(_ c: InputCommand) {
        guard !menuPages.isEmpty else { return }
        switch c {
        case .page(let d): menuPage = (menuPage + d + menuPages.count) % menuPages.count
        case .selectCard(let i):
            let page = menuPages[menuPage]
            if page.indices.contains(i) { choose(page[i]) }
        default: break
        }
    }

    func apply(_ c: InputCommand) {
        let me = world.controlledID
        switch c {
        case .button(.snap): if humanOnOffense { world.snap() }
        case .button(.juke): world.requestMove(.juke, for: me, side: touches.worldMove.x >= 0 ? 1 : -1)
        case .button(.spin): world.requestMove(.spin, for: me)
        case .button(.stiffArm): world.requestMove(.stiffArm, for: me)
        case .button(.dive):
            if humanOnDefense { world.requestDefenderAction(.dive, for: me) } else { world.requestMove(.dive, for: me) }
        case .button(.diveTackle): world.requestDefenderAction(.dive, for: me)
        case .button(.jump): world.requestDefenderAction(.jump, for: me)
        case .button(.switchPlayer): switchDefender()
        case .button(.audible), .button(.spirit): break     // Spirit Plays arrive in M4
        case .throwTo(let r, let lob): world.requestThrow(to: r, kind: lob ? .lob : .bullet)
        case .kickTap:
            if var k = kick, !kicked, world.carrierID == holderID {
                if k.tap() { kick = k; launchKick() } else { kick = k }
            }
        case .selectCard, .page: break
        }
    }

    /// Switch to the defender closest to the ball (classic arcade rule).
    func switchDefender() {
        guard humanOnDefense else { return }
        let ball = world.ball.position.ground
        let cands = world.players.filter { $0.side == .defense && $0.id != world.controlledID && $0.status.canMakePlays }
        if let best = cands.min(by: { ($0.body.position.ground - ball).length < ($1.body.position.ground - ball).length }) {
            world.controlledID = best.id
        }
    }

    // MARK: Kicks

    var holderID: Int? { world.players.first { $0.side == .offense && $0.slot == "QB" }?.id }

    func updateKick(dt: Double) {
        guard var k = kick, !kicked, world.phase.isLive, world.carrierID == holderID else { return }
        k.update(dt: dt)
        if !humanOnOffense {
            k.cpuTimer += dt
            if k.cpuTimer > 0.6 {
                var rng = SplitMix64(seed: seedCounter)
                let dist = (Field.length - world.ball.position.y)
                let v = k.kind == .punt ? KickAI.punt(error: ai.difficulty.kickError, rng: &rng)
                                        : KickAI.fieldGoal(distance: dist, error: ai.difficulty.kickError, rng: &rng)
                k.lock(power: v.power, aim: v.aim)
                kick = k
                return launchKick()
            }
        }
        kick = k
    }

    func launchKick() {
        guard let k = kick, let h = holderID else { return }
        kicked = true
        let p = world.player(h).body.position
        let leg = max(world.player(h).data.ratings.throwPower, 80)
        let v: Vec3
        if k.kind == .punt {
            v = KickPhysics.launchVelocity(power: k.lockedPower, elevationDegrees: 50,
                                           yaw: Double.pi / 2 + k.lockedAim * 0.2, legRating: leg)
        } else {
            let toPosts = atan2Safe(Field.length - p.y, Field.centerX - p.x)
            v = KickPhysics.launchVelocity(power: k.lockedPower, elevationDegrees: 36,
                                           yaw: toPosts + k.lockedAim * 0.11, legRating: leg)
        }
        world.kickBall(from: p + Vec3(0, 0.6, k.kind == .punt ? 1.0 : 0.25), velocity: v)
        kickSpot = p.y - Field.homeGoalLine
    }
    var kickSpot = 0.0

    /// Decides field goals at the plane of the uprights and spots punts.
    func monitorKick() {
        guard let k = kick, kicked, world.isKickInFlight else { return }
        let b = world.ball
        if k.kind == .punt {
            let inEndZone = b.position.y > Field.awayGoalLine && b.isOnGround
            let out = b.position.x < 0 || b.position.x > Field.width || b.position.y > Field.length
            if inEndZone || out || world.kickRested || b.airTime > 9 {
                let spot = (inEndZone || b.position.y > Field.length) ? 101 : b.position.y - Field.homeGoalLine
                kickResult = .punt(spot: spot)
                world.endKick(spot: b.position.ground)
            }
            return
        }
        // Field goal: crossing the end-line plane (y = 120).
        if lastBallY < Field.length && b.position.y >= Field.length {
            let made = abs(b.position.x - Field.centerX) <= 18.5 / 6 && b.position.z >= 10.0 / 3
            kickResult = .fieldGoal(made: made, kickSpot: kickSpot)
            world.endKick(spot: b.position.ground)
        } else if (b.airTime > 0.4 && b.position.z <= BallPhysics.groundZ + 0.01) || b.airTime > 7 {
            kickResult = .fieldGoal(made: false, kickSpot: kickSpot)
            world.endKick(spot: b.position.ground)
        }
    }

    // MARK: Whistle -> ruling

    func playResult() -> PlayResult {
        let spotV = world.deadSpot ?? Vec2(Field.centerX, world.lineOfScrimmage)
        let spot = spotV.y - Field.homeGoalLine
        let pi = world.passInterference.map { $0.spot.y - Field.homeGoalLine }
        if let k = kickResult { return PlayResult(k) }
        guard case .dead(let reason) = world.phase else { return PlayResult(.down(spot: spot)) }
        switch reason {
        case .tackled, .safety:
            let qb = world.quarterback?.id
            let sack = world.lastCarrierSide == .offense && !world.passThrown && qb != nil
                && world.ball.holder == qb && spotV.y < world.lineOfScrimmage
            return PlayResult(.down(spot: spot), passInterference: pi, sack: sack)
        case .outOfBounds: return PlayResult(.outOfBounds(spot: spot), passInterference: pi)
        case .incomplete: return PlayResult(.incomplete, passInterference: pi)
        case .touchdown: return PlayResult(.touchdown(byOffense: world.lastCarrierSide != .defense), passInterference: pi)
        case .interception: return PlayResult(.turnover(spot: spot, interception: true), passInterference: pi)
        case .turnover:
            if spot <= 0 { return PlayResult(.touchdown(byOffense: false)) }       // recovered in the end zone
            return PlayResult(.turnover(spot: spot, interception: false))
        case .falseStart: return PlayResult(.falseStart)
        case .kickDead:
            if case .fieldGoal? = kick?.kind { return PlayResult(.fieldGoal(made: false, kickSpot: kickSpot)) }
            return PlayResult(.punt(spot: spot))
        }
    }

    func endPlay() {
        let before = state
        let result = playResult()
        let ruling = Referee.apply(result, to: &state)
        lastRuling = ruling
        if let s = world.deadSpot { lastPlayGain = s.y - world.lineOfScrimmage }
        // Next spot laterally (mirrored when the other team takes over).
        let x = world.deadSpot?.x ?? Field.centerX
        nextLateral = ruling.possessionChanged ? Field.width - x : x
        if ruling.possessionChanged && result.kind == .falseStart { nextLateral = x }
        if case .touchdown = result.kind { nextLateral = Field.centerX }
        let callout = ruling.callouts.first { $0 != "FLAG!" } ?? ruling.callouts.first
        if let c = callout {
            fx.say(c, 2.0)
            if ruling.points != nil || ["INTERCEPTION!", "SACK!", "TURNOVER ON DOWNS"].contains(c) { fx.crowdHype = 2.5 }
        }
        if !ruling.possessionChanged && !before.isConversion, let cat = currentOffensePlay?.category {
            var e = stats[cat.rawValue] ?? (0, 0)
            e.plays += 1
            e.yards += state.ballOn - before.ballOn
            stats[cat.rawValue] = e
        }
        let who = teams[before.possession].abbreviation
        playLog.append("Q\(before.quarter) \(before.clockText) \(who) \(before.downAndDistance) @\(before.fieldPosition): "
                       + "\(currentOffensePlay?.name ?? "?") -> \(ruling.callouts.joined(separator: ", "))"
                       + (ruling.points.map { "  [+\($0.points) \(teams[$0.team].abbreviation)]" } ?? "")
                       + "  \(state.score[0])-\(state.score[1])")
        phase = .postPlay
        phaseTimer = 0
    }

    func finishPostPlay() {
        if state.clockRunning { _ = Referee.tick(&state, dt: Referee.runoffBetweenPlays, live: false) }
        if let banner = Referee.endQuarterIfExpired(&state) {
            fx.say(banner, 2.4)
            playLog.append("== \(banner)  \(teams[0].abbreviation) \(state.score[0]) - \(teams[1].abbreviation) \(state.score[1])")
            phase = .banner
            phaseTimer = 0
            if banner == "HALFTIME" { nextLateral = Field.centerX }
            return
        }
        enterPlayCall()
    }

    // MARK: Context, camera

    func updateContext() {
        switch phase {
        case .playCall: touches.context = menuPages.isEmpty ? .none : .playCall
        case .preSnap:
            touches.context = humanOnOffense ? (kick == nil ? .preSnap : .preSnap) : (humanOnDefense ? .defense : .none)
        case .live:
            guard humanTeam != nil else { touches.context = .none; return }
            if humanOnDefense { touches.context = .defense; return }
            if kick != nil && !kicked && world.carrierID == holderID { touches.context = .kick; return }
            if world.canThrow && world.carrierID == world.controlledID && humanControlID != nil { touches.context = .passing }
            else if world.carrierID == world.controlledID && humanControlID != nil { touches.context = .ballCarrier }
            else { touches.context = .none }
        default: touches.context = .none
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
        } else if world.isKickInFlight {
            rig.mode = .follow
            rig.update(dt: dt, carrier: ball.position.ground, carrierVelocity: ball.velocity.ground * 0.6)
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

    /// Skips the play call with a given offensive play (for tests and previews).
    public func debugCall(offense id: String, defense did: String? = nil) {
        guard let p = playbook.offense(id) else { return }
        offenseCall = .offense(p)
        defenseCall = did.flatMap { playbook.defense($0) } ?? defenseCall ?? playbook.defense.first
        menuPages = []
        setupPlay()
    }

    /// Jumps to a down/distance/spot and re-opens the play call (previews, tests).
    public func debugSetSituation(down: Int, ballOn: Double, lineToGain: Double) {
        state.down = down; state.ballOn = ballOn; state.lineToGain = lineToGain
        state.mode = .scrimmage
        enterPlayCall()
    }

    /// Puts the human on a ball carrier in open field so speed lines, top-speed
    /// running and pursuit angles can be inspected without setting up a play.
    public func debugBreakaway() {
        if phase == .playCall { debugCall(offense: "slants", defense: "cover3") }
        world.snap()
        phase = .live
        let rb = world.players.first { $0.slot == "RB" && $0.side == .offense }!.id
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
        for i in currPlayers.indices where i < world.players.count && i < prevPlayers.count {
            let s = PlayerState.lerped(prevPlayers[i], currPlayers[i], alpha)
            let sim = world.players[i]
            let sp = Self.project(s, sim: sim, camera: camera,
                                  controlled: humanTeam != nil && sim.id == world.controlledID && humanControlID != nil,
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
        let near = teams[state.possession].colors.primaryRGBA, far = teams[state.defense].colors.primaryRGBA
        return RenderFrame(camera: camera, sprites: sprites, ball: pball, effects: effects, overlays: overlays,
                           icons: icons, chargingReceiver: touches.charging?.receiverID, buttons: touches.buttons,
                           impactFrame: fx.consumeImpactFrame(), callout: fx.callout?.text,
                           haptics: fx.drainHaptics(), crowdFrame: Int(world.time * (fx.crowdHype > 0 ? 6 : 2.5)) & 1,
                           phase: phase, hud: hud(), playCall: playCallVisual(), kickMeter: kickVisual(),
                           endZones: (near, far),
                           simTime: world.time, hitStopped: fx.hitStop > 0, alpha: alpha, stepsThisFrame: steps)
    }

    func hud() -> HUDInfo {
        let w = state.possession == 0 ? wind : -wind
        // Screen: +x right, world +y is screen up.
        let a = atan2Safe(-w.y, w.x)
        let bucket = ((Int((a / (2 * Double.pi) * 16).rounded()) % 16) + 16) % 16
        var active: (String, Int, Int, Int)?
        if humanTeam != nil, phase == .live || phase == .preSnap {
            let p = world.controlled.data
            active = (p.lastName.uppercased(), p.ratings.speed, p.ratings.strength, p.ratings.catching)
        }
        return HUDInfo(abbreviations: teams.map(\.abbreviation), scores: state.score, possession: state.possession,
                       quarter: state.quarter, clock: state.clockText, downDistance: state.downAndDistance,
                       fieldPosition: state.fieldPosition,
                       playClock: phase == .playCall || phase == .preSnap ? max(0, Int(playClock.rounded(.up))) : nil,
                       windMPH: Int((wind.length / 0.4889).rounded()), windBucket: bucket, activePlayer: active,
                       ballProgress: state.ballOn / 100,
                       lineToGainProgress: state.isConversion ? nil : state.lineToGain / 100)
    }

    func playCallVisual() -> PlayCallVisual? {
        guard phase == .playCall, !menuPages.isEmpty else { return nil }
        let page = menuPages[menuPage]
        let cards = page.enumerated().map { i, item in
            PlayCallCard(title: title(item), category: category(item), diagram: diagram(item), rect: Self.cardRects[i])
        }
        let accent = teams[humanTeam ?? 0].colors.primaryRGBA
        return PlayCallVisual(header: menuHeader, cards: cards, page: menuPage, pageCount: menuPages.count, accent: accent)
    }

    func kickVisual() -> KickMeterVisual? {
        guard let k = kick, humanOnOffense || humanTeam == nil, phase == .live || (phase == .preSnap) else { return nil }
        guard !kicked || phase == .live else { return nil }
        return KickMeterVisual(power: k.stage == 0 ? k.power : k.lockedPower, aim: k.stage == 1 ? k.aim : k.lockedAim,
                               stage: k.stage)
    }

    func title(_ i: MenuItem) -> String {
        switch i {
        case .offense(let p): return p.name
        case .defense(let d): return d.name
        case .special(let k): return k == .punt ? "PUNT" : "FIELD GOAL"
        case .conversion(let c): return c == .kick ? "KICK PAT" : "GO FOR 2"
        }
    }

    func category(_ i: MenuItem) -> String {
        switch i {
        case .offense(let p): return p.category.label
        case .defense(let d): return d.category.label
        case .special(let k):
            let d = Int(((100 - state.ballOn) + 17).rounded())
            return k == .punt ? "SPECIAL" : "\(d) YD ATTEMPT"
        case .conversion(let c): return c == .kick ? "1 POINT" : "2 POINTS"
        }
    }

    /// Chalkboard diagram generated from the play data itself.
    func diagram(_ i: MenuItem) -> CardDiagram {
        switch i {
        case .offense(let p):
            var d = CardDiagram()
            for s in Playbook.offenseSlots { if let a = p.alignment(s) { d.offense.append(a) } }
            for s in ["WR1", "WR2", "RB"] {
                guard let a = p.alignment(s) else { continue }
                if s == "RB", let path = p.runPath { d.primary = d.paths.count; d.paths.append([a] + path.waypoints.map { a + $0 }) }
                else if let r = p.routes[s] {
                    if s == p.progression.first { d.primary = d.paths.count }
                    d.paths.append([a] + r.waypoints.map { a + $0 })
                }
            }
            return d
        case .defense(let p):
            var d = CardDiagram()
            for s in Playbook.defenseSlots {
                guard let a = p.alignment(s), let asg = p.assignments[s] else { continue }
                d.defense.append(a)
                switch asg.role {
                case .rush: d.paths.append([a, Vec2(a.x * 0.4, -3.5)])
                case .zone, .spy: if let z = asg.zonePoint { d.paths.append([a, z]) }
                case .man: break
                }
            }
            d.offense = [Vec2(0, -0.6), Vec2(-1.4, -0.7), Vec2(1.4, -0.7), Vec2(0, -4.5), Vec2(-14, -0.8), Vec2(13, -0.8), Vec2(1.3, -4.6)]
            return d
        case .special(let k):
            let o = SpecialPlays.offense(k)
            var d = CardDiagram(offense: Playbook.offenseSlots.compactMap { o.alignment($0) })
            let holder = o.alignment("QB") ?? Vec2(0, -7)
            d.paths = [k == .punt ? [holder, Vec2(0, 8), Vec2(0, 22)] : [holder, Vec2(0, 6), Vec2(0, 22)]]
            d.primary = 0
            return d
        case .conversion(let c):
            var d = CardDiagram(offense: [Vec2(0, -0.6), Vec2(-1.4, -0.7), Vec2(1.4, -0.7), Vec2(0, c == .kick ? -7 : -4.5)])
            d.paths = [[Vec2(0, c == .kick ? -7 : -4.5), Vec2(0, 18)]]
            d.primary = 0
            return d
        }
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
