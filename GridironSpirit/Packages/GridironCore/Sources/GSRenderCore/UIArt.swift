import GSFoundation

/// A play diagram in yards relative to the ball (x right, y downfield).
public struct CardDiagram: Sendable, Hashable {
    public var offense: [Vec2]
    public var defense: [Vec2]
    public var paths: [[Vec2]]
    /// Highlighted path index (the ball carrier / first read).
    public var primary: Int?
    public init(offense: [Vec2] = [], defense: [Vec2] = [], paths: [[Vec2]] = [], primary: Int? = nil) {
        self.offense = offense; self.defense = defense; self.paths = paths; self.primary = primary
    }
}

extension Vec2 {
    // Hashable via its stored doubles (already synthesized); helper for diagrams.
}

/// Procedural UI art: play cards, kick meter, HUD panels, wind arrow.
public enum UIArt {
    public static let cardSize = (w: 150, h: 118)
    static let paper = RGBA(hex: 0xF3E6C4), ink = RGBA(hex: 0x2A1E3A), chalk = RGBA(hex: 0x2F7D3A)

    /// Playbook card: category ribbon, chalkboard diagram, name plate.
    public static func playCard(title: String, category: String, diagram: CardDiagram, accent: RGBA,
                                highlighted: Bool) -> PixelBuffer {
        let (w, h) = cardSize
        var b = PixelBuffer(width: w, height: h)
        let frame = highlighted ? Palette.highlight : accent.hueShifted(-0.4)
        b.fillRect(x: 0, y: 0, width: w, height: h, Palette.outline)
        b.fillRect(x: 1, y: 1, width: w - 2, height: h - 2, frame)
        b.fillRect(x: 3, y: 3, width: w - 6, height: h - 6, paper)
        // Category ribbon.
        b.fillRect(x: 3, y: 3, width: w - 6, height: 11, accent)
        b.drawText(category, x: 6, y: 5, RGBA(hex: 0xFFFFFF), shadow: accent.hueShifted(-0.7))
        // Chalkboard.
        let bx = 7, by = 17, bw = w - 14, bh = 72
        b.fillRect(x: bx, y: by, width: bw, height: bh, chalk)
        for y in by..<(by + bh) where (y & 3) == 0 {
            for x in bx..<(bx + bw) where (x + y) & 7 == 0 { b.set(x, y, chalk.hueShifted(0.25)) }
        }
        // Map yards -> board pixels: x in [-17, 17], y in [-8, 24].
        func map(_ p: Vec2) -> (Int, Int) {
            let px = Double(bx) + (p.x + 17) / 34 * Double(bw - 1)
            let py = Double(by + bh - 1) - (p.y + 8) / 32 * Double(bh - 1)
            return (Int(px.rounded()), Int(py.rounded()))
        }
        // Line of scrimmage.
        let (_, losY) = map(Vec2(0, 0))
        for x in bx..<(bx + bw) where x & 1 == 0 { b.set(x, losY, RGBA(hex: 0xBFE8C2)) }
        let white = RGBA(hex: 0xFFFFFF), gold = Palette.highlight
        for (i, path) in diagram.paths.enumerated() where path.count > 1 {
            let col = i == diagram.primary ? gold : white
            for k in 1..<path.count {
                let (x0, y0) = map(path[k - 1]), (x1, y1) = map(path[k])
                EffectsRasterizer.line(x0, y0, x1, y1) { x, y, _ in
                    if x >= bx && x < bx + bw && y >= by && y < by + bh { b.set(x, y, col) }
                }
            }
            // Arrow head: a 3 px block at the end.
            let (ex, ey) = map(path[path.count - 1])
            b.fillRect(x: clamp(ex - 1, bx, bx + bw - 3), y: clamp(ey - 1, by, by + bh - 3), width: 3, height: 3, col)
        }
        for p in diagram.defense {
            let (x, y) = map(p)
            for d in -1...1 { b.set(x + d, y + d, RGBA(hex: 0xFF8A8A)); b.set(x + d, y - d, RGBA(hex: 0xFF8A8A)) }
        }
        for p in diagram.offense {
            let (x, y) = map(p)
            b.fillEllipse(cx: Double(x) + 0.5, cy: Double(y) + 0.5, rx: 2, ry: 2, white)
            b.set(x, y, chalk)
        }
        // Name plate.
        let ty = by + bh + 6
        b.fillRect(x: 7, y: ty - 2, width: w - 14, height: 13, ink)
        b.drawText(title, x: (w - PixelFont.width(of: title)) / 2, y: ty + 1, highlighted ? gold : white)
        return b
    }

