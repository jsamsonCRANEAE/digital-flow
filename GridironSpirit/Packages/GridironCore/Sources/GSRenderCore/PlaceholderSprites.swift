import GSFoundation

/// Which side of the player faces the camera.
public enum SpriteView: Int, Sendable, Hashable { case back = 0, front = 1 }

/// Body pose. Run frames are the 4-frame cycle; the rest are held poses with
/// exaggerated anime silhouettes (big wind-up, full extension).
public enum SpritePose: Int, Sendable, Hashable, CaseIterable {
    case idle, run0, run1, run2, run3, throwing, stiffArm, dive, down, stumble

    public static func run(_ i: Int) -> SpritePose { SpritePose(rawValue: 1 + (i & 3))! }
    public var runIndex: Int? { (1...4).contains(rawValue) ? rawValue - 1 : nil }
}

public struct PlayerLook: Sendable, Hashable {
    public var jersey: RGBA
    public var trim: RGBA
    public var pants: RGBA
    public var helmet: RGBA
    public var skin: RGBA
    public init(jersey: RGBA, trim: RGBA, pants: RGBA, helmet: RGBA, skin: RGBA) {
        self.jersey = jersey; self.trim = trim; self.pants = pants; self.helmet = helmet; self.skin = skin
    }
}

/// Procedural placeholder player art (M1-M3). It already follows the final
/// pixel rules: 1 px dark outline, hue-shifted shadows/highlights with a
/// dithered terminator, anime proportions (big helmet, big gloves), and it
/// is drawn natively at every height bucket instead of being scaled, so the
/// outline stays exactly 1 px at any depth.
public enum PlaceholderSprites {
    public static let runFrames = 4
    /// Frame 0 = idle/stance, 1...4 = run cycle.
    public static let frameCount = 1 + runFrames

    public static func width(forHeight h: Int) -> Int {
        let w = Int((Double(h) * 0.78).rounded())
        return w + (w & 1)
    }

    /// Back-compat helper: frame 0 = idle, 1...4 = run cycle.
    public static func player(height h: Int, look: PlayerLook, view: SpriteView, frame: Int) -> PixelBuffer {
        player(height: h, look: look, view: view, pose: frame == 0 ? .idle : .run(frame - 1), squash: 0)
    }

    /// - Parameter squash: -1 squashed (landing / impact), 0 normal, +1 stretched (launch).
    ///   Drawn natively at the new size so outlines stay 1 px.
    public static func player(height h: Int, look: PlayerLook, view: SpriteView, pose: SpritePose, squash: Int) -> PixelBuffer {
        switch pose {
        case .down, .dive:
            // Lying / flying horizontally: draw the upright figure, rotate it a
            // quarter turn (lossless in pixel art) and foreshorten vertically,
            // because a body lying on the turf is seen at a grazing angle.
            let upright = body(height: h, widthScale: 1, look: look, view: view,
                               pose: pose == .dive ? .throwing : .idle, armsUp: pose == .dive)
            var lying = upright.rotatedClockwise()
            lying = lying.resampledVertically(to: max(6, Int(Double(lying.height) * (pose == .dive ? 0.62 : 0.5))))
            lying.addOutline(Palette.outline)
            return lying
        default:
            let (hs, ws) = squash < 0 ? (0.86, 1.18) : squash > 0 ? (1.1, 0.9) : (1.0, 1.0)
            let hh = max(8, Int((Double(h) * hs / 2).rounded()) * 2)
            var b = body(height: hh, widthScale: ws * (pose == .stiffArm ? 1.45 : 1), look: look, view: view,
                         pose: pose, armsUp: false)
            if pose == .stumble { b = b.sheared(amount: 0.14) }
            b.addOutline(Palette.outline)
            return b
        }
    }

