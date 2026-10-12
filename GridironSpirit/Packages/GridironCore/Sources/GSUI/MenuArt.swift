import Foundation
import GSFoundation
import GSRenderCore

/// Procedural menu art: backgrounds, logo, buttons, badges. All integer,
/// palette-limited and outlined so menus match the in-game pixel style.
public enum MenuArt {
    public static let ink = RGBA(hex: 0x0E0B1C)
    public static let panelFill = RGBA(hex: 0x1A1838)
    public static let panelEdge = RGBA(hex: 0x3A3F6E)
    public static let white = RGBA(hex: 0xFFFFFF)
    public static let soft = RGBA(hex: 0x9AD8FF)
    public static let gold = Palette.highlight
    public static let red = RGBA(hex: 0xFF5A3C)
    public static let green = RGBA(hex: 0x7CFF6B)
    public static let dimText = RGBA(hex: 0x7A7FA8)

    /// Night-stadium background: dithered gradient, floodlight glows and
    /// diagonal speed stripes that scroll with `time`.
    public static func background(time: Double, accent: RGBA) -> PixelBuffer {
        var b = PixelBuffer(width: Canvas.width, height: Canvas.height)
        let top = RGBA(hex: 0x0B0A1E), mid = RGBA(hex: 0x1C1846), low = accent.hueShifted(-0.75)
        let shift = Int(time * 40)
        for y in 0..<b.height {
            let t = Double(y) / Double(b.height - 1)
            let (c0, c1, u) = t < 0.6 ? (top, mid, t / 0.6) : (mid, low, (t - 0.6) / 0.4)
            let steps = 6.0, f = u * steps, band = floor(f), frac = f - band
            let ca = lerp(c0, c1, band / steps), cb = lerp(c0, c1, min(1, (band + 1) / steps))
            for x in 0..<b.width {
                var c = Double(Palette.bayer(x, y)) / 16 < frac ? cb : ca
                // Speed stripes: 45-degree bands, every 48 px, 10 px wide.
                if ((x + y + shift) % 48) < 10 { c = lerp(c, accent, 0.10) }
                b[x, y] = c.argb
            }
        }
        // Floodlight glows (dithered discs) and a horizon of turf.
        for (cx, cy) in [(70.0, 34.0), (570.0, 34.0)] {
            for y in 0..<80 { for x in -70..<70 {
                let px = Int(cx) + x, py = Int(cy) + y - 30
                guard b.contains(px, py) else { continue }
                let d = Double(x * x + (y - 30) * (y - 30) * 4).squareRoot() / 70
                if d < 1, Double(Palette.bayer(px, py)) / 16 > d * 1.3 { b[px, py] = lerp(b.color(px, py), RGBA(hex: 0xFFF6C0), 0.18).argb }
            }}
            b.fillRect(x: Int(cx) - 10, y: Int(cy) - 4, width: 20, height: 6, RGBA(hex: 0xFFF6C0))
            b.fillRect(x: Int(cx) - 1, y: Int(cy) + 2, width: 2, height: 40, RGBA(hex: 0x2A2850))
        }
        let turfY = 250
        for y in turfY..<b.height {
            for x in 0..<b.width {
                let stripe = ((x + (y - turfY) * 2) / 40) % 2 == 0
                b[x, y] = (stripe ? Palette.turfDark : Palette.turfSideline).hueShifted(-0.5).argb
            }
        }
        b.fillRect(x: 0, y: turfY, width: b.width, height: 1, Palette.line.hueShifted(-0.4))
        return b
    }

    static func lerp(_ a: RGBA, _ b: RGBA, _ t: Double) -> RGBA {
        func m(_ x: UInt8, _ y: UInt8) -> UInt8 { UInt8(clamp(Double(x) + (Double(y) - Double(x)) * t, 0, 255).rounded()) }
        return RGBA(r: m(a.r, b.r), g: m(a.g, b.g), b: m(a.b, b.b), a: 255)
    }