    /// Kick meter: power bar (fills left to right) and an aim needle.
    /// `stage` 0 = choosing power, 1 = choosing aim, 2 = locked.
    public static func kickMeter(power: Double, aim: Double, stage: Int) -> PixelBuffer {
        let w = 132, h = 34
        var b = PixelBuffer(width: w, height: h)
        b.fillRect(x: 0, y: 0, width: w, height: h, Palette.outline)
        b.fillRect(x: 1, y: 1, width: w - 2, height: h - 2, RGBA(hex: 0x23264A))
        b.drawText(stage == 0 ? "POWER" : stage == 1 ? "AIM" : "KICK!", x: 4, y: 3, RGBA(hex: 0xFFFFFF))
        // Power bar with a green -> yellow -> red gradient, dithered at the boundaries.
        let bx = 4, by = 12, bw = w - 8, bh = 8
        b.fillRect(x: bx - 1, y: by - 1, width: bw + 2, height: bh + 2, RGBA(hex: 0x0E0F20))
        let filled = Int(clamp(power, 0, 1) * Double(bw))
        for x in 0..<filled {
            let t = Double(x) / Double(bw)
            let c = t < 0.6 ? RGBA(hex: 0x4FD86A) : t < 0.85 ? RGBA(hex: 0xFFD23F) : RGBA(hex: 0xFF5A3C)
            for y in 0..<bh { b.set(bx + x, by + y, y == 0 ? c.hueShifted(0.5) : c) }
        }
        // Aim track.
        let ty = by + bh + 4
        b.fillRect(x: bx, y: ty + 2, width: bw, height: 1, RGBA(hex: 0x6C7FB0))
        let mid = bx + bw / 2
        b.fillRect(x: mid - 6, y: ty, width: 1, height: 5, RGBA(hex: 0xFFFFFF))
        b.fillRect(x: mid + 6, y: ty, width: 1, height: 5, RGBA(hex: 0xFFFFFF))
        if stage >= 1 {
            let ax = mid + Int((clamp(aim, -1, 1) * Double(bw / 2 - 2)).rounded())
            b.fillRect(x: ax - 1, y: ty - 1, width: 3, height: 7, Palette.highlight)
        }
        return b
    }

    /// Wind arrow for the HUD; `angle` in screen space (0 = right, pi/2 = down).
    public static func windArrow(bucket: Int, buckets: Int = 16) -> PixelBuffer {
        var b = PixelBuffer(width: 15, height: 15)
        let a = Double(bucket) / Double(buckets) * 2 * Double.pi
        let c = 7.0
        let tip = Vec2(c + cosD(a) * 6, c + sinD(a) * 6), tail = Vec2(c - cosD(a) * 6, c - sinD(a) * 6)
        let col = RGBA(hex: 0x9AD8FF)
        EffectsRasterizer.line(Int(tail.x), Int(tail.y), Int(tip.x), Int(tip.y)) { x, y, _ in b.set(x, y, col); b.set(x, y + 1, col) }
        for side in [-1.0, 1.0] {
            let wing = Vec2(tip.x - cosD(a + side * 0.6) * 4, tip.y - sinD(a + side * 0.6) * 4)
            EffectsRasterizer.line(Int(tip.x), Int(tip.y), Int(wing.x), Int(wing.y)) { x, y, _ in b.set(x, y, col) }
        }
        b.addOutline(Palette.outline)
        return b
    }

    /// Framed HUD box with up to 2 lines of text (scorebug, down & distance...).
    public static func panel(lines: [String], colors: [RGBA]? = nil, minWidth: Int = 0, accent: RGBA = RGBA(hex: 0x3A3F6E)) -> PixelBuffer {
        let tw = max(minWidth, (lines.map { PixelFont.width(of: $0) }.max() ?? 0) + 8)
        let h = lines.count * PixelFont.lineHeight + 6
        var b = PixelBuffer(width: tw, height: h)
        b.fillRect(x: 0, y: 0, width: tw, height: h, Palette.outline)
        b.fillRect(x: 1, y: 1, width: tw - 2, height: h - 2, accent)
        b.fillRect(x: 2, y: 2, width: tw - 4, height: h - 4, RGBA(hex: 0x14162E))
        b.fillRect(x: 2, y: 2, width: tw - 4, height: 1, accent.hueShifted(0.5))
        for (i, l) in lines.enumerated() {
            let c = colors?[safeIndex: i] ?? RGBA(hex: 0xFFFFFF)
            b.drawText(l, x: (tw - PixelFont.width(of: l)) / 2, y: 3 + i * PixelFont.lineHeight, c)
        }
        return b
    }
}

extension UIArt {
    /// Mini field strip: goal lines, ball spot and line to gain (offense frame).
    public static func fieldStrip(ballPercent: Int, lineToGainPercent: Int?) -> PixelBuffer {
        let w = 84, h = 9
        var b = PixelBuffer(width: w, height: h)
        b.fillRect(x: 0, y: 0, width: w, height: h, Palette.outline)
        b.fillRect(x: 1, y: 1, width: 6, height: h - 2, RGBA(hex: 0x6C7FB0))           // own end zone
        b.fillRect(x: w - 7, y: 1, width: 6, height: h - 2, RGBA(hex: 0xB0506C))       // opponent end zone
        b.fillRect(x: 7, y: 1, width: w - 14, height: h - 2, Palette.turfDark)
        for i in 1..<10 { b.fillRect(x: 7 + i * (w - 14) / 10, y: 2, width: 1, height: h - 4, Palette.turfLight) }
        func x(_ pct: Int) -> Int { 7 + clamp(pct, 0, 100) * (w - 15) / 100 }
        if let l = lineToGainPercent { b.fillRect(x: x(l), y: 1, width: 1, height: h - 2, Palette.highlight) }
        b.fillRect(x: x(ballPercent) - 1, y: 2, width: 3, height: h - 4, RGBA(hex: 0x8A4524))
        b.set(x(ballPercent), 2, RGBA(hex: 0xF4F0E4))
        return b
    }
}

extension Array {
    subscript(safeIndex i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}
