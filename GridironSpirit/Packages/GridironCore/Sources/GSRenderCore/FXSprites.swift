import GSFoundation

/// Procedural sprites for the ball, controls and anime effects.
public enum FXSprites {
    public static let leather = RGBA(hex: 0x8A4524)
    public static let lace = RGBA(hex: 0xF4F0E4)
    public static let angleBuckets = 16
    public static let spinFrames = 4

    /// Prolate football seen side-on, long axis at `angleBucket` (of 16 per
    /// full turn, screen space). Spin frames rotate the laces around the long
    /// axis: visible on top, edge-on, hidden, edge-on.
    public static func ball(length L: Int, angleBucket: Int, spinFrame: Int) -> PixelBuffer {
        let len = max(4, L)
        let size = len + 4
        var b = PixelBuffer(width: size, height: size)
        let a = Double(angleBucket % angleBuckets) / Double(angleBuckets) * 2 * Double.pi
        let ca = cosD(a), sa = sinD(a)
        let hl = Double(len) / 2, hw = max(1.2, Double(len) * 0.305)
        let c = Double(size) / 2
        let laceOffset: Double? = [-0.35, 0.0, nil, 0.0][spinFrame & 3]
        for y in 0..<size {
            for x in 0..<size {
                let dx = Double(x) + 0.5 - c, dy = Double(y) + 0.5 - c
                let u = dx * ca + dy * sa          // along the long axis
                let v = -dx * sa + dy * ca         // across
                let e = (u / hl) * (u / hl) + (v / hw) * (v / hw)
                guard e <= 1 else { continue }
                var col = leather
                if v < -hw * 0.35 && u < hl * 0.3 { col = leather.hueShifted(0.55) }
                else if v > hw * 0.4 { col = leather.hueShifted(-0.6) }
                if let lo = laceOffset, len >= 6, abs(v - lo * hw) < 0.6, abs(u) < hl * 0.42 { col = lace }
                b[x, y] = col.argb
            }
        }
        b.addOutline(Palette.outline)
        return b
    }

    public static let iconColors: [RGBA] = [RGBA(hex: 0xFFD23F), RGBA(hex: 0x3FD8FF), RGBA(hex: 0xFF5AB4)]

    /// Receiver badge with its slot number. `charging` adds a white pulse rim
    /// while the player holds the icon for a lob.
    public static func receiverIcon(slot: Int, charging: Bool) -> PixelBuffer {
        let size = charging ? 17 : 13
        var b = PixelBuffer(width: size, height: size)
        let c = Double(size) / 2
        let col = iconColors[slot % iconColors.count]
        if charging { b.fillEllipse(cx: c, cy: c, rx: c - 0.5, ry: c - 0.5, RGBA(hex: 0xFFFFFF)) }
        b.fillEllipse(cx: c, cy: c, rx: 5.5, ry: 5.5, col.hueShifted(-0.5))
        b.fillEllipse(cx: c - 0.5, cy: c - 0.5, rx: 4.8, ry: 4.8, col)
        PixelFont.draw(String(slot + 1), into: &b, x: Int(c) - 2, y: Int(c) - 3, Palette.outline)
        b.addOutline(Palette.outline)
        return b
    }

    public static let buttonColors: [RGBA] = [RGBA(hex: 0xFF7A2E), RGBA(hex: 0x3F8CFF), RGBA(hex: 0x3FCF6A)]

    /// Beveled round arcade button with a pixel-font label.
    public static func button(radius r: Int, slot: Int, label: String, enabled: Bool, pressed: Bool) -> PixelBuffer {
        let d = r * 2 + 3
        var b = PixelBuffer(width: d, height: d)
        let base = enabled ? buttonColors[slot % buttonColors.count] : RGBA(hex: 0x6A6E80)
        let c = Double(d) / 2
        let rr = Double(r)
        let press = pressed ? 1.0 : 0
        for y in 0..<d {
            for x in 0..<d {
                let dx = Double(x) + 0.5 - c, dy = Double(y) + 0.5 - c - press
                let dist = (dx * dx + dy * dy).squareRoot()
                guard dist <= rr else { continue }
                var col = pressed ? base.hueShifted(-0.35) : base
                let n = (dx - dy) / rr                       // top-left lit
                if dist > rr - 2.2 { col = n > 0.2 ? col.hueShifted(-0.6) : n < -0.2 ? col.hueShifted(0.55) : col }
                else if !pressed && dy < -rr * 0.45 && (x + y) & 1 == 0 { col = col.hueShifted(0.35) }
                b[x, y] = col.argb
            }
        }
        if !label.isEmpty {
            let tw = PixelFont.width(of: label)
            let tx = (d - tw) / 2, ty = (d - PixelFont.glyphHeight) / 2 + Int(press)
            b.drawText(label, x: tx, y: ty, enabled ? RGBA(hex: 0xFFFFFF) : RGBA(hex: 0xB0B4C4),
                       shadow: base.hueShifted(-0.8))
        }
        b.addOutline(Palette.outline)
        return b
    }

    /// Anime impact starburst: jagged spikes, white core, hot rim. Frame 0..2 grows.
    public static func starburst(size: Int, frame: Int) -> PixelBuffer {
        let s = max(9, size) | 1
        var b = PixelBuffer(width: s, height: s)
        let c = Double(s) / 2
        let grow = [0.55, 0.85, 1.0][min(2, max(0, frame))]
        let spikes = 9
        for y in 0..<s {
            for x in 0..<s {
                let dx = Double(x) + 0.5 - c, dy = Double(y) + 0.5 - c
                let r = (dx * dx + dy * dy).squareRoot() / c
                let a = atan2Safe(dy, dx)
                // Uneven spike lengths read as hand-drawn.
                let k = Int(((a + Double.pi) / (2 * Double.pi) * Double(spikes)).rounded(.down)) % spikes
                let spikeLen = [1.0, 0.7, 0.92, 0.62, 1.0, 0.78, 0.88, 0.66, 0.95][k]
                let local = abs(((a + Double.pi) / (2 * Double.pi) * Double(spikes)).truncatingRemainder(dividingBy: 1) - 0.5) * 2
                let edge = (0.32 + (spikeLen - 0.32) * (1 - local)) * grow
                if r <= edge {
                    let col: RGBA = r < edge * 0.45 ? RGBA(hex: 0xFFFFFF) : r < edge * 0.75 ? Palette.highlight : RGBA(hex: 0xFF6A2A)
                    b[x, y] = col.argb
                }
            }
        }
        b.addOutline(Palette.outline)
        return b
    }

    /// Catch flash: thin ring that expands (frames 0..2).
    public static func catchFlash(size: Int, frame: Int) -> PixelBuffer {
        let s = max(9, size) | 1
        var b = PixelBuffer(width: s, height: s)
        let c = Double(s) / 2
        let r = [0.45, 0.7, 0.95][min(2, max(0, frame))] * (c - 1)
        for y in 0..<s {
            for x in 0..<s {
                let dx = Double(x) + 0.5 - c, dy = Double(y) + 0.5 - c
                let d = (dx * dx + dy * dy).squareRoot()
                if abs(d - r) < 0.8 { b[x, y] = RGBA(hex: 0xFFFFFF).argb }
                else if frame == 0 && d < r * 0.5 { b[x, y] = Palette.highlight.argb }
            }
        }
        // Four sparkle ticks.
        for (dx, dy) in [(0, -1), (0, 1), (-1, 0), (1, 0)] {
            for k in 0..<2 { b.set(Int(c) + dx * (Int(r) + 2 + k), Int(c) + dy * (Int(r) + 2 + k), Palette.highlight) }
        }
        return b
    }
}