    static func body(height h: Int, widthScale sx: Double, look: PlayerLook, view: SpriteView,
                     pose: SpritePose, armsUp: Bool) -> PixelBuffer {
        var w = Int((Double(width(forHeight: h)) * sx).rounded())
        w += w & 1
        var b = PixelBuffer(width: w, height: h)
        let s = Double(h - 2)          // drawable height inside the outline margin
        let top = 1.0
        let cx = Double(w) / 2
        let bodyScaleX = pose == .stiffArm ? sx / 1.45 : sx
        func px(_ u: Double) -> Double { cx + u * s * bodyScaleX }   // horizontal unit -> pixel
        func py(_ v: Double) -> Double { top + v * s }               // vertical unit -> pixel

        // Run cycle: which leg is lifted and how the arms swing.
        let frame = pose.runIndex.map { $0 + 1 } ?? 0
        let run = frame > 0
        let phase = (frame - 1) % 4
        let liftL = run && phase == 0 ? 0.075 : 0
        let liftR = run && phase == 2 ? 0.075 : 0
        let bob = run && (phase == 1 || phase == 3) ? 1.0 / s : 0
        let armSwing = !run ? 0 : (phase == 0 ? 0.045 : phase == 2 ? -0.045 : 0)
        let crouch = run || pose == .stiffArm ? 0 : (pose == .throwing ? 0.01 : 0.02)

        let jersey = look.jersey, trim = look.trim, pants = look.pants
        let helmet = look.helmet, skin = look.skin
        let sock = jersey.hueShifted(-0.25)
        let shoe = RGBA(hex: 0x23202E)
        let grey = RGBA(hex: 0xB8BCC8)

        // Legs (drawn first so the pants overlap the tops).
        let legTop = 0.70 + crouch + bob
        func leg(_ u0: Double, _ u1: Double, lift: Double) {
            shadedRect(&b, x0: px(u0), x1: px(u1), y0: py(legTop), y1: py(0.92 - lift + bob), base: sock)
            shadedRect(&b, x0: px(u0 - 0.01), x1: px(u1 + 0.01), y0: py(0.92 - lift + bob), y1: py(1.0 - lift), base: shoe)
        }
        leg(-0.125, -0.025, lift: liftL)
        leg(0.025, 0.125, lift: liftR)

        // Pants.
        shadedRect(&b, x0: px(-0.15), x1: px(0.15), y0: py(0.53 + crouch + bob), y1: py(0.73 + crouch + bob), base: pants)

        // Arms (behind torso edges) with oversized gloves.
        let armTop = 0.33 + crouch + bob
        for side in [-1.0, 1.0] {
            let swing = side * armSwing
            let ax0 = side < 0 ? -0.255 : 0.165, ax1 = side < 0 ? -0.165 : 0.255
            let raised = armsUp || (pose == .throwing && side > 0)
            if raised {
                // Exaggerated wind-up: arm cocked high above the helmet.
                shadedRect(&b, x0: px(ax0), x1: px(ax1), y0: py(-0.02), y1: py(armTop + 0.04), base: jersey)
                shadedEllipse(&b, cx: px((ax0 + ax1) / 2), cy: py(-0.02), rx: 0.062 * s, ry: 0.055 * s, base: trim)
                continue
            }
            if pose == .stiffArm && side > 0 {
                // Full extension: straight arm, giant palm.
                shadedRect(&b, x0: px(0.16), x1: px(0.44), y0: py(armTop), y1: py(armTop + 0.075), base: jersey)
                shadedEllipse(&b, cx: px(0.47), cy: py(armTop + 0.04), rx: 0.07 * s, ry: 0.065 * s, base: trim)
                continue
            }
            let lean = pose == .throwing ? 0.05 : 0
            shadedRect(&b, x0: px(ax0), x1: px(ax1), y0: py(armTop), y1: py(0.41 + crouch + bob), base: jersey)
            shadedRect(&b, x0: px(ax0 + 0.01 - lean), x1: px(ax1 - 0.01 - lean), y0: py(0.41 + crouch + bob),
                       y1: py(0.50 + swing + crouch + bob), base: skin)
            shadedEllipse(&b, cx: px((ax0 + ax1) / 2 - lean), cy: py(0.535 + swing + crouch + bob),
                          rx: 0.058 * s, ry: 0.05 * s, base: trim)
        }

        // Torso + shoulder pads.
        shadedRect(&b, x0: px(-0.17), x1: px(0.17), y0: py(0.31 + crouch + bob), y1: py(0.56 + crouch + bob), base: jersey)
        shadedEllipse(&b, cx: px(0), cy: py(0.315 + crouch + bob), rx: 0.255 * s, ry: 0.07 * s, base: jersey)
        // Trim stripe on the sleeves / collar.
        let collarY = py(0.27 + crouch + bob)
        fillRectD(&b, x0: px(-0.06), x1: px(0.06), y0: collarY, y1: collarY + max(1, 0.025 * s), trim)

        // Jersey number placeholder block (real numerals come with M4 art).
        if h >= 36 {
            let ny0 = py(0.36 + crouch + bob), ny1 = py(0.48 + crouch + bob)
            fillRectD(&b, x0: px(-0.07), x1: px(-0.015), y0: ny0, y1: ny1, trim)
            fillRectD(&b, x0: px(0.015), x1: px(0.07), y0: ny0, y1: ny1, trim)
        }

        // Helmet: anime-big head.
        let hy = py(0.145 + crouch + bob)
        shadedEllipse(&b, cx: px(0), cy: hy, rx: 0.15 * s, ry: 0.14 * s, base: helmet)
        // Center stripe.
        fillRectD(&b, x0: px(-0.018), x1: px(0.018), y0: hy - 0.14 * s, y1: hy + (view == .back ? 0.12 : 0.0) * s, trim)
        if view == .front {
            // Face opening + mask bars.
            fillRectD(&b, x0: px(-0.085), x1: px(0.085), y0: hy + 0.0 * s, y1: hy + 0.10 * s, skin.hueShifted(-0.3))
            fillRectD(&b, x0: px(-0.10), x1: px(0.10), y0: hy + 0.035 * s, y1: hy + 0.035 * s + 1, grey)
            fillRectD(&b, x0: px(-0.10), x1: px(0.10), y0: hy + 0.085 * s, y1: hy + 0.085 * s + 1, grey)
        } else {
            // Back of helmet: darker lower rim.
            fillRectD(&b, x0: px(-0.11), x1: px(0.11), y0: hy + 0.10 * s, y1: hy + 0.12 * s, helmet.hueShifted(-0.6))
        }

        return b
    }

