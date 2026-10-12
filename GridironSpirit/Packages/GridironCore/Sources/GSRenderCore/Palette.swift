import GSFoundation

/// Shared world palette. Kept small so the whole screen reads as one
/// coherent 16-bit era image.
public enum Palette {
    public static let outline = RGBA(hex: 0x16102A)          // near-black, purple-shifted
    public static let turfLight = RGBA(hex: 0x3DBA41)
    public static let turfDark = RGBA(hex: 0x2E9E38)
    public static let turfSideline = RGBA(hex: 0x27863A)
    public static let turfHaze = RGBA(hex: 0x86CF8C)
    public static let line = RGBA(hex: 0xF6F4E8)
    public static let lineHaze = RGBA(hex: 0xC9E8C5)
    public static let dirt = RGBA(hex: 0xD3A062)
    public static let dirtDark = RGBA(hex: 0xB9834A)
    public static let dirtHaze = RGBA(hex: 0xD9C08E)
    public static let skyTop = RGBA(hex: 0x4FA8F0)
    public static let skyBottom = RGBA(hex: 0x9AD8FF)
    public static let wallBase = RGBA(hex: 0x1F2A4A)
    public static let wallCap = RGBA(hex: 0x6C7FB0)
    public static let letterbox = RGBA(hex: 0x0E1426)       // stadium-night border
    public static let shadow = RGBA(hex: 0x0B2410)
    public static let highlight = RGBA(hex: 0xFFE45C)
    public static let skinTones: [RGBA] = [0xF6CDA8, 0xE2A877, 0xC07D4E, 0x8C5634, 0x5E3A22].map { RGBA(hex: $0) }
    public static let crowdBright: [RGBA] = [0xFF4D4D, 0xFFD23F, 0x3FA7FF, 0xFFFFFF, 0x7CFF6B, 0xFF7AE0,
                                             0xFF9A3C, 0x9B6BFF, 0x2ED1C4, 0xE8E8E8].map { RGBA(hex: $0) }

    /// 4x4 Bayer matrix (0...15) for ordered dithering.
    public static let bayer4: [UInt8] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
    @inlinable public static func bayer(_ x: Int, _ y: Int) -> Int { Int(bayer4[(y & 3) << 2 | (x & 3)]) }
}
