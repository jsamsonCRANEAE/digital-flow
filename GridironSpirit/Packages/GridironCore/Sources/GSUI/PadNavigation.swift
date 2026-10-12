import GSFoundation
import GSInput
import GSData
import GSRenderCore
import GSGame

/// Bluetooth controller support for everything above the match: d-pad /
/// stick moves a focus highlight between the same hit regions touches use,
/// A confirms, B goes back, Menu pauses. In a match the pad goes to the
/// runtime (TouchRouter maps it to gameplay commands).
extension AppFlow {
    /// Call once per frame, before `advance`, with the current controller state.
    public func handle(pad: GamepadState) {
        let prev = lastPad
        lastPad = pad
        guard pad.connected else {
            if prev.connected { padStyle = nil }
            runtime?.handle(pad: pad)
            return
        }
        let e = PadEdges(prev, pad)
        let dir = pad.direction
        // Menu direction with key repeat (0.35 s delay, then every 0.12 s).
        var step: Vec2?
        if let d = dir {
            if prev.direction != d { step = d; navRepeat = time + 0.35 }
            else if time >= navRepeat { step = d; navRepeat = time + 0.12 }
        }
        if !e.down.isEmpty || step != nil { padStyle = pad.style }

        switch screen {
        case .title:
            if e.down.contains(.a) || e.down.contains(.menu) { sfx(.uiTap); go(.mainMenu) }
        case .game:
            if let rt = runtime, rt.report != nil {
                if finalTimer > 2, e.down.contains(.a) || e.down.contains(.menu) { activate("continue") }
                return
            }
            if e.down.contains(.menu) || e.down.contains(.options) { activate("pause"); return }
            runtime?.handle(pad: pad)
        default:
            if screen == .pause, e.down.contains(.menu) || e.down.contains(.b) { activate("resume"); return }
            // Settings rows: left/right change the value directly.
            if screen == .settings, let f = focusID, f.hasPrefix("set."), let s = step, s.y == 0 {
                let row = f.split(separator: ".")[1]
                activate("set.\(row).\(s.x > 0 ? 1 : -1)")
                focusID = "set.\(row).1"
                return
            }
            if screen == .shop {
                if e.down.contains(.l1) || e.down.contains(.r1) {
                    let cats = GearCategory.allCases
                    let i = cats.firstIndex(of: shopCategory) ?? 0
                    let n = cats[(i + (e.down.contains(.r1) ? 1 : cats.count - 1)) % cats.count]
                    activate("tab.\(n.rawValue)")
                    focusID = "item." + (shopSelected ?? "")
                }
            }
            if let s = step { moveFocus(s) }
            if e.down.contains(.a), let f = currentFocus() { activate(f) }
            if e.down.contains(.b) {
                if hits.contains(where: { $0.id == "back" }) { activate("back") }
                else if screen == .postGame { activate("post.menu") }
            }
        }
    }

    /// Focused id, falling back to the screen's default when it's gone.
    func currentFocus() -> String? {
        if let f = focusID, hits.contains(where: { $0.id == f }) { return f }
        let d = defaultFocus()
        focusID = hits.contains(where: { $0.id == d }) ? d : hits.first?.id
        return focusID
    }

    func defaultFocus() -> String {
        switch screen {
        case .mainMenu: return "exhibition"
        case .teamSelect: return "play"
        case .settings: return "set.music.1"
        case .shop: return "item." + (shopSelected ?? gear.items(in: shopCategory).first?.id ?? "")
        case .cupBracket: return "cup.play"
        case .postGame: return "post.again"
        case .pause: return "resume"
        case .game: return "continue"
        case .title: return ""
        }
    }

    /// Spatial navigation: nearest region in the pressed direction, with
    /// sideways distance weighted double so lines and columns feel natural.
    func moveFocus(_ d: Vec2) {
        guard let f = currentFocus(), let from = hits.first(where: { $0.id == f }) else { return }
        func center(_ r: Rect) -> Vec2 { Vec2((r.minX + r.maxX) / 2, (r.minY + r.maxY) / 2) }
        let c = center(from.rect)
        var best: (String, Double)?
        for h in hits where h.id != f {
            let v = center(h.rect) - c
            let along = v.x * d.x + v.y * d.y
            guard along > 2 else { continue }
            let side = abs(v.x * d.y - v.y * d.x)
            let score = along + side * 2
            if best == nil || score < best!.1 { best = (h.id, score) }
        }
        guard let next = best?.0 else { return }
        focusID = next
        sfx(.uiTap)
        // Shop: moving onto an item previews it (quietly, no keeper chatter).
        if screen == .shop, next.hasPrefix("item."), let it = gear.item(String(next.dropFirst(5))) {
            shopSelected = it.id; shopCategory = it.category
        }
    }

    /// Pulsing gold frame around the focused region (menus).
    func drawFocus(_ b: inout PixelBuffer) {
        guard padStyle != nil, let f = currentFocus(), let h = hits.first(where: { $0.id == f }) else { return }
        let pulse = Int(time * 6) % 2
        let r = h.rect
        let x0 = Int(r.minX) - 2 - pulse, y0 = Int(r.minY) - 2 - pulse
        let x1 = Int(r.maxX) + 1 + pulse, y1 = Int(r.maxY) + 1 + pulse
        for x in x0...x1 { b.set(x, y0, MenuArt.gold); b.set(x, y1, MenuArt.gold); b.set(x, y0 + 1, Palette.outline); b.set(x, y1 - 1, Palette.outline) }
        for y in y0...y1 { b.set(x0, y, MenuArt.gold); b.set(x1, y, MenuArt.gold) }
    }

    /// Same frame as a UI item for game-path overlays (pause panel, CONTINUE).
    func focusItem() -> UIItem? {
        guard padStyle != nil, let f = currentFocus(), let h = hits.first(where: { $0.id == f }) else { return nil }
        let pulse = Int(time * 6) % 2
        let w = Int(h.rect.width) + 4 + pulse * 2, hh = Int(h.rect.height) + 4 + pulse * 2
        return UIItem(key: "flow.focus.\(w).\(hh)", x: Int(h.rect.minX) - 2 - pulse, y: Int(h.rect.minY) - 2 - pulse) {
            var b = PixelBuffer(width: w, height: hh)
            for x in 0..<w { b.set(x, 0, MenuArt.gold); b.set(x, hh - 1, MenuArt.gold) }
            for y in 0..<hh { b.set(0, y, MenuArt.gold); b.set(w - 1, y, MenuArt.gold) }
            return b
        }
    }

    /// Controller-only hint line for menu screens ("A SELECT  B BACK").
    func padHint(_ b: inout PixelBuffer) {
        guard let s = padStyle else { return }
        let a = s.glyph(.a), bk = s.glyph(.b)
        var x = (Canvas.width - 110) / 2, y = Canvas.height - 11
        if screen == .shop { x = 372; y = 4 }        // shop panel is full height; tuck it in the frame
        b.blit(FXSprites.padBadge(a), x: x, y: y - 3); b.drawText("SELECT", x: x + 15, y: y, MenuArt.white, shadow: MenuArt.ink)
        b.blit(FXSprites.padBadge(bk), x: x + 64, y: y - 3); b.drawText("BACK", x: x + 79, y: y, MenuArt.white, shadow: MenuArt.ink)
    }
}
