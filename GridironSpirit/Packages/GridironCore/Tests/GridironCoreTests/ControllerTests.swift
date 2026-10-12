import XCTest
@testable import GSFoundation
@testable import GSData
@testable import GSInput
@testable import GSGame
@testable import GSAudio
@testable import GSUI
@testable import GSRenderCore

final class ControllerTests: XCTestCase {
    func pad(_ b: PadButton..., stick: Vec2 = .zero, style: PadStyle = .xbox) -> GamepadState {
        GamepadState(connected: true, style: style, stick: stick, pressed: Set(b))
    }

    // MARK: Router mapping

    func testContextButtonsMapToFaceButtonsWithGlyphs() {
        var r = TouchRouter(safeArea: Canvas.bounds)
        r.context = .preSnap
        r.spiritReady = true
        r.handle(pad: pad())
        r.handle(pad: pad(.a))
        XCTAssertEqual(r.drainCommands(), [.button(.snap)])
        XCTAssertEqual(r.padStyle, .xbox)
        XCTAssertEqual(r.buttons.first { $0.action == .snap }?.padGlyph?.text, "A")
        XCTAssertEqual(r.buttons.first { $0.action == .spirit }?.padGlyph?.text, "Y")
        r.handle(pad: pad(.a))                     // held: no repeat
        XCTAssertTrue(r.drainCommands().isEmpty)
        r.handle(pad: pad(.a, .r1))
        XCTAssertEqual(r.drainCommands(), [.button(.spirit)], "R1 is a Spirit shortcut")
        r.context = .ballCarrier
        r.handle(pad: pad())
        r.handle(pad: pad(.x))
        r.handle(pad: pad(.a))
        XCTAssertEqual(r.drainCommands(), [.button(.juke), .button(.dive)])
        // Touch takes over: glyphs go away.
        r.handle(TouchEvent(id: 1, phase: .began, location: Vec2(100, 100)))
        XCTAssertNil(r.padStyle)
        XCTAssertNil(r.buttons.first?.padGlyph)
    }

    func testReceiverButtonsTapForBulletHoldForLob() {
        var r = TouchRouter(safeArea: Canvas.bounds)
        r.context = .passing
        r.icons = [ReceiverIcon(receiverID: 7, center: Vec2(300, 100), slot: 0),
                   ReceiverIcon(receiverID: 9, center: Vec2(400, 100), slot: 1)]
        r.now = 1
        r.handle(pad: pad(.b))
        XCTAssertEqual(r.charging?.receiverID, 9)
        r.now = 1.05
        r.handle(pad: pad())
        XCTAssertEqual(r.drainCommands(), [.throwTo(receiver: 9, lob: false)])
        r.now = 2
        r.handle(pad: pad(.a))
        r.now = 2.4
        r.handle(pad: pad(.a))
        r.handle(pad: pad())
        XCTAssertEqual(r.drainCommands(), [.throwTo(receiver: 7, lob: true)])
        r.handle(pad: pad(.y))                      // no receiver in slot 3
        r.handle(pad: pad())
        XCTAssertTrue(r.drainCommands().isEmpty)
    }

    func testPlayCallKickAndReplay() {
        var r = TouchRouter(safeArea: Canvas.bounds)
        r.context = .playCall
        r.cardRects = [Rect(x: 0, y: 0, width: 10, height: 10), Rect(x: 20, y: 0, width: 10, height: 10), Rect(x: 40, y: 0, width: 10, height: 10)]
        r.handle(pad: pad())
        r.handle(pad: pad(.r1)); r.handle(pad: pad())
        r.handle(pad: pad(stick: Vec2(-1, 0))); r.handle(pad: pad(stick: Vec2(-1, 0)))   // flick once = one page
        r.handle(pad: pad(.x)); r.handle(pad: pad(.b))
        XCTAssertEqual(r.drainCommands(), [.page(1), .page(-1), .selectCard(0), .selectCard(2)])
        r.context = .kick
        r.handle(pad: pad()); r.handle(pad: pad(.a))
        r.context = .replay
        r.handle(pad: pad()); r.handle(pad: pad(.b))
        XCTAssertEqual(r.drainCommands(), [.kickTap, .skip])
    }

    func testStickDeadZoneDpadAndGlyphStyles() {
        XCTAssertEqual(pad(stick: Vec2(0.1, 0.1)).move, .zero)
        XCTAssertEqual(pad(stick: Vec2(0, 1)).move.y, 1, accuracy: 1e-9)
        XCTAssertEqual(pad(stick: Vec2(0, 0.59)).move.y, 0.5, accuracy: 1e-9, "rescaled past the dead zone")
        XCTAssertEqual(pad(.up, .right).move.length, 1, accuracy: 1e-9)
        XCTAssertEqual(PadStyle.playstation.glyph(.a).shape, .cross)
        XCTAssertEqual(PadStyle.nintendo.glyph(.a).text, "B", "Nintendo labels the bottom button B")
        XCTAssertEqual(PadStyle.xbox.glyph(.y).text, "Y")
    }

