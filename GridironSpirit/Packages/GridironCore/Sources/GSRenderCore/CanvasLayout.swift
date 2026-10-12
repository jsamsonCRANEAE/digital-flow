import GSFoundation

/// Maps the 640x296 canvas onto the device's drawable.
///
/// Integer scale is chosen so every canvas pixel becomes an exact NxN block.
/// The remainder is letterboxed with a border color by the presenter.
/// Coordinates are physical drawable pixels with origin top-left.
public struct CanvasLayout: Sendable, Equatable {
    public let drawableWidth: Int
    public let drawableHeight: Int
    public let scale: Int
    public let originX: Int
    public let originY: Int

    public init(drawableWidth: Int, drawableHeight: Int) {
        self.drawableWidth = max(1, drawableWidth)
        self.drawableHeight = max(1, drawableHeight)
        let s = min(self.drawableWidth / Canvas.width, self.drawableHeight / Canvas.height)
        scale = max(1, s)
        originX = (self.drawableWidth - Canvas.width * scale) / 2
        originY = (self.drawableHeight - Canvas.height * scale) / 2
    }

    public var scaledWidth: Int { Canvas.width * scale }
    public var scaledHeight: Int { Canvas.height * scale }

    /// Drawable pixel -> canvas pixel (may be outside the canvas).
    public func canvasPoint(drawableX x: Double, drawableY y: Double) -> Vec2 {
        Vec2((x - Double(originX)) / Double(scale), (y - Double(originY)) / Double(scale))
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
