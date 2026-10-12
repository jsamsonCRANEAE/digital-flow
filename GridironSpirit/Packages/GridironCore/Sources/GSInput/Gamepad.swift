import GSFoundation

/// Physical controller buttons by *position* (Apple's GameController
/// framework reports `buttonA` as the bottom face button on every brand).
public enum PadButton: Int, CaseIterable, Sendable, Hashable {
    case a, b, x, y            // bottom, right, left, top
    case l1, r1, l2, r2
    case menu, options
    case up, down, left, right
}

/// Which labels to show: the player's own controller's.
public enum PadStyle: Int, Sendable, Hashable {
    case xbox, playstation, nintendo

    public func glyph(_ b: PadButton) -> PadGlyph {
        switch (self, b) {
        case (.playstation, .a): return PadGlyph(text: "X", shape: .cross, color: RGBA(hex: 0x8FB4FF))
        case (.playstation, .b): return PadGlyph(text: "O", shape: .circle, color: RGBA(hex: 0xFF6A6A))
        case (.playstation, .x): return PadGlyph(text: "[]", shape: .square, color: RGBA(hex: 0xF28AD8))
        case (.playstation, .y): return PadGlyph(text: "^", shape: .triangle, color: RGBA(hex: 0x4FD8A8))
        case (.playstation, .l1): return PadGlyph(text: "L1", color: RGBA(hex: 0xC8CCD8))
        case (.playstation, .r1): return PadGlyph(text: "R1", color: RGBA(hex: 0xC8CCD8))
        // Nintendo prints A on the right and B at the bottom (positions are what matter).
        case (.nintendo, .a): return PadGlyph(text: "B", color: RGBA(hex: 0xE8E8F0))
        case (.nintendo, .b): return PadGlyph(text: "A", color: RGBA(hex: 0xE8E8F0))
        case (.nintendo, .x): return PadGlyph(text: "Y", color: RGBA(hex: 0xE8E8F0))
        case (.nintendo, .y): return PadGlyph(text: "X", color: RGBA(hex: 0xE8E8F0))
        case (.nintendo, .l1): return PadGlyph(text: "L", color: RGBA(hex: 0xC8CCD8))
        case (.nintendo, .r1): return PadGlyph(text: "R", color: RGBA(hex: 0xC8CCD8))
        case (_, .a): return PadGlyph(text: "A", color: RGBA(hex: 0x3FCF6A))
        case (_, .b): return PadGlyph(text: "B", color: RGBA(hex: 0xE0402A))
        case (_, .x): return PadGlyph(text: "X", color: RGBA(hex: 0x3F8CFF))
        case (_, .y): return PadGlyph(text: "Y", color: RGBA(hex: 0xFFC83C))
        case (_, .l1): return PadGlyph(text: "LB", color: RGBA(hex: 0xC8CCD8))
        case (_, .r1): return PadGlyph(text: "RB", color: RGBA(hex: 0xC8CCD8))
        default: return PadGlyph(text: "?", color: RGBA(hex: 0xC8CCD8))
        }
    }
}

/// One frame of controller state, filled by the platform layer
/// (GCExtendedGamepad on iOS) and consumed by TouchRouter / AppFlow.
public struct GamepadState: Sendable, Equatable {
    public var connected = false
    public var style: PadStyle = .xbox
    /// Left thumbstick: x right, y UP, each -1...1 (same convention as VirtualJoystick.value).
    public var stick = Vec2.zero
    public var pressed: Set<PadButton> = []
    public init(connected: Bool = false, style: PadStyle = .xbox, stick: Vec2 = .zero, pressed: Set<PadButton> = []) {
        self.connected = connected; self.style = style; self.stick = stick; self.pressed = pressed
    }

    public static let deadZone = 0.18

    /// Movement: d-pad wins if held, else the stick with a radial dead zone
    /// rescaled so motion starts smoothly at its edge. Length 0...1.
    public var move: Vec2 {
        var d = Vec2(pressed.contains(.right) ? 1 : 0, pressed.contains(.up) ? 1 : 0)
        d = d - Vec2(pressed.contains(.left) ? 1 : 0, pressed.contains(.down) ? 1 : 0)
        if d.length > 0 { return d.normalized }
        let m = min(1, stick.length)
        guard m > Self.deadZone else { return .zero }
        return stick.normalized * ((m - Self.deadZone) / (1 - Self.deadZone))
    }

    /// Dominant menu direction (screen space, y DOWN), or nil when centered.
    public var direction: Vec2? {
        let m = move
        guard m.length > 0.55 else { return nil }
        return abs(m.x) > abs(m.y) ? Vec2(m.x > 0 ? 1 : -1, 0) : Vec2(0, m.y > 0 ? -1 : 1)
    }
}

/// Edge detection between two frames of pad state.
public struct PadEdges: Sendable {
    public let down: Set<PadButton>
    public let up: Set<PadButton>
    public init(_ prev: GamepadState, _ now: GamepadState) {
        down = now.pressed.subtracting(prev.pressed)
        up = prev.pressed.subtracting(now.pressed)
    }
    public var isEmpty: Bool { down.isEmpty && up.isEmpty }
}