    // MARK: Full match with a controller

    func testPlayAPassingDownWithTheController() throws {
        let rt = GameRuntime(league: try DataLoader.bundledLeague())
        rt.debugCall(offense: "slants", defense: "cover3")
        rt.handle(pad: pad())
        _ = rt.advance(frameTime: 1 / 60)
        rt.handle(pad: pad(.a))                     // SNAP
        for _ in 0..<40 { _ = rt.advance(frameTime: 1 / 60); rt.handle(pad: pad()) }
        XCTAssertEqual(rt.world.carrierID, rt.world.quarterback?.id)
        let y0 = rt.world.controlled.body.position.y
        for _ in 0..<30 { rt.handle(pad: pad(stick: Vec2(0, -1))); _ = rt.advance(frameTime: 1 / 60) }   // drop back
        XCTAssertLessThan(rt.world.controlled.body.position.y, y0 - 1, "stick moves the QB")
        let f = rt.advance(frameTime: 1 / 60)
        XCTAssertEqual(f.padStyle, .xbox)
        XCTAssertFalse(f.icons.isEmpty)
        XCTAssertEqual(f.receiverGlyph(slot: 0)?.text, "A")
        rt.handle(pad: pad(.a)); _ = rt.advance(frameTime: 1 / 60)
        rt.handle(pad: pad()); _ = rt.advance(frameTime: 1 / 60)
        for _ in 0..<20 { _ = rt.advance(frameTime: 1 / 60) }
        XCTAssertTrue(rt.world.ball.isForwardPass, "A threw to receiver slot 0")
    }

    // MARK: Menus

    func step(_ flow: AppFlow, _ p: GamepadState, frames: Int = 1) {
        for _ in 0..<frames { flow.handle(pad: p); _ = flow.advance(frameTime: 1 / 60) }
    }

    func testMenusAreFullyDrivableByController() throws {
        let flow = AppFlow(league: try DataLoader.bundledLeague(), gear: try DataLoader.bundledGear(), savedProfile: nil,
                           persist: { _ in }, audio: AudioCore(), seed: 4)
        step(flow, pad(), frames: 30)
        step(flow, pad(.a)); step(flow, pad())
        XCTAssertEqual(flow.screen, .mainMenu)
        XCTAssertTrue(flow.controllerActive)
        XCTAssertEqual(flow.currentFocus(), "exhibition")
        step(flow, pad(.down)); step(flow, pad())
        XCTAssertEqual(flow.focusID, "cup")
        step(flow, pad(.down)); step(flow, pad())
        step(flow, pad(.a)); step(flow, pad())
        XCTAssertEqual(flow.screen, .shop)
        XCTAssertTrue(flow.focusID?.hasPrefix("item.") ?? false)
        step(flow, pad(.right)); step(flow, pad())
        XCTAssertEqual(flow.shopSelected, "cleat2", "moving focus previews the item")
        step(flow, pad(.r1)); step(flow, pad())
        XCTAssertEqual(flow.shopCategory, .gloves)
        step(flow, pad(.b)); step(flow, pad())
        XCTAssertEqual(flow.screen, .mainMenu)
        // Settings: left/right on a row changes the value.
        flow.tap("settings")
        step(flow, pad())
        let m = flow.profile.settings.music
        step(flow, pad(.left)); step(flow, pad())
        XCTAssertEqual(flow.profile.settings.music, m - 1)
        step(flow, pad(.b)); step(flow, pad())
        // Into a match and pause with Menu.
        flow.tap("exhibition"); step(flow, pad())
        XCTAssertEqual(flow.currentFocus(), "play")
        step(flow, pad(.a)); step(flow, pad())
        XCTAssertEqual(flow.screen, .game)
        step(flow, pad(.menu)); step(flow, pad())
        XCTAssertEqual(flow.screen, .pause)
        step(flow, pad(.b)); step(flow, pad())
        XCTAssertEqual(flow.screen, .game)
        // Holding a direction repeats after a delay.
        flow.tap("pause"); flow.tap("quit"); step(flow, pad())
        step(flow, pad(.down), frames: 40)          // 0.66 s: first move + repeats
        XCTAssertEqual(flow.focusID, "settings", "repeat walked to the last button and stopped")
    }

    func testDisconnectFallsBackToTouch() throws {
        let flow = AppFlow(league: try DataLoader.bundledLeague(), gear: try DataLoader.bundledGear(), savedProfile: nil,
                           persist: { _ in }, audio: nil, seed: 4)
        step(flow, pad(), frames: 30); step(flow, pad(.a)); step(flow, pad())
        XCTAssertTrue(flow.controllerActive)
        step(flow, GamepadState())
        XCTAssertFalse(flow.controllerActive)
    }
}
