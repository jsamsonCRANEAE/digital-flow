import GSFoundation

/// CPU-side 32-bit image, top-left origin, 0xAARRGGBB pixels
/// (= bgra8Unorm in memory). Used for procedural art and the field.
public struct PixelBuffer: Sendable {
    public let width: Int
    public let height: Int
    public var pixels: [UInt32]

    public init(width: Int, height: Int, fill: RGBA = .clear) {
        self.width = width
        self.height = height
        pixels = [UInt32](repeating: fill.argb, count: width * height)
    }

    @inlinable public func contains(_ x: Int, _ y: Int) -> Bool { x >= 0 && y >= 0 && x < width && y < height }

    @inlinable public subscript(x: Int, y: Int) -> UInt32 {
        get { pixels[y * width + x] }
        set { pixels[y * width + x] = newValue }
    }

    public func color(_ x: Int, _ y: Int) -> RGBA { RGBA(argb: self[x, y]) }

    @inlinable public mutating func set(_ x: Int, _ y: Int, _ c: RGBA) {
        guard contains(x, y) else { return }
        pixels[y * width + x] = c.argb
    }

    public func isOpaque(_ x: Int, _ y: Int) -> Bool { contains(x, y) && (self[x, y] >> 24) != 0 }

    public mutating func fill(_ c: RGBA) {
        for i in pixels.indices { pixels[i] = c.argb }
    }

    public mutating func fillRect(x: Int, y: Int, width w: Int, height h: Int, _ c: RGBA) {
        let x0 = max(0, x), y0 = max(0, y), x1 = min(width, x + w), y1 = min(height, y + h)
        guard x0 < x1, y0 < y1 else { return }
        for yy in y0..<y1 { for xx in x0..<x1 { pixels[yy * width + xx] = c.argb } }
    }

    /// Ellipse test at pixel centers, so shapes are symmetric on the grid.
    public mutating func fillEllipse(cx: Double, cy: Double, rx: Double, ry: Double, _ c: RGBA) {
        guard rx > 0, ry > 0 else { return }
        let x0 = Int((cx - rx).rounded(.down)), x1 = Int((cx + rx).rounded(.up))
        let y0 = Int((cy - ry).rounded(.down)), y1 = Int((cy + ry).rounded(.up))
        for y in y0...y1 {
            for x in x0...x1 {
                let dx = (Double(x) + 0.5 - cx) / rx, dy = (Double(y) + 0.5 - cy) / ry
                if dx * dx + dy * dy <= 1 { set(x, y, c) }
            }
        }
    }

    /// Alpha-tested blit (pixels with alpha 0 are skipped).
    public mutating func blit(_ src: PixelBuffer, x: Int, y: Int) {
        for sy in 0..<src.height {
            for sx in 0..<src.width {
                let v = src[sx, sy]
                if v >> 24 != 0 { set(x + sx, y + sy, RGBA(argb: v)) }
            }
        }
    }

    /// Adds a 1 px outline around every opaque region (4-neighbourhood),
    /// the standard pixel-art silhouette treatment.
    public mutating func addOutline(_ c: RGBA) {
        var out = self
        for y in 0..<height {
            for x in 0..<width where !isOpaque(x, y) {
                if isOpaque(x - 1, y) || isOpaque(x + 1, y) || isOpaque(x, y - 1) || isOpaque(x, y + 1) {
                    out[x, y] = c.argb
                }
            }
        }
        self = out
    }

    public mutating func drawText(_ text: String, x: Int, y: Int, _ c: RGBA, shadow: RGBA? = nil) {
        if let shadow {
            PixelFont.draw(text, into: &self, x: x + 1, y: y + 1, shadow)
        }
        PixelFont.draw(text, into: &self, x: x, y: y, c)
    }

    public var distinctOpaqueColors: Int {
        Set(pixels.filter { $0 >> 24 != 0 }).count
    }
}
