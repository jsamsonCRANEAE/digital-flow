import GSFoundation
import GSSimulation
import GSRenderCore

/// Presentation state driven by simulation events: hit-stop, impact frames,
/// particles, overlays, squash & stretch, callouts, haptics, speed lines.
/// Advanced at the fixed sim rate so it is deterministic and replayable.
struct FXState {
    struct Overlay { var kind: OverlayKind; var at: Vec3; var sizeYards: Double; var age: Double; var duration: Double }
    struct Callout { var text: String; var remaining: Double; var life: Double }

    var hitStop = 0.0
    var impactPending = false
    var particles: [Particle] = []
    var overlays: [Overlay] = []
    var squash: [Int: (level: Int, remaining: Double)] = [:]
    var callout: Callout?
    var haptics: [HapticPulse] = []
    var trail: [Vec3] = []
    var trailTick = 0
    var speedLineIntensity = 0.0
    var crowdHype = 0.0
    var rng = SplitMix64(seed: 0xFEED)

    static let frame = 1.0 / 60     // hit-stop is specified in 60 Hz frames

    mutating func resetForPlay() {
        particles.removeAll(); overlays.removeAll(); squash.removeAll(); trail.removeAll()
        speedLineIntensity = 0; hitStop = 0
    }

    mutating func consumeImpactFrame() -> Bool { defer { impactPending = false }; return impactPending }
    mutating func drainHaptics() -> [HapticPulse] { defer { haptics.removeAll() }; return haptics }

    func squashLevel(for id: Int) -> Int { squash[id]?.level ?? 0 }

    mutating func say(_ t: String, _ seconds: Double = 1.3) { callout = Callout(text: t, remaining: seconds, life: seconds) }

    mutating func handle(_ events: [GameEvent], world: World, rig: inout CameraRig, gainFrom los: Double) {
        for e in events {
            switch e {
            case .snap:
                haptics.append(HapticPulse(intensity: 0.35, sharpness: 0.8))
            case .hardCut(_, let at):
                turf(at: Vec3(at), count: 7, speed: 3)
            case .reachedTopSpeed:
                break
            case .throwRelease(_, _, let wobble):
                trail.removeAll()
                haptics.append(HapticPulse(intensity: 0.4, sharpness: 0.6))
                if wobble > 0.55 { say("WOBBLY!", 0.8) }
            case .catchMade(let id, let at, let contested, let pick):
                hitStop = max(hitStop, Self.frame * (contested ? 5 : 3))
                overlays.append(Overlay(kind: .catchFlash, at: at, sizeYards: 1.6, age: 0, duration: 0.25))
                squash[id] = (-1, 0.1)
                haptics.append(HapticPulse(intensity: contested ? 0.8 : 0.55, sharpness: 0.5))
                crowdHype = 1.5
                say(pick ? "INTERCEPTION!" : contested ? "WHAT A CATCH!" : "CATCH!")
            case .drop(_, let at):
                say("DROPPED!")
                dust(at: Vec3(at.x, at.y, 0.2), count: 4)
            case .deflection(_, let at):
                hitStop = max(hitStop, Self.frame * 3)
                overlays.append(Overlay(kind: .starburst, at: at, sizeYards: 1.1, age: 0, duration: 0.18))
                haptics.append(HapticPulse(intensity: 0.6, sharpness: 0.9))
                say("TIPPED!")
            case .tackle(let r, let carrier, let tackler, let at):
                let big = r.impact >= TackleResolver.bigHitImpact
                let downs = r.outcome == .clean || r.outcome == .pushedForward
                let frames = big ? 6.0 : downs ? 4 : r.outcome == .whiff ? 0 : 3
                hitStop = max(hitStop, Self.frame * frames)
                if r.outcome != .whiff {
                    rig.addShake(amplitude: clamp(2 + r.impact * 0.3, 2, 4), duration: big ? 0.18 : 0.15)
                    overlays.append(Overlay(kind: .starburst, at: at + Vec3(0, 0, 1.1),
                                            sizeYards: big ? 2.6 : 1.5, age: 0, duration: big ? 0.22 : 0.16))
                    dust(at: Vec3(at.x, at.y, 0.05), count: big ? 16 : 8)
                    squash[carrier] = (-1, 0.12)
                    squash[tackler] = (-1, 0.12)
                }
                if big { impactPending = true; crowdHype = 2 }
                haptics.append(HapticPulse(intensity: clamp(0.35 + r.impact * 0.08, 0, 1), sharpness: big ? 1 : 0.7))
                switch r.outcome {
                case .whiff: say("WHIFF!", 0.9)
                case .broken: say("BROKEN TACKLE!")
                case .stumble: say("STUMBLES!", 0.9)
                case .clean, .pushedForward: if big { say("BIG HIT!") }
                }
            case .fumble(_, let at):
                say("FUMBLE!", 1.6)
                hitStop = max(hitStop, Self.frame * 4)
                overlays.append(Overlay(kind: .starburst, at: at + Vec3(0, 0, 1), sizeYards: 2, age: 0, duration: 0.2))
                haptics.append(HapticPulse(intensity: 1, sharpness: 1))
            case .recovery(_, let offense):
                say(offense ? "RECOVERED!" : "TURNOVER!")
            case .ballBounce(let at, let strength):
                dust(at: Vec3(at.x, at.y, 0.05), count: Int(clamp(strength * 1.5, 2, 8)))
                haptics.append(HapticPulse(intensity: clamp(strength * 0.08, 0.1, 0.4), sharpness: 0.3))
            case .move(let id, let kind):
                let p = world.player(id).body
                switch kind {
                case .juke: turf(at: p.position, count: 9, speed: 3.5)
                case .dive: squash[id] = (1, 0.12)
                default: break
                }
                haptics.append(HapticPulse(intensity: 0.3, sharpness: 0.9))
            case .landing(let id, let at):
                squash[id] = (-1, 0.1)
                dust(at: Vec3(at.x, at.y, 0.05), count: 6)
            case .handoff, .kick, .jump:
                haptics.append(HapticPulse(intensity: 0.25, sharpness: 0.6))
            case .flag:
                say("FLAG!", 1.0)
            case .whistle(let reason, let spot):
                switch reason {
                case .touchdown:
                    say("TOUCHDOWN!", 2.2); crowdHype = 3
                    haptics.append(HapticPulse(intensity: 1, sharpness: 0.4))
                case .incomplete: if callout == nil || callout!.remaining < 0.6 { say("INCOMPLETE") }
                case .outOfBounds: say("OUT OF BOUNDS")
                case .interception, .turnover: break
                case .safety: say("SAFETY!")
                case .falseStart, .kickDead: break
                case .tackled:
                    if callout == nil || callout!.remaining < 0.8 {
                        let g = Int((spot.y - los).rounded())
                        say(g > 0 ? "GAIN OF \(g)" : g < 0 ? "LOSS OF \(-g)" : "NO GAIN")
                    }
                }
            }
        }
    }

