import Foundation
import GSFoundation
import GSData
import GSInput
import GSAI
import GSRenderCore
import GSGame
import GSAudio

/// What the app should draw this frame.
public enum FlowOutput {
    /// A full 640x296 CPU-composed menu screen (drawn as the field layer; sprites hidden).
    case menu(PixelBuffer)
    /// The live game path, plus flow overlays (pause button, pause panel, title logo).
    case game(RenderFrame, runtime: GameRuntime, extraUI: [UIItem], accent: RGBA)
}

/// The whole app above the match: title (attract mode), menus, team select,
/// settings, gear shop, Spirit Cup bracket, pause and post-game. Platform
/// independent; the iOS layer only forwards touches and presents output.
public final class AppFlow {
    public enum Screen: Equatable { case title, mainMenu, teamSelect, settings, shop, cupBracket, game, pause, postGame }
    public enum Mode: Equatable { case exhibition, cup }

    public let league: League
    public let gear: GearCatalog
    public let store: ProfileStore
    public let audio: AudioCore?
    public private(set) var screen: Screen = .title
    public private(set) var runtime: GameRuntime?
    public private(set) var attract: GameRuntime?
    public private(set) var mode: Mode = .exhibition
    public var profile: Profile { store.profile }

    var time = 0.0
    var screenTime = 0.0
    var rng: SplitMix64
    var safeArea = Canvas.bounds
    var minTouch = 44.0
    var settingsReturn: Screen = .mainMenu

    // Team select state.
    var pickTeam = 0
    var pickOpponent = 1
    // Shop state.
    var shopCategory = GearCategory.cleats
    var shopSelected: String?
    var keeperLine = "WELCOME! TAP AN ITEM."
    var keeperMood = Expression.confident
    var keeperTime = 0.0
    // Post-game state.
    struct PostGame { var report: GameReport; var coinsBefore: Int; var cupOutcome: SpiritCup.Outcome?; var cupRound: Int; var opponent: String; var won: Bool }
    var post: PostGame?
    var finalTimer = 0.0
    var lastMatch: (human: String, opponent: String)?

    // Immediate-mode hit regions, rebuilt every frame.
    struct Hit { let id: String; let rect: Rect }
    var hits: [Hit] = []
    var pressed: String?
    var pressTouch: Int?
    var forwarded: [Int: Vec2] = [:]
    // Controller (see PadNavigation.swift).
    var lastPad = GamepadState()
    var padStyle: PadStyle?
    var focusID: String?
    var navRepeat = 0.0
    /// True while the player is driving the menus with a controller.
    public var controllerActive: Bool { padStyle != nil }
    var swallowed: Set<Int> = []

    // Caches.
    var shopInteriors: [Expression: PixelBuffer] = [:]
    var iconCache: [String: PixelBuffer] = [:]
    var portraitCache: [String: PixelBuffer] = [:]
    var bgCache: (key: Int, buf: PixelBuffer)?
    let logoCache: [PixelBuffer]

    /// - Parameters:
    ///   - savedProfile: JSON from a previous `persist` call, or nil for a fresh profile.
    public init(league: League, gear: GearCatalog, savedProfile: Data?, persist: @escaping (Data) -> Void,
                audio: AudioCore?, seed: UInt64? = nil) {
        self.league = league
        self.gear = gear
        store = ProfileStore(data: savedProfile, persist: persist)
        self.audio = audio
        rng = SplitMix64(seed: seed ?? UInt64(Date().timeIntervalSince1970 * 1000))
        logoCache = (0..<24).map { MenuArt.logo(scale: 4, glint: Double($0) / 23) }
        if let id = store.profile.teamID, let i = league.teams.firstIndex(where: { $0.id == id }) { pickTeam = i }
        pickOpponent = (pickTeam + 1) % max(1, league.teams.count)
        applyAudioSettings()
        go(.title)
    }

    // MARK: Navigation

