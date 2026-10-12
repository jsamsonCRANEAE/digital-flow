import GameController
import GSFoundation
import GSInput

/// Reads the active Bluetooth controller (Xbox, PlayStation DualShock 4 /
/// DualSense, Switch Pro, or any MFi "extended gamepad") through Apple's
/// GameController framework, once per frame, as a platform-free GamepadState.
/// Controllers paired in iOS Settings > Bluetooth connect automatically.
final class GamepadInput {
    private var observers: [NSObjectProtocol] = []
    private(set) var controller: GCController?

    init() {
        let nc = NotificationCenter.default
        for name in [Notification.Name.GCControllerDidConnect, .GCControllerDidDisconnect, .GCControllerDidBecomeCurrent] {
            observers.append(nc.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in self?.refresh() })
        }
        refresh()
    }

    deinit { for o in observers { NotificationCenter.default.removeObserver(o) } }

    private func refresh() {
        controller = GCController.current ?? GCController.controllers().first { $0.extendedGamepad != nil }
    }

    func poll() -> GamepadState {
        guard let c = controller, let g = c.extendedGamepad else { return GamepadState() }
        var pressed = Set<PadButton>()
        func add(_ b: GCControllerButtonInput?, _ k: PadButton) { if b?.isPressed == true { pressed.insert(k) } }
        add(g.buttonA, .a); add(g.buttonB, .b); add(g.buttonX, .x); add(g.buttonY, .y)
        add(g.leftShoulder, .l1); add(g.rightShoulder, .r1); add(g.leftTrigger, .l2); add(g.rightTrigger, .r2)
        add(g.buttonMenu, .menu); add(g.buttonOptions, .options)
        add(g.dpad.up, .up); add(g.dpad.down, .down); add(g.dpad.left, .left); add(g.dpad.right, .right)
        let stick = Vec2(Double(g.leftThumbstick.xAxis.value), Double(g.leftThumbstick.yAxis.value))
        return GamepadState(connected: true, style: Self.style(of: c), stick: stick, pressed: pressed)
    }

    /// Picks on-screen glyphs that match the player's own controller.
    static func style(of c: GCController) -> PadStyle {
        if let g = c.extendedGamepad, g is GCDualShockGamepad || g is GCDualSenseGamepad { return .playstation }
        let cat = c.productCategory.lowercased()
        if cat.contains("switch") || cat.contains("joy-con") || cat.contains("nintendo") { return .nintendo }
        return .xbox
    }
}
