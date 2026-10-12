import GSFoundation

public enum Expression: Int, Sendable, Hashable, CaseIterable { case neutral, confident, shocked }

/// Everything needed to draw one player's bust. Derived deterministically
/// from the player id, so a player always looks the same.
public struct PortraitSpec: Sendable, Hashable {
    public var seed: UInt64
    public var skin: RGBA
    public var hair: RGBA
    public var eyes: RGBA
    public var hairStyle: Int        // 0 spiky, 1 slick, 2 bangs, 3 buzz, 4 long, 5 mohawk
    public var headband: Bool
    public var eyeBlack: Bool
    public var jersey: RGBA
    public var trim: RGBA
    public var number: Int
    public var jaw: Double           // 0 narrow V ... 1 square (linemen)

    public init(seed: UInt64, jersey: RGBA, trim: RGBA, number: Int, archetype: Int, big: Bool) {
        var r = SplitMix64(seed: seed)
        self.seed = seed
        skin = Palette.skinTones[r.int(Palette.skinTones.count)]
        let hairs = [0x1A1420, 0x3B2416, 0x6B4A2A, 0xE8D27A, 0xF2F2F2, 0xC0392B, 0x2E86DE, 0x8E44AD].map { RGBA(hex: $0) }
        hair = r.unit() < 0.25 ? trim : hairs[r.int(hairs.count)]
        let irises = [0x6B3E1E, 0xC8902A, 0x3A7BD5, 0x2E9E5B, 0xC0392B, 0x8E44AD].map { RGBA(hex: $0) }
        eyes = irises[r.int(irises.count)]
        hairStyle = r.int(6)
        headband = archetype == 0 && r.unit() < 0.7            // disciplined team: hachimaki
        eyeBlack = r.unit() < 0.6
        self.jersey = jersey
        self.trim = trim
        self.number = number
        jaw = big ? 0.8 + r.unit() * 0.2 : r.unit() * 0.4
    }
}

/// Procedural anime bust portraits (88x88 content) with three expressions,
/// cel-shaded with hue-shifted shadows and a 1 px dark outline.
public enum Portraits {
    public static let size = 88

    public static func render(_ s: PortraitSpec, _ e: Expression) -> PixelBuffer {
        let n = size
        var fig = PixelBuffer(width: n, height: n)
        let cx = 44.0, cy = 40.0
        let skin = s.skin, skinShadow = s.skin.hueShifted(-0.55), skinLight = s.skin.hueShifted(0.4)
        let ink = Palette.outline

        // Shoulders + jersey.
        for y in 68..<n {
            let t = Double(y - 68) / Double(n - 68)
            let half = 30 + 14 * t
            for x in 0..<n {
                let dx = Double(x) + 0.5 - cx
                guard abs(dx) <= half else { continue }
                var c = s.jersey
                if abs(dx) > half - 7 { c = s.jersey.hueShifted(0.35) }                 // pad rim light
                if dx > 8 { c = c.hueShifted(-0.45) }
                if y < 72 && abs(dx) > 12 { c = s.trim }                                  // pad stripe
                fig[x, y] = c.argb
            }
        }
        // Collar V.
        for y in 68..<80 { for x in Int(cx) - (80 - y) / 2...Int(cx) + (80 - y) / 2 { fig.set(x, y, s.trim) } }
        for y in 69..<78 { for x in Int(cx) - (78 - y) / 3...Int(cx) + (78 - y) / 3 { fig.set(x, y, skinShadow) } }
        // Chest number (2x font).
        let num = String(s.number)
        var nb = PixelBuffer(width: PixelFont.width(of: num) + 1, height: 8)
        PixelFont.draw(num, into: &nb, x: 0, y: 0, s.trim)
        for y in 0..<nb.height { for x in 0..<nb.width where nb.isOpaque(x, y) {
            let px = Int(cx) + 10 + x * 2, py = 72 + y * 2
            fig.fillRect(x: px, y: py, width: 2, height: 2, s.trim)
        } }

        // Neck.
        for y in 58..<72 { for x in 36..<53 { fig[x, y] = (x > 47 || y < 63 ? skinShadow : skin).argb } }

        // Head: wide cheekbones tapering to an anime chin.
        func halfWidth(_ y: Double) -> Double {
            let dy = y - cy
            if dy <= 0 { let k = dy / 23; return 21 * max(0, 1 - k * k).squareRoot() }
            let k = min(1, dy / 25)
            let taper = 1 - (1 - s.jaw) * 0.55 * k * k
            return 21 * max(0, 1 - powD(k, 2.4)).squareRoot() * taper + s.jaw * 2.5 * k
        }
        for y in 14..<66 {
            let hw = halfWidth(Double(y) + 0.5)
            for x in 0..<n {
                let dx = Double(x) + 0.5 - cx
                guard abs(dx) <= hw else { continue }
                var c = skin
                if dx > hw * 0.45 || (Double(y) > cy + 12 && dx > -hw * 0.2) { c = skinShadow }   // cel shadow
                if dx < -hw * 0.55 && Double(y) > cy - 2 && Double(y) < cy + 10 { c = skinLight }
                fig[x, y] = c.argb
            }
        }
        // Ears.
        fig.fillEllipse(cx: cx - 21, cy: cy + 4, rx: 3.5, ry: 6, skin)
        fig.fillEllipse(cx: cx + 21, cy: cy + 4, rx: 3.5, ry: 6, skinShadow)

        drawHair(&fig, s, cx: cx, cy: cy)
        if s.headband {
            for x in 22..<67 { for y in Int(cy) - 12..<Int(cy) - 8 { if fig.isOpaque(x, y) { fig.set(x, y, x > 50 ? s.trim.hueShifted(-0.4) : s.trim) } } }
            // Knot tails flying off the side.
            for i in 0..<9 { fig.fillRect(x: 66 + i, y: Int(cy) - 12 + i / 2 + (i & 1), width: 2, height: 2, s.trim) }
        }

        drawFace(&fig, s, e, cx: cx, cy: cy)
        fig.addOutline(ink)

        // Background, then the figure on top.
        var out = PixelBuffer(width: n, height: n)
        drawBackground(&out, s, e)
        out.blit(fig, x: 0, y: 0)
        if e == .shocked { drawSweat(&out, x: 69, y: 20) }
        if e == .confident { drawSparkle(&out, x: 12, y: 30) }
        return out
    }