    func go(_ s: Screen) {
        screen = s
        screenTime = 0
        pressed = nil
        focusID = nil
        switch s {
        case .title:
            startAttract()
            audio?.play(Soundtrack.title)
            audio?.setCrowd(0.1)
        case .game, .pause:
            audio?.play(Soundtrack.game)
        default:
            attract = nil
            audio?.play(Soundtrack.menu)
            audio?.setCrowd(0.05)
        }
    }

    func startAttract() {
        let a = rng.int(league.teams.count), b = (a + 1 + rng.int(max(1, league.teams.count - 1))) % league.teams.count
        let rt = GameRuntime(league: league, offenseID: league.teams[a].id, defenseID: league.teams[b].id,
                             difficulty: .pro, humanTeam: nil, seed: rng.next(), quarterLength: 45)
        rt.setSafeArea(safeArea)
        attract = rt
    }

    public func setSafeArea(_ r: Rect) { safeArea = r; runtime?.setSafeArea(r); attract?.setSafeArea(r) }
    public func setMinTouchSize(canvasPixels p: Double) { minTouch = p; runtime?.setMinTouchSize(canvasPixels: p) }
    public var hapticsEnabled: Bool { profile.settings.haptics }
    public var sharpFit: Bool { profile.settings.sharpFit }

    /// Call when the app resigns active.
    public func pauseIfPlaying() { if screen == .game, runtime?.report == nil { releaseForwardedTouches(); go(.pause) } }

    func applyAudioSettings() {
        guard let a = audio else { return }
        let s = profile.settings
        a.musicVolume = Double(s.music) / 10 * 0.8
        a.sfxVolume = Double(s.sfx) / 10
        a.musicEnabled = s.music > 0
        a.sfxEnabled = s.sfx > 0
    }

    func sfx(_ e: SoundEffect) { audio?.play(e) }

    // MARK: Frame

    public func advance(frameTime dt: Double) -> FlowOutput {
        time += dt
        screenTime += dt
        keeperTime += dt
        hits.removeAll(keepingCapacity: true)
        switch screen {
        case .title: return titleFrame(dt)
        case .game: return gameFrame(dt)
        case .pause: return pauseFrame()
        case .mainMenu: return .menu(decorated(mainMenu()))
        case .teamSelect: return .menu(decorated(teamSelect()))
        case .settings: return .menu(decorated(settings()))
        case .shop: return .menu(decorated(shop()))
        case .cupBracket: return .menu(decorated(cupBracket()))
        case .postGame: return .menu(decorated(postGame()))
        }
    }

    func decorated(_ b: PixelBuffer) -> PixelBuffer {
        guard padStyle != nil else { return b }
        var b = b
        drawFocus(&b)
        padHint(&b)
        return b
    }

    // MARK: Input

    public func handle(_ e: TouchEvent) {
        if e.phase == .began { padStyle = nil }      // touch takes over: hide focus
        switch screen {
        case .game:
            if swallowed.contains(e.id) { if e.phase == .ended { swallowed.remove(e.id) }; return }
            if e.phase == .began, let h = hit(e.location) {
                swallowed.insert(e.id)
                activate(h)
                return
            }
            if e.phase == .ended { forwarded[e.id] = nil } else { forwarded[e.id] = e.location }
            runtime?.handle(e)
        case .title:
            if e.phase == .ended && screenTime > 0.4 { sfx(.uiTap); go(.mainMenu) }
        default:
            switch e.phase {
            case .began:
                pressed = hit(e.location); pressTouch = e.id
            case .moved:
                if e.id == pressTouch, let p = pressed, hit(e.location) != p { pressed = nil }
            case .ended:
                if e.id == pressTouch, let p = pressed, hit(e.location) == p { activate(p) }
                if e.id == pressTouch { pressed = nil; pressTouch = nil }
            }
        }
    }

