import GSFoundation

public struct MovementEvents: OptionSet, Sendable {
    public let rawValue: UInt8
    public init(rawValue: UInt8) { self.rawValue = rawValue }
    /// Planted foot on a hard cut: spawn turf particles, play cleat SFX.
    public static let hardCut = MovementEvents(rawValue: 1 << 0)
    /// Crossed into the top-speed band this tick (anime speed lines in M4).
    public static let reachedTopSpeed = MovementEvents(rawValue: 1 << 1)
}

/// Kinematic body for a player on the ground plane with height.
/// Velocity is integrated with explicit Euler at the fixed sim rate (120 Hz),
/// which is stable for these first-order steering dynamics.
public struct PlayerBody: Sendable {
    public var position: Vec3
    public var velocity: Vec2
    public var verticalVelocity: Double = 0
    /// Direction the body faces (radians); follows velocity while moving.
    public var facing: Double
    /// Monotonic stride phase; one unit = one animation frame.
    public var stridePhase: Double = 0
    public var profile: MovementProfile
    var cutCooldown: Double = 0
    var wasAtTopSpeed = false

    public init(position: Vec2, facing: Double, profile: MovementProfile) {
        self.position = Vec3(position)
        self.velocity = .zero
        self.facing = facing
        self.profile = profile
    }

    public var speed: Double { velocity.length }
    public var isAirborne: Bool { position.z > 0 || verticalVelocity > 0 }
    public var speedFraction: Double { speed / profile.topSpeed }

    static let gravity = 32.17 / 3   // yd/s^2
    /// Direction changes sharper than this (~115 deg) require a full plant.
    static let plantAngle = 2.0

    /// Steers toward `intent` (desired direction * throttle, length <= 1).
    @discardableResult
    public mutating func step(intent rawIntent: Vec2, dt: Double, speedScale: Double = 1) -> MovementEvents {
        var events: MovementEvents = []
        var p = profile
        p.topSpeed *= speedScale
        let intent = rawIntent.clampedLength(1)
        let throttle = intent.length
        var speed = velocity.length
        var heading = speed > 0.05 ? velocity.angle : facing
        var targetSpeed = 0.0

        if throttle > 0.01 {
            let desiredSpeed = throttle * p.topSpeed
            let desiredHeading = intent.angle
            let diff = wrapAngle(desiredHeading - heading)
            if speed < 0.6 {
                // Nearly standing: can pivot almost freely.
                heading = desiredHeading
                targetSpeed = desiredSpeed
            } else {
                let frac = clamp(speed / p.topSpeed, 0, 1)
                let maxTurn = lerp(p.turnRateSlow, p.turnRateFast, frac) * dt
                // Near-reversals plant first (brake in a straight line), then pivot;
                // shallower cuts carve an arc whose radius grows with speed and mass.
                let turn = abs(diff) > Self.plantAngle ? 0 : clamp(diff, -maxTurn, maxTurn)
                heading = wrapAngle(heading + turn)
                let remaining = abs(diff - turn)
                // Can't turn that sharply at this speed: brake to plant and cut.
                // Aligned => full speed; 90+ degrees off => come to a stop.
                let alignment = remaining >= Double.pi / 2 ? 0 : cosD(remaining)
                targetSpeed = desiredSpeed * alignment * alignment
                if remaining > 0.9 && frac > 0.45 && cutCooldown <= 0 {
                    events.insert(.hardCut)
                    cutCooldown = 0.25
                }
            }
        }

        if targetSpeed > speed {
            // Acceleration tapers as we approach top speed.
            let taper = 1 - 0.55 * clamp(speed / p.topSpeed, 0, 1)
            speed = min(targetSpeed, speed + p.acceleration * taper * dt)
        } else {
            speed = max(targetSpeed, speed - p.deceleration * dt)
        }

        velocity = Vec2.fromAngle(heading, length: speed)
        if speed > 0.05 { facing = heading }

        position.x += velocity.x * dt
        position.y += velocity.y * dt
        if position.z > 0 || verticalVelocity > 0 {
            verticalVelocity -= Self.gravity * dt
            position.z = max(0, position.z + verticalVelocity * dt)
            if position.z == 0 { verticalVelocity = 0 }
        }
        position.x = clamp(position.x, -Field.runoff, Field.width + Field.runoff)
        position.y = clamp(position.y, -Field.runoff, Field.length + Field.runoff)

        // ~2.1 strides per second per yd/s, scaled so animation reads well.
        stridePhase += speed * dt * 0.95
        cutCooldown = max(0, cutCooldown - dt)

        let atTop = speed >= profile.topSpeed * 0.94
        if atTop && !wasAtTopSpeed { events.insert(.reachedTopSpeed) }
        wasAtTopSpeed = atTop
        return events
    }

    /// Simple hop used by tests and, later, by jump-to-deflect.
    public mutating func jump(verticalSpeed: Double) {
        guard position.z == 0 else { return }
        verticalVelocity = verticalSpeed
        position.z = 1e-6
    }
}