    /// "GRIDIRON / SPIRIT" title logo with a moving chrome glint.
    public static func logo(scale k: Int, glint: Double) -> PixelBuffer {
        let top = ArcadeArt.callout("GRIDIRON", scale: k, style: .chrome)
        let bottom = ArcadeArt.callout("SPIRIT", scale: k + 1, style: .fire)
        let w = max(top.width, bottom.width) + 16, h = top.height + bottom.height - 2
        var b = PixelBuffer(width: w, height: h)
        b.blit(top, x: (w - top.width) / 2, y: 0)
        b.blit(bottom, x: (w - bottom.width) / 2, y: top.height - 2)
        // Diagonal glint sweeping across the opaque letters.
        let gx = Int(glint * Double(w + h)) - h
        for y in 0..<h { for x in 0..<w where b.isOpaque(x, y) {
            let d = (x + y) - (gx + h)
            if d >= 0 && d < 4 && RGBA(argb: b[x, y]) != Palette.outline && RGBA(argb: b[x, y]) != RGBA(hex: 0x2A1E4A) {
                b[x, y] = white.argb
            }
        }}
        // Speed streaks either side of SPIRIT.
        let sy = top.height + bottom.height / 2 - 4
        for i in 0..<3 {
            let len = 18 - i * 5, yy = sy + i * 4
            b.fillRect(x: 2 + i * 2, y: yy, width: len, height: 2, Palette.highlight)
            b.fillRect(x: w - 2 - i * 2 - len, y: yy, width: len, height: 2, Palette.highlight)
        }
        return b
    }

    public enum ButtonStyle { case primary, normal, danger, disabled }

    /// Beveled pixel button. `pressed` shifts the face down 1 px.
    public static func button(_ text: String, width w: Int, height h: Int = 24, style: ButtonStyle = .normal,
                              selected: Bool = false, pressed: Bool = false, accent: RGBA = RGBA(hex: 0x3FA7FF)) -> PixelBuffer {
        var b = PixelBuffer(width: w, height: h + 2)
        let face: RGBA
        switch style {
        case .primary: face = accent
        case .normal: face = RGBA(hex: 0x2C2F5E)
        case .danger: face = RGBA(hex: 0xA8323C)
        case .disabled: face = RGBA(hex: 0x24233A)
        }
        let dy = pressed ? 1 : 0
        b.fillRect(x: 0, y: 2, width: w, height: h, ink)                                  // drop shadow
        b.fillRect(x: 0, y: dy, width: w, height: h, Palette.outline)
        b.fillRect(x: 1, y: dy + 1, width: w - 2, height: h - 2, face.hueShifted(-0.5))
        b.fillRect(x: 1, y: dy + 1, width: w - 3, height: h - 4, face)
        b.fillRect(x: 2, y: dy + 1, width: w - 4, height: 1, face.hueShifted(0.6))          // top bevel
        if selected {
            for x in 0..<w { b.set(x, dy, gold); b.set(x, dy + h - 1, gold) }
            for y in dy..<(dy + h) { b.set(0, y, gold); b.set(w - 1, y, gold) }
        }
        let tc = style == .disabled ? dimText : white
        b.drawText(text, x: (w - PixelFont.width(of: text)) / 2, y: dy + (h - 7) / 2, tc, shadow: ink)
        return b
    }

    /// Framed dark panel.
    public static func panel(width w: Int, height h: Int, accent: RGBA = panelEdge, fill: RGBA = panelFill) -> PixelBuffer {
        var b = PixelBuffer(width: w, height: h, fill: Palette.outline)
        b.fillRect(x: 1, y: 1, width: w - 2, height: h - 2, accent)
        b.fillRect(x: 2, y: 2, width: w - 4, height: h - 4, fill)
        b.fillRect(x: 2, y: 2, width: w - 4, height: 1, fill.hueShifted(0.4))
        return b
    }

