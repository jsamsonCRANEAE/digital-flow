import GSFoundation

/// Floating virtual joystick. Lives in internal-canvas pixel space (y down).
/// The base appears where the thumb lands; dragging past the radius pulls the
/// base along so the stick never "runs out" of travel.
public struct VirtualJoystick: Sendable {
    public struct Config: Sendable {
        public var radius: Double = 22          // canvas px (~66 pt at 3x)
        public var deadZone: Double = 0.14      // fraction of radius
        public var followDrag: Bool = true
        public init() {}
    }

    public var config: Config
    public private(set) var touchID: Int?
    public private(set) var base: Vec2 = .zero
    public private(set) var knob: Vec2 = .zero
    var bounds = Rect(minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9)

    public init(config: Config = Config()) { self.config = config }

    public var isActive: Bool { touchID != nil }

    /// Output in screen-oriented space: x right, y UP, length 0...1,
    /// with radial dead zone rescaled so motion starts smoothly at its edge.
    public var value: Vec2 {
        guard isActive else { return .zero }
        let d = knob - base
        let m = clamp(d.length / config.radius, 0, 1)
        guard m > config.deadZone else { return .zero }
        let scaled = (m - config.deadZone) / (1 - config.deadZone)
        let dir = d.normalized
        return Vec2(dir.x, -dir.y) * scaled
    }

    /// Starts tracking. `bounds` keeps the base fully inside the safe area.
    public mutating func began(id: Int, at p: Vec2, bounds: Rect) {
        guard touchID == nil else { return }
        touchID = id
        self.bounds = bounds
        base = clampedToBounds(p)
        knob = p
        clampKnob()
    }

    public mutating func moved(id: Int, to p: Vec2) {
        guard id == touchID else { return }
        knob = p
        clampKnob()
    }

    public mutating func ended(id: Int) {
        guard id == touchID else { return }
        touchID = nil
        knob = base
    }

    mutating func clampKnob() {
        let d = knob - base
        let l = d.length
        guard l > config.radius else { return }
        if config.followDrag {
            base = clampedToBounds(knob - d * (config.radius / l))
        }
        let d2 = knob - base
        let l2 = d2.length
        if l2 > config.radius { knob = base + d2 * (config.radius / l2) }
    }

    /// Keeps the whole base circle inside the safe area.
    func clampedToBounds(_ p: Vec2) -> Vec2 {
        let r = config.radius
        return Vec2(clamp(p.x, bounds.minX + r, max(bounds.minX + r, bounds.maxX - r)),
                    clamp(p.y, bounds.minY + r, max(bounds.minY + r, bounds.maxY - r)))
    }
}
