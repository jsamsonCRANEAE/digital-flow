import GSFoundation

/// Big arcade callouts (TOUCHDOWN!, FIRST DOWN!...) and the Spirit cut-in art.
public enum ArcadeArt {
    public enum CalloutStyle: Int, Sendable, Hashable { case chrome, rainbow, fire }

    /// Thick-outlined, vertically graded block text built from the 5x7 font
    /// at an integer `scale` (2...5) so it stays pixel-exact at every size.
    public static func callout(_ text: String, scale k: Int, style: CalloutStyle) -> PixelBuffer {
        let k = clamp(k, 1, 6)
        let pad = 3
        let w = PixelFont.width(of: text) * k + pad * 2, h = PixelFont.glyphHeight * k + pad * 2
        var mask = PixelBuffer(width: w, height: h)
        PixelFont.draw(text, into: &mask, x: 0, y: 0, RGBA(hex: 0xFFFFFF))
        var b = PixelBuffer(width: w, height: h)
        // Scale glyph pixels into k x k blocks.
        for y in 0..<(PixelFont.glyphHeight) {
            for x in 0..<PixelFont.width(of: text) where mask.isOpaque(x, y) {
                b.fillRect(x: pad + x * k, y: pad + y * k, width: k, height: k, RGBA(hex: 0xFFFFFF))
            }
        }
        let bands: [RGBA]
        switch style {
        case .chrome:
            bands = [0xFFFFFF, 0xD8F4FF, 0x9AD8FF, 0x4FA8F0, 0x1E4AA8, 0x14206A, 0xF6C040, 0xFFE45C, 0xFFF6C0].map { RGBA(hex: $0) }
        case .rainbow:
            bands = [0xFF4D6D, 0xFF9A3C, 0xFFE45C, 0x7CFF6B, 0x3FD8FF, 0x6B7CFF, 0xC86BFF].map { RGBA(hex: $0) }
        case .fire:
            bands = [0xFFF6C0, 0xFFE45C, 0xFFB238, 0xFF7A2E, 0xE0402A, 0x9A1E3A].map { RGBA(hex: $0) }
        }
        let top = pad, bottom = pad + PixelFont.glyphHeight * k
        for y in 0..<h {
            let t = clamp(Double(y - top) / Double(max(1, bottom - top)), 0, 0.999)
            let c = bands[Int(t * Double(bands.count))]
            for x in 0..<w where b.isOpaque(x, y) { b[x, y] = c.argb }
        }
        // Hard drop shadow and a 2 px outline.
        var out = PixelBuffer(width: w + 2, height: h + 2)
        for y in 0..<h { for x in 0..<w where b.isOpaque(x, y) { out[x + 2, y + 2] = RGBA(hex: 0x0A0814).argb } }
        out.blit(b, x: 0, y: 0)
        out.addOutline(Palette.outline)
        out.addOutline(RGBA(hex: 0x2A1E4A))
        return out
    }

    /// The scale to draw a callout at `age` seconds: pops in small, overshoots,
    /// settles (integer steps only), and blinks out at the end.
    public static func calloutScale(age: Double, life: Double, base: Int) -> Int? {
        if age > life - 0.18 && Int(age * 30) % 2 == 0 { return nil }
        if age < 0.05 { return max(1, base - 2) }
        if age < 0.12 { return base + 1 }
        return base
    }

    /// Diagonal cut-in band in team colors with bold brush-glyph shapes.
    /// `frame` (0/1) shifts the streaks for a 2-frame flicker.
    public static func cutInBand(width w: Int, height h: Int, primary: RGBA, accent: RGBA, motif: Int, frame: Int) -> PixelBuffer {
        var b = PixelBuffer(width: w, height: h)
        let slant = 0.35
        let dark = primary.hueShifted(-0.7), mid = primary, light = primary.hueShifted(0.5)
        for y in 0..<h {
            let off = Int(Double(h - y) * slant)
            for x in off..<min(w, off + w - Int(Double(h) * slant)) {
                let stripe = ((x - off + frame * 6 + y / 3) / 6) % 9 == 0
                b[x, y] = (y < 3 || y >= h - 3 ? accent : stripe ? light : (y < h / 2 ? mid : mid.hueShifted(-0.25))).argb
            }
        }
        // Brush glyphs: 3 abstract kanji-like blocks (original strokes, not real characters).
        var rng = SplitMix64(seed: UInt64(motif) &* 0x9E37 &+ 77)
        for g in 0..<3 {
            let gx = 40 + g * (w - 140) / 2, gy = 12, gs = h - 24
            let strokes = 4 + rng.int(3)
            for _ in 0..<strokes {
                let kind = rng.int(4)
                let x0 = gx + rng.int(gs / 2), y0 = gy + rng.int(gs / 2)
                let len = gs / 2 + rng.int(gs / 2)
                let thick = 4 + rng.int(5)
                for i in 0..<len {
                    let taper = max(1, thick - i * thick / max(1, len) / 2)
                    let (px, py): (Int, Int)
                    switch kind {
                    case 0: (px, py) = (x0 + i, y0)                       // horizontal
                    case 1: (px, py) = (x0, y0 + i)                       // vertical
                    case 2: (px, py) = (x0 + i * 2 / 3, y0 + i)           // sweep
                    default: (px, py) = (x0 + i, y0 + i * 2 / 3)          // hook
                    }
                    b.fillRect(x: px + Int(Double(h - py) * slant) / 2, y: py, width: taper, height: taper, dark)
                }
                b.fillEllipse(cx: Double(x0) + 3, cy: Double(y0) + 3, rx: Double(thick) / 2 + 1, ry: Double(thick) / 2 + 1, dark)
            }
        }
        return b
    }

    /// 50% checker dim (pixel-art transparency) for the full-screen cut-in.
    public static func dim(width w: Int, height h: Int) -> PixelBuffer {
        var b = PixelBuffer(width: w, height: h)
        for y in 0..<h { for x in 0..<w where (x + y) & 1 == 0 { b[x, y] = RGBA(hex: 0x0A0814).argb } }
        return b
    }

    public static func bar(width w: Int, height h: Int, _ c: RGBA) -> PixelBuffer { PixelBuffer(width: w, height: h, fill: c) }

    /// Spirit meter: framed bar, pulsing gold when full.
    public static func spiritMeter(fill: Double, color: RGBA, full: Bool, pulse: Int, label: String) -> PixelBuffer {
        let w = 64, h = 13
        var b = PixelBuffer(width: w, height: h)
        b.fillRect(x: 0, y: 0, width: w, height: h, Palette.outline)
        b.fillRect(x: 1, y: 1, width: w - 2, height: h - 2, RGBA(hex: 0x14162E))
        let n = Int(clamp(fill, 0, 1) * Double(w - 4))
        let c = full ? (pulse & 1 == 0 ? Palette.highlight : RGBA(hex: 0xFFFFFF)) : color
        for x in 0..<n { for y in 0..<(h - 4) { b.set(2 + x, 2 + y, (x + y) & 3 == 0 ? c.hueShifted(0.4) : c) } }
        b.drawText(label, x: (w - PixelFont.width(of: label)) / 2, y: 3, full ? Palette.outline : RGBA(hex: 0xFFFFFF))
        return b
    }
}
