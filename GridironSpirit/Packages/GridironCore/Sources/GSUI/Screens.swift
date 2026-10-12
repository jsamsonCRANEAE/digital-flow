import Foundation
import GSFoundation
import GSData
import GSRenderCore
import GSGame

extension AppFlow {
    // MARK: Main menu

    func mainMenu() -> PixelBuffer {
        var b = background()
        let li = Int(time * 12) % 60
        let logo = logoCache[min(23, max(0, li - 36))]
        b.blit(logo, x: (Canvas.width - logo.width) / 2, y: 10)
        let p = profile
        let bx = (Canvas.width - 180) / 2
        button(&b, "exhibition", "EXHIBITION", x: bx, y: 120, w: 180, style: .primary)
        button(&b, "cup", p.cup != nil ? "SPIRIT CUP - ROUND \(p.cup!.round + 1)" : "SPIRIT CUP", x: bx, y: 152, w: 180)
        button(&b, "shop", "GEAR SHOP", x: bx, y: 184, w: 180)
        button(&b, "settings", "SETTINGS", x: bx, y: 216, w: 180)

        // Left: your star. Right: today's trials (daily replay hook).
        let team = league.teams[pickTeam]
        let portrait = starPortrait(team)
        b.blit(portrait, x: 34, y: 114)
        text(&b, team.fullName.uppercased(), x: 34 + portrait.width / 2, y: 104, MenuArt.gold, center: true)

        let trials = Trials.daily(dayKey: Self.todayKey())
        var tp = MenuArt.panel(width: 176, height: 98)
        tp.drawText("DAILY TRIALS", x: 8, y: 6, MenuArt.gold, shadow: MenuArt.ink)
        for (i, t) in trials.enumerated() {
            let lines = MenuArt.wrap(t.text, width: 126)
            for (j, l) in lines.prefix(2).enumerated() { tp.drawText(l, x: 8, y: 20 + i * 26 + j * 9, MenuArt.white) }
            tp.blit(MenuArt.coin, x: 140, y: 19 + i * 26)
            tp.drawText("\(t.reward)", x: 151, y: 20 + i * 26, MenuArt.gold)
        }
        b.blit(tp, x: Canvas.width - 176 - 30, y: 128)

        let coins = MenuArt.coins(p.coins)
        b.blit(coins, x: Canvas.width - coins.width - 10, y: 8)
        text(&b, "RECORD \(p.wins)-\(p.gamesPlayed - p.wins)   BEST \(p.bestGrade)", x: 10, y: 284, MenuArt.soft)
        if !p.trophies.isEmpty {
            let t = ShopArt.trophy(color: MenuArt.gold)
            b.blit(t, x: Canvas.width - 40, y: 268)
            text(&b, "X\(p.trophies.count)", x: Canvas.width - 64, y: 280, MenuArt.gold)
        }
        return b
    }

    // MARK: Team select

