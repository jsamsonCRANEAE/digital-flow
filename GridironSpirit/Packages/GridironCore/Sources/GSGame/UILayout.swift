import GSFoundation
import GSRenderCore

/// One positioned piece of screen UI. `key` identifies the texture (so the
/// app can cache it); `make` draws it. Positions are top-left canvas pixels.
public struct UIItem {
    public var key: AnyHashable
    public var x: Int
    public var y: Int
    public var make: () -> PixelBuffer
    public init(key: AnyHashable, x: Int, y: Int, make: @escaping () -> PixelBuffer) { self.key = key; self.x = x; self.y = y; self.make = make }
}

/// Lays out the HUD, play-call cards, kick meter and callout inside the safe
/// area. Shared by the iOS renderer and the preview tool so they never drift.
public enum UILayout {
    struct Key: Hashable { let kind: String; let a: String; let n: [Int] }

    public static func items(for f: RenderFrame, safeArea s: Rect, accent: RGBA) -> [UIItem] {
        var out: [UIItem] = []
        let left = Int(s.minX) + 4, right = Int(s.maxX) - 4, top = Int(s.minY) + 3

        if let h = f.hud, !f.replay {
            // Top center: scorebug.
            let a = h.abbreviations
            let poss0 = h.possession == 0 ? ">" : " ", poss1 = h.possession == 1 ? "<" : " "
            let period = h.clock.hasPrefix("OT") ? h.clock : "Q\(h.quarter) \(h.clock)"
            let line1 = "\(poss0)\(a[0]) \(pad(h.scores[0]))  \(period)  \(pad(h.scores[1])) \(a[1])\(poss1)"
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

        // Spirit meters under the scorebug.
        if f.hud != nil && !f.replay && f.spirit.count == 2 && f.spiritColors.count == 2 {
            let pulse = Int(f.simTime * 6)
            for t in 0..<2 {
                let full = f.spirit[t] >= 1
                let pct = Int((f.spirit[t] * 100).rounded())
                let x = t == 0 ? Canvas.width / 2 - 66 : Canvas.width / 2 + 2
                out.append(UIItem(key: Key(kind: "spirit", a: "", n: [t, pct, full ? pulse & 1 : 9]), x: x, y: top + 15) {
                    ArcadeArt.spiritMeter(fill: f.spirit[t], color: f.spiritColors[t], full: full, pulse: pulse,
                                          label: full ? "SPIRIT!" : "SPIRIT")
                })
            }
        }

        // Matchup / reaction portraits.
        if let m = f.matchup, f.cutIn == nil, !f.replay {
            let w = Portraits.size + 8
            let y = 112
            let lx = Int(lerp(-Double(w) - 4, Double(left), m.slide)), rx = Int(lerp(Double(Canvas.width + 4), Double(right - w), m.slide))
            for (info, e, x) in [(m.left, m.leftExpression, lx), (m.right, m.rightExpression, rx)] {
                out.append(UIItem(key: Key(kind: "portrait", a: info.playerID, n: [e.rawValue]), x: x, y: y) {
                    Portraits.framed(Portraits.render(info.spec, e), name: info.name, accent: info.jersey)
                })
            }
        }

        // Spirit cut-in: dim, diagonal band, 2x portrait, names in chrome.
        if let c = f.cutIn {
            let t = c.t
            let inT = clamp(t / 0.22, 0, 1), outT = clamp((t - 1.2) / 0.25, 0, 1)
            let ease = 1 - (1 - inT) * (1 - inT) * (1 - inT)
            out.append(UIItem(key: Key(kind: "dim", a: "", n: []), x: 0, y: 0) { ArcadeArt.dim(width: Canvas.width, height: Canvas.height) })
            let bandW = 760, bandH = 132
            let bx = Int(lerp(-Double(bandW), -60, ease) + outT * 760), by = 96
            let frameN = Int(t * 15) & 1
            out.append(UIItem(key: Key(kind: "band", a: c.spiritName, n: [frameN]), x: bx, y: by) {
                ArcadeArt.cutInBand(width: bandW, height: bandH, primary: c.primary, accent: c.accent, motif: c.motif, frame: frameN)
            })
            let px = Int(lerp(-200, 34, ease) + outT * 700), py = Int(lerp(296, 50, ease))
            out.append(UIItem(key: Key(kind: "cutportrait", a: c.portrait.playerID, n: []), x: px, y: py) {
                Portraits.scaled(Portraits.framed(Portraits.render(c.portrait.spec, .confident), name: c.playerName, accent: c.accent), 2)
            })
            let tx = Int(lerp(Double(Canvas.width), 250, ease) + outT * 500)
            let k = t < 0.3 ? 5 : 4
            out.append(UIItem(key: Key(kind: "cutname", a: c.spiritName, n: [k]), x: tx, y: 132) {
                ArcadeArt.callout(c.spiritName, scale: k, style: .chrome)
            })
            out.append(UIItem(key: Key(kind: "cutsub", a: c.playerName, n: []), x: tx + 4, y: 176) {
                ArcadeArt.callout("SPIRIT PLAY", scale: 2, style: .fire)
            })
            if t > 1.42 {
                out.append(UIItem(key: Key(kind: "flash", a: "", n: []), x: 0, y: 0) {
                    PixelBuffer(width: Canvas.width, height: Canvas.height, fill: RGBA(hex: 0xFFFFFF))
                })
            }
        }

        // Instant replay: letterbox + blinking tag.
        if f.replay {
            out.append(UIItem(key: Key(kind: "lbt", a: "", n: []), x: 0, y: 0) { ArcadeArt.bar(width: Canvas.width, height: 22, RGBA(hex: 0x05040A)) })
            out.append(UIItem(key: Key(kind: "lbb", a: "", n: []), x: 0, y: Canvas.height - 22) { ArcadeArt.bar(width: Canvas.width, height: 22, RGBA(hex: 0x05040A)) })
            if Int(f.simTime * 3) & 1 == 0 {
                out.append(UIItem(key: Key(kind: "replaytag", a: "", n: []), x: left + 4, y: 4) {
                    ArcadeArt.callout("REPLAY", scale: 2, style: .fire)
                })
            }
            let hint = "TAP TO SKIP"
            out.append(UIItem(key: Key(kind: "skiphint", a: hint, n: []), x: right - PixelFont.width(of: hint) - 4, y: Canvas.height - 15) {
                var b = PixelBuffer(width: PixelFont.width(of: hint) + 2, height: 9)
                b.drawText(hint, x: 0, y: 0, RGBA(hex: 0x9AD8FF))
                return b
            })
        }

        // Callouts: the big moments get chrome block letters with an overshoot pop.
        if let c = f.callout, f.cutIn == nil {
            if let style = bigCallouts[c] {
                let base = PixelFont.width(of: c) * 4 + 12 > Canvas.width - 40 ? 3 : 4
                if let k = ArcadeArt.calloutScale(age: f.calloutAge, life: f.calloutLife, base: base) {
                    let w = PixelFont.width(of: c) * k + 10, h = PixelFont.glyphHeight * k + 10
                    out.append(UIItem(key: Key(kind: "big", a: c, n: [k]), x: (Canvas.width - w) / 2, y: f.replay ? 30 : 84 - h / 2 + 14) {
                        ArcadeArt.callout(c, scale: k, style: style)
                    })
                }
            } else {
                out.append(UIItem(key: Key(kind: "callout", a: c, n: []), x: (Canvas.width - PixelFont.width(of: c) - 2) / 2, y: f.replay ? 34 : 104) {
                    var b = PixelBuffer(width: PixelFont.width(of: c) + 2, height: PixelFont.lineHeight + 1)
                    b.drawText(c, x: 0, y: 0, RGBA(hex: 0xFFE45C), shadow: Palette.outline)
                    return b
                })
            }
        }

        // First play call of the day: today's trials.
        if let lines = f.trialsBanner {
            out.append(UIItem(key: Key(kind: "trials", a: lines.joined(separator: "|"), n: []), x: (Canvas.width - 260) / 2, y: 228) {
                UIArt.panel(lines: lines, colors: [Palette.highlight] + Array(repeating: RGBA(hex: 0xFFFFFF), count: lines.count),
                            minWidth: 260, accent: accent)
            })
        }

        // End-of-game report card.
        if let r = f.report {
            var lines: [String] = [r.scoreLine, "GRADE  \(r.grade)", r.mvp]
            var colors: [RGBA] = [RGBA(hex: 0xFFFFFF), Palette.highlight, RGBA(hex: 0x9AD8FF)]
            for l in r.statLines { lines.append(l); colors.append(RGBA(hex: 0xFFFFFF)) }
            lines.append(""); colors.append(RGBA(hex: 0xFFFFFF))
            for t in r.trialLines {
                let mark = t.passed ? "[X] " : "[ ] "
                let reward = t.passed ? "  +\(t.reward)" : ""
                lines.append(mark + t.text + reward)
                colors.append(t.passed ? RGBA(hex: 0x7CFF6B) : RGBA(hex: 0x8A8EA8))
            }
            lines.append(""); colors.append(RGBA(hex: 0xFFFFFF))
            lines.append("COINS EARNED  +\(r.coins)"); colors.append(Palette.highlight)
            out.append(UIItem(key: Key(kind: "reporthead", a: r.headline, n: []), x: (Canvas.width - PixelFont.width(of: r.headline) * 4 - 12) / 2, y: 40) {
                ArcadeArt.callout(r.headline, scale: 4, style: r.headline.hasPrefix("VIC") ? .rainbow : .chrome)
            })
            out.append(UIItem(key: Key(kind: "report", a: lines.joined(separator: "|"), n: []), x: (Canvas.width - 360) / 2, y: 86) {
                UIArt.panel(lines: lines, colors: colors, minWidth: 360, accent: accent)
            })
        }
        return out
    }

    static let bigCallouts: [String: ArcadeArt.CalloutStyle] = [
        "TOUCHDOWN!": .rainbow, "FIRST DOWN!": .chrome, "INTERCEPTION!": .chrome, "SACK!": .fire, "FUMBLE!": .fire,
        "BIG HIT!": .fire, "FIELD GOAL!": .chrome, "SAFETY!": .fire, "IT'S GOOD!": .chrome, "2-PT GOOD!": .rainbow,
        "TURNOVER!": .fire, "OVERTIME": .fire, "FINAL": .chrome, "HALFTIME": .chrome, "WHAT A CATCH!": .chrome,
        "NO GOOD!": .fire, "TURNOVER ON DOWNS": .fire,
    ]

    static func pad(_ n: Int) -> String { n < 10 ? " \(n)" : "\(n)" }
}