    static func drawBackground(_ b: inout PixelBuffer, _ s: PortraitSpec, _ e: Expression) {
        let base = e == .shocked ? RGBA(hex: 0x2A1E4A) : s.jersey.hueShifted(-0.75)
        let ray = e == .shocked ? RGBA(hex: 0x5A3E8A) : s.jersey.hueShifted(-0.2)
        let c = Double(size) / 2
        for y in 0..<size {
            for x in 0..<size {
                let a = atan2Safe(Double(y) - c, Double(x) - c)
                let k = Int(((a + Double.pi) / (2 * Double.pi) * 28).rounded(.down))
                var col = base
                if k & 1 == 0 && (x + y) & 1 == 0 { col = ray }          // dithered radial burst
                if e == .shocked && k % 7 == 0 { col = RGBA(hex: 0x8A6EC8) }
                b[x, y] = col.argb
            }
        }
    }

    static func drawHair(_ f: inout PixelBuffer, _ s: PortraitSpec, cx: Double, cy: Double) {
        let h = s.hair, hs = s.hair.hueShifted(-0.55), hl = s.hair.hueShifted(0.5)
        func cap(_ ry: Double, sideDown: Double) {
            for y in 4..<Int(cy + sideDown) {
                for x in 16..<72 {
                    let dx = (Double(x) + 0.5 - cx) / 24, dy = (Double(y) + 0.5 - (cy - 6)) / (ry * 1.22)
                    let inCap = dx * dx + dy * dy <= 1 && Double(y) < cy - 6
                    let side = Double(y) >= cy - 6 && abs(Double(x) + 0.5 - cx) > 19.5 && abs(Double(x) + 0.5 - cx) < 24
                    if inCap || side {
                        let c = Double(x) > cx + 7 ? hs : (Double(y) < cy - 22 && Double(x) < cx - 2 ? hl : h)
                        f.set(x, y, c)
                    }
                }
            }
        }
        func spike(_ ax: Double, _ ay: Double, _ bx: Double, _ by: Double, width w: Double) {
            // Triangle from base centre (bx, by) with half-width w to apex (ax, ay).
            let steps = 40
            for i in 0...steps {
                let t = Double(i) / Double(steps)
                let px = lerp(bx, ax, t), py = lerp(by, ay, t)
                let ww = w * (1 - t)
                let nx = -(ay - by), ny = ax - bx
                let l = max(1e-6, (nx * nx + ny * ny).squareRoot())
                var o = -ww
                while o <= ww {
                    let x = Int((px + nx / l * o).rounded()), y = Int((py + ny / l * o).rounded())
                    f.set(x, y, o > 0 ? hs : (t > 0.6 ? hl : h))
                    o += 0.5
                }
            }
        }
        switch s.hairStyle {
        case 0: // spiky
            cap(16, sideDown: 2)
            for i in -3...3 {
                let a = -Double.pi / 2 + Double(i) * 0.42
                spike(cx + cosD(a) * 37, cy - 7 + sinD(a) * 34, cx + cosD(a) * 16, cy - 7 + sinD(a) * 15, width: 7)
            }
        case 1: // slicked back with a swoop
            cap(17, sideDown: 0)
            spike(cx + 32, cy - 27, cx + 7, cy - 22, width: 8)
            spike(cx - 10, cy - 17, cx - 2, cy - 27, width: 5)
        case 2: // heavy bangs
            cap(17, sideDown: 6)
            for i in 0..<7 {
                let x = cx - 18 + Double(i) * 6
                spike(x + 1, cy - 4 + Double(i % 2) * 2, x, cy - 18, width: 3.8)
            }
        case 3: // buzz cut: thin dithered cap
            for y in 14..<Int(cy - 7) { for x in 20..<68 {
                let dx = (Double(x) + 0.5 - cx) / 22, dy = (Double(y) + 0.5 - (cy - 6)) / 19
                if dx * dx + dy * dy <= 1 && f.isOpaque(x, y) && (x + y) & 1 == 0 { f.set(x, y, hs) }
            } }
        case 4: // long, behind the ears
            cap(17, sideDown: 16)
            spike(cx - 27, cy + 24, cx - 21, cy - 5, width: 5)
            spike(cx + 27, cy + 24, cx + 21, cy - 5, width: 5)
        default: // mohawk
            for i in -2...2 {
                let a = -Double.pi / 2 + Double(i) * 0.3
                spike(cx + cosD(a) * 7 + Double(i) * 2, cy - 7 + sinD(a) * 36, cx + Double(i) * 4, cy - 19, width: 5)
            }
        }
    }