    /// Soft oval ground shadow: solid core with a dithered rim. Drawn with node
    /// alpha by the renderer; it never leaves the ground, which is what makes
    /// jump/ball height readable.
    public static func shadow(width w: Int) -> PixelBuffer {
        let ww = max(4, w), hh = max(3, Int((Double(ww) * 0.32).rounded()))
        var b = PixelBuffer(width: ww, height: hh)
        let cx = Double(ww) / 2, cy = Double(hh) / 2
        for y in 0..<hh {
            for x in 0..<ww {
                let dx = (Double(x) + 0.5 - cx) / cx, dy = (Double(y) + 0.5 - cy) / cy
                let d = dx * dx + dy * dy
                if d <= 0.55 || (d <= 1 && (x + y) & 1 == 0) { b[x, y] = Palette.shadow.argb }
            }
        }
        return b
    }

    /// Marker above the human-controlled player.
    public static func controlMarker() -> PixelBuffer {
        var b = PixelBuffer(width: 9, height: 6)
        for row in 0..<4 {
            for x in row..<(9 - row) { b[x, row + 1] = (row == 0 ? Palette.highlight.hueShifted(0.4) : Palette.highlight).argb }
        }
        b.addOutline(Palette.outline)
        return b
    }

    public static func joystickBase(radius r: Int) -> PixelBuffer {
        let d = r * 2 + 3
        var b = PixelBuffer(width: d, height: d)
        let c = Double(d) / 2
        let ring = RGBA(hex: 0xE8ECFF), fill = RGBA(hex: 0x1A1E3A)
        for y in 0..<d {
            for x in 0..<d {
                let dist = ((Double(x) + 0.5 - c) * (Double(x) + 0.5 - c) + (Double(y) + 0.5 - c) * (Double(y) + 0.5 - c)).squareRoot()
                if abs(dist - Double(r)) < 0.75 { b[x, y] = ring.argb }
                else if dist < Double(r) && (x + y) & 1 == 0 { b[x, y] = fill.argb }
            }
        }
        return b
    }

