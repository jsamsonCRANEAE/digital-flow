import GSFoundation

// MARK: - Catching

public enum CatchOutcome: Sendable, Equatable { case caught, dropped, deflected, missed }

/// Inputs for a single catch attempt, all normalised to 0...1 where possible.
public struct CatchContext: Sendable {
    public var catching: Int
    public var isOffense: Bool
    public var isIntendedReceiver: Bool
    public var ballSpeed: Double
    public var ballHeight: Double
    /// 1 = ball arrives dead centre on the body, 0 = at the edge of reach.
    public var centered: Double
    /// 0 = uncontested, 1 = defender's hands right there.
    public var contest: Double
    public var diving: Bool
    /// Spirit Play bonus added to the catch (offense) / pick (defense) chance.
    public var bonus: Double = 0

    public init(catching: Int, isOffense: Bool, isIntendedReceiver: Bool, ballSpeed: Double, ballHeight: Double,
                centered: Double, contest: Double, diving: Bool) {
        self.catching = catching; self.isOffense = isOffense; self.isIntendedReceiver = isIntendedReceiver
        self.ballSpeed = ballSpeed; self.ballHeight = ballHeight; self.centered = centered
        self.contest = contest; self.diving = diving
    }
}

public enum CatchResolver {
    /// (catch, deflect) probabilities; the remainder is drop (offense) or miss (defense).
    public static func probabilities(_ c: CatchContext) -> (catch: Double, deflect: Double) {
        let skill = Double(clamp(c.catching, 1, 99)) / 99
        // Fast balls are harder to secure, but open NFL-calibre bullets are still caught ~85%+.
        let speedPenalty = clamp((c.ballSpeed - 20) / 30, 0, 0.12)
        let heightPenalty = (c.ballHeight > 2.15 || c.ballHeight < 0.55) ? 0.12 : 0
        let divePenalty = c.diving ? 0.12 : 0
        let centered = clamp(c.centered, 0, 1), contest = clamp(c.contest, 0, 1)
        if c.isOffense {
            let base = c.isIntendedReceiver ? 0.38 : 0.2
            let pc = clamp(base + 0.58 * skill + 0.14 * centered - speedPenalty - heightPenalty
                           - divePenalty - 0.5 * contest + c.bonus, 0.03, 0.99)
            return (pc, (1 - pc) * contest * 0.6)
        } else {
            // Defenders mostly play the ball: deflections are far likelier than picks.
            let pi = clamp(0.03 + 0.3 * skill * centered - speedPenalty - heightPenalty + c.bonus, 0.01, 0.4 + c.bonus)
            let pd = clamp(0.12 + 0.38 * centered + 0.12 * (c.diving ? 1 : 0), 0, 1 - pi)
            return (pi, pd)
        }
    }

    public static func resolve(_ c: CatchContext, roll: Double) -> CatchOutcome {
        let (pc, pd) = probabilities(c)
        if roll < pc { return .caught }
        if roll < pc + pd { return .deflected }
        return c.isOffense ? .dropped : .missed
    }
}

// MARK: - Tackling

public enum MoveKind: Int, Sendable, Hashable { case juke, spin, stiffArm, dive, jump }

public enum TackleOutcome: Sendable, Equatable {
    /// Carrier goes down at the spot.
    case clean
    /// Carrier's momentum carries the pile forward before going down.
    case pushedForward
    /// Carrier keeps feet but is slowed and off balance.
    case stumble
    /// Carrier shrugs it off; tackler hits the turf.
    case broken
    /// Juke made the tackler grab air.
    case whiff
}

public struct TackleContext: Sendable {
    public var tacklerMass: Double
    public var tacklerStrength: Int
    public var tacklerSpeed: Double
    public var carrierMass: Double
    public var carrierStrength: Int
    public var carrierBalance: Int
    /// Relative speed along the contact normal (yd/s, > 0 = colliding).
    public var closingSpeed: Double
    /// 1 = tackler squarely in front of the carrier, -1 = from behind.
    public var frontalness: Double
    /// Carrier speed along their own heading (yd/s).
    public var carrierSpeed: Double
    public var move: MoveKind?
    /// Seconds since the move started.
    public var moveAge: Double
    /// Dive tackle: longer reach, more stopping power, but no recovery if missed.
    public var tacklerDiving: Bool
    /// Tackler is locked up with a blocker: only an arm tackle is possible.
    public var tacklerEngaged: Bool = false
    // Spirit Play modifiers.
    public var extraPower: Double = 0
    public var extraResist: Double = 0
    public var unbreakableMoves = false
    public var forcePile = false
    public var fumbleMultiplier: Double = 1

