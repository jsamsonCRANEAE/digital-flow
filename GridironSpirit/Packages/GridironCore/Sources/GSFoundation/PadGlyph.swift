/// How one controller button is labeled on screen (letter or PlayStation-style
/// shape, in the button's color). Lives here so input, game and render
/// modules can all pass it around.
public struct PadGlyph: Sendable, Hashable {
    public enum Shape: Sendable, Hashable { case cross, circle, square, triangle }
    public var text: String
    public var shape: Shape?
    public var color: RGBA
    public init(text: String, shape: Shape? = nil, color: RGBA) { self.text = text; self.shape = shape; self.color = color }
}
