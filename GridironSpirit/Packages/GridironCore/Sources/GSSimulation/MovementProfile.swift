import GSFoundation
import GSData

/// Physical movement parameters derived from ratings. All speeds in yd/s,
/// accelerations in yd/s^2, turn rates in rad/s.
public struct MovementProfile: Sendable, Equatable {
    public var topSpeed: Double
    public var acceleration: Double
    public var deceleration: Double
    /// Max turn rate when nearly stationary (sharp cuts possible).
    public var turnRateSlow: Double
    /// Max turn rate at top speed (heavy players turn wide here).
    public var turnRateFast: Double
    /// 0 = lightest skill player, 1 = heaviest lineman.
    public var massFactor: Double
    public var mass: Double
    /// Collider radius on the ground plane.
    public var radius: Double

    public init(topSpeed: Double, acceleration: Double, deceleration: Double,
                turnRateSlow: Double, turnRateFast: Double, massFactor: Double, mass: Double, radius: Double) {
        self.topSpeed = topSpeed; self.acceleration = acceleration; self.deceleration = deceleration
        self.turnRateSlow = turnRateSlow; self.turnRateFast = turnRateFast
        self.massFactor = massFactor; self.mass = mass; self.radius = radius
    }

    public static func from(_ r: PlayerRatings) -> MovementProfile {
        func n(_ v: Int) -> Double { Double(clamp(v, 1, 99)) / 99 }
        let massFactor = clamp((Double(r.weightLbs) - 180) / 140, 0, 1)
        let top = 6.8 + n(r.speed) * 3.4                          // 7.1 ... 10.2 yd/s (~14.5-21 mph)
        let accel = 5.0 + n(r.acceleration) * 9.0 - massFactor * 1.5
        let slow = 7.0 + n(r.agility) * 8.0                        // rad/s
        // Momentum: heavy bodies lose most of their turning ability at speed.
        let fast = slow * lerp(0.42, 0.16, massFactor)
        return MovementProfile(topSpeed: top,
                               acceleration: accel,
                               deceleration: accel * 1.5 + 2.0 + n(r.balance) * 2.0,
                               turnRateSlow: slow,
                               turnRateFast: fast,
                               massFactor: massFactor,
                               mass: Double(r.weightLbs),
                               radius: 0.42 + massFactor * 0.22)
    }
}
