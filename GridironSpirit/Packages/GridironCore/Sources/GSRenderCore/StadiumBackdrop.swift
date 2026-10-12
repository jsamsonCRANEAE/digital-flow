import GSFoundation

/// Procedural stadium seen beyond the far end zone: sky, packed crowd tiers
/// (2-frame animation), a scoreboard and a padded wall with fake ad panels.
/// Built once at load; per frame we only copy rows with a parallax shift.
public final class StadiumBackdrop {
    public static let width = 960
    /// Extra rows above and below so screen shake never reveals an edge.
    public static let margin = 6
    public let contentHeight: Int
    public var height: Int { contentHeight + Self.margin * 2 }
    public private(set) var frames: [PixelBuffer]

    /// Original, fictional sponsors only.
    public static let sponsors = ["ZUNKO COLA", "RAMEN ROCKET", "BLITZO GUM", "KAIJUMOTO",
                                  "HYPERNOVA TV", "GOGO CURRY", "PIXELPOP", "TORII BANK"]

    public init(horizonRow: Int, home: RGBA, away: RGBA, seed: UInt64 = 0x6D5A) {
        contentHeight = horizonRow
        frames = []
        frames = [build(frame: 0, home: home, away: away, seed: seed),
                  build(frame: 1, home: home, away: away, seed: seed)]
    }

    /// Copies one canvas row (already offset into backdrop space) into `dst`.
    @inline(__always)
    func copyRow(_ row: Int, frame: Int, shiftX: Int, into dst: UnsafeMutableBufferPointer<UInt32>, offset: Int, count: Int) {
        let buf = frames[frame & 1]
        let r = clamp(row, 0, buf.height - 1)
        let start = (Self.width - count) / 2 + shiftX
        buf.pixels.withUnsafeBufferPointer { src in
            let srcBase = r * buf.width
            if start >= 0 && start + count <= buf.width {
                for i in 0..<count { dst[offset + i] = src[srcBase + start + i] }
            } else {
                for i in 0..<count { dst[offset + i] = src[srcBase + clamp(start + i, 0, buf.width - 1)] }
            }
        }
    }

    // MARK: Generation

    func build(frame: Int, home: RGBA, away: RGBA, seed: UInt64) -> PixelBuffer {
        let m = Self.margin
        var b = PixelBuffer(width: Self.width, height: contentHeight + m * 2, fill: Palette.skyTop)
        let wallTop = contentHeight - 12            // 12 px padded wall at the bottom
        let railTop = wallTop - 4
        let crowdTop = 8

        // Sky: ordered-dither gradient.
        for y in 0..<(crowdTop + m) {
            let t = Double(y) / Double(crowdTop + m)
            for x in 0..<Self.width {
                b[x, y] = (Double(Palette.bayer(x, y)) / 16 < t ? Palette.skyBottom : Palette.skyTop).argb
            }
        }
        // Light towers.
        for tx in stride(from: 60, to: Self.width, by: 210) {
            b.fillRect(x: tx, y: 0, width: 26, height: m + 3, RGBA(hex: 0x3A3F58))
            for lx in stride(from: tx + 2, to: tx + 24, by: 4) {
                b.fillRect(x: lx, y: 1, width: 2, height: 2, RGBA(hex: 0xFFF6C0))
            }
        }

        // Crowd: people are 2x4 px (hair, face, shirt, shirt shadow) packed in
        // tiers; frame 1 pops ~1/3 of them up a pixel (cheering).
        var rng = SplitMix64(seed: seed)
        let homeShadow = home.hueShifted(-0.5), awayShadow = away.hueShifted(-0.5)
        let tierRows = 6, personH = 4
        var y = crowdTop + m
        var tier = 0
        while y + personH <= railTop + m {
            // Tier backing (seat color).
            b.fillRect(x: 0, y: y, width: Self.width, height: tierRows * personH, RGBA(hex: tier & 1 == 0 ? 0x30285A : 0x3A2E66))
            for pr in 0..<tierRows {
                let py = y + pr * personH
                guard py + personH <= railTop + m else { break }
                var x = (pr & 1)
                while x < Self.width - 1 {
                    let roll = rng.unit()
                    let shirt: RGBA
                    if roll < 0.32 { shirt = home } else if roll < 0.52 { shirt = away }
                    else { shirt = Palette.crowdBright[rng.int(Palette.crowdBright.count)] }
                    let shirtShadow = roll < 0.32 ? homeShadow : roll < 0.52 ? awayShadow : shirt.hueShifted(-0.5)
                    let skin = Palette.skinTones[rng.int(Palette.skinTones.count)]
                    let hair = rng.unit() < 0.25 ? shirt : RGBA(hex: [0x1A1420, 0x3B2416, 0x6B4A2A, 0xD8C070][rng.int(4)])
                    let empty = rng.unit() < 0.04
                    let cheer = rng.unit() < 0.33
                    let jitter = rng.int(2)
                    if !empty {
                        let lift = (frame == 1 && cheer) ? 1 : 0
                        let top = py - lift + jitter - 1
                        for dx in 0..<2 {
                            b.set(x + dx, top, hair)
                            b.set(x + dx, top + 1, skin)
                            b.set(x + dx, top + 2, shirt)
                            b.set(x + dx, top + 3 + lift, dx == 1 ? shirtShadow : shirt)
                        }
                        // Raised arms on cheering frame.
                        if frame == 1 && cheer && rng.unit() < 0.5 {
                            b.set(x - 1, top - 1, skin)
                            b.set(x + 2, top - 1, skin)
                        }
                    }
                    x += 2 + (rng.unit() < 0.12 ? 1 : 0)
                }
            }
            y += tierRows * personH
            // Aisle / tier front edge.
            b.fillRect(x: 0, y: y, width: Self.width, height: 2, RGBA(hex: 0x8C8FB8))
            b.fillRect(x: 0, y: y + 1, width: Self.width, height: 1, RGBA(hex: 0x4A4C78))
            y += 2
            tier += 1
        }

        // Front railing.
        b.fillRect(x: 0, y: railTop + m, width: Self.width, height: 4, RGBA(hex: 0x2A2440))
        for x in stride(from: 0, to: Self.width, by: 6) { b.fillRect(x: x, y: railTop + m, width: 1, height: 4, RGBA(hex: 0x6A6890)) }
        b.fillRect(x: 0, y: railTop + m, width: Self.width, height: 1, RGBA(hex: 0xB8B8D8))

        drawScoreboard(&b, top: m + 21)   // below the HUD scorebug, between the side panels
        drawWall(&b, top: wallTop + m, home: home, away: away)

        // Below the wall (only seen during shake): wall base.
        b.fillRect(x: 0, y: contentHeight + m, width: Self.width, height: m, Palette.wallBase)
        return b
    }