    public static func joystickKnob(radius r: Int) -> PixelBuffer {
        let d = r * 2 + 2
        var b = PixelBuffer(width: d, height: d)
        let base = RGBA(hex: 0xF2F4FF)
        shadedEllipse(&b, cx: Double(d) / 2, cy: Double(d) / 2, rx: Double(r), ry: Double(r), base: base)
        b.addOutline(Palette.outline)
        return b
    }

    // MARK: Shading helpers (top-left key light)

    static func shade(_ base: RGBA, relX: Double, relY: Double, x: Int, y: Int) -> RGBA {
        if relX > 0.55 { return base.hueShifted(-0.6) }
        if relX > 0.30 { return (x + y) & 1 == 0 ? base.hueShifted(-0.6) : base }   // dithered terminator
        if relX < -0.45 && relY < -0.15 { return base.hueShifted(0.55) }
        return base
    }

    static func shadedRect(_ b: inout PixelBuffer, x0: Double, x1: Double, y0: Double, y1: Double, base: RGBA) {
        let ix0 = Int(x0.rounded()), ix1 = Int(x1.rounded()), iy0 = Int(y0.rounded()), iy1 = Int(y1.rounded())
        guard ix1 > ix0, iy1 > iy0 else { return }
        let mx = Double(ix0 + ix1) / 2, hw = max(0.5, Double(ix1 - ix0) / 2)
        let my = Double(iy0 + iy1) / 2, hh = max(0.5, Double(iy1 - iy0) / 2)
        for y in iy0..<iy1 {
            for x in ix0..<ix1 {
                let rx = (Double(x) + 0.5 - mx) / hw, ry = (Double(y) + 0.5 - my) / hh
                b.set(x, y, shade(base, relX: rx, relY: ry, x: x, y: y))
            }
        }
    }

    static func shadedEllipse(_ b: inout PixelBuffer, cx: Double, cy: Double, rx: Double, ry: Double, base: RGBA) {
        guard rx > 0.3, ry > 0.3 else { return }
        let x0 = Int((cx - rx).rounded(.down)), x1 = Int((cx + rx).rounded(.up))
        let y0 = Int((cy - ry).rounded(.down)), y1 = Int((cy + ry).rounded(.up))
        for y in y0...y1 {
            for x in x0...x1 {
                let dx = (Double(x) + 0.5 - cx) / rx, dy = (Double(y) + 0.5 - cy) / ry
                if dx * dx + dy * dy <= 1 { b.set(x, y, shade(base, relX: dx, relY: dy, x: x, y: y)) }
            }
        }
    }

    static func fillRectD(_ b: inout PixelBuffer, x0: Double, x1: Double, y0: Double, y1: Double, _ c: RGBA) {
        let ix0 = Int(x0.rounded()), ix1 = Int(x1.rounded()), iy0 = Int(y0.rounded()), iy1 = Int(y1.rounded())
        b.fillRect(x: ix0, y: iy0, width: max(1, ix1 - ix0), height: max(1, iy1 - iy0), c)
    }
}

/// Depth -> on-screen size rules for sprites.
public enum SpriteMetrics {
    /// Physical player height used for projection (yards, incl. helmet).
    public static let playerHeightYards = 2.05
    /// Arcade exaggeration over true perspective size (readability).
    public static let exaggeration = 1.25
    public static let minHeight = 12
    public static let maxHeight = 80

    /// Sprite height in canvas px for a given projection scale, quantized
    /// to even sizes so the number of distinct textures stays bounded.
    public static func playerHeight(pixelsPerYard: Double) -> Int {
        let h = playerHeightYards * exaggeration * pixelsPerYard
        let even = Int((h / 2).rounded()) * 2
        return clamp(even, minHeight, maxHeight)
    }

    public static func shadowWidth(forPlayerHeight h: Int) -> Int {
        max(4, Int((Double(h) * 0.5).rounded()))
    }
}