    /// 9x9 coin.
    public static let coin: PixelBuffer = {
        var b = PixelBuffer(width: 9, height: 9)
        b.fillEllipse(cx: 4, cy: 4, rx: 4.5, ry: 4.5, RGBA(hex: 0xB9832A))
        b.fillEllipse(cx: 4, cy: 4, rx: 3.5, ry: 3.5, RGBA(hex: 0xFFC83C))
        b.fillRect(x: 4, y: 2, width: 1, height: 5, RGBA(hex: 0xB9832A))
        b.set(2, 2, RGBA(hex: 0xFFF6C0)); b.set(3, 1, RGBA(hex: 0xFFF6C0))
        b.addOutline(Palette.outline)
        return b
    }()

    /// Coin badge "(c) 1,234".
    public static func coins(_ n: Int) -> PixelBuffer {
        let t = grouped(n)
        var b = panel(width: PixelFont.width(of: t) + 26, height: 17, accent: RGBA(hex: 0xB9832A))
        b.blit(coin, x: 3, y: 3)
        b.drawText(t, x: 18, y: 5, gold, shadow: ink)
        return b
    }

    public static func grouped(_ n: Int) -> String {
        let s = String(abs(n))
        var out = ""
        for (i, ch) in s.reversed().enumerated() { if i > 0 && i % 3 == 0 { out.append(",") }; out.append(ch) }
        return (n < 0 ? "-" : "") + String(out.reversed())
    }

    /// Simple greedy word wrap for the 5x7 font.
    public static func wrap(_ text: String, width: Int) -> [String] {
        var lines: [String] = [], cur = ""
        for w in text.split(separator: " ") {
            let cand = cur.isEmpty ? String(w) : cur + " " + w
            if PixelFont.width(of: cand) > width && !cur.isEmpty { lines.append(cur); cur = String(w) } else { cur = cand }
        }
        if !cur.isEmpty { lines.append(cur) }
        return lines
    }

    /// Horizontal rating bar (0...99) with label.
    public static func ratingBar(_ label: String, value: Int, width w: Int, color: RGBA) -> PixelBuffer {
        var b = PixelBuffer(width: w, height: 9)
        b.drawText(label, x: 0, y: 1, soft)
        let bx = 30, bw = w - bx - 16
        b.fillRect(x: bx, y: 2, width: bw, height: 5, Palette.outline)
        b.fillRect(x: bx + 1, y: 3, width: max(0, (bw - 2) * value / 99), height: 3, color)
        b.drawText("\(value)", x: w - 13, y: 1, white)
        return b
    }

    /// Small 4-point sparkle (animated by frame 0...3).
    public static func sparkle(frame: Int) -> PixelBuffer {
        var b = PixelBuffer(width: 7, height: 7)
        let r = [1, 2, 3, 2][frame & 3]
        for i in -r...r { b.set(3 + i, 3, white); b.set(3, 3 + i, white) }
        b.set(3, 3, Palette.highlight)
        return b
    }

    /// Draws `img` scaled by integer `k` into `dst` (nearest neighbour).
    public static func blitScaled(_ img: PixelBuffer, into dst: inout PixelBuffer, x: Int, y: Int, k: Int) {
        for sy in 0..<img.height { for sx in 0..<img.width where img.isOpaque(sx, sy) {
            dst.fillRect(x: x + sx * k, y: y + sy * k, width: k, height: k, RGBA(argb: img[sx, sy]))
        }}
    }

    /// Half-transparent darkening of a rect (checker dither keeps it "pixel").
    public static func darken(_ b: inout PixelBuffer, x: Int, y: Int, width w: Int, height h: Int, amount: Double = 0.55) {
        for yy in max(0, y)..<min(b.height, y + h) { for xx in max(0, x)..<min(b.width, x + w) {
            b[xx, yy] = lerp(b.color(xx, yy), ink, amount).argb
        }}
    }
}