    func drawScoreboard(_ b: inout PixelBuffer, top: Int) {
        let w = 132, h = 38
        let x0 = (Self.width - w) / 2
        // Support pillars.
        b.fillRect(x: x0 + 20, y: top + h, width: 6, height: 8, RGBA(hex: 0x2A2D44))
        b.fillRect(x: x0 + w - 26, y: top + h, width: 6, height: 8, RGBA(hex: 0x2A2D44))
        b.fillRect(x: x0 + 20, y: 0, width: 6, height: top, RGBA(hex: 0x2A2D44))       // hung from the roof
        b.fillRect(x: x0 + w - 26, y: 0, width: 6, height: top, RGBA(hex: 0x2A2D44))
        b.fillRect(x: x0 - 1, y: top - 1, width: w + 2, height: h + 2, Palette.outline)
        b.fillRect(x: x0, y: top, width: w, height: h, RGBA(hex: 0x3B3F5E))
        b.fillRect(x: x0 + 3, y: top + 3, width: w - 6, height: h - 6, RGBA(hex: 0x0C0C18))
        // Marquee bulbs.
        for bx in stride(from: x0 + 1, to: x0 + w - 1, by: 3) {
            b.set(bx, top + 1, Palette.highlight)
            b.set(bx, top + h - 2, Palette.highlight)
        }
        let amber = RGBA(hex: 0xFFB238)
        let l1 = "GRIDIRON", l2 = "SPIRIT"
        b.drawText(l1, x: x0 + (w - PixelFont.width(of: l1)) / 2, y: top + 7, amber, shadow: RGBA(hex: 0x6A3A08))
        b.drawText(l2, x: x0 + (w - PixelFont.width(of: l2)) / 2, y: top + 17, RGBA(hex: 0x5CF0FF), shadow: RGBA(hex: 0x0A4A60))
        // Fake LED "clock" dots.
        for i in 0..<10 { b.set(x0 + 40 + i * 5, top + 29, i & 1 == 0 ? amber : RGBA(hex: 0x6A3A08)) }
    }

    func drawWall(_ b: inout PixelBuffer, top: Int, home: RGBA, away: RGBA) {
        b.fillRect(x: 0, y: top, width: Self.width, height: 12, Palette.wallBase)
        b.fillRect(x: 0, y: top, width: Self.width, height: 1, Palette.wallCap)
        b.fillRect(x: 0, y: top + 11, width: Self.width, height: 1, Palette.outline)
        let panelColors: [(RGBA, RGBA)] = [
            (RGBA(hex: 0xF4F1E6), RGBA(hex: 0xC8283C)), (home, RGBA(hex: 0xFFFFFF)),
            (RGBA(hex: 0x1B1B2E), RGBA(hex: 0xFFD23F)), (away, RGBA(hex: 0xFFFFFF)),
            (RGBA(hex: 0x2ED1C4), RGBA(hex: 0x16102A)),
        ]
        var x = 2
        var i = 0
        while x < Self.width - 20 {
            let name = Self.sponsors[i % Self.sponsors.count]
            let (bg, fg) = panelColors[i % panelColors.count]
            let pw = PixelFont.width(of: name) + 14
            b.fillRect(x: x, y: top + 2, width: pw, height: 9, bg)
            b.fillRect(x: x, y: top + 2, width: pw, height: 1, bg.hueShifted(0.5))
            b.drawText(name, x: x + 7, y: top + 3, fg)
            x += pw + 4
            i += 1
        }
    }
}