    static func drawFace(_ f: inout PixelBuffer, _ s: PortraitSpec, _ e: Expression, cx: Double, cy: Double) {
        let ink = Palette.outline
        let white = RGBA(hex: 0xFFFFFF)
        let ey = Int(cy) + 3
        for side in [-1, 1] {
            let ex = Int(cx) + side * 10
            // Eye shape per expression.
            let (h, topCut, irisR): (Int, Int, Double) = e == .confident ? (5, 2, 3.2) : e == .shocked ? (9, 0, 1.5) : (8, 0, 3.4)
            for y in (ey - h / 2 + topCut)...(ey + h / 2) {
                for x in (ex - 5)...(ex + 5) {
                    let dx = Double(x - ex) / 5.6, dy = Double(y - ey) / (Double(h) / 2 + 0.4)
                    if dx * dx + dy * dy <= 1 { f.set(x, y, white) }
                }
            }
            // Iris + pupil + highlight.
            let icy = Double(ey) + (e == .shocked ? 0 : 0.8)
            for y in (ey - 5)...(ey + 5) { for x in (ex - 5)...(ex + 5) {
                let d = ((Double(x) - Double(ex)) * (Double(x) - Double(ex)) + (Double(y) - icy) * (Double(y) - icy)).squareRoot()
                guard f[x, y] == white.argb else { continue }
                if d <= irisR { f.set(x, y, d < irisR * 0.45 ? ink : (y > ey ? s.eyes.hueShifted(0.4) : s.eyes)) }
            } }
            if e != .shocked { f.set(ex - 1, ey - 1, white); f.set(ex - 2, ey - 1, white); f.set(ex - 1, ey - 2, white); f.set(ex + 1, ey + 2, white) }
            // Upper lash line (thick) and brow.
            let lashY = ey - h / 2 + topCut - 1
            for x in (ex - 6)...(ex + 5) { f.set(x, lashY, ink); if abs(x - ex) < 5 { f.set(x, lashY - 1, ink) } }
            f.set(ex + side * 6, lashY + 1, ink); f.set(ex + side * 7, lashY + 2, ink)                                      // outer flick
            let browY = e == .shocked ? ey - 12 : ey - 8
            for i in 0..<12 {
                let x = ex - side * 5 + side * i
                let tilt = e == .confident ? (11 - i) / 3 : e == .shocked ? -abs(i - 6) / 2 : i / 6
                f.set(x, browY + tilt, ink); f.set(x, browY + tilt - 1, s.hair.hueShifted(-0.6))
            }
            if s.eyeBlack { f.fillRect(x: ex - 5, y: ey + h / 2 + 2, width: 9, height: 2, RGBA(hex: 0x15131C)) }
        }
        // Nose.
        for d in 9...11 { f.set(Int(cx) + 1, Int(cy) + d, s.skin.hueShifted(-0.8)) }
        f.set(Int(cx), Int(cy) + 12, s.skin.hueShifted(-0.6)); f.set(Int(cx) - 1, Int(cy) + 12, s.skin.hueShifted(-0.4))
        // Mouth.
        let my = Int(cy) + 17
        switch e {
        case .neutral:
            for x in (Int(cx) - 4)...(Int(cx) + 4) { f.set(x, my, s.skin.hueShifted(-0.9)) }
            f.set(Int(cx) + 5, my - 1, s.skin.hueShifted(-0.9))
        case .confident:
            // Toothy grin, higher on one side.
            for x in (Int(cx) - 5)...(Int(cx) + 5) {
                let lift = x > Int(cx) ? (x - Int(cx)) / 3 : 0
                f.set(x, my - lift, ink)
                f.set(x, my + 1 - lift, white)
                f.set(x, my + 2 - lift, x == Int(cx) - 5 || x == Int(cx) + 5 ? ink : RGBA(hex: 0xB03A48))
                f.set(x, my + 3 - lift, ink)
            }
        case .shocked:
            f.fillEllipse(cx: cx, cy: Double(my) + 2, rx: 4.2, ry: 4.5, ink)
            f.fillEllipse(cx: cx, cy: Double(my) + 4, rx: 2.8, ry: 1.8, RGBA(hex: 0xC0485A))
            for x in (Int(cx) - 3)...(Int(cx) + 3) { f.set(x, my - 1, white) }
        }
    }

