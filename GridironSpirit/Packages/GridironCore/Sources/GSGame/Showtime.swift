import GSFoundation
import GSData
import GSSimulation
import GSInput
import GSRules
import GSRenderCore

/// M4 presentation & replay-value systems: Spirit Plays, matchup portraits,
/// instant replays, stats, trials and the end-of-game report.
extension GameRuntime {
    static let cutInLength = 1.5
    var replayLength: Double { replayFrames.last?.t ?? 0 }

    func portrait(_ p: PlayerData, team: Int) -> PortraitInfo {
        let t = teams[team]
        return PortraitInfo(playerID: p.id, name: p.lastName.uppercased(), number: p.number,
                            jersey: t.colors.primaryRGBA, trim: t.colors.accentRGBA,
                            archetype: Self.archetypeIndex(t), big: [.c, .og, .dl].contains(p.position))
    }

    // MARK: Spirit meter

    /// Charge a team's meter. The trailing team charges 35% faster: games stay
    /// alive and comebacks feel earned rather than impossible.
    func charge(_ team: Int, _ amount: Double) {
        let trailing = state.score[team] < state.score[1 - team]
        spiritMeter[team] = min(1, spiritMeter[team] + amount * Self.spiritChargeRate * (trailing ? 1.35 : 1))
    }

    /// Tuned so each team gets about 2-3 Spirit Plays a game: special, not routine.
    static let spiritChargeRate = 0.5

    func spiritStar(team: Int) -> (SpiritPlay, PlayerData)? {
        let side: SpiritPlay.Side = team == state.possession ? .offense : .defense
        let wanted: SpiritPlay.PlayType = currentOffensePlay?.category == .run ? .run : .pass
        let onField = Set(world.players.filter { $0.teamIndex == team }.map(\.data.id))
        let options = teams[team].roster.compactMap { p -> (SpiritPlay, PlayerData, Int)? in
            guard let sp = spirits.play(p.spiritPlay), sp.side == side else { return nil }
            var score = onField.contains(p.id) ? 2 : 0
            if sp.playType == wanted { score += 3 } else if sp.playType == .any { score += 1 }
            return (sp, p, score)
        }
        return options.max { $0.2 < $1.2 }.map { ($0.0, $0.1) }
    }

    @discardableResult
    func activateSpirit(team: Int) -> Bool {
        guard phase == .preSnap, spiritMeter[team] >= 1, kick == nil, cutIn == nil,
              !activeSpirit.contains(where: { $0.team == team }), let (play, player) = spiritStar(team: team) else { return false }
        let side: TeamSide = team == state.possession ? .offense : .defense
        world.spirit[side.rawValue] = play.effects
        if side == .defense && play.effects.instantReads == true { ai.spiritInstantReads = true }
        spiritMeter[team] = 0
        activeSpirit.append((team, play, player))
        cutIn = (team, play, player, 0)
        teamStats[team].spiritPlaysUsed += 1
        fx.haptics.append(HapticPulse(intensity: 1, sharpness: 0.5))
        fx.crowdHype = 3
        playLog.append("   ** \(teams[team].abbreviation) SPIRIT PLAY: \(play.name) (\(player.lastName.uppercased()))")
        return true
    }

    /// CPU coaches save Spirit for moments that matter.
    func cpuSpiritDecision() {
        guard phaseTimer > 0.3, kick == nil else { return }
        for team in 0..<2 where team != humanTeam && spiritMeter[team] >= 1 {
            let lateClose = state.quarter == 4 && state.clock < 120 && abs(state.score[0] - state.score[1]) <= 8
            let critical: Bool
            if team == state.possession {
                critical = state.down >= 3 || state.ballOn >= 80 || state.isOvertime || state.isConversion || lateClose
            } else {
                critical = state.ballOn >= 75 || (state.down >= 3 && state.distance <= 4) || state.isOvertime || lateClose
            }
            if critical { activateSpirit(team: team) }
        }
    }

    // MARK: Matchups

    func defensiveStar() -> SimPlayer? {
        let d = world.players.filter { $0.side == .defense }
        return d.first { $0.data.spiritPlay != nil }
            ?? d.filter { [.lb, .s, .cb].contains($0.data.position) }
                .max { $0.data.ratings.speed + $0.data.ratings.strength < $1.data.ratings.speed + $1.data.ratings.strength }
    }

    func startSnapMatchup() {
        let slot = currentOffensePlay?.category == .run ? "RB" : "QB"
        guard kick == nil, let o = world.players.first(where: { $0.side == .offense && $0.slot == slot }),
              let d = defensiveStar() else { return }
        matchup = (o.data, o.teamIndex, d.data, d.teamIndex, .neutral, .neutral, 0, 1.0)
    }

