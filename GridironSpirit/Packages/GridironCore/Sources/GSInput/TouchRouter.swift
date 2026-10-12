import GSFoundation

/// Platform-agnostic touch event (already converted to canvas pixels).
public struct TouchEvent: Sendable {
    public enum Phase: Sendable { case began, moved, ended }
    public var id: Int
    public var phase: Phase
    public var location: Vec2
    public init(id: Int, phase: Phase, location: Vec2) { self.id = id; self.phase = phase; self.location = location }
}

/// What the right-hand buttons mean right now.
public enum ControlContext: Sendable, Equatable {
    case preSnap        // SNAP / AUDIBLE / SPIRIT
    case passing        // receiver icons are live; buttons idle
    case ballCarrier    // JUKE / SPIN / STIFF ARM, swipe up = DIVE
    case defense        // SWITCH / DIVE TACKLE / JUMP
    case playCall       // play cards: tap to call, swipe to page
    case kick           // tap anywhere to stop the meter
    case none
}

public enum ButtonAction: Sendable, Equatable {
    case snap, audible, spirit, juke, spin, stiffArm, dive
    case switchPlayer, diveTackle, jump
}

/// Discrete commands produced by touches, drained by the game each tick.
public enum InputCommand: Sendable, Equatable {
    case button(ButtonAction)
    case throwTo(receiver: Int, lob: Bool)
    case selectCard(Int)
    case page(Int)
    case kickTap
}

public struct ButtonSlot: Sendable, Equatable {
    public var center: Vec2
    public var radius: Double
    public var action: ButtonAction?
    public var label: String
    public var enabled: Bool
    public var pressed: Bool
}

/// A receiver icon drawn above a target's head (canvas px).
public struct ReceiverIcon: Sendable, Equatable {
    public var receiverID: Int
    public var center: Vec2
    public var slot: Int
    public init(receiverID: Int, center: Vec2, slot: Int) { self.receiverID = receiverID; self.center = center; self.slot = slot }
}

/// Routes touches to controls. Events are applied the moment UIKit delivers
/// them; the simulation drains commands at its next fixed tick, so input is
/// never older than one 8.3 ms tick when the next frame is built.
public struct TouchRouter: Sendable {
    public var joystick = VirtualJoystick()
    /// Safe area in canvas pixels (excludes notch / Dynamic Island / home bar).
    public var safeArea: Rect { didSet { layoutButtons() } }
    /// 44 pt expressed in canvas pixels for this device (set by the app).
    public var minTouchSize: Double = 44 { didSet { layoutButtons() } }
    public var joystickZoneFraction = 0.5
    public var context: ControlContext = .none { didSet { if context != oldValue { layoutButtons() } } }
    public private(set) var buttons: [ButtonSlot] = []
    public var icons: [ReceiverIcon] = []
    /// Play-call card hit rects (canvas px), set by the game.
    public var cardRects: [Rect] = []
    var swipeStart: (id: Int, at: Vec2)?
    /// Held receiver icon (for lob charge feedback).
    public private(set) var charging: (receiverID: Int, since: Double)?
    public var now: Double = 0
    public static let lobHoldThreshold = 0.18

    var buttonTouches: [Int: (index: Int, start: Vec2, time: Double, swiped: Bool)] = [:]
    var iconTouch: (id: Int, receiver: Int, time: Double)?
    var commands: [InputCommand] = []

    public init(safeArea: Rect) {
        self.safeArea = safeArea
        layoutButtons()
    }

    public var joystickZone: Rect {
        Rect(minX: safeArea.minX, minY: safeArea.minY,
             maxX: safeArea.minX + safeArea.width * joystickZoneFraction, maxY: safeArea.maxY)
    }

