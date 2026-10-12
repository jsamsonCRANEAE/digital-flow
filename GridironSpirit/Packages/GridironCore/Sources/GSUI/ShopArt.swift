import Foundation
import GSFoundation
import GSData
import GSRenderCore

/// Gear icons, trophies and the shop interior (spec reference 3: wood
/// interior, shopkeeper, trophy shelf, pegboard).
public enum ShopArt {
    /// Tier palettes: I steel, II jade, III azure, IV violet, V legendary gold.
    static let tierColors: [(base: UInt32, trim: UInt32)] = [
        (0xC8CCD8, 0x6C7FB0), (0x4CC38A, 0x1E6E52), (0x3FA7FF, 0x1E4AA8), (0xB06BFF, 0x5A2A9A), (0xFFC83C, 0xE0402A),
    ]

    public static func tierColor(_ tier: Int) -> RGBA { RGBA(hex: tierColors[clamp(tier - 1, 0, 4)].base) }

    /// 22x22 procedural icon for an item (category silhouette, tier colors).
    public static func icon(_ item: GearItem) -> PixelBuffer {
        let tc = tierColors[clamp(item.tier - 1, 0, 4)]
        let base = RGBA(hex: tc.base), trim = RGBA(hex: tc.trim)
        let hi = base.hueShifted(0.6), lo = base.hueShifted(-0.6)
        var b = PixelBuffer(width: 22, height: 22)
        switch item.category {
        case .cleats:
            // Side-view boot: upper, toe cap, collar, sole with studs.
            b.fillEllipse(cx: 13, cy: 12, rx: 7.5, ry: 4.5, base)
            b.fillRect(x: 4, y: 6, width: 7, height: 9, base)
            b.fillRect(x: 4, y: 5, width: 7, height: 2, trim)                 // collar
            b.fillRect(x: 4, y: 15, width: 17, height: 2, lo)                 // sole
            for sx in [5, 9, 14, 18] { b.fillRect(x: sx, y: 17, width: 2, height: 2, RGBA(hex: 0xE8E8F0)) }
            b.fillRect(x: 9, y: 9, width: 8, height: 1, trim)                 // laces stripe
            b.fillRect(x: 6, y: 12, width: 12, height: 1, trim)
            b.set(16, 9, hi); b.set(17, 10, hi); b.set(5, 8, hi)
        case .gloves:
            b.fillRect(x: 6, y: 9, width: 10, height: 9, base)                // palm
            for (i, h) in [7, 8, 8, 6].enumerated() { b.fillRect(x: 6 + i * 2 + (i > 0 ? i / 2 : 0), y: 9 - h + 1, width: 2, height: h, base) }
            b.fillRect(x: 15, y: 10, width: 3, height: 5, base)               // thumb
            b.fillRect(x: 17, y: 9, width: 2, height: 3, base)
            b.fillRect(x: 6, y: 17, width: 10, height: 3, trim)               // cuff
            b.fillRect(x: 8, y: 12, width: 5, height: 3, hi)                  // grip pad
            b.set(7, 3, hi); b.set(9, 2, hi)
        case .helmets:
            // Side view facing right: dome, open lower front, facemask cage.
            b.fillEllipse(cx: 10, cy: 10, rx: 8.5, ry: 8, base)
            b.fillRect(x: 2, y: 10, width: 6, height: 7, base)                // back shell flare
            for y in 12..<20 { for x in 14..<22 { b.set(x, y, .clear) } }      // face opening
            for y in 0..<22 { for x in 0..<22 {                                // stripe arc over the top
                let dx = Double(x) - 10, dy = Double(y) - 10
                let d = (dx * dx + dy * dy).squareRoot()
                if dy < 1 && d > 5.2 && d < 6.6 && dx < 4 { b.set(x, y, trim) }
            }}
            b.fillRect(x: 8, y: 11, width: 3, height: 3, lo)                  // ear hole
            let mask = RGBA(hex: 0xE8E8F0)
            b.fillRect(x: 14, y: 12, width: 7, height: 1, mask)
            b.fillRect(x: 14, y: 15, width: 7, height: 1, mask)
            b.fillRect(x: 20, y: 12, width: 1, height: 6, mask)
            b.fillRect(x: 13, y: 17, width: 8, height: 1, mask)
            b.fillRect(x: 4, y: 17, width: 7, height: 2, lo)                  // chin strap / jaw pad
            b.set(6, 4, hi); b.set(7, 3, hi); b.set(5, 5, hi); b.set(8, 3, hi)
        case .training:
            // Dumbbell.
            b.fillRect(x: 6, y: 10, width: 10, height: 2, RGBA(hex: 0xE8E8F0))
            for x in [2, 16] {
                b.fillRect(x: x, y: 5, width: 4, height: 12, base)
                b.fillRect(x: x + 1, y: 6, width: 1, height: 10, hi)
                b.fillRect(x: x, y: 15, width: 4, height: 2, lo)
            }
            b.fillRect(x: 0, y: 8, width: 2, height: 6, trim)
            b.fillRect(x: 20, y: 8, width: 2, height: 6, trim)
        }
        b.addOutline(Palette.outline)
        if item.tier == 5 {        // legendary: tiny star badge
            for (dx, dy) in [(0, -1), (-1, 0), (0, 0), (1, 0), (0, 1)] { b.set(19 + dx, 2 + dy, RGBA(hex: 0xFFFFFF)) }
        }
        return b
    }

