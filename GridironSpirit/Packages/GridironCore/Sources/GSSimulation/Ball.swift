import GSFoundation

public enum ThrowKind: Int, Sendable, Hashable {
    /// Tap: flat, fast, minimum-time trajectory.
    case bullet
    /// Hold and release: high touch pass over coverage.
    case lob
}

public enum BallPhase: Sendable, Equatable {
    case held(by: Int)
    case inFlight
    case loose
}

/// Physical constants for a regulation football, in yards / seconds.
///
/// Drag is quadratic: a = -k |v| v with k = rho * Cd * A / (2 m).
/// With rho = 1.2 kg/m^3, A = 0.0186 m^2 (11 in long, about 6.7 in across),
/// m = 0.41 kg and Cd of about 0.1 for a tight spiral (nose roughly into the
/// wind), k is about 0.0027 per metre, or 0.0025 per yard. A wobbling or
/// tumbling ball presents more of its side, so its drag rises several-fold.
/// These are tunable approximations, not measured constants.
public enum BallPhysics {
    public static let gravity = 32.17 / 3          // 10.72 yd/s^2
    public static let spiralDrag = 0.0025           // per yard
    public static let maxWobbleDragFactor = 3.0     // duck: up to 4x spiral drag
    public static let tumbleDragFactor = 2.2        // end-over-end kicks, loose balls
    public static let groundZ = 0.09                // ball resting half-thickness
    public static let rollFriction = 5.5            // yd/s^2 sliding / rolling
    /// Spiral spin rate (~600 rpm) for the visual laces cycle.
    public static let spiralRate = 63.0
}

public struct BallEvents: OptionSet, Sendable {
    public let rawValue: UInt8
    public init(rawValue: UInt8) { self.rawValue = rawValue }
    public static let groundContact = BallEvents(rawValue: 1 << 0)
    public static let bounced = BallEvents(rawValue: 1 << 1)
    public static let cameToRest = BallEvents(rawValue: 1 << 2)
}

public struct Ball: Sendable {
    public var phase: BallPhase
    public var position: Vec3
    public var velocity: Vec3 = .zero
    /// Roll angle around the long axis (spiral), visual only.
    public var spin: Double = 0
    public var spinRate: Double = 0
    /// Long-axis angle from horizontal. Controls how the ball meets the turf.
    public var pitch: Double = 0
    /// Nonzero = tumbling end over end (kicks, loose balls).
    public var pitchRate: Double = 0
    /// 0 = tight spiral ... 1 = ugly duck. Raises drag and causes yaw wobble.
    public var wobble: Double = 0
    public var airTime: Double = 0
    public var isForwardPass = false
    public var thrower: Int?
    public var target: Int?
    public var kind: ThrowKind?
    public var lastBounceStrength: Double = 0

    public init(heldBy id: Int, at p: Vec3) {
        phase = .held(by: id)
        position = p
    }

    public var holder: Int? { if case .held(let id) = phase { return id }; return nil }
    public var isOnGround: Bool { position.z <= BallPhysics.groundZ + 1e-6 && abs(velocity.z) < 1e-6 }

    public mutating func launch(from p: Vec3, velocity v: Vec3, wobble w: Double, tumbling: Bool) {
        phase = .inFlight
        position = p
        velocity = v
        wobble = clamp(w, 0, 1)
        airTime = 0
        spinRate = tumbling ? 0 : BallPhysics.spiralRate * (1 - 0.6 * wobble)
        pitchRate = tumbling ? 12 : 0
    }

    var dragCoefficient: Double {
        pitchRate != 0 ? BallPhysics.spiralDrag * BallPhysics.tumbleDragFactor
                       : BallPhysics.spiralDrag * (1 + BallPhysics.maxWobbleDragFactor * wobble)
    }

    /// Acceleration from gravity and drag relative to the wind.
    static func acceleration(velocity v: Vec3, wind: Vec2, k: Double) -> Vec3 {
        let rel = Vec3(v.x - wind.x, v.y - wind.y, v.z)
        let s = rel.length
        return Vec3(-k * s * rel.x, -k * s * rel.y, -k * s * rel.z - BallPhysics.gravity)
    }