    func teamSelect() -> PixelBuffer {
        var b = background()
        header(&b, mode == .cup ? "SPIRIT CUP - PICK TEAM" : "CHOOSE YOUR TEAM", style: mode == .cup ? .fire : .chrome, y: 6, scale: 2)
        let cw = 190, ch = 186, gap = 13
        let x0 = (Canvas.width - (cw * 3 + gap * 2)) / 2
        for (i, t) in league.teams.prefix(3).enumerated() {
            let x = x0 + i * (cw + gap), y = 30
            let you = i == pickTeam, them = mode == .exhibition && i == pickOpponent
            var card = MenuArt.panel(width: cw, height: ch, accent: you ? MenuArt.gold : them ? MenuArt.red : t.colors.primaryRGBA)
            let por = starPortrait(t)
            card.blit(por, x: (cw - por.width) / 2, y: 6)
            card.drawText(t.city.uppercased(), x: (cw - PixelFont.width(of: t.city.uppercased())) / 2, y: 120, MenuArt.soft, shadow: MenuArt.ink)
            let nm = t.name.uppercased()
            card.drawText(nm, x: (cw - PixelFont.width(of: nm)) / 2, y: 129, MenuArt.white, shadow: MenuArt.ink)
            let r = Self.teamRatings(t)
            card.blit(MenuArt.ratingBar("OFF", value: r.off, width: cw - 16, color: RGBA(hex: 0xFF9A3C)), x: 8, y: 141)
            card.blit(MenuArt.ratingBar("DEF", value: r.def, width: cw - 16, color: RGBA(hex: 0x3FA7FF)), x: 8, y: 151)
            card.blit(MenuArt.ratingBar("SPD", value: r.spd, width: cw - 16, color: MenuArt.green), x: 8, y: 161)
            let bl = Self.blurb(t.archetype).joined(separator: " ")
            card.drawText(bl, x: (cw - PixelFont.width(of: bl)) / 2, y: 174, MenuArt.dimText)
            b.blit(card, x: x, y: y)
            if you || them {
                let tag = ArcadeArt.callout(you ? "YOU" : "VS", scale: 2, style: you ? .chrome : .fire)
                b.blit(tag, x: x + cw - tag.width - 2, y: y - 4)
            }
            region("team.\(i)", x: x, y: y, w: cw, h: ch)
        }
        let y = 236
        button(&b, "back", "BACK", x: 20, y: y, w: 80)
        button(&b, "difficulty", "LEVEL: " + profile.settings.difficultyValue.name, x: 110, y: y, w: 130)
        if mode == .exhibition {
            button(&b, "opponent", "VS: " + league.teams[pickOpponent].abbreviation + " >", x: 250, y: y, w: 120)
        } else {
            text(&b, "3 ROUNDS. WIN THEM ALL.", x: 252, y: y + 4, MenuArt.soft)
            text(&b, "FINAL: YOUR SHADOW.", x: 252, y: y + 14, RGBA(hex: 0xC23BFF))
        }
        button(&b, "play", mode == .cup ? "START CUP" : "KICK OFF!", x: Canvas.width - 170, y: y, w: 150, style: .primary)
        let gearLine = profile.equippedIDs.compactMap { gear.item($0)?.name }.joined(separator: ", ")
        text(&b, gearLine.isEmpty ? "NO GEAR EQUIPPED - VISIT THE SHOP" : "GEAR: " + gearLine, x: 20, y: 270, MenuArt.dimText)
        return b
    }

    // MARK: Settings

    func settings() -> PixelBuffer {
        var b = background()
        header(&b, "SETTINGS", y: 8)
        let pw = 380, px = (Canvas.width - pw) / 2, py = 44
        b.blit(MenuArt.panel(width: pw, height: 196), x: px, y: py)
        let s = profile.settings
        let rows: [(String, String, String)] = [
            ("music", "MUSIC", s.music == 0 ? "OFF" : "#\(s.music)"),
            ("sfx", "SOUND FX", s.sfx == 0 ? "OFF" : "#\(s.sfx)"),
            ("haptics", "HAPTICS", s.haptics ? "ON" : "OFF"),
            ("difficulty", "DIFFICULTY", s.difficultyValue.name),
            ("quarter", "QUARTER", "\(Int(s.quarterLength / 60)) MIN"),
            ("fit", "SCREEN", s.sharpFit ? "SHARP FILL" : "PIXEL PERFECT"),
        ]
        for (i, r) in rows.enumerated() {
            let y = py + 10 + i * 30
            text(&b, r.1, x: px + 16, y: y + 8, MenuArt.soft)
            button(&b, "set.\(r.0).-1", "<", x: px + 160, y: y, w: 28)
            if r.2.hasPrefix("#"), let n = Int(r.2.dropFirst()) {     // volume: 10 blocks
                for k in 0..<10 {
                    let bx = px + 160 + 28 + 80 - 55 + k * 11, h = 4 + k
                    b.fillRect(x: bx, y: y + 18 - h, width: 8, height: h, k < n ? MenuArt.green.hueShifted(Double(k) / 20) : RGBA(hex: 0x2C2F5E))
                }
            } else {
                text(&b, r.2, x: px + 160 + 28 + 80, y: y + 8, MenuArt.white, center: true)
            }
            button(&b, "set.\(r.0).1", ">", x: px + pw - 44, y: y, w: 28)
        }
        let note = s.sharpFit ? "FILLS THE SCREEN, SLIGHTLY SOFT PIXELS" : "EXACT INTEGER PIXELS, THIN BORDERS"
        text(&b, note, x: Canvas.width / 2, y: py + 186, MenuArt.dimText, center: true)
        button(&b, "back", "BACK", x: (Canvas.width - 120) / 2, y: 252, w: 120, style: .primary)
        return b
    }

