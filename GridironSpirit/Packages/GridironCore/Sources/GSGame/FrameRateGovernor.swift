/// Picks 120 Hz on ProMotion displays only while frames stay comfortably
/// inside the 8.3 ms budget; otherwise settles at 60 Hz. One-way per session
/// (with a long cool-down) so the refresh rate never oscillates.
public struct FrameRateGovernor: Sendable {
    public private(set) var targetFPS: Int
    public let maxFPS: Int
    var samples: [Double] = []
    let window = 120
    /// CPU work per frame above which 120 Hz is considered unstable.
    public var budget120: Double = 0.0060

    public init(displayMaxFPS: Int) {
        maxFPS = displayMaxFPS >= 120 ? 120 : 60
        targetFPS = maxFPS
    }

    /// Feed the measured CPU time spent producing a frame (seconds).
    /// Returns a new target if it changed.
    public mutating func record(frameWork: Double) -> Int? {
        guard targetFPS == 120 else { return nil }
        samples.append(frameWork)
        guard samples.count >= window else { return nil }
        let sorted = samples.sorted()
        let p90 = sorted[Int(Double(sorted.count) * 0.9)]
        samples.removeAll(keepingCapacity: true)
        if p90 > budget120 {
            targetFPS = 60
            return 60
        }
        return nil
    }
}