    func hit(_ p: Vec2) -> String? {
        // Expand small targets to the minimum touch size, but prefer exact hits.
        if let h = hits.last(where: { $0.rect.contains(p) }) { return h.id }
        var best: (String, Double)?
        for h in hits {
            let padX = max(0, (minTouch - h.rect.width) / 2), padY = max(0, (minTouch - h.rect.height) / 2)
            let r = Rect(minX: h.rect.minX - padX, minY: h.rect.minY - padY, maxX: h.rect.maxX + padX, maxY: h.rect.maxY + padY)
            guard r.contains(p) else { continue }
            let cx = (h.rect.minX + h.rect.maxX) / 2, cy = (h.rect.minY + h.rect.maxY) / 2
            let d = (p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy)
            if best == nil || d < best!.1 { best = (h.id, d) }
        }
        return best?.0
    }

    func releaseForwardedTouches() {
        for (id, loc) in forwarded { runtime?.handle(TouchEvent(id: id, phase: .ended, location: loc)) }
        forwarded.removeAll()
    }

    /// Scripted activation (tests, preview tool).
    public func tap(_ id: String) { activate(id) }

    func activate(_ id: String) {
        // Edits go to `p` and are written back only if this action changed it,
        // so actions that update the store themselves (finishMatch) aren't clobbered.
        let before = store.profile
        var p = before
        defer { if p != before { store.profile = p; store.save() } }
        switch id {
        // Main menu
        case "exhibition": mode = .exhibition; sfx(.uiTap); go(.teamSelect)
        case "cup":
            sfx(.uiTap)
            if p.cup != nil { mode = .cup; go(.cupBracket) } else { mode = .cup; go(.teamSelect) }
        case "shop": sfx(.uiTap); keeperSay("WELCOME! TAP AN ITEM.", .confident); go(.shop)
        case "settings": sfx(.uiTap); settingsReturn = screen; go(.settings)
        case "back":
            sfx(.uiBack)
            switch screen {
            case .settings: go(settingsReturn == .pause ? .pause : settingsReturn)
            case .cupBracket, .shop, .teamSelect: go(post != nil && screen == .shop ? .postGame : .mainMenu)
            default: go(.mainMenu)
            }
        // Team select
        case _ where id.hasPrefix("team."):
            let i = Int(id.dropFirst(5)) ?? 0
            sfx(.uiTap)
            pickTeam = i
            if pickOpponent == i { pickOpponent = (i + 1) % league.teams.count }
            p.teamID = league.teams[i].id
        case "opponent":
            sfx(.uiTap)
            repeat { pickOpponent = (pickOpponent + 1) % league.teams.count } while pickOpponent == pickTeam && league.teams.count > 1
        case "difficulty": sfx(.uiTap); p.settings.difficulty = (p.settings.difficulty + 1) % 3
        case "play":
            sfx(.uiBuy)
            p.teamID = league.teams[pickTeam].id
            store.profile = p
            if mode == .cup {
                p.cup = SpiritCup.start(team: league.teams[pickTeam].id, league: league, seed: rng.next())
                store.profile = p; store.save()
                go(.cupBracket)
            } else {
                startMatch(human: league.teams[pickTeam].id, opponent: league.teams[pickOpponent].id)
            }
        // Cup
        case "cup.play":
            guard let run = p.cup else { return }
            sfx(.uiBuy)
            startMatch(human: run.teamID, opponent: run.opponents[run.round])
        case "cup.forfeit": sfx(.uiError); p.cup = nil; go(.mainMenu)
        // Settings rows: "set.<name>.<-1|1>"
        case _ where id.hasPrefix("set."):
            let parts = id.split(separator: ".")
            let d = Int(parts.last ?? "1") ?? 1
            var s = p.settings
            switch parts[1] {
            case "music": s.music = clamp(s.music + d, 0, 10)
            case "sfx": s.sfx = clamp(s.sfx + d, 0, 10)
            case "haptics": s.haptics.toggle()
            case "difficulty": s.difficulty = (s.difficulty + d + 3) % 3
            case "quarter":
                let o = Profile.Settings.quarterOptions
                let i = o.firstIndex(of: s.quarterLength) ?? 1
                s.quarterLength = o[(i + d + o.count) % o.count]
            case "fit": s.sharpFit.toggle()
            default: break
            }
            p.settings = s
            store.profile = p
            applyAudioSettings()
            sfx(.uiTap)
        // Shop
        case _ where id.hasPrefix("tab."):
            sfx(.uiTap)
            shopCategory = GearCategory(rawValue: String(id.dropFirst(4))) ?? .cleats
            shopSelected = gear.items(in: shopCategory).first?.id
        case _ where id.hasPrefix("item."):
            sfx(.uiTap)
            shopSelected = String(id.dropFirst(5))
            if let it = gear.item(shopSelected!) { shopCategory = it.category; keeperSay(it.tier == 5 ? "OHO! A LEGEND PIECE." : "GOOD EYE.", .neutral) }
        case "buy":
            guard let sid = shopSelected, let it = gear.item(sid) else { return }
            switch p.buyOrEquip(it) {
            case .bought: sfx(.uiBuy); keeperSay(it.tier >= 4 ? "NOW THAT'S SPIRIT!" : "FINE CHOICE, KID!", .confident)
            case .equipped: sfx(.uiTap); keeperSay("SUITS YOU.", .confident)
            case .unequipped: sfx(.uiBack); keeperSay("BACK ON THE HOOK.", .neutral)
            case .tooExpensive: sfx(.uiError); keeperSay("NOT ENOUGH COIN!", .shocked)
            }
        // Game overlay
        case "pause": sfx(.uiTap); releaseForwardedTouches(); go(.pause)
        case "resume": sfx(.uiTap); go(.game)
        case "pause.settings": sfx(.uiTap); settingsReturn = .pause; go(.settings)
        case "quit": sfx(.uiBack); runtime = nil; go(.mainMenu)
        case "continue": finishMatch()
        // Post game
        case "post.menu": sfx(.uiTap); post = nil; go(.mainMenu)
        case "post.shop": sfx(.uiTap); keeperSay("SPEND IT WELL!", .confident); go(.shop)
        case "post.again":
            sfx(.uiBuy)
            if mode == .cup { post = nil; go(p.cup != nil ? .cupBracket : .mainMenu) }
            else if let m = lastMatch { post = nil; startMatch(human: m.human, opponent: m.opponent) }
        default: break
        }
    }