    // MARK: Gear shop (spec reference 3)

    func shop() -> PixelBuffer {
        let leftW = 364
        var b = PixelBuffer(width: Canvas.width, height: Canvas.height, fill: Palette.letterbox)
        let mood = keeperTime < 2.5 ? keeperMood : .neutral
        if shopInteriors[mood] == nil {
            var room = ShopArt.interior(width: leftW, height: Canvas.height)
            // Shopkeeper stands behind the counter (redraw counter top over his waist).
            let keeper = ShopArt.shopkeeper(expression: mood)
            var withKeeper = room
            let counterTop = Canvas.height - ShopArt.counterHeight
            withKeeper.blit(keeper, x: (leftW - keeper.width) / 2 - 26, y: counterTop - 84)
            for y in counterTop..<Canvas.height { for x in 0..<leftW { withKeeper[x, y] = room[x, y] } }
            room = withKeeper
            shopInteriors[mood] = room
        }
        b.blit(shopInteriors[mood]!, x: 0, y: 0)
        let p = profile

        // Trophy shelf: one slot per club, filled by Spirit Cup wins.
        for (i, t) in league.teams.prefix(3).enumerated() {
            let n = p.trophies.filter { $0 == t.id }.count
            let x = 70 + i * 100, y = ShopArt.interiorShelfY - 22
            if n > 0 {
                b.blit(ShopArt.trophy(color: t.colors.primaryRGBA), x: x, y: y)
                if n > 1 { b.drawText("X\(n)", x: x + 20, y: y + 12, MenuArt.gold, shadow: MenuArt.ink) }
                if Int(time * 3 + Double(i)) % 4 == 0 { b.blit(MenuArt.sparkle(frame: Int(time * 8)), x: x + 1, y: y - 2) }
            } else {
                b.blit(ShopArt.emptyTrophy, x: x, y: y)
            }
            b.drawText(t.abbreviation, x: x + 9 - PixelFont.width(of: t.abbreviation) / 2, y: ShopArt.interiorShelfY + 8, RGBA(hex: 0xF2E3C8))
        }
        // Pegboard: owned gear hangs here (best first).
        let owned = p.owned.compactMap { gear.item($0) }.sorted { ($0.tier, $0.id) > ($1.tier, $1.id) }
        let pb = (x: leftW + ShopArt.pegboard.x, y: ShopArt.pegboard.y)
        for (i, it) in owned.prefix(12).enumerated() {
            let x = pb.x + 4 + (i % 4) * 28, y = pb.y + 6 + (i / 4) * 30
            b.fillRect(x: x + 10, y: y - 3, width: 2, height: 4, RGBA(hex: 0x3A2A1E))
            b.blit(icon(it), x: x, y: y)
        }
        if owned.isEmpty { b.drawText("EMPTY", x: pb.x + 43, y: pb.y + 42, RGBA(hex: 0x7A5A3A)) }
        // Speech bubble.
        let line = keeperLine
        let lines = MenuArt.wrap(line, width: 110)
        let bw = (lines.map { PixelFont.width(of: $0) }.max() ?? 40) + 12, bh = lines.count * 9 + 8
        let bx = 12, by = 128
        b.fillRect(x: bx, y: by, width: bw, height: bh, Palette.outline)
        b.fillRect(x: bx + 1, y: by + 1, width: bw - 2, height: bh - 2, RGBA(hex: 0xFFF6E0))
        for k in 0..<5 { b.fillRect(x: bx + bw - 1, y: by + 6 + k, width: 6 - k, height: 1, RGBA(hex: 0xFFF6E0)) }
        for (i, l) in lines.enumerated() { b.drawText(l, x: bx + 6, y: by + 5 + i * 9, RGBA(hex: 0x2A1A10)) }
        b.drawText("GORO", x: bx + 2, y: by + bh + 3, RGBA(hex: 0xF2E3C8), shadow: MenuArt.ink)

        // Right panel.
        let rx = leftW + 2, rw = Canvas.width - rx - 4
        b.blit(MenuArt.panel(width: rw, height: Canvas.height - 8), x: rx, y: 4)
        // Tabs.
        let tw = (rw - 12) / 4
        for (i, c) in GearCategory.allCases.enumerated() {
            let x = rx + 6 + i * tw, sel = c == shopCategory
            region("tab.\(c.rawValue)", x: x, y: 8, w: tw - 2, h: 16)
            b.fillRect(x: x, y: 8, width: tw - 2, height: 16, Palette.outline)
            b.fillRect(x: x + 1, y: 9, width: tw - 4, height: sel ? 15 : 14, sel ? RGBA(hex: 0x2C2F5E) : RGBA(hex: 0x14122C))
            if sel { b.fillRect(x: x + 1, y: 9, width: tw - 4, height: 1, MenuArt.gold) }
            b.drawText(c.title, x: x + (tw - 2 - PixelFont.width(of: c.title)) / 2, y: 13, sel ? MenuArt.gold : MenuArt.dimText)
        }
        b.fillRect(x: rx + 6, y: 24, width: rw - 12, height: 1, RGBA(hex: 0x2C2F5E))
        text(&b, "GEAR SHOP", x: rx + 8, y: 32, MenuArt.white)
        let coins = MenuArt.coins(p.coins)
        b.blit(coins, x: rx + rw - coins.width - 6, y: 28)

        // Preview.
        let items = gear.items(in: shopCategory)
        let sel = shopSelected.flatMap { gear.item($0) } ?? items.first
        if let it = sel {
            let tc = ShopArt.tierColor(it.tier)
            var frame = MenuArt.panel(width: 52, height: 52, accent: tc, fill: RGBA(hex: 0x0E0C22))
            MenuArt.blitScaled(icon(it), into: &frame, x: 4, y: 4, k: 2)
            b.blit(frame, x: rx + 8, y: 48)
            if it.tier == 5 { b.blit(MenuArt.sparkle(frame: Int(time * 8)), x: rx + 48, y: 46) }
            let ix = rx + 66
            text(&b, it.name, x: ix, y: 50, MenuArt.white)
            text(&b, "TIER " + it.tierNumeral + (it.tier == 5 ? " LEGENDARY" : ""), x: ix, y: 60, tc)
            for (j, l) in MenuArt.wrap(it.boostSummary, width: rw - 74).prefix(2).enumerated() { text(&b, l, x: ix, y: 71 + j * 9, MenuArt.soft) }
            let status: (String, RGBA)
            if p.equipped[it.category.rawValue] == it.id { status = ("EQUIPPED", MenuArt.green) }
            else if p.owns(it.id) { status = ("OWNED", MenuArt.soft) }
            else { status = (MenuArt.grouped(it.price), p.coins >= it.price ? MenuArt.gold : MenuArt.red) }
            if !p.owns(it.id) { b.blit(MenuArt.coin, x: ix, y: 90) }
            text(&b, status.0, x: ix + (p.owns(it.id) ? 0 : 12), y: 91, status.1)
            // Best for.
            var bf = MenuArt.panel(width: rw - 12, height: 40, accent: RGBA(hex: 0x2C2F5E), fill: RGBA(hex: 0x100E26))
            bf.drawText("BEST FOR:", x: 6, y: 5, MenuArt.gold)
            for (j, l) in MenuArt.wrap(it.bestFor, width: rw - 26).prefix(3).enumerated() { bf.drawText(l, x: 6, y: 15 + j * 8, MenuArt.white) }
            b.blit(bf, x: rx + 6, y: 106)
            // Action.
            let label: String, style: MenuArt.ButtonStyle
            if p.equipped[it.category.rawValue] == it.id { label = "UNEQUIP"; style = .normal }
            else if p.owns(it.id) { label = "EQUIP"; style = .primary }
            else { label = "BUY"; style = p.coins >= it.price ? .primary : .disabled }
            button(&b, "buy", label, x: rx + rw - 106, y: 156, w: 100, style: style)
        }
        // 5x4 grid: rows = categories, columns = tiers.
        let gx = rx + 8, gy = 152, cs = 27
        for (r, c) in GearCategory.allCases.enumerated() {
            let rowItems = gear.items(in: c)
            if c == shopCategory { b.fillRect(x: gx - 3, y: gy + r * cs + 2, width: 2, height: cs - 4, MenuArt.gold) }
            for (col, it) in rowItems.prefix(5).enumerated() {
                let x = gx + col * cs, y = gy + r * cs
                let isSel = it.id == sel?.id
                b.fillRect(x: x, y: y, width: cs - 2, height: cs - 2, isSel ? MenuArt.gold : Palette.outline)
                b.fillRect(x: x + 1, y: y + 1, width: cs - 4, height: cs - 4, ShopArt.tierColor(it.tier).hueShifted(-0.85))
                var ic = icon(it)
                if !p.owns(it.id) && p.coins < it.price {
                    for k in ic.pixels.indices where ic.pixels[k] >> 24 != 0 { ic.pixels[k] = MenuArt.lerp(RGBA(argb: ic.pixels[k]), MenuArt.ink, 0.5).argb }
                }
                b.blit(ic, x: x + 2, y: y + 2)
                if p.equipped[it.category.rawValue] == it.id {
                    b.fillRect(x: x + cs - 9, y: y + cs - 10, width: 7, height: 8, MenuArt.green)
                    b.drawText("E", x: x + cs - 8, y: y + cs - 10, MenuArt.ink)
                } else if p.owns(it.id) {
                    b.set(x + cs - 6, y + cs - 6, MenuArt.green); b.set(x + cs - 5, y + cs - 5, MenuArt.green)
                    b.set(x + cs - 4, y + cs - 6, MenuArt.green); b.set(x + cs - 3, y + cs - 7, MenuArt.green)
                }
                region("item.\(it.id)", x: x, y: y, w: cs - 2, h: cs - 2)
            }
        }
        // Loadout.
        let lx = rx + rw - 106, ly = 190
        text(&b, "LOADOUT", x: lx, y: ly, MenuArt.soft)
        for (i, c) in GearCategory.allCases.enumerated() {
            let x = lx + (i % 2) * 26, y = ly + 10 + (i / 2) * 26
            b.fillRect(x: x, y: y, width: 24, height: 24, Palette.outline)
            b.fillRect(x: x + 1, y: y + 1, width: 22, height: 22, RGBA(hex: 0x100E26))
            if let id = p.equipped[c.rawValue], let it = gear.item(id) { b.blit(icon(it), x: x + 1, y: y + 1) }
        }
        let bonus = gear.spiritChargeBonus(equipped: p.equippedIDs)
        if bonus > 0 { text(&b, "SPIRIT", x: lx + 56, y: ly + 18, RGBA(hex: 0xC23BFF)); text(&b, "+\(Int((bonus * 100).rounded()))%", x: lx + 56, y: ly + 28, RGBA(hex: 0xC23BFF)) }
        button(&b, "back", "BACK", x: lx, y: 262, w: 100)
        return b
    }