    public init(tacklerMass: Double, tacklerStrength: Int, tacklerSpeed: Double, carrierMass: Double,
                carrierStrength: Int, carrierBalance: Int, closingSpeed: Double, frontalness: Double,
                carrierSpeed: Double, move: MoveKind?, moveAge: Double, tacklerDiving: Bool = false) {
        self.tacklerDiving = tacklerDiving
        self.tacklerMass = tacklerMass; self.tacklerStrength = tacklerStrength; self.tacklerSpeed = tacklerSpeed
        self.carrierMass = carrierMass; self.carrierStrength = carrierStrength; self.carrierBalance = carrierBalance
        self.closingSpeed = closingSpeed; self.frontalness = frontalness; self.carrierSpeed = carrierSpeed
        self.move = move; self.moveAge = moveAge
    }
}

public struct TackleResult: Sendable, Equatable {
    public var outcome: TackleOutcome
    /// Impulse-based hit strength: ~3 routine, 6+ big hit, 9+ highlight reel.
    public var impact: Double
    public var fumble: Bool
}

public enum TackleResolver {
    /// ~9 = a genuinely violent collision (a full-speed head-on hit is ~11),
    /// so "BIG HIT!" stays rare enough to mean something.
    public static let bigHitImpact = 9.0

    /// Impact uses the two-body reduced mass so a lineman hitting a receiver
    /// rates higher than two receivers bumping at the same speed.
    public static func impact(_ c: TackleContext) -> Double {
        let reduced = c.tacklerMass * c.carrierMass / (c.tacklerMass + c.carrierMass)   // lbs
        // Normalised so a full-speed head-on hit (~16 yd/s closing) by a
        // linebacker on a back rates ~11, and a routine wrap-up ~3.
        return max(0, c.closingSpeed) * reduced / 160
    }

    public static func resolve(_ c: TackleContext, rolls r: (Double, Double, Double)) -> TackleResult {
        let imp = impact(c)
        // Juke: lateral/front contacts early in the move can whiff entirely.
        if c.move == .juke && c.moveAge < 0.22 && c.frontalness > -0.3 && (r.0 < 0.6 || c.unbreakableMoves) {
            return TackleResult(outcome: .whiff, impact: 0, fumble: false)
        }
        if c.unbreakableMoves && (c.move == .spin || c.move == .juke) && c.moveAge < 0.45 {
            return TackleResult(outcome: .whiff, impact: 0, fumble: false)
        }
        let str = Double(c.tacklerStrength) / 99
        let side = 1 - abs(c.frontalness)
        var power = 0.25 + 0.4 * str + 0.06 * min(imp, 10)
        power += c.frontalness < -0.4 ? 0.2 : 0          // wrapped up from behind
        power += c.tacklerDiving ? 0.22 : 0
        power -= c.tacklerEngaged ? 0.4 : 0
        power += c.extraPower
        var resist = 0.18 + 0.35 * Double(c.carrierBalance) / 99 + 0.25 * Double(c.carrierStrength) / 99
        resist += 0.0015 * max(0, c.carrierMass - c.tacklerMass)  // big backs bounce off small DBs
        resist += c.extraResist
        switch c.move {
        case .stiffArm? where c.frontalness > -0.2 && c.moveAge < 0.5: resist += 0.38
        case .spin? where side > 0.3 || c.frontalness < 0: resist += 0.42 * (c.moveAge < 0.42 ? 1 : 0.3)
        default: break
        }
        let margin = power - resist + (r.1 - 0.5) * 0.5
        let outcome: TackleOutcome
        if margin > 0.22 {
            // Carrier running downhill into a frontal hit falls forward for extra yards.
            let carrierMomentum = c.carrierMass * c.carrierSpeed
            let tacklerMomentum = c.tacklerMass * c.tacklerSpeed * max(0, c.frontalness)
            outcome = c.forcePile || (carrierMomentum > tacklerMomentum * 1.15 && c.frontalness > 0.3) ? .pushedForward : .clean
        } else if margin > -0.06 {
            outcome = .stumble
        } else {
            outcome = .broken
        }
        let down = outcome == .clean || outcome == .pushedForward
        // NFL fumble rate is ~1 per 60-70 touches; big hits raise it, capped.
        let fumbleChance = down && imp > bigHitImpact
            ? clamp(0.03 + 0.008 * (imp - bigHitImpact) - 0.015 * Double(c.carrierStrength) / 99, 0, 0.07) : 0
        return TackleResult(outcome: outcome, impact: imp, fumble: r.2 < fumbleChance * c.fumbleMultiplier)
    }
}
