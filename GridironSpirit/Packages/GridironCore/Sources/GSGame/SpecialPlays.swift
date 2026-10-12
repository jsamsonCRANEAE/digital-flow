import GSFoundation
import GSData

/// Kicking formations, built in code because they are rules-driven rather
/// than part of the strategy playbook.
public enum SpecialPlays {
    public enum Kind: Sendable, Equatable { case punt, fieldGoal, extraPoint }

    static let line: [Slot: [Double]] = ["C": [0, -0.6], "LG": [-1.4, -0.7], "RG": [1.4, -0.7]]

    public static func offense(_ k: Kind) -> OffensivePlay {
        var f = line
        switch k {
        case .punt:
            f["QB"] = [0, -12]; f["RB"] = [-1.5, -5]; f["WR1"] = [-18, -0.8]; f["WR2"] = [18, -0.8]
        case .fieldGoal, .extraPoint:
            f["QB"] = [0, -7]; f["RB"] = [-2.6, -1.2]; f["WR1"] = [-4.2, -1.0]; f["WR2"] = [4.2, -1.0]
        }
        let name = k == .punt ? "PUNT" : k == .fieldGoal ? "FIELD GOAL" : "EXTRA POINT"
        return OffensivePlay(id: "special_\(name)", name: name, category: .special, formation: f, routes: [:],
                             runPath: nil, exchange: .none, progression: [], blockers: nil)
    }

    public static func defense(_ k: Kind) -> DefensivePlay {
        let rush = DefensiveAssignment(role: .rush)
        var f: [Slot: [Double]] = ["DL1": [-1.0, 1.0], "DL2": [1.6, 1.0], "LB1": [-3.5, 1.2], "LB2": [3.5, 1.2],
                                   "CB1": [-8, 1.5], "CB2": [8, 1.5], "S": [0, 6]]
        var a: [Slot: DefensiveAssignment] = Dictionary(uniqueKeysWithValues: Playbook.defenseSlots.map { ($0, rush) })
        if k == .punt {
            f["S"] = [0, 40]; f["CB1"] = [-18, 6]; f["CB2"] = [18, 6]
            a["S"] = DefensiveAssignment(role: .zone, zone: [0, 40])
            a["CB1"] = DefensiveAssignment(role: .man, target: "WR1")
            a["CB2"] = DefensiveAssignment(role: .man, target: "WR2")
        }
        return DefensivePlay(id: "special_def", name: "KICK BLOCK", category: .special, formation: f, assignments: a)
    }
}

/// Kick meter state machine: power sweeps, tap; aim sweeps, tap; kick.
struct KickMeter: Sendable {
    let kind: SpecialPlays.Kind
    var stage = 0
    var t = 0.0
    var power = 0.0
    var aim = 0.0
    var lockedPower = 0.0
    var lockedAim = 0.0
    var cpuTimer = 0.0

    init(kind: SpecialPlays.Kind) { self.kind = kind }

    static func triangle(_ t: Double, period: Double) -> Double {
        let x = (t / period).truncatingRemainder(dividingBy: 1)
        return x < 0.5 ? x * 2 : 2 - x * 2
    }

    mutating func update(dt: Double) {
        t += dt
        if stage == 0 { power = Self.triangle(t, period: 1.3) }
        if stage == 1 { aim = Self.triangle(t * 1.0 + 0.25, period: 1.0) * 2 - 1 }
    }

    /// Returns true when both values are locked (ready to kick).
    mutating func tap() -> Bool {
        switch stage {
        case 0: lockedPower = power; stage = 1; t = 0
        case 1: lockedAim = aim; stage = 2
        default: break
        }
        return stage == 2
    }

    mutating func lock(power p: Double, aim a: Double) {
        lockedPower = p; power = p; lockedAim = a; aim = a; stage = 2
    }
}
