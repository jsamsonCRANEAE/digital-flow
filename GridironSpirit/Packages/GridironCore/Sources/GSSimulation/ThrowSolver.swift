import GSFoundation

/// Solves launch velocities for passes and snaps, including receiver lead,
/// air drag and wind, by shooting: aim with the vacuum solution, simulate
/// with drag, and correct the aim point by the miss. Fully deterministic.
public enum ThrowSolver {
    public struct Solution: Sendable {
        public var velocity: Vec3
        public var flightTime: Double
        /// Where the receiver should be when the ball arrives.
        public var catchPoint: Vec3
    }

    public static let catchHeight = 1.35
    static let dt = 1.0 / 120

    /// Velocity that reaches `target` after `time` in a vacuum.
    static func vacuumVelocity(from p: Vec3, to target: Vec3, time t: Double) -> Vec3 {
        let g = BallPhysics.gravity
        return Vec3((target.x - p.x) / t, (target.y - p.y) / t, (target.z - p.z + 0.5 * g * t * t) / t)
    }

    /// Integrates a flight exactly as Ball does and returns the position at `time`.
    public static func positionAfter(_ time: Double, from p: Vec3, velocity v: Vec3, wobble: Double, wind: Vec2) -> Vec3 {
        var pos = p, vel = v
        let k = BallPhysics.spiralDrag * (1 + BallPhysics.maxWobbleDragFactor * wobble)
        var t = 0.0
        while t < time - 1e-9 {
            let h = min(dt, time - t)          // last partial step lands exactly on `time`
            vel = vel + Ball.acceleration(velocity: vel, wind: wind, k: k) * h
            pos = pos + vel * h
            t += h
        }
        return pos
    }

    /// First point where a flight descends through height `z` (or hits the ground).
    public static func descentPoint(through z: Double, from p: Vec3, velocity v: Vec3, wobble: Double, wind: Vec2,
                                    maxTime: Double = 8) -> (point: Vec3, time: Double) {
        var pos = p, vel = v, t = 0.0
        let k = BallPhysics.spiralDrag * (1 + BallPhysics.maxWobbleDragFactor * wobble)
        while t < maxTime {
            vel = vel + Ball.acceleration(velocity: vel, wind: wind, k: k) * dt
            let next = pos + vel * dt
            t += dt
            if vel.z < 0 && next.z <= z {
                let f = (pos.z - z) / max(1e-9, pos.z - next.z)
                return (lerp(pos, next, f), t)
            }
            if next.z <= BallPhysics.groundZ { return (next, t) }
            pos = next
        }
        return (pos, t)
    }

    /// - Parameters:
    ///   - maxSpeed: the passer's arm strength (yd/s).
    public static func solve(from release: Vec3, receiver: Vec2, receiverVelocity: Vec2, kind: ThrowKind,
                             maxSpeed: Double, wind: Vec2 = .zero) -> Solution {
        func flightTime(for d: Double) -> Double {
            switch kind {
            case .bullet: return max(0.25, d / (maxSpeed * 0.9))
            case .lob: return 0.75 + d / (maxSpeed * 0.62)
            }
        }
        // Lead the receiver: iterate time <-> lead point.
        var lead = receiver
        var t = 0.0
        for _ in 0..<5 {
            t = flightTime(for: (lead - release.ground).length)
            lead = clampToPlayable(receiver + receiverVelocity * t)   // lead always matches final t
        }
        // A long bullet may exceed the arm: stretch time until it fits.
        var target = Vec3(lead, z: catchHeight)
        var v = vacuumVelocity(from: release, to: target, time: t)
        var guardCount = 0
        while v.length > maxSpeed * 1.02 && guardCount < 60 {
            // Past the vacuum minimum-speed time (sqrt(2)*d/v-ish) speed grows again; cap.
            let dHoriz = (target.ground - release.ground).length
            if t > 1.6 * dHoriz / maxSpeed + 0.5 { break }
            t *= 1.04
            lead = clampToPlayable(receiver + receiverVelocity * t)
            target = Vec3(lead, z: catchHeight)
            v = vacuumVelocity(from: release, to: target, time: t)
            guardCount += 1
        }
        // Shooting correction for drag and wind.
        var aim = target
        for _ in 0..<12 {
            v = vacuumVelocity(from: release, to: aim, time: t)
            let p = positionAfter(t, from: release, velocity: v, wobble: 0, wind: wind)
            let miss = target - p
            aim = aim + miss
            if miss.length < 0.02 { break }
        }
        v = vacuumVelocity(from: release, to: aim, time: t)
        return Solution(velocity: v, flightTime: t, catchPoint: target)
    }

    static func clampToPlayable(_ p: Vec2) -> Vec2 {
        Vec2(clamp(p.x, 0.5, 160.0 / 3 - 0.5), clamp(p.y, 0.5, 119.5))
    }

    /// Passer error: angular and speed noise that grows with pressure and
    /// with lower accuracy. Returns the perturbed velocity and a wobble amount.
    public static func applyError(_ v: Vec3, accuracy: Int, pressure: Double, kind: ThrowKind,
                                  rng: inout SplitMix64) -> (velocity: Vec3, wobble: Double) {
        let acc = Double(clamp(accuracy, 1, 99)) / 99
        let p = clamp(pressure, 0, 1)
        let sigmaDeg = lerp(3.2, 0.5, acc) * (1 + 2.2 * p) * (kind == .lob ? 1.3 : 1)
        let yaw = rng.gaussian() * sigmaDeg * Double.pi / 180
        let speedErr = 1 + rng.gaussian() * lerp(0.05, 0.012, acc) * (1 + 1.5 * p)
        let h = v.ground
        let hv = Vec2.fromAngle(h.angle + yaw, length: h.length * speedErr)
        let vz = v.z * (1 + rng.gaussian() * 0.03 * (1 + 2 * p))
        let wobble = clamp(p * 0.85 + (1 - acc) * 0.25 + rng.unit() * 0.1 * p, 0, 1)
        return (Vec3(hv.x, hv.y, vz), wobble)
    }
}

/// Kick launch from the meter: power 0...1, elevation angle and aim yaw.
/// The HUD meter arrives with special teams in M3; the physics is here so
/// wind and drag behave identically for passes and kicks.
public enum KickPhysics {
    public static func launchVelocity(power: Double, elevationDegrees: Double, yaw: Double, legRating: Int) -> Vec3 {
        let leg = Double(clamp(legRating, 1, 99)) / 99
        let speed = lerp(12, 31, clamp(power, 0, 1)) * (0.82 + 0.18 * leg)
        let el = elevationDegrees * Double.pi / 180
        let h = Vec2.fromAngle(yaw, length: speed * cosD(el))
        return Vec3(h.x, h.y, speed * sinD(el))
    }

    /// Where a kicked (tumbling) ball first lands.
    public static func landing(from p: Vec3, velocity v: Vec3, wind: Vec2) -> Vec3 {
        var ball = Ball(heldBy: -1, at: p)
        ball.launch(from: p, velocity: v, wobble: 0, tumbling: true)
        var rng = SplitMix64(seed: 1)
        for _ in 0..<(120 * 10) {
            if ball.step(dt: 1.0 / 120, wind: wind, rng: &rng).contains(.groundContact) { return ball.position }
        }
        return ball.position
    }
}