    // MARK: Spirit Cup bracket

    func cupBracket() -> PixelBuffer {
        var b = background()
        header(&b, "SPIRIT CUP", style: .fire, y: 6, scale: 3)
        guard let run = profile.cup, let me = league.team(id: run.teamID) else {
            button(&b, "back", "BACK", x: 20, y: 252, w: 100)
            return b
        }
        let pw = 176, gap = 26, x0 = (Canvas.width - (pw * 3 + gap * 2)) / 2, y = 46
        for i in 0..<SpiritCup.rounds.count {
            let x = x0 + i * (pw + gap)
            let oppID = run.opponents[i]
            let shadow = oppID.hasPrefix("shadow_")
            let opp = SpiritCup.team(oppID, league: league) ?? me
            let done = i < run.round, current = i == run.round
            var panel = MenuArt.panel(width: pw, height: 186, accent: current ? MenuArt.gold : done ? MenuArt.green : MenuArt.panelEdge)
            let rn = SpiritCup.rounds[i]
            panel.drawText(rn, x: (pw - PixelFont.width(of: rn)) / 2, y: 6, current ? MenuArt.gold : MenuArt.soft, shadow: MenuArt.ink)
            let por = starPortrait(shadow ? me : opp, shadow: shadow)
            panel.blit(por, x: (pw - por.width) / 2, y: 18)
            if !done && !current {
                MenuArt.darken(&panel, x: 4, y: 18, width: pw - 8, height: por.height, amount: 0.6)
                let q = ArcadeArt.callout("?", scale: 4, style: shadow ? .fire : .chrome)
                if shadow == false { panel.blit(q, x: (pw - q.width) / 2, y: 50) }
            }
            let nm = shadow ? "SHADOW " + me.abbreviation : opp.fullName.uppercased()
            panel.drawText(String(nm.prefix(27)), x: (pw - PixelFont.width(of: String(nm.prefix(27)))) / 2, y: 140, MenuArt.white, shadow: MenuArt.ink)
            let st: (String, RGBA) = done ? (run.results[safe: i] ?? "CLEARED", MenuArt.green)
                : current ? ("NEXT MATCH", MenuArt.gold) : ("LOCKED", MenuArt.dimText)
            panel.drawText(st.0, x: (pw - PixelFont.width(of: st.0)) / 2, y: 154, st.1)
            if shadow { panel.drawText("RATINGS +\(SpiritCup.shadowBoost)", x: (pw - PixelFont.width(of: "RATINGS +4")) / 2, y: 166, RGBA(hex: 0xC23BFF)) }
            b.blit(panel, x: x, y: y)
            if i < 2 {   // connector arrow
                let ax = x + pw + 4, ay = y + 90
                b.fillRect(x: ax, y: ay, width: gap - 10, height: 3, done ? MenuArt.green : MenuArt.dimText)
                for k in 0..<4 { b.fillRect(x: ax + gap - 10 + k, y: ay - 3 + k, width: 1, height: 9 - 2 * k, done ? MenuArt.green : MenuArt.dimText) }
            }
        }
        text(&b, "PLAYING AS " + me.fullName.uppercased() + "   WIN BONUS +\(SpiritCup.winBonus) + TROPHY", x: Canvas.width / 2, y: 238, MenuArt.soft, center: true)
        button(&b, "back", "BACK", x: 20, y: 256, w: 90)
        button(&b, "cup.forfeit", "FORFEIT", x: 120, y: 256, w: 90, style: .danger)
        button(&b, "cup.play", "PLAY " + SpiritCup.rounds[run.round], x: Canvas.width - 220, y: 256, w: 200, style: .primary)
        return b
    }

