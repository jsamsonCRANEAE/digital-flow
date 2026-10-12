/// Axis-aligned rectangle in canvas pixels (y down).
public struct Rect: Sendable, Equatable {
    public var minX, minY, maxX, maxY: Double
    public init(minX: Double, minY: Double, maxX: Double, maxY: Double) {
        self.minX = minX; self.minY = minY; self.maxX = maxX; self.maxY = maxY
    }
    public init(x: Double, y: Double, width: Double, height: Double) {
        self.init(minX: x, minY: y, maxX: x + width, maxY: y + height)
    }
    public var width: Double { maxX - minX }
    public var height: Double { maxY - minY }
    public func contains(_ p: Vec2) -> Bool { p.x >= minX && p.x < maxX && p.y >= minY && p.y < maxY }
}