    func keeperSay(_ s: String, _ e: Expression) { keeperLine = s; keeperMood = e; keeperTime = 0 }

    // MARK: Match lifecycle

    func startMatch(human: String, opponent: String) {
        guard let h = league.team(id: human), let o = SpiritCup.team(opponent, league: league) else { return }
        var lg = league
        let boosted = gear.boosted(h, equipped: profile.equippedIDs)
        lg.teams = [boosted, o]
        let rt = GameRuntime(league: lg, offenseID: boosted.id, defenseID: o.id, difficulty: profile.settings.difficultyValue,
                             humanTeam: 0, seed: rng.next(), quarterLength: profile.settings.quarterLength,
                             openingReceiver: rng.int(2))
        rt.progress = store
        rt.spiritChargeBonus = [gear.spiritChargeBonus(equipped: profile.equippedIDs), 0]
        rt.setSafeArea(safeArea)
        rt.setMinTouchSize(canvasPixels: minTouch)
        runtime = rt
        lastMatch = (human, opponent)
        finalTimer = 0
        forwarded.removeAll(); swallowed.removeAll()
        audio?.setCrowd(0.25)
        go(.game)
    }

    func finishMatch() {
        guard let rt = runtime, let r = rt.report else { return }
        sfx(.uiTap)
        let won = rt.state.score[0] > rt.state.score[1]
        var outcome: SpiritCup.Outcome?
        var p = store.profile
        let round = p.cup?.round ?? 0
        let coinsBefore = p.coins - r.coins             // runtime already banked the match coins
        if mode == .cup, p.cup != nil {
            outcome = SpiritCup.record(&p, won: won, scoreLine: r.scoreLine)
            store.profile = p
            store.save()
        }
        post = PostGame(report: r, coinsBefore: coinsBefore, cupOutcome: outcome, cupRound: round,
                        opponent: rt.teams[1].abbreviation, won: won)
        runtime = nil
        go(.postGame)
        if won { audio?.play(Soundtrack.touchdown) }
    }

