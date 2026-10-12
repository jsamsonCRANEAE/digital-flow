import GSFoundation

public enum DeadBallReason: Sendable, Equatable {
    case tackled, outOfBounds, incomplete, touchdown, interception, turnover, safety
}

/// Everything noteworthy that happened during one simulation tick. The
/// presentation layer turns these into hit-stop, particles, haptics, sound.
public enum GameEvent: Sendable, Equatable {
    case snap
    case hardCut(player: Int, at: Vec2)
    case reachedTopSpeed(player: Int)
    case throwRelease(player: Int, kind: ThrowKind, wobble: Double)
    case catchMade(player: Int, at: Vec3, contested: Bool, interception: Bool)
    case drop(player: Int, at: Vec3)
    case deflection(player: Int, at: Vec3)
    case tackle(TackleResult, carrier: Int, tackler: Int, at: Vec3)
    case fumble(player: Int, at: Vec3)
    case recovery(player: Int, offense: Bool)
    case ballBounce(at: Vec3, strength: Double)
    case move(player: Int, kind: MoveKind)
    case landing(player: Int, at: Vec3)
    case whistle(DeadBallReason, spot: Vec2)
}
