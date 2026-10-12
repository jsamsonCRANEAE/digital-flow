import XCTest
@testable import GSFoundation
@testable import GSInput

final class InputTests: XCTestCase {
    let safe = Rect(x: 20, y: 0, width: 600, height: 296)

    func testJoystickFloatsWhereThumbLands() {
        var r = TouchRouter(safeArea: safe)
        r.handle(TouchEvent(id: 1, phase: .began, location: Vec2(120, 200)))
        XCTAssertTrue(r.joystick.isActive)
        XCTAssertEqual(r.joystick.base, Vec2(120, 200))
        XCTAssertEqual(r.worldMove, .zero)
    }

    func testJoystickUpIsDownfield() {
        var r = TouchRouter(safeArea: safe)
        r.handle(TouchEvent(id: 1, phase: .began, location: Vec2(120, 200)))
        r.handle(TouchEvent(id: 1, phase: .moved, location: Vec2(120, 150)))   // screen up
        XCTAssertEqual(r.worldMove.y, 1, accuracy: 1e-9)
        XCTAssertEqual(r.worldMove.x, 0, accuracy: 1e-9)
    }

    func testDeadZoneAndClamp() {
        var j = VirtualJoystick()
        j.began(id: 1, at: Vec2(100, 100), bounds: safe)
        j.moved(id: 1, to: Vec2(102, 100))
        XCTAssertEqual(j.value, .zero)
        j.moved(id: 1, to: Vec2(300, 100))
        XCTAssertEqual(j.value.length, 1, accuracy: 1e-9)
        // Base was dragged along: pulling back a little immediately reverses.
        j.moved(id: 1, to: Vec2(300 - 2 * j.config.radius, 100))
        XCTAssertLessThan(j.value.x, -0.9)
    }

    func testBaseStaysInsideSafeArea() {
        var r = TouchRouter(safeArea: safe)
        r.handle(TouchEvent(id: 7, phase: .began, location: Vec2(21, 290)))
        let b = r.joystick.base, rad = r.joystick.config.radius
        XCTAssertGreaterThanOrEqual(b.x - rad, safe.minX)
        XCTAssertLessThanOrEqual(b.y + rad, safe.maxY)
    }

    func testRightSideTouchDoesNotGrabJoystick() {
        var r = TouchRouter(safeArea: safe)
        r.handle(TouchEvent(id: 2, phase: .began, location: Vec2(500, 150)))
        XCTAssertFalse(r.joystick.isActive)
        r.handle(TouchEvent(id: 2, phase: .ended, location: Vec2(500, 150)))
        XCTAssertTrue(r.drainCommands().isEmpty)
    }

    func testContextButtonsFireOnPressAndSwipeUpDives() {
        var r = TouchRouter(safeArea: safe)
        r.context = .ballCarrier
        XCTAssertEqual(r.buttons.map(\.label), ["JUKE", "SPIN", "STIFF"])
        let b = r.buttons[0]
        r.handle(TouchEvent(id: 3, phase: .began, location: b.center))
        XCTAssertEqual(r.drainCommands(), [.button(.juke)], "fires on touch-down, not release")
        r.handle(TouchEvent(id: 3, phase: .moved, location: b.center - Vec2(0, 20)))
        XCTAssertEqual(r.drainCommands(), [.button(.dive)])
        r.context = .preSnap
        XCTAssertEqual(r.buttons.map(\.label), ["SNAP", "AUDBL", "SPRT"])
    }

    func testButtonsMeet44ptAndStayInSafeArea() {
        var r = TouchRouter(safeArea: Rect(x: 15, y: 0, width: 610, height: 290))
        r.minTouchSize = 44
        r.context = .ballCarrier
        for b in r.buttons {
            XCTAssertGreaterThanOrEqual(b.radius * 2, 44)
            XCTAssertLessThanOrEqual(b.center.x + b.radius, 625)
            XCTAssertLessThanOrEqual(b.center.y + b.radius, 290)
            XCTAssertGreaterThanOrEqual(b.center.y - b.radius, 0)
        }
    }

    func testReceiverIconTapIsBulletHoldIsLob() {
        var r = TouchRouter(safeArea: safe)
        r.context = .passing
        r.icons = [ReceiverIcon(receiverID: 5, center: Vec2(300, 120), slot: 0),
                   ReceiverIcon(receiverID: 6, center: Vec2(330, 120), slot: 1)]
        r.now = 1.0
        r.handle(TouchEvent(id: 1, phase: .began, location: Vec2(326, 125)))   // nearest is #6
        r.now = 1.05
        r.handle(TouchEvent(id: 1, phase: .ended, location: Vec2(326, 125)))
        XCTAssertEqual(r.drainCommands(), [.throwTo(receiver: 6, lob: false)])
        r.handle(TouchEvent(id: 2, phase: .began, location: Vec2(300, 120)))
        r.now = 1.5
        r.handle(TouchEvent(id: 2, phase: .ended, location: Vec2(300, 120)))
        XCTAssertEqual(r.drainCommands(), [.throwTo(receiver: 5, lob: true)])
    }

    func testReleaseRecentres() {
        var r = TouchRouter(safeArea: safe)
        r.handle(TouchEvent(id: 1, phase: .began, location: Vec2(120, 200)))
        r.handle(TouchEvent(id: 1, phase: .moved, location: Vec2(160, 200)))
        r.handle(TouchEvent(id: 1, phase: .ended, location: Vec2(160, 200)))
        XCTAssertEqual(r.worldMove, .zero)
        XCTAssertFalse(r.joystick.isActive)
    }
}
