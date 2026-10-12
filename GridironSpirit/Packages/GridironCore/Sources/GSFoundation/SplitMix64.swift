/// Small deterministic RNG (SplitMix64). Same seed => same sequence on every
/// platform, which keeps procedural art and simulation reproducible.
public struct SplitMix64: RandomNumberGenerator, Sendable {
    public private(set) var state: UInt64

    public init(seed: UInt64) { state = seed }

    public mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }

    /// Uniform in [0, 1).
    public mutating func unit() -> Double { Double(next() >> 11) * (1.0 / 9_007_199_254_740_992.0) }

    /// Uniform integer in [0, upperBound).
    public mutating func int(_ upperBound: Int) -> Int {
        precondition(upperBound > 0)
        return Int(next() % UInt64(upperBound))
    }

    /// Uniform in [-1, 1).
    public mutating func signed() -> Double { unit() * 2 - 1 }

    /// Standard normal sample (Box-Muller).
    public mutating func gaussian() -> Double {
        let u1 = max(unit(), 1e-12), u2 = unit()
        return (-2 * logD(u1)).squareRoot() * cosD(2 * Double.pi * u2)
    }

    /// Stateless hash of a few integers, for per-pixel noise without a stream.
    public static func hash(_ a: Int, _ b: Int = 0, _ c: Int = 0) -> UInt64 {
        var r = SplitMix64(seed: UInt64(bitPattern: Int64(a)) &* 0x9E37_79B1
                             ^ UInt64(bitPattern: Int64(b)) &* 0x85EB_CA77
                             ^ UInt64(bitPattern: Int64(c)) &* 0xC2B2_AE3D)
        return r.next()
    }
}