    mutating func update(dt: Double, world: World) {
        // Particles: simple ballistic + ground friction.
        for i in particles.indices {
            particles[i].velocity.z -= particles[i].gravity * dt
            particles[i].position = particles[i].position + particles[i].velocity * dt
            if particles[i].position.z < 0 {
                particles[i].position.z = 0
                particles[i].velocity = Vec3(particles[i].velocity.x * 0.4, particles[i].velocity.y * 0.4, 0)
            }
            particles[i].life -= dt
        }
        particles.removeAll { $0.life <= 0 }
        for i in overlays.indices { overlays[i].age += dt }
        overlays.removeAll { $0.age >= $0.duration }
        for (k, v) in squash { squash[k] = v.remaining - dt > 0 ? (v.level, v.remaining - dt) : nil }
        if var c = callout { c.remaining -= dt; callout = c.remaining > 0 ? c : nil }
        crowdHype = max(0, crowdHype - dt)

        // Ball trail: sample every 2 ticks while in flight, keep ~0.15 s.
        trailTick += 1
        if world.ball.phase == .inFlight && world.ball.isForwardPass {
            if trailTick % 2 == 0 {
                trail.append(world.ball.position)
                let keep = world.ball.kind == .lob ? 14 : 9
                if trail.count > keep { trail.removeFirst(trail.count - keep) }
            }
        } else if !trail.isEmpty { trail.removeFirst() }

        // Speed lines: controlled ball carrier at top speed in open field.
        var target = 0.0
        if world.phase.isLive, let c = world.carrierID, c == world.controlledID, !world.canThrow {
            let p = world.player(c)
            let open = !world.players.contains { $0.side != p.side && $0.status.canMakePlays
                && ($0.body.position.ground - p.body.position.ground).length < 5 }
            if open && p.body.speed >= p.body.profile.topSpeed * 0.92 { target = 1 }
        }
        speedLineIntensity += (target - speedLineIntensity) * min(1, dt / 0.18)
    }

    mutating func turf(at p: Vec3, count: Int, speed: Double) {
        let colors = [Palette.turfLight.hueShifted(0.3), Palette.turfDark, Palette.dirt, Palette.dirtDark]
        for _ in 0..<count {
            let a = rng.unit() * 2 * Double.pi
            let v = Vec3(cosD(a) * speed * rng.unit(), sinD(a) * speed * rng.unit(), 1.5 + 2.5 * rng.unit())
            particles.append(Particle(position: Vec3(p.x, p.y, 0.05), velocity: v, life: 0.35 + 0.3 * rng.unit(),
                                      color: colors[rng.int(colors.count)], size: 0.07))
        }
    }

    mutating func dust(at p: Vec3, count: Int) {
        let colors = [Palette.dirtHaze, Palette.dirt, RGBA(hex: 0xF0E6D0)]
        for _ in 0..<count {
            let a = rng.unit() * 2 * Double.pi
            let s = 1 + 3 * rng.unit()
            particles.append(Particle(position: p, velocity: Vec3(cosD(a) * s, sinD(a) * s, 0.8 + 1.8 * rng.unit()),
                                      life: 0.3 + 0.35 * rng.unit(), color: colors[rng.int(colors.count)],
                                      size: 0.1, gravity: 4))
        }
    }
}
