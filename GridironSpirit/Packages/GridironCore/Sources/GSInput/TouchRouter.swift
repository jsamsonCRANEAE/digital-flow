import GSFoundation

/// Platform-agnostic touch event (already converted to canvas pixels).
public struct TouchEvent: Sendable {
    public enum Phase: Sendable { case began, moved, ended }
    public var id: Int
    public var phase: Phase
    public var location: Vec2
    public init(id: Int, phase: Phase, location: Vec2) { self.id = id; self.phase = phase; self.location = location }
}

/// Routes touches to controls. Events are applied immediately as they arrive
/// from UIKit; the simulation samples `state` at its next fixed tick, so input
/// is never older than one 8.3 ms tick when the frame is built.
public struct TouchRouter: Sendable {
    public var joystick = VirtualJoystick()
    /// Safe area in canvas pixels (excludes notch / Dynamic Island / home bar).
    public var safeArea: Rect
    /// Fraction of the safe area width that belongs to the joystick side.
    public var joystickZoneFraction = 0.5
    /// Touch ids that started on the right side (buttons, M2+).
    public private(set) var rightSideTouches: [Int: Vec2] = [:]
    /// Count of right-side taps; M1 uses it as a debug screen-shake trigger.
    public private(set) var rightTapCount = 0

    public init(safeArea: Rect) { self.safeArea = safeArea }

    public var joystickZone: Rect {
        Rect(minX: safeArea.minX, minY: safeArea.minY,
             maxX: safeArea.minX + safeArea.width * joystickZoneFraction, maxY: safeArea.maxY)
    }

    public mutating func handle(_ e: TouchEvent) {
        switch e.phase {
        case .began:
            if !joystick.isActive && e.location.x < joystickZone.maxX {
                joystick.began(id: e.id, at: e.location, bounds: joystickZone)
            } else {
                rightSideTouches[e.id] = e.location
            }
        case .moved:
            joystick.moved(id: e.id, to: e.location)
            if rightSideTouches[e.id] != nil { rightSideTouches[e.id] = e.location }
        case .ended:
            joystick.ended(id: e.id)
            if rightSideTouches.removeValue(forKey: e.id) != nil { rightTapCount += 1 }
        }
    }

    /// Joystick mapped to world space. The camera always sits behind the
    /// offense looking toward +y, so screen-up is downfield and screen-right is +x.
    public var worldMove: Vec2 { joystick.value }
}