    // MARK: Post game

    func postGame() -> PixelBuffer {
        var b = background()
        guard let pg = post else { button(&b, "post.menu", "MENU", x: 270, y: 250, w: 100); return b }
        let r = pg.report
        header(&b, r.headline, style: pg.won ? .rainbow : .chrome, y: 6, scale: 4)
        text(&b, r.scoreLine, x: Canvas.width / 2, y: 46, MenuArt.white, center: true)
        // Grade badge.
        var gp = MenuArt.panel(width: 96, height: 96, accent: pg.won ? MenuArt.gold : MenuArt.panelEdge)
        gp.drawText("GRADE", x: 33, y: 6, MenuArt.soft)
        let g = ArcadeArt.callout(r.grade, scale: 8, style: r.grade == "S" ? .rainbow : r.grade == "A" ? .fire : .chrome)
        gp.blit(g, x: (96 - g.width) / 2, y: 18)
        b.blit(gp, x: 30, y: 62)
        // Stats + trials.
        var sp = MenuArt.panel(width: 330, height: 126)
        sp.drawText(r.mvp, x: 8, y: 6, MenuArt.gold, shadow: MenuArt.ink)
        for (i, l) in r.statLines.enumerated() { sp.drawText(l, x: 8, y: 18 + i * 10, MenuArt.white) }
        sp.drawText("TRIALS", x: 8, y: 44, MenuArt.soft)
        for (i, t) in r.trialLines.enumerated() {
            let y = 55 + i * 10
            sp.drawText(t.passed ? "+" : "-", x: 8, y: y, t.passed ? MenuArt.green : MenuArt.red)
            sp.drawText(String(t.text.prefix(40)), x: 16, y: y, t.passed ? MenuArt.white : MenuArt.dimText)
            if t.passed { sp.drawText("+\(t.reward)", x: 300, y: y, MenuArt.gold) }
        }
        // Cup line.
        if let o = pg.cupOutcome {
            let s: (String, RGBA)
            switch o {
            case .advanced(let n): s = ("CUP: ADVANCED TO " + SpiritCup.rounds[n] + "!", MenuArt.green)
            case .champion: s = ("SPIRIT CUP CHAMPIONS! +\(SpiritCup.winBonus) + TROPHY", MenuArt.gold)
            case .eliminated: s = ("CUP: ELIMINATED IN " + SpiritCup.rounds[pg.cupRound], MenuArt.red)
            }
            sp.drawText(s.0, x: 8, y: 92, s.1, shadow: MenuArt.ink)
        }
        b.blit(sp, x: 136, y: 62)
        // Coins count up over 1.5 s.
        let earned = profile.coins - pg.coinsBefore
        let shown = pg.coinsBefore + Int(Double(earned) * clamp(screenTime / 1.5, 0, 1))
        let cb = MenuArt.coins(shown)
        b.blit(cb, x: 476, y: 62)
        text(&b, "+\(earned)", x: 476 + cb.width + 6, y: 67, MenuArt.gold)
        // Next unlock: the replay carrot.
        let next = gear.items.filter { !profile.owns($0.id) }.min { $0.price < $1.price }
        if let n = next {
            var np = MenuArt.panel(width: 150, height: 100, accent: ShopArt.tierColor(n.tier))
            np.drawText(profile.coins >= n.price ? "YOU CAN AFFORD:" : "NEXT UNLOCK:", x: 8, y: 6, MenuArt.soft)
            MenuArt.blitScaled(icon(n), into: &np, x: 8, y: 18, k: 2)
            np.drawText(n.name, x: 8, y: 66, MenuArt.white)
            let need = n.price - profile.coins
            np.drawText(need <= 0 ? "VISIT THE SHOP!" : "\(need) MORE COINS", x: 8, y: 78, need <= 0 ? MenuArt.green : MenuArt.gold)
            b.blit(np, x: 476, y: 88)
        }
        let again = mode == .cup ? (profile.cup != nil ? "BRACKET" : "MENU") : "REMATCH"
        button(&b, "post.shop", "GEAR SHOP", x: 30, y: 250, w: 140)
        button(&b, "post.again", again, x: 250, y: 250, w: 140, style: .primary)
        button(&b, "post.menu", "MAIN MENU", x: 470, y: 250, w: 140)
        return b
    }
}

extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}