    static func drawSweat(_ b: inout PixelBuffer, x: Int, y: Int) {
        let c = RGBA(hex: 0x9AD8FF)
        b.fillEllipse(cx: Double(x) + 2, cy: Double(y) + 5, rx: 2.5, ry: 3, c)
        b.fillRect(x: x + 2, y: y, width: 1, height: 3, c)
        b.set(x + 1, y + 4, RGBA(hex: 0xFFFFFF))
    }

    static func drawSparkle(_ b: inout PixelBuffer, x: Int, y: Int) {
        for d in -4...4 { b.set(x + d, y, Palette.highlight); b.set(x, y + d, Palette.highlight) }
        for d in -1...1 { b.set(x + d, y + d, RGBA(hex: 0xFFFFFF)); b.set(x + d, y - d, RGBA(hex: 0xFFFFFF)) }
    }

    /// Beveled frame with a caps name plate under the portrait (96 x 112).
    public static func framed(_ p: PixelBuffer, name: String, accent: RGBA) -> PixelBuffer {
        let w = size + 8, h = size + 8 + 15
        var b = PixelBuffer(width: w, height: h)
        b.fillRect(x: 0, y: 0, width: w, height: size + 8, Palette.outline)
        b.fillRect(x: 1, y: 1, width: w - 2, height: size + 6, accent.hueShifted(0.5))       // bevel light
        b.fillRect(x: 2, y: 2, width: w - 3, height: size + 5, accent.hueShifted(-0.6))      // bevel shadow
        b.fillRect(x: 2, y: 2, width: w - 4, height: size + 4, accent)
        b.blit(p, x: 4, y: 4)
        // Name plate.
        let py = size + 8
        b.fillRect(x: 0, y: py, width: w, height: 15, Palette.outline)
        b.fillRect(x: 1, y: py, width: w - 2, height: 14, RGBA(hex: 0x14162E))
        b.fillRect(x: 1, y: py, width: w - 2, height: 1, accent)
        let label = String(name.prefix(15))
        b.drawText(label, x: (w - PixelFont.width(of: label)) / 2, y: py + 4, RGBA(hex: 0xFFFFFF))
        return b
    }

    /// Integer 2x upscale (for the Spirit cut-in), still perfectly crisp.
    public static func scaled(_ p: PixelBuffer, _ k: Int) -> PixelBuffer {
        var o = PixelBuffer(width: p.width * k, height: p.height * k)
        for y in 0..<o.height { for x in 0..<o.width { o[x, y] = p[x / k, y / k] } }
        return o
    }
}