    // MARK: Stats from live events

    func harvest(_ events: [GameEvent]) {
        for e in events {
            guard case .tackle(let r, let carrier, let tackler, _) = e else { continue }
            let tk = world.player(tackler), ca = world.player(carrier)
            switch r.outcome {
            case .clean, .pushedForward:
                lastTackler = tackler
                playerStats[tk.data.id, default: PlayerGameStats(name: tk.data.lastName.uppercased(), team: tk.teamIndex)].tackles += 1
            case .broken, .whiff:
                teamStats[ca.teamIndex].brokenTackles += 1
                charge(ca.teamIndex, 0.05)
            case .stumble: break
            }
            if r.impact >= TackleResolver.bigHitImpact && (r.outcome == .clean || r.outcome == .pushedForward) {
                bigHitThisPlay = true
                teamStats[tk.teamIndex].bigHits += 1
                charge(tk.teamIndex, 0.06)
            }
        }
    }

    func afterRuling(result: PlayResult, ruling: Ruling, before: GameState) {
        let off = before.possession, def = 1 - off
        let carrier = world.ball.holder.map { world.player($0) }
        func pstat(_ p: SimPlayer, _ f: (inout PlayerGameStats) -> Void) {
            var s = playerStats[p.data.id] ?? PlayerGameStats(name: p.data.lastName.uppercased(), team: p.teamIndex)
            f(&s)
            playerStats[p.data.id] = s
        }
        var gain: Double = 0
        var highlight = false
        var offenseWon = true
        var callout = ruling.callouts.first { $0 != "FLAG!" } ?? ""

        if !before.isConversion && result.kind != .falseStart {
            var isTD = false
            if case .touchdown(byOffense: true) = result.kind { isTD = true }
            if isTD { gain = 100 - before.ballOn } else if !ruling.possessionChanged { gain = state.ballOn - before.ballOn }
            let completed = world.passThrown && carrier?.side == .offense && carrier?.slot != "QB"
            if world.passThrown { teamStats[off].passAttempts += 1 }
            if !ruling.possessionChanged || isTD {
                if completed { teamStats[off].completions += 1; teamStats[off].passYards += gain }
                else if !world.passThrown && !result.sack { teamStats[off].rushYards += gain }
                if let c = carrier, c.side == .offense { pstat(c) { $0.yards += gain } }
            }
            if ruling.firstDown { teamStats[off].firstDowns += 1; charge(off, 0.08) }
            if gain >= 15 { charge(off, 0.1) }
            if gain >= 25 { highlight = true }
        }
        switch result.kind {
        case .touchdown(let byOffense):
            let scorer = byOffense ? off : def
            teamStats[scorer].touchdowns += 1
            if let c = carrier { pstat(c) { $0.touchdowns += 1 } }
            if activeSpirit.contains(where: { $0.team == scorer }) { teamStats[scorer].spiritTouchdowns += 1 }
            charge(scorer, 0.2); charge(1 - scorer, 0.12)
            highlight = true
            offenseWon = byOffense
        case .turnover(_, let pick):
            if pick {
                teamStats[def].interceptionsMade += 1; teamStats[off].interceptionsThrown += 1
                if let c = carrier { pstat(c) { $0.picks += 1 } }
            } else { teamStats[def].fumblesRecovered += 1 }
            charge(def, 0.22)
            highlight = true
            offenseWon = false
        case .fieldGoal(let made, _):
            let dist = Int((117 - before.ballOn).rounded())
            if made && !before.isConversion {
                teamStats[off].fieldGoalsMade += 1
                teamStats[off].longestFieldGoal = max(teamStats[off].longestFieldGoal, dist)
                charge(off, 0.08)
                if dist >= 45 { highlight = true }
            }
            offenseWon = made
        case .incomplete:
            charge(def, 0.03)
            offenseWon = false
        default: break
        }
        if result.sack {
            teamStats[def].sacksMade += 1
            if let t = lastTackler { pstat(world.player(t)) { $0.sacks += 1 } }
            charge(def, 0.14)
            offenseWon = false
        }
        if ruling.callouts.contains("TURNOVER ON DOWNS") { charge(def, 0.12); offenseWon = false }
        if bigHitThisPlay { highlight = true; if callout.isEmpty { callout = "BIG HIT!" } }
        for t in 0..<2 { teamStats[t].largestDeficit = max(teamStats[t].largestDeficit, state.score[1 - t] - state.score[t]) }

        // Reaction portraits: winner confident, loser shocked.
        if highlight || result.sack, let d = (lastTackler.map { world.player($0) } ?? defensiveStar()),
           let o = (carrier?.side == .offense ? carrier : world.quarterback) {
            let (le, re): (Expression, Expression) = offenseWon ? (.confident, .shocked) : (.shocked, .confident)
            let defender = carrier?.side == .defense ? carrier! : d
            matchup = (o.data, o.teamIndex, defender.data, defender.teamIndex, le, re, 0, 1.8)
        }
        pendingReplay = highlight && kick == nil
        replayLabel = callout
    }