    // MARK: Sound routing

    func route(_ cues: [SoundCue], quiet: Bool = false) {
        guard let a = audio else { return }
        for c in cues {
            switch c {
            case .snap: a.play(.snap)
            case .throwRelease: a.play(.throwWhoosh)
            case .catchMade: a.play(.catchPop)
            case .deflection: a.play(.hit(0.4))
            case .tackle(let k): a.play(.hit(clamp(k / 9, 0.3, 1.5)))
            case .fumble: a.play(.hit(1.2))
            case .bounce(let s): if s > 2 { a.play(.footstep(clamp(s / 6, 0.3, 1))) }
            case .move: a.play(.footstep(1))
            case .kick: a.play(.kick)
            case .whistle: a.play(.whistle)
            case .touchdown:
                a.play(.whistle); a.play(.cheer(1))
                if !quiet { a.play(Soundtrack.touchdown) }
            case .spirit: a.play(.spirit)
            case .footstep(let f): if !quiet { a.play(.footstep(f)) }
            case .crowd(let k): a.play(.cheer(k))
            }
        }
    }

    // MARK: Game-path screens

    func titleFrame(_ dt: Double) -> FlowOutput {
        guard let rt = attract else { startAttract(); return titleFrame(dt) }
        var f = rt.advance(frameTime: dt)
        if rt.phase == .final || rt.report != nil { finalTimer += dt; if finalTimer > 3 { finalTimer = 0; startAttract() } }
        route(f.sounds.filter { if case .crowd = $0 { return true }; if case .touchdown = $0 { return true }; return false }, quiet: true)
        f.hud = nil; f.playCall = nil; f.buttons = []; f.icons = []; f.kickMeter = nil; f.report = nil
        f.trialsBanner = nil; f.matchup = nil; f.haptics = []; f.callout = nil; f.cutIn = nil
        var ui: [UIItem] = []
        let li = Int(time * 12) % 48
        let logo = logoCache[min(23, max(0, li - 24))]
        ui.append(UIItem(key: "flow.logo.\(min(23, max(0, li - 24)))", x: (Canvas.width - logo.width) / 2, y: 18) { logo })
        if Int(time * 2) % 2 == 0 {
            let t = lastPad.connected ? "PRESS " + lastPad.style.glyph(.a).text : "TAP TO START"
            ui.append(UIItem(key: "flow.tap.\(t)", x: (Canvas.width - PixelFont.width(of: t) * 2 - 8) / 2, y: 226) {
                ArcadeArt.callout(t, scale: 2, style: .chrome)
            })
        }
        let c = "ORIGINAL GAME - ALL TEAMS FICTIONAL"
        ui.append(UIItem(key: "flow.copy", x: (Canvas.width - PixelFont.width(of: c)) / 2, y: 280) {
            var b = PixelBuffer(width: PixelFont.width(of: c) + 2, height: 9)
            b.drawText(c, x: 0, y: 0, MenuArt.soft, shadow: MenuArt.ink)
            return b
        })
        return .game(f, runtime: rt, extraUI: ui, accent: rt.teams[0].colors.primaryRGBA)
    }

