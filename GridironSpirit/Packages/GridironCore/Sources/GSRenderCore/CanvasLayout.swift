import GSFoundation

/// Maps the 640x296 canvas onto the device's drawable.
///
/// Integer scale is chosen so every canvas pixel becomes an exact NxN block.
/// The remainder is letterboxed with a border color by the presenter.
/// Coordinates are physical drawable pixels with origin top-left.
public struct CanvasLayout: Sendable, Equatable {
    public let drawableWidth: Int
    public let drawableHeight: Int
    /// Integer part of the scale (the exact scale in pixel-perfect mode).
    public let scale: Int
    /// Actual canvas-to-drawable scale: equals `scale` in pixel-perfect mode,
    /// fractional in sharp-fit mode (fills the screen; the shader keeps texel
    /// interiors solid and blends only the 1-pixel seams).
    public let pixelScale: Double
    public let sharpFit: Bool
    public let originX: Int
    public let originY: Int

    public init(drawableWidth: Int, drawableHeight: Int, sharpFit: Bool = false) {
        self.drawableWidth = max(1, drawableWidth)
        self.drawableHeight = max(1, drawableHeight)
        let s = min(self.drawableWidth / Canvas.width, self.drawableHeight / Canvas.height)
        scale = max(1, s)
        let fit = min(Double(self.drawableWidth) / Double(Canvas.width), Double(self.drawableHeight) / Double(Canvas.height))
        // Sharp fit only helps when it is meaningfully bigger than the integer scale.
        self.sharpFit = sharpFit && fit > Double(scale) + 0.05
        pixelScale = self.sharpFit ? fit : Double(scale)
        originX = (self.drawableWidth - Self.scaledWidth(pixelScale)) / 2
        originY = (self.drawableHeight - Self.scaledHeight(pixelScale)) / 2
    }

    private static func scaledWidth(_ s: Double) -> Int { Int((Double(Canvas.width) * s).rounded(.down)) }
    private static func scaledHeight(_ s: Double) -> Int { Int((Double(Canvas.height) * s).rounded(.down)) }
    public var scaledWidth: Int { Self.scaledWidth(pixelScale) }
    public var scaledHeight: Int { Self.scaledHeight(pixelScale) }

    /// Drawable pixel -> canvas pixel (may be outside the canvas).
    public func canvasPoint(drawableX x: Double, drawableY y: Double) -> Vec2 {
        Vec2((x - Double(originX)) / pixelScale, (y - Double(originY)) / pixelScale)
    }

    /// Safe area (given as insets in drawable pixels) expressed in canvas
    /// pixels, intersected with the canvas. UI must stay inside this rect.
    public func safeRect(insetTop: Double, insetLeft: Double, insetBottom: Double, insetRight: Double) -> Rect {
        let tl = canvasPoint(drawableX: insetLeft, drawableY: insetTop)
        let br = canvasPoint(drawableX: Double(drawableWidth) - insetRight,
                             drawableY: Double(drawableHeight) - insetBottom)
        return Rect(minX: clamp(tl.x.rounded(.up), 0, Double(Canvas.width)),
                    minY: clamp(tl.y.rounded(.up), 0, Double(Canvas.height)),
                    maxX: clamp(br.x.rounded(.down), 0, Double(Canvas.width)),
                    maxY: clamp(br.y.rounded(.down), 0, Double(Canvas.height)))
    }
}
