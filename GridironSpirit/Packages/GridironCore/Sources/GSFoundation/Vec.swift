/// 2D vector on the ground plane. World units are yards:
/// x = lateral (0 = left sideline, 53.33 = right sideline),
/// y = downfield (0 = back of home end zone, 120 = back of away end zone).
public struct Vec2: Hashable, Codable, Sendable {
    public var x: Double
    public var y: Double

    public init(_ x: Double, _ y: Double) { self.x = x; self.y = y }

    public static let zero = Vec2(0, 0)

    public var length: Double { (x * x + y * y).squareRoot() }
    public var lengthSquared: Double { x * x + y * y }
    /// Heading in radians, 0 = +x, pi/2 = +y (downfield).
    public var angle: Double { atan2Safe(y, x) }

    public var normalized: Vec2 {
        let l = length
        return l > 1e-9 ? Vec2(x / l, y / l) : .zero
    }

    public func clampedLength(_ maxLength: Double) -> Vec2 {
        let l = length
        return l > maxLength && l > 0 ? self * (maxLength / l) : self
    }

    public func dot(_ o: Vec2) -> Double { x * o.x + y * o.y }
    public func cross(_ o: Vec2) -> Double { x * o.y - y * o.x }

    public static func fromAngle(_ a: Double, length: Double = 1) -> Vec2 {
        Vec2(cosD(a) * length, sinD(a) * length)
    }

    public static func + (a: Vec2, b: Vec2) -> Vec2 { Vec2(a.x + b.x, a.y + b.y) }
    public static func - (a: Vec2, b: Vec2) -> Vec2 { Vec2(a.x - b.x, a.y - b.y) }
    public static func * (a: Vec2, s: Double) -> Vec2 { Vec2(a.x * s, a.y * s) }
    public static func / (a: Vec2, s: Double) -> Vec2 { Vec2(a.x / s, a.y / s) }
    public static prefix func - (a: Vec2) -> Vec2 { Vec2(-a.x, -a.y) }
    public static func += (a: inout Vec2, b: Vec2) { a = a + b }
    public static func -= (a: inout Vec2, b: Vec2) { a = a - b }
}

/// World position: ground plane (x, y) plus height z (yards, up).
public struct Vec3: Hashable, Codable, Sendable {
    public var x: Double
    public var y: Double
    public var z: Double

    public init(_ x: Double, _ y: Double, _ z: Double) { self.x = x; self.y = y; self.z = z }
    public init(_ g: Vec2, z: Double = 0) { self.x = g.x; self.y = g.y; self.z = z }

    public static let zero = Vec3(0, 0, 0)
    public var ground: Vec2 { Vec2(x, y) }
    public var length: Double { (x * x + y * y + z * z).squareRoot() }
    public func dot(_ o: Vec3) -> Double { x * o.x + y * o.y + z * o.z }

    public static func + (a: Vec3, b: Vec3) -> Vec3 { Vec3(a.x + b.x, a.y + b.y, a.z + b.z) }
    public static func - (a: Vec3, b: Vec3) -> Vec3 { Vec3(a.x - b.x, a.y - b.y, a.z - b.z) }
    public static func * (a: Vec3, s: Double) -> Vec3 { Vec3(a.x * s, a.y * s, a.z * s) }
}

@inlinable public func lerp(_ a: Double, _ b: Double, _ t: Double) -> Double { a + (b - a) * t }
@inlinable public func lerp(_ a: Vec2, _ b: Vec2, _ t: Double) -> Vec2 { Vec2(lerp(a.x, b.x, t), lerp(a.y, b.y, t)) }
@inlinable public func lerp(_ a: Vec3, _ b: Vec3, _ t: Double) -> Vec3 {
    Vec3(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t))
}
@inlinable public func clamp<T: Comparable>(_ v: T, _ lo: T, _ hi: T) -> T { min(max(v, lo), hi) }

/// Wraps an angle into (-pi, pi].
@inlinable public func wrapAngle(_ a: Double) -> Double {
    var r = a.truncatingRemainder(dividingBy: 2 * Double.pi)
    if r > Double.pi { r -= 2 * Double.pi }
    if r <= -Double.pi { r += 2 * Double.pi }
    return r
}

/// Interpolates angles along the shortest arc.
@inlinable public func lerpAngle(_ a: Double, _ b: Double, _ t: Double) -> Double {
    wrapAngle(a + wrapAngle(b - a) * t)
}