    func gameFrame(_ dt: Double) -> FlowOutput {
        guard let rt = runtime else { go(.mainMenu); return .menu(mainMenu()) }
        let f = rt.advance(frameTime: dt)
        route(f.sounds)
        audio?.setCrowd(rt.phase == .live ? 0.3 : 0.2)
        var ui: [UIItem] = []
        let left = Int(safeArea.minX) + 82, top = Int(safeArea.minY) + 3
        if rt.report != nil {
            finalTimer += dt
            if finalTimer > 2 {
                ui.append(buttonItem("continue", "CONTINUE", x: (Canvas.width - 140) / 2, y: 262, w: 140, style: .primary))
                if let f = focusItem() { ui.append(f) }
            }
        } else if !f.replay {
            ui.append(buttonItem("pause", "II", x: left, y: top, w: 20, h: 16))
        }
        return .game(f, runtime: rt, extraUI: ui, accent: rt.teams[0].colors.primaryRGBA)
    }

    func pauseFrame() -> FlowOutput {
        guard let rt = runtime else { go(.mainMenu); return .menu(mainMenu()) }
        var f = rt.advance(frameTime: 0)
        f.haptics = []; f.sounds = []
        var ui: [UIItem] = []
        ui.append(UIItem(key: "flow.dim", x: 0, y: 0) {
            var b = PixelBuffer(width: Canvas.width, height: Canvas.height)
            for y in 0..<b.height { for x in 0..<b.width where (x + y) & 1 == 0 { b[x, y] = MenuArt.ink.argb } }
            return b
        })
        let pw = 220, ph = 150, px = (Canvas.width - pw) / 2, py = 66
        ui.append(UIItem(key: "flow.pausepanel", x: px, y: py) {
            var b = MenuArt.panel(width: pw, height: ph)
            let t = ArcadeArt.callout("PAUSED", scale: 3, style: .chrome)
            b.blit(t, x: (pw - t.width) / 2, y: 8)
            return b
        })
        ui.append(buttonItem("resume", "RESUME", x: px + 30, y: py + 48, w: pw - 60, style: .primary))
        ui.append(buttonItem("pause.settings", "SETTINGS", x: px + 30, y: py + 80, w: pw - 60))
        ui.append(buttonItem("quit", "QUIT TO MENU", x: px + 30, y: py + 112, w: pw - 60, style: .danger))
        if let f = focusItem() { ui.append(f) }
        return .game(f, runtime: rt, extraUI: ui, accent: rt.teams[0].colors.primaryRGBA)
    }

    func buttonItem(_ id: String, _ label: String, x: Int, y: Int, w: Int, h: Int = 24, style: MenuArt.ButtonStyle = .normal) -> UIItem {
        hits.append(Hit(id: id, rect: Rect(x: Double(x), y: Double(y), width: Double(w), height: Double(h))))
        let isPressed = pressed == id
        return UIItem(key: "flow.btn.\(id).\(label).\(isPressed)", x: x, y: y) {
            MenuArt.button(label, width: w, height: h, style: style, pressed: isPressed)
        }
    }

    // MARK: Menu drawing helpers

    func background() -> PixelBuffer {
        let accent = league.teams[pickTeam].colors.primaryRGBA
        let key = Int(time * 20) & 0xFFFF ^ Int(accent.argb & 0xFFFF) << 16
        if let c = bgCache, c.key == key { return c.buf }
        let b = MenuArt.background(time: time, accent: accent)
        bgCache = (key, b)
        return b
    }

    func button(_ b: inout PixelBuffer, _ id: String, _ label: String, x: Int, y: Int, w: Int, h: Int = 24,
                style: MenuArt.ButtonStyle = .normal, selected: Bool = false) {
        hits.append(Hit(id: id, rect: Rect(x: Double(x), y: Double(y), width: Double(w), height: Double(h))))
        b.blit(MenuArt.button(label, width: w, height: h, style: style, selected: selected, pressed: pressed == id,
                              accent: league.teams[pickTeam].colors.primaryRGBA), x: x, y: y)
    }