    /// Advances an airborne or loose ball. Held balls are positioned by the world.
    public mutating func step(dt: Double, wind: Vec2, rng: inout SplitMix64) -> BallEvents {
        var ev: BallEvents = []
        guard holder == nil else { return ev }
        spin += spinRate * dt

        let airborne = position.z > BallPhysics.groundZ + 1e-6 || velocity.z > 0
        if airborne {
            airTime += dt
            // Semi-implicit Euler: update velocity, then position.
            let a = Self.acceleration(velocity: velocity, wind: wind, k: dragCoefficient)
            velocity = velocity + a * dt
            // A wobbling ball yaws: small lateral force that oscillates.
            if wobble > 0.05 && pitchRate == 0 {
                let side = Vec2(-velocity.y, velocity.x).normalized
                let f = sinD(airTime * 17) * wobble * 2.2
                velocity.x += side.x * f * dt
                velocity.y += side.y * f * dt
            }
            position = position + velocity * dt
            if pitchRate != 0 {
                pitch += pitchRate * dt
            } else {
                // A spiral's nose follows its flight path.
                pitch = atan2Safe(velocity.z, velocity.ground.length) + sinD(airTime * 19) * wobble * 0.5
            }
            if position.z <= BallPhysics.groundZ && velocity.z < 0 {
                position.z = BallPhysics.groundZ
                ev.insert(.groundContact)
                bounce(rng: &rng)
                ev.insert(.bounced)
            }
        } else {
            ev.formUnion(roll(dt: dt, rng: &rng))
        }
        return ev
    }

    /// Prolate-spheroid ground contact. How the ball lands decides everything:
    /// a point-first landing ("tip") pops high and kicks off at a sharp random
    /// angle, while a belly landing skids low and mostly keeps its line. The
    /// tumble rate is re-rolled on every contact, so consecutive hops never
    /// look the same. A round ball would just reflect.
    mutating func bounce(rng: inout SplitMix64) {
        let tip = abs(sinD(pitch))                       // 1 = long axis vertical
        let vz = -velocity.z
        let h = velocity.ground
        let hs = h.length
        lastBounceStrength = vz
        let restitution = lerp(0.18, 0.62, tip) * (0.85 + 0.3 * rng.unit())
        var newVz = vz * restitution + hs * 0.22 * tip * rng.unit()   // tips convert run into hop
        let deflect = rng.signed() * lerp(0.12, 1.25, tip)
        let keep = lerp(0.82, 0.48, tip) * (0.9 + 0.2 * rng.unit())
        let dir = hs > 1e-6 ? h.angle + deflect : rng.unit() * 2 * Double.pi
        let newH = Vec2.fromAngle(dir, length: hs * keep)
        if newVz < 0.7 { newVz = 0 }                     // too weak to leave the ground
        velocity = Vec3(newH.x, newH.y, newVz)
        // Re-randomise tumble: sign flips, magnitude depends on contact.
        pitchRate = (rng.unit() < 0.5 ? -1 : 1) * (4 + 16 * rng.unit()) * (0.3 + tip)
        spinRate *= 0.3
        if newVz == 0 { position.z = BallPhysics.groundZ }
    }

    /// Rolling on the ground. A prolate ball rocks end over end as it rolls,
    /// so its path curves and it occasionally catches a point and hops.
    mutating func roll(dt: Double, rng: inout SplitMix64) -> BallEvents {
        var ev: BallEvents = []
        var h = velocity.ground
        let s = h.length
        guard s > 0.25 else {
            if s > 0 { ev.insert(.cameToRest) }
            velocity = .zero
            pitchRate = 0
            return ev
        }
        // End-over-end rocking advances with distance rolled.
        pitch += (pitchRate >= 0 ? 1 : -1) * s * dt / 0.12
        // Curved path while rolling on its belly.
        let curve = sinD(pitch * 0.5) * 0.9 * (pitchRate >= 0 ? 1 : -1)
        h = Vec2.fromAngle(h.angle + curve * dt, length: max(0, s - BallPhysics.rollFriction * dt))
        velocity = Vec3(h.x, h.y, 0)
        position.x += h.x * dt
        position.y += h.y * dt
        // Tip catches the turf: irregular little hop.
        if abs(sinD(pitch)) > 0.985 && s > 2.2 && rng.unit() < 0.5 {
            velocity.z = s * (0.15 + 0.25 * rng.unit())
            position.z = BallPhysics.groundZ + 1e-3
            ev.insert(.bounced)
        }
        return ev
    }
}
