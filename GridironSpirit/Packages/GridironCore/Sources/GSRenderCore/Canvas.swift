import GSFoundation

/// The fixed internal resolution. Everything (field, sprites, UI text) is
/// rendered at this size and then integer-upscaled with nearest filtering.
/// 640x296 = 2.162:1, matching modern notched iPhones in landscape.
public enum Canvas {
    public static let width = 640
    public static let height = 296
    public static var bounds: Rect { Rect(x: 0, y: 0, width: Double(width), height: Double(height)) }
}

/// Rounds a continuous screen coordinate onto the pixel grid. Every sprite
/// position goes through here *after* interpolation, so nothing is ever drawn
/// at a sub-pixel offset (no shimmer when moving slowly).
@inlinable public func snapToPixel(_ v: Double) -> Int { Int((v + 0.5).rounded(.down)) }