    // MARK: Instant replay

    func recordForReplay(_ f: RenderFrame) {
        guard replaysEnabled, phase == .live || (phase == .postPlay && phaseTimer < 0.9), cutIn == nil else { return }
        var c = f
        c.haptics = []; c.hud = nil; c.icons = []; c.buttons = []; c.playCall = nil; c.kickMeter = nil
        c.matchup = nil; c.trialsBanner = nil; c.report = nil
        replayBuffer.append((wallClock, c))
        while let first = replayBuffer.first, first.t < wallClock - 6 { replayBuffer.removeFirst() }
    }

    func startReplay() {
        pendingReplay = false
        guard replayBuffer.count > 30, let last = replayBuffer.last?.t else { return continueAfterPlay() }
        let start = last - 4.2
        replayFrames = replayBuffer.filter { $0.t >= start }.map { ($0.t - start, $0.frame) }
        replayClock = 0
        phase = .replay
        matchup = nil
    }

    func endReplay() {
        replayFrames.removeAll()
        replayBuffer.removeAll()
        phase = .postPlay
        continueAfterPlay()
    }

    func replayFrame() -> RenderFrame? {
        guard !replayFrames.isEmpty else { return nil }
        var lo = 0, hi = replayFrames.count - 1
        while lo < hi { let mid = (lo + hi + 1) / 2; if replayFrames[mid].t <= replayClock { lo = mid } else { hi = mid - 1 } }
        var f = replayFrames[lo].frame
        f.replay = true
        f.callout = replayLabel.isEmpty ? nil : replayLabel
        f.calloutAge = 0.5; f.calloutLife = 99
        f.phase = .replay
        return f
    }

    // MARK: End of game

    func finishGame() {
        guard report == nil else { return }
        let me = humanTeam ?? 0
        let r = GameReport.build(humanTeam: me, abbreviations: teams.map(\.abbreviation), score: state.score,
                                 stats: teamStats, players: playerStats, trials: trials)
        report = r
        if let p = progress, humanTeam != nil {
            p.coins += r.coins
            p.gamesPlayed += 1
            if state.score[me] > state.score[1 - me] { p.wins += 1 }
            let order = ["S", "A", "B", "C", "D", "-"]
            if (order.firstIndex(of: r.grade) ?? 5) < (order.firstIndex(of: p.bestGrade) ?? 5) { p.bestGrade = r.grade }
            p.save()
        }
        playLog.append("== REPORT \(r.headline) \(r.scoreLine) GRADE \(r.grade) \(r.mvp) COINS +\(r.coins)")
    }

    // MARK: Frame decoration

    func decorate(_ f: inout RenderFrame) {
        if let c = fx.callout { f.calloutAge = c.life - c.remaining; f.calloutLife = c.life }
        f.spirit = spiritMeter
        f.spiritColors = teams.map(\.colors.primaryRGBA)
        if let m = matchup {
            let slide = m.t < 0.15 ? m.t / 0.15 : m.t > m.life - 0.15 ? max(0, (m.life - m.t) / 0.15) : 1
            f.matchup = MatchupVisual(left: portrait(m.left, team: m.lt), right: portrait(m.right, team: m.rt),
                                      leftExpression: m.le, rightExpression: m.re, slide: slide)
        }
        if let c = cutIn {
            let t = teams[c.team]
            f.cutIn = CutInVisual(portrait: portrait(c.player, team: c.team), spiritName: c.play.name,
                                  playerName: c.player.lastName.uppercased(), primary: t.colors.primaryRGBA,
                                  accent: t.colors.accentRGBA, motif: c.play.motif, t: c.t)
        }
        if phase == .final { f.report = report }
        if phase == .playCall && playCount == 0 && gameTime < 8 && humanTeam != nil {
            f.trialsBanner = ["TODAY'S SPIRIT TRIALS"] + trials.map { "\($0.text)  +\($0.reward)" }
        }
    }
}