    /// 18x22 gold cup with team-colored ribbon.
    public static func trophy(color: RGBA) -> PixelBuffer {
        var b = PixelBuffer(width: 18, height: 22)
        let g = RGBA(hex: 0xFFC83C), gl = RGBA(hex: 0xFFF6C0), gd = RGBA(hex: 0xB9832A)
        b.fillEllipse(cx: 8.5, cy: 5, rx: 6.5, ry: 5, g)
        b.fillRect(x: 2, y: 1, width: 14, height: 4, g)
        b.fillEllipse(cx: 1.5, cy: 5, rx: 1.5, ry: 2.5, gd)                   // handles
        b.fillEllipse(cx: 15.5, cy: 5, rx: 1.5, ry: 2.5, gd)
        b.fillRect(x: 7, y: 10, width: 4, height: 5, gd)                      // stem
        b.fillRect(x: 4, y: 15, width: 10, height: 3, g)
        b.fillRect(x: 3, y: 18, width: 12, height: 3, color)                  // plinth in team color
        b.fillRect(x: 4, y: 2, width: 2, height: 5, gl)
        b.addOutline(Palette.outline)
        return b
    }

    /// Dusty outline for a trophy not yet won.
    public static let emptyTrophy: PixelBuffer = {
        var b = trophy(color: RGBA(hex: 0x4A3A30))
        for i in b.pixels.indices where b.pixels[i] >> 24 != 0 && RGBA(argb: b.pixels[i]) != Palette.outline {
            b.pixels[i] = RGBA(hex: 0x4A3A30).argb
        }
        b.drawText("?", x: 6, y: 3, RGBA(hex: 0x6A5444))
        return b
    }()

    /// Shopkeeper "OLD MAN GORO": a retired lineman. Built on the portrait
    /// renderer (gray buzz cut, headband) plus an apron overlay.
    public static func shopkeeper(expression: Expression) -> PixelBuffer {
        var spec = PortraitSpec(seed: 0x60_0B_0D, jersey: RGBA(hex: 0x8E2A2A), trim: RGBA(hex: 0xF2E3C8), number: 77, archetype: 0, big: true)
        spec.hair = RGBA(hex: 0xBFC3CC); spec.hairStyle = 3; spec.headband = true; spec.eyeBlack = false
        spec.skin = Palette.skinTones[2]
        var p = Portraits.render(spec, expression, background: false)
        // Apron bib over the jersey.
        let apron = RGBA(hex: 0x6B4A2A)
        for y in 70..<p.height { for x in 30..<58 where p.isOpaque(x, y) { p[x, y] = apron.argb } }
        p.fillRect(x: 30, y: 70, width: 28, height: 1, apron.hueShifted(0.5))
        p.fillRect(x: 38, y: 76, width: 12, height: 6, apron.hueShifted(-0.5))   // pocket
        return p
    }

