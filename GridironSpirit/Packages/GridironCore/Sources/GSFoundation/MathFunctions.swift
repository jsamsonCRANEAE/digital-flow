#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

// Thin wrappers so the rest of the core never imports platform libc directly.
@inlinable public func sinD(_ x: Double) -> Double { sin(x) }
@inlinable public func cosD(_ x: Double) -> Double { cos(x) }
@inlinable public func tanD(_ x: Double) -> Double { tan(x) }
@inlinable public func atanD(_ x: Double) -> Double { atan(x) }
@inlinable public func atan2Safe(_ y: Double, _ x: Double) -> Double { (x == 0 && y == 0) ? 0 : atan2(y, x) }
@inlinable public func expD(_ x: Double) -> Double { exp(x) }
@inlinable public func powD(_ x: Double, _ y: Double) -> Double { pow(x, y) }
