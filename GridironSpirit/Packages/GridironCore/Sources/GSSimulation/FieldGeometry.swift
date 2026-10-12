/// Regulation field dimensions in yards. World origin is the back corner of
/// the home end zone on the left sideline; the offense in M1 drives toward +y.
public enum Field {
    public static let width: Double = 160.0 / 3.0          // 53.33 yd
    public static let length: Double = 120                 // incl. both end zones
    public static let endZoneDepth: Double = 10
    public static let homeGoalLine: Double = 10
    public static let awayGoalLine: Double = 110
    /// Hash marks 70 ft 9 in from each sideline.
    public static let leftHash: Double = 70.75 / 3
    public static var rightHash: Double { width - leftHash }
    public static var centerX: Double { width / 2 }

    /// How far players may run past the boundary before being clamped.
    public static let runoff: Double = 4

    /// Converts "own N yard line" for a team driving toward +y into world y.
    public static func worldY(ownYardLine n: Double) -> Double { homeGoalLine + n }

    public static func isInBounds(_ x: Double, _ y: Double) -> Bool {
        x >= 0 && x <= width && y >= 0 && y <= length
    }
}