    /// Static shop interior for the left portion (width `w`). Trophies and
    /// pegboard items are drawn on top by the flow (they change).
    public static func interior(width w: Int, height h: Int) -> PixelBuffer {
        var b = PixelBuffer(width: w, height: h)
        // Plank wall: vertical boards with grain and hue-shifted seams.
        let woods = [0x8A5A34, 0x7E5230, 0x94643A, 0x845632].map { RGBA(hex: $0) }
        var rng = SplitMix64(seed: 0x5409)
        let plank = 22
        for px in stride(from: 0, to: w, by: plank) {
            let c = woods[rng.int(woods.count)]
            for y in 0..<h { for x in px..<min(w, px + plank) {
                let grain = (Int(sinD(Double(y) * 0.21 + Double(px)) * 3) + x) % 7 == 0
                b[x, y] = (grain ? c.hueShifted(-0.25) : c).argb
            }}
            b.fillRect(x: px, y: 0, width: 1, height: h, c.hueShifted(-0.8))
            b.fillRect(x: px + 1, y: 0, width: 1, height: h, c.hueShifted(0.3))
            for ny in [18, h - 70] { b.set(px + plank / 2, ny, RGBA(hex: 0x3A2A1E)) }   // nails
        }
        // Warm lamp light falloff from the top center (dithered).
        for y in 0..<h { for x in 0..<w {
            let dx = Double(x - w / 2) / Double(w), dy = Double(y) / Double(h)
            let d = (dx * dx * 2.2 + dy * dy).squareRoot()
            if Double(Palette.bayer(x, y)) / 16 < (d - 0.35) * 1.2 { b[x, y] = RGBA(argb: b[x, y]).hueShifted(-0.45).argb }
        }}
        // Trophy shelf.
        let shelfY = 58
        b.fillRect(x: 16, y: shelfY, width: w - 32, height: 5, RGBA(hex: 0x5A3A22))
        b.fillRect(x: 16, y: shelfY, width: w - 32, height: 1, RGBA(hex: 0xB07A4A))
        b.fillRect(x: 16, y: shelfY + 5, width: w - 32, height: 2, RGBA(hex: 0x2A1A10))
        for bx in [30, w - 34] { b.fillRect(x: bx, y: shelfY + 5, width: 4, height: 8, RGBA(hex: 0x3A2A1E)) }
        b.drawText("SPIRIT CUP", x: (w - PixelFont.width(of: "SPIRIT CUP")) / 2, y: 6, RGBA(hex: 0xF2E3C8), shadow: RGBA(hex: 0x2A1A10))
        // Pegboard (right side of the wall).
        let pbx = w - 132, pby = 76, pbw = 116, pbh = 92
        b.fillRect(x: pbx - 2, y: pby - 2, width: pbw + 4, height: pbh + 4, RGBA(hex: 0x3A2A1E))
        b.fillRect(x: pbx, y: pby, width: pbw, height: pbh, RGBA(hex: 0xC89A64))
        for yy in stride(from: pby + 4, to: pby + pbh, by: 8) { for xx in stride(from: pbx + 4, to: pbx + pbw, by: 8) {
            b.set(xx, yy, RGBA(hex: 0x7A5A3A))
        }}
        // Pennant and a framed photo on the left wall (original art).
        let pen = RGBA(hex: 0xE0402A)
        for i in 0..<30 { b.fillRect(x: 22 + i, y: 80 + i / 5, width: 1, height: max(1, 14 - i * 14 / 30), pen) }
        b.fillRect(x: 22, y: 80, width: 2, height: 16, RGBA(hex: 0x3A2A1E))
        b.drawText("GO!", x: 28, y: 83, RGBA(hex: 0xFFFFFF))
        b.fillRect(x: 64, y: 78, width: 52, height: 40, RGBA(hex: 0x3A2A1E))
        b.fillRect(x: 67, y: 81, width: 46, height: 34, Palette.skyBottom)
        b.fillRect(x: 67, y: 103, width: 46, height: 12, Palette.turfLight)
        for (i, c) in [0xFFFFFF, 0xF6F4E8].enumerated() { b.fillRect(x: 67, y: 106 + i * 4, width: 46, height: 1, RGBA(hex: UInt32(c))) }
        b.fillEllipse(cx: 90, cy: 96, rx: 5, ry: 3, RGBA(hex: 0x8A4A24))      // a ball in the photo
        b.fillRect(x: 88, y: 96, width: 5, height: 1, RGBA(hex: 0xFFFFFF))
        // Counter: front panel with bevel, top surface.
        let cy = h - ShopArt.counterHeight
        b.fillRect(x: 0, y: cy, width: w, height: 6, RGBA(hex: 0xB07A4A))
        b.fillRect(x: 0, y: cy, width: w, height: 1, RGBA(hex: 0xE0B07A))
        b.fillRect(x: 0, y: cy + 6, width: w, height: h - cy - 6, RGBA(hex: 0x5A3A22))
        for px in stride(from: 8, to: w, by: 48) {
            b.fillRect(x: px, y: cy + 12, width: 36, height: 30, RGBA(hex: 0x4A2E1A))
            b.fillRect(x: px, y: cy + 12, width: 36, height: 1, RGBA(hex: 0x7A5232))
        }
        // Floor shadow under counter.
        b.fillRect(x: 0, y: h - 4, width: w, height: 4, RGBA(hex: 0x2A1A10))
        return b
    }

    public static let interiorShelfY = 58
    public static let counterHeight = 50
    public static let pegboard = (x: -132, y: 76, w: 116, h: 92)    // x relative to interior width
}
