/// 32-bit color stored as 0xAARRGGBB. In little-endian memory that is
/// B, G, R, A, i.e. exactly MTLPixelFormat.bgra8Unorm, so CPU-rasterized
/// buffers can be uploaded to Metal without swizzling.
public struct RGBA: Hashable, Codable, Sendable {
    public var argb: UInt32

    public init(argb: UInt32) { self.argb = argb }
    public init(r: UInt8, g: UInt8, b: UInt8, a: UInt8 = 255) {
        argb = UInt32(a) << 24 | UInt32(r) << 16 | UInt32(g) << 8 | UInt32(b)
    }
    /// 0xRRGGBB, opaque.
    public init(hex: UInt32) { argb = 0xFF00_0000 | (hex & 0x00FF_FFFF) }

    /// Parses "#RRGGBB" or "RRGGBB".
    public init?(hexString: String) {
        var s = Substring(hexString)
        if s.hasPrefix("#") { s = s.dropFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(hex: v)
    }

    public static let clear = RGBA(argb: 0)

    public var a: UInt8 { UInt8(truncatingIfNeeded: argb >> 24) }
    public var r: UInt8 { UInt8(truncatingIfNeeded: argb >> 16) }
    public var g: UInt8 { UInt8(truncatingIfNeeded: argb >> 8) }
    public var b: UInt8 { UInt8(truncatingIfNeeded: argb) }

    public var hexString: String {
        let v = argb & 0x00FF_FFFF
        let s = String(v, radix: 16, uppercase: true)
        return "#" + String(repeating: "0", count: 6 - s.count) + s
    }

    // MARK: HSV and hue-shifted shading

    /// h in [0, 360), s and v in [0, 1].
    public var hsv: (h: Double, s: Double, v: Double) {
        let rf = Double(r) / 255, gf = Double(g) / 255, bf = Double(b) / 255
        let mx = max(rf, gf, bf), mn = min(rf, gf, bf), d = mx - mn
        var h = 0.0
        if d > 0 {
            if mx == rf { h = 60 * ((gf - bf) / d).truncatingRemainder(dividingBy: 6) }
            else if mx == gf { h = 60 * ((bf - rf) / d + 2) }
            else { h = 60 * ((rf - gf) / d + 4) }
        }
        if h < 0 { h += 360 }
        return (h, mx == 0 ? 0 : d / mx, mx)
    }

    public init(h: Double, s: Double, v: Double, a: UInt8 = 255) {
        let hh = (h.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360) / 60
        let c = v * s, x = c * (1 - abs(hh.truncatingRemainder(dividingBy: 2) - 1)), m = v - c
        let (r1, g1, b1): (Double, Double, Double)
        switch Int(hh) {
        case 0: (r1, g1, b1) = (c, x, 0)
        case 1: (r1, g1, b1) = (x, c, 0)
        case 2: (r1, g1, b1) = (0, c, x)
        case 3: (r1, g1, b1) = (0, x, c)
        case 4: (r1, g1, b1) = (x, 0, c)
        default: (r1, g1, b1) = (c, 0, x)
        }
        func q(_ f: Double) -> UInt8 { UInt8(clamp((f + m) * 255, 0, 255).rounded()) }
        self.init(r: q(r1), g: q(g1), b: q(b1), a: a)
    }

    /// Pixel-art shading: shadows darken and rotate hue toward blue/purple,
    /// highlights brighten and rotate toward yellow (amount in [-1, 1]).
    public func hueShifted(_ amount: Double) -> RGBA {
        var (h, s, v) = hsv
        let target = amount < 0 ? 250.0 : 55.0
        let t = abs(amount)
        var dh = target - h
        if dh > 180 { dh -= 360 }
        if dh < -180 { dh += 360 }
        h += dh * 0.35 * t
        if amount < 0 {
            v *= 1 - 0.38 * t
            s = min(1, s + 0.12 * t)
        } else {
            v = min(1, v + (1 - v) * 0.6 * t + 0.08 * t)
            s *= 1 - 0.25 * t
        }
        return RGBA(h: h, s: s, v: v, a: a)
    }

    public func mixed(with o: RGBA, _ t: Double) -> RGBA {
        func m(_ a: UInt8, _ b: UInt8) -> UInt8 { UInt8(clamp(lerp(Double(a), Double(b), t).rounded(), 0, 255)) }
        return RGBA(r: m(r, o.r), g: m(g, o.g), b: m(b, o.b), a: m(a, o.a))
    }
}
