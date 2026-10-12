import GSFoundation
import GSRenderCore

/// One positioned piece of screen UI. `key` identifies the texture (so the
/// app can cache it); `make` draws it. Positions are top-left canvas pixels.
public struct UIItem {
    public var key: AnyHashable
    public var x: Int
    public var y: Int
    public var make: () -> PixelBuffer
}

/// Lays out the HUD, play-call cards, kick meter and callout inside the safe
/// area. Shared by the iOS renderer and the preview tool so they never drift.
public enum UILayout {
    struct Key: Hashable { let kind: String; let a: String; let n: [Int] }

    public static func items(for f: RenderFrame, safeArea s: Rect, accent: RGBA) -> [UIItem] {
        var out: [UIItem] = []
        let left = Int(s.minX) + 4, right = Int(s.maxX) - 4, top = Int(s.minY) + 3

        if let h = f.hud {
            // Top center: scorebug.
            let a = h.abbreviations
            let poss0 = h.possession == 0 ? ">" : " ", poss1 = h.possession == 1 ? "<" : " "
            let line1 = "\(poss0)\(a[0]) \(pad(h.scores[0]))  Q\(h.quarter) \(h.clock)  \(pad(h.scores[1])) \(a[1])\(poss1)"
            let bug = Key(kind: "bug", a: line1, n: [])
            let bw = PixelFont.width(of: line1) + 8
            out.append(UIItem(key: bug, x: (Canvas.width - bw) / 2, y: top) { UIArt.panel(lines: [line1], accent: accent) })
            // Left: down & distance, play clock.
            let dd = [h.downDistance, h.fieldPosition]
            out.append(UIItem(key: Key(kind: "dd", a: dd.joined(separator: "|"), n: []), x: left, y: top) {
                UIArt.panel(lines: dd, colors: [RGBA(hex: 0xFFFFFF), RGBA(hex: 0x9AD8FF)], minWidth: 70)
            })
            if let pc = h.playClock {
                let t = ":" + (pc < 10 ? "0" : "") + "\(pc)"
                out.append(UIItem(key: Key(kind: "pc", a: t, n: []), x: left, y: top + 24) {
                    UIArt.panel(lines: [t], colors: [pc <= 5 ? RGBA(hex: 0xFF5A3C) : Palette.highlight], minWidth: 30)
                })
            }
            // Right: field strip, wind, active player stats.
            let bp = Int((h.ballProgress * 100).rounded()), lp = h.lineToGainProgress.map { Int(($0 * 100).rounded()) }
            out.append(UIItem(key: Key(kind: "strip", a: "", n: [bp, lp ?? -1]), x: right - 84, y: top) {
                UIArt.fieldStrip(ballPercent: bp, lineToGainPercent: lp)
            })
            let wind = "WIND \(h.windMPH) MPH"
            out.append(UIItem(key: Key(kind: "wind", a: wind, n: [h.windBucket]), x: right - 84, y: top + 11) {
                var b = UIArt.panel(lines: [wind + "   "], colors: [RGBA(hex: 0x9AD8FF)], minWidth: 84)
                if h.windMPH > 0 { b.blit(UIArt.windArrow(bucket: h.windBucket), x: b.width - 18, y: -1) }
                return b
            })
            if let p = h.activePlayer {
                let lines = [p.name, "SPD \(p.spd) POW \(p.pow)", "CATCH \(p.cat)"]
                let w = (lines.map { PixelFont.width(of: $0) }.max() ?? 0) + 8
                out.append(UIItem(key: Key(kind: "stats", a: lines.joined(separator: "|"), n: []), x: right - max(w, 84), y: top + 28) {
                    UIArt.panel(lines: lines, colors: [Palette.highlight, RGBA(hex: 0xFFFFFF), RGBA(hex: 0xFFFFFF)], minWidth: 84)
                })
            }
        }

        if let pc = f.playCall {
            let header = pc.header
            out.append(UIItem(key: Key(kind: "hdr", a: header, n: []), x: (Canvas.width - PixelFont.width(of: header) - 8) / 2, y: 70) {
                UIArt.panel(lines: [header], accent: pc.accent)
            })
            for c in pc.cards {
                out.append(UIItem(key: Key(kind: "card", a: c.title + c.category, n: []), x: Int(c.rect.minX), y: Int(c.rect.minY)) {
                    UIArt.playCard(title: c.title, category: c.category, diagram: c.diagram, accent: pc.accent, highlighted: false)
                })
            }
            if pc.pageCount > 1 {
                let hint = "< SWIPE  \(pc.page + 1)/\(pc.pageCount)  SWIPE >"
                out.append(UIItem(key: Key(kind: "hint", a: hint, n: []), x: (Canvas.width - PixelFont.width(of: hint)) / 2, y: 216) {
                    var b = PixelBuffer(width: PixelFont.width(of: hint) + 2, height: PixelFont.lineHeight + 1)
                    b.drawText(hint, x: 0, y: 0, RGBA(hex: 0xFFFFFF), shadow: Palette.outline)
                    return b
                })
            }
        }

        if let k = f.kickMeter {
            let p = Int((k.power * 100).rounded()), a = Int((k.aim * 100).rounded())
            out.append(UIItem(key: Key(kind: "kick", a: "", n: [p, a, k.stage]), x: (Canvas.width - 132) / 2, y: Int(s.maxY) - 44) {
                UIArt.kickMeter(power: Double(p) / 100, aim: Double(a) / 100, stage: k.stage)
            })
        }

        if let c = f.callout {
            out.append(UIItem(key: Key(kind: "callout", a: c, n: []), x: (Canvas.width - PixelFont.width(of: c) - 2) / 2, y: 104) {
                var b = PixelBuffer(width: PixelFont.width(of: c) + 2, height: PixelFont.lineHeight + 1)
                b.drawText(c, x: 0, y: 0, RGBA(hex: 0xFFE45C), shadow: Palette.outline)
                return b
            })
        }
        return out
    }

    static func pad(_ n: Int) -> String { n < 10 ? " \(n)" : "\(n)" }
}
