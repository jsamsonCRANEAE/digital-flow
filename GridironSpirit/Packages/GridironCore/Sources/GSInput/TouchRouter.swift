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
    case defensePreSnap // SPIRIT / SWITCH
    case replay         // tap anywhere to skip
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
    case skip
}

public struct ButtonSlot: Sendable, Equatable {
    public var center: Vec2
    public var radius: Double
    public var action: ButtonAction?
    public var label: String
    public var enabled: Bool
    public var pressed: Bool
    /// Controller button that fires this slot (shown as a badge while a pad is in use).
    public var padGlyph: PadGlyph? = nil
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
    /// Spirit meter full: lights up the SPIRIT button.
    public var spiritReady = false { didSet { if spiritReady != oldValue { layoutButtons() } } }
    public static let lobHoldThreshold = 0.18

    // Controller.
    /// Non-nil while the player is using a controller (drives on-screen glyphs).
    public private(set) var padStyle: PadStyle? { didSet { if padStyle != oldValue { layoutButtons() } } }
    var lastPad = GamepadState()
    var padMove = Vec2.zero
    var padCharge: (button: PadButton, receiver: Int, time: Double)?
    var padHeld: Set<PadButton> = []
    /// Receiver icon slot -> face button (console-football convention).
    public static let receiverButtons: [PadButton] = [.a, .b, .x, .y, .r1]
    /// Context action -> button. Positions are consistent across brands.
    public static func padButton(for a: ButtonAction) -> PadButton {
        switch a {
        case .snap, .diveTackle, .dive: return .a
        case .switchPlayer, .spin: return .b
        case .audible, .juke: return .x
        case .spirit, .stiffArm, .jump: return .y
        }
    }

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
        case .preSnap: spec = [(.snap, "SNAP", true), (.audible, "AUDBL", false), (.spirit, "SPRT", spiritReady)]
        case .defensePreSnap: spec = [(.spirit, "SPRT", spiritReady), (.switchPlayer, "SWTCH", true), (nil, "", false)]
        case .ballCarrier: spec = [(.juke, "JUKE", true), (.spin, "SPIN", true), (.stiffArm, "STIFF", true)]
        case .defense: spec = [(.diveTackle, "DIVE", true), (.switchPlayer, "SWTCH", true), (.jump, "JUMP", true)]
        case .passing, .none, .playCall, .kick, .replay: spec = [(nil, "", false), (nil, "", false), (nil, "", false)]
        }
        let pressed = Set(buttonTouches.values.map(\.index))
        buttons = zip([inside(a), inside(b), inside(c)], spec).enumerated().map { i, pair in
            let act = pair.1.0
            let held = act.map { padHeld.contains(Self.padButton(for: $0)) } ?? false
            return ButtonSlot(center: pair.0, radius: r, action: act, label: pair.1.1, enabled: pair.1.2,
                              pressed: pressed.contains(i) || held,
                              padGlyph: act.flatMap { a in padStyle.map { $0.glyph(Self.padButton(for: a)) } })
        }
    }

    public mutating func drainCommands() -> [InputCommand] {
        defer { commands.removeAll(keepingCapacity: true) }
        return commands
    }

    public mutating func handle(_ e: TouchEvent) {
        if e.phase == .began { padStyle = nil }          // back to touch: show touch UI
        if context == .playCall { return handleCards(e) }
        if context == .kick {
            if e.phase == .began { commands.append(.kickTap) }
            return
        }
        if context == .replay {
            if e.phase == .began { commands.append(.skip) }
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
    /// A controller stick/d-pad in use overrides the touch joystick.
    public var worldMove: Vec2 { padMove.length > 0 ? padMove : joystick.value }

    // MARK: Controller

    /// Call once per frame with the current controller state. Press edges
    /// become the same InputCommands touches produce, so gameplay code
    /// doesn't know (or care) which device is in use.
    public mutating func handle(pad: GamepadState) {
        let prev = lastPad
        lastPad = pad
        guard pad.connected else {
            padMove = .zero; padCharge = nil
            if padStyle != nil { padStyle = nil }
            return
        }
        let e = PadEdges(prev, pad)
        padMove = pad.move
        if !e.down.isEmpty || padMove.length > 0.3 { padStyle = pad.style }
        if context != .passing, padCharge != nil { padCharge = nil; charging = nil }
        let dirNow = pad.direction, dirPrev = prev.direction

        switch context {
        case .playCall:
            if e.down.contains(.l1) || e.down.contains(.left) || (dirNow?.x == -1 && dirPrev?.x != -1) { commands.append(.page(-1)) }
            if e.down.contains(.r1) || e.down.contains(.right) || (dirNow?.x == 1 && dirPrev?.x != 1) { commands.append(.page(1)) }
            // Cards read left -> right as X / A / B (the face buttons' own layout).
            for (i, b) in [PadButton.x, .a, .b].enumerated() where e.down.contains(b) && i < cardRects.count {
                commands.append(.selectCard(i))
            }
        case .kick:
            if e.down.contains(.a) { commands.append(.kickTap) }
        case .replay:
            if e.down.contains(.a) || e.down.contains(.b) { commands.append(.skip) }
        case .passing:
            if padCharge == nil {
                for (slot, b) in Self.receiverButtons.enumerated() where e.down.contains(b) {
                    if let icon = icons.first(where: { $0.slot == slot }) {
                        padCharge = (b, icon.receiverID, now)
                        charging = (icon.receiverID, now)
                        break
                    }
                }
            } else if let c = padCharge, e.up.contains(c.button) {
                // Tap = bullet, hold = lob: same threshold as touch.
                commands.append(.throwTo(receiver: c.receiver, lob: now - c.time >= Self.lobHoldThreshold))
                padCharge = nil
                charging = nil
            }
        default:
            for slot in buttons where slot.enabled {
                guard let act = slot.action else { continue }
                if e.down.contains(Self.padButton(for: act)) { commands.append(.button(act)) }
            }
            if context == .ballCarrier && e.down.contains(.a) { commands.append(.button(.dive)) }
            // Shoulder shortcut for the Spirit Play.
            if e.down.contains(.r1), buttons.contains(where: { $0.action == .spirit && $0.enabled }) { commands.append(.button(.spirit)) }
        }
        let held = pad.pressed
        if held != padHeld { padHeld = held; layoutButtons() }
    }
}