    /// Three buttons in a thumb arc at the bottom-right of the safe area.
    mutating func layoutButtons() {
        let r = max(22, minTouchSize / 2)
        let m = 6.0
        // Primary (A) is lowest-right under the thumb's rest position; B sits
        // to its left, C above-left, forming an arc. All fully inside the safe area.
        let a = Vec2(safeArea.maxX - r - m, safeArea.maxY - r - m - 4)
        let b = Vec2(a.x - 2 * r - 8, a.y + 2)
        let c = Vec2(a.x - r * 0.9, a.y - 2 * r - 6)
        func inside(_ p: Vec2) -> Vec2 {
            Vec2(clamp(p.x, safeArea.minX + r + 2, safeArea.maxX - r - 2),
                 clamp(p.y, safeArea.minY + r + 2, safeArea.maxY - r - 2))
        }
        let spec: [(ButtonAction?, String, Bool)]
        switch context {
        case .preSnap: spec = [(.snap, "SNAP", true), (.audible, "AUDBL", false), (.spirit, "SPRT", false)]
        case .ballCarrier: spec = [(.juke, "JUKE", true), (.spin, "SPIN", true), (.stiffArm, "STIFF", true)]
        case .defense: spec = [(.diveTackle, "DIVE", true), (.switchPlayer, "SWTCH", true), (.jump, "JUMP", true)]
        case .passing, .none, .playCall, .kick: spec = [(nil, "", false), (nil, "", false), (nil, "", false)]
        }
        let pressed = Set(buttonTouches.values.map(\.index))
        buttons = zip([inside(a), inside(b), inside(c)], spec).enumerated().map { i, pair in
            ButtonSlot(center: pair.0, radius: r, action: pair.1.0, label: pair.1.1, enabled: pair.1.2,
                       pressed: pressed.contains(i))
        }
    }

    public mutating func drainCommands() -> [InputCommand] {
        defer { commands.removeAll(keepingCapacity: true) }
        return commands
    }

    public mutating func handle(_ e: TouchEvent) {
        if context == .playCall { return handleCards(e) }
        if context == .kick {
            if e.phase == .began { commands.append(.kickTap) }
            return
        }
        switch e.phase {
        case .began:
            if context == .passing, iconTouch == nil, let icon = hitIcon(e.location) {
                iconTouch = (e.id, icon.receiverID, now)
                charging = (icon.receiverID, now)
            } else if let i = hitButton(e.location) {
                buttonTouches[e.id] = (i, e.location, now, false)
                if buttons[i].enabled, let act = buttons[i].action { commands.append(.button(act)) }  // fire on press
                buttons[i].pressed = true
            } else if !joystick.isActive && e.location.x < joystickZone.maxX {
                joystick.began(id: e.id, at: e.location, bounds: joystickZone)
            }
        case .moved:
            joystick.moved(id: e.id, to: e.location)
            if var t = buttonTouches[e.id] {
                // Swipe up on any carrier button = dive.
                if !t.swiped && context == .ballCarrier && t.start.y - e.location.y > 16 && now - t.time < 0.35 {
                    t.swiped = true
                    commands.append(.button(.dive))
                }
                buttonTouches[e.id] = t
            }
        case .ended:
            joystick.ended(id: e.id)
            if let t = buttonTouches.removeValue(forKey: e.id), buttons.indices.contains(t.index) {
                buttons[t.index].pressed = false
            }
            if let it = iconTouch, it.id == e.id {
                let lob = now - it.time >= Self.lobHoldThreshold
                commands.append(.throwTo(receiver: it.receiver, lob: lob))
                iconTouch = nil
                charging = nil
            }
        }
    }

    /// Cards: tap = call the play, horizontal swipe = next/previous page.
    mutating func handleCards(_ e: TouchEvent) {
        switch e.phase {
        case .began: swipeStart = (e.id, e.location)
        case .moved:
            if let s = swipeStart, s.id == e.id, abs(e.location.x - s.at.x) > 40 {
                commands.append(.page(e.location.x < s.at.x ? 1 : -1))
                swipeStart = nil
            }
        case .ended:
            if let s = swipeStart, s.id == e.id {
                if let i = cardRects.firstIndex(where: { $0.contains(s.at) }) { commands.append(.selectCard(i)) }
                swipeStart = nil
            }
        }
    }

    func hitButton(_ p: Vec2) -> Int? {
        buttons.indices.filter { buttons[$0].action != nil }
            .min { (buttons[$0].center - p).length < (buttons[$1].center - p).length }
            .flatMap { (buttons[$0].center - p).length <= buttons[$0].radius + 4 ? $0 : nil }
    }

    /// Icons are small on screen but get a full 44 pt hit target; overlaps go
    /// to the nearest icon.
    func hitIcon(_ p: Vec2) -> ReceiverIcon? {
        let r = max(minTouchSize / 2, 14)
        return icons.filter { ($0.center - p).length <= r }.min { ($0.center - p).length < ($1.center - p).length }
    }

    /// Joystick mapped to world space. The camera always sits behind the
    /// offense looking toward +y, so screen-up is downfield and screen-right is +x.
    public var worldMove: Vec2 { joystick.value }
}