    func region(_ id: String, x: Int, y: Int, w: Int, h: Int) {
        hits.append(Hit(id: id, rect: Rect(x: Double(x), y: Double(y), width: Double(w), height: Double(h))))
    }

    func text(_ b: inout PixelBuffer, _ s: String, x: Int, y: Int, _ c: RGBA = MenuArt.white, center: Bool = false) {
        b.drawText(s, x: center ? x - PixelFont.width(of: s) / 2 : x, y: y, c, shadow: MenuArt.ink)
    }

    func header(_ b: inout PixelBuffer, _ s: String, style: ArcadeArt.CalloutStyle = .chrome, y: Int = 8, scale: Int = 3) {
        let t = ArcadeArt.callout(s, scale: scale, style: style)
        b.blit(t, x: (Canvas.width - t.width) / 2, y: y)
    }

    func icon(_ item: GearItem) -> PixelBuffer {
        if let c = iconCache[item.id] { return c }
        let i = ShopArt.icon(item); iconCache[item.id] = i; return i
    }

    func starPortrait(_ t: TeamData, shadow: Bool = false) -> PixelBuffer {
        let key = t.id + (shadow ? ".sh" : "")
        if let c = portraitCache[key] { return c }
        let star = t.roster.first { $0.spiritPlay != nil && $0.position == .qb } ?? t.roster.first { $0.spiritPlay != nil } ?? t.roster[0]
        var spec = PortraitSpec(seed: stableHash(star.id), jersey: t.colors.primaryRGBA, trim: t.colors.accentRGBA,
                                number: star.number, archetype: GameRuntimeArchetype.index(t), big: [.c, .og, .dl].contains(star.position))
        var name = star.lastName.uppercased()
        var accent = t.colors.primaryRGBA
        if shadow {
            spec.jersey = RGBA(hex: 0x2A1B3D); spec.trim = RGBA(hex: 0xC23BFF); spec.eyes = RGBA(hex: 0xFF3BD8)
            spec.hair = RGBA(hex: 0x1A1420); spec.skin = spec.skin.hueShifted(-0.7)
            accent = RGBA(hex: 0x5A2A9A)
        }
        let p = Portraits.framed(Portraits.render(spec, shadow ? .confident : .neutral), name: name, accent: accent)
        portraitCache[key] = p
        return p
    }

    static func todayKey() -> Int {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone.current
        let c = cal.dateComponents([.year, .month, .day], from: Date())
        return (c.year ?? 2026) * 10000 + (c.month ?? 1) * 100 + (c.day ?? 1)
    }

    static func teamRatings(_ t: TeamData) -> (off: Int, def: Int, spd: Int) {
        func avg(_ ps: [PlayerData], _ f: (PlayerRatings) -> Int) -> Int { ps.isEmpty ? 50 : ps.map { f($0.ratings) }.reduce(0, +) / ps.count }
        let off = t.roster.filter { $0.position.isOffense && $0.position != .k }
        let def = t.roster.filter { !$0.position.isOffense }
        let skill = t.roster.filter { [.rb, .wr, .cb, .s].contains($0.position) }
        let o = avg(off) { ($0.speed + $0.strength + $0.catching + $0.agility) / 4 }
        let d = avg(def) { ($0.speed + $0.strength + $0.balance + $0.agility) / 4 }
        return (o, d, avg(skill) { $0.speed })
    }

    static func blurb(_ a: TeamArchetype) -> [String] {
        switch a {
        case .disciplined: return ["PRECISE ROUTES.", "SURE TACKLES."]
        case .flashy: return ["BLAZING SPEED.", "BIG PLAYS."]
        case .powerhouse: return ["GIANT LINES.", "POWER RUNNING."]
        }
    }
}

/// Mirror of GameRuntime.archetypeIndex (internal there).
enum GameRuntimeArchetype {
    static func index(_ t: TeamData) -> Int {
        switch t.archetype { case .disciplined: return 0; case .flashy: return 1; case .powerhouse: return 2 }
    }
}
