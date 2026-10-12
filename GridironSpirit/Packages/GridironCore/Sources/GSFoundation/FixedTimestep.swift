/// Fixed-timestep accumulator. The simulation always advances in exact `dt`
/// increments (120 Hz by default) no matter what the display refresh rate is;
/// the leftover fraction becomes the render interpolation factor.
public struct FixedTimestep: Sendable {
    public let dt: Double
    /// Longest real frame we will try to catch up on (avoids the spiral of death
    /// after a stall such as an app switch).
    public let maxFrameTime: Double
    public let maxStepsPerFrame: Int
    public private(set) var accumulator: Double = 0
    public private(set) var totalSteps: UInt64 = 0

    public init(hz: Double = 120, maxFrameTime: Double = 0.1, maxStepsPerFrame: Int = 12) {
        dt = 1.0 / hz
        self.maxFrameTime = maxFrameTime
        self.maxStepsPerFrame = maxStepsPerFrame
    }

    /// Advances by a real frame duration, invoking `step` zero or more times.
    /// Returns alpha in [0, 1): how far we are between the last two sim states.
    @discardableResult
    public mutating func advance(by frameTime: Double, step: (Double) -> Void) -> Double {
        accumulator += clamp(frameTime, 0, maxFrameTime)
        var steps = 0
        // Small epsilon so 1/60 s frames at 120 Hz produce exactly 2 steps
        // instead of occasionally 1 then 3 from float rounding.
        while accumulator + 1e-9 >= dt && steps < maxStepsPerFrame {
            step(dt)
            accumulator -= dt
            steps += 1
            totalSteps += 1
        }
        if steps == maxStepsPerFrame && accumulator >= dt { accumulator = 0 }
        accumulator = max(0, accumulator)
        return clamp(accumulator / dt, 0, 0.999_999)
    }
}
