import GSFoundation
import GSSimulation

/// Critically damped spring toward a target (frame-rate independent).
@inlinable func smoothDamp(_ current: Double, _ target: Double, _ velocity: inout Double,
                           smoothTime: Double, dt: Double) -> Double {
    let omega = 2 / max(1e-4, smoothTime)
    let x = omega * dt
    let decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
    let change = current - target
    let temp = (velocity + omega * change) * dt
    velocity = (velocity - omega * temp) * decay
    return target + (change + temp) * decay
}

/// Camera behaviour, advanced at the fixed simulation rate so that it is
/// deterministic and interpolates exactly like the players do.
public struct CameraRig: Sendable {
    public enum Mode: Sendable, Equatable {
        /// Follow a ball carrier with look-ahead.
        case follow
        /// Frame two points (thrower + target) — used by passing in M2.
        case frame(Vec2, Vec2)
    }

    public struct State: Sendable, Equatable {
        public var focus: Vec2
        public var zoom: Double
        public init(focus: Vec2, zoom: Double) { self.focus = focus; self.zoom = zoom }
        public static func lerped(_ a: State, _ b: State, _ t: Double) -> State {
            State(focus: lerp(a.focus, b.focus, t), zoom: lerp(a.zoom, b.zoom, t))
        }
    }

    public var config: CameraConfig
    public var mode: Mode = .follow
    public private(set) var state: State
    var velocity = Vec2.zero
    var zoomVelocity = 0.0

    // Screen shake (whole canvas pixels, decaying).
    var shakeAmplitude = 0.0
    var shakeRemaining = 0.0
    var shakeDuration = 0.0
    var shakeTick: Int = 0
    public private(set) var shakeOffset: (x: Int, y: Int) = (0, 0)

    public init(config: CameraConfig = CameraConfig(), focus: Vec2) {
        self.config = config
        state = State(focus: focus, zoom: 1)
    }

    public mutating func update(dt: Double, carrier: Vec2, carrierVelocity: Vec2) {
        var target: Vec2
        var targetZoom = 1.0
        switch mode {
        case .follow:
            let lead = (carrierVelocity * config.lookAheadTime).clampedLength(config.maxLookAhead)
            target = carrier + lead
        case .frame(let a, let b):
            target = (a + b) * 0.5
            // Zoom out so the pair fits: ~30 yd visible across at zoom 1.
            let spread = max(abs(a.x - b.x) / 26, abs(a.y - b.y) / 30)
            targetZoom = clamp(spread, 1, 1.9)
            // Pull the focus back toward the thrower so both stay on screen.
            target.y -= (targetZoom - 1) * 6
        }
        let margin = config.lateralMargin
        target.x = clamp(target.x, margin, Field.width - margin)
        var f = state.focus
        var vx = velocity.x, vy = velocity.y
        f.x = smoothDamp(f.x, target.x, &vx, smoothTime: config.followSmoothTime, dt: dt)
        f.y = smoothDamp(f.y, target.y, &vy, smoothTime: config.followSmoothTime, dt: dt)
        velocity = Vec2(vx, vy)
        state.focus = f
        state.zoom = smoothDamp(state.zoom, targetZoom, &zoomVelocity, smoothTime: config.zoomSmoothTime, dt: dt)
        updateShake(dt: dt)
    }

    /// Big-hit screen shake. Amplitude in canvas pixels (2-4), ~150 ms.
    public mutating func addShake(amplitude: Double = 3, duration: Double = 0.15) {
        if amplitude >= shakeAmplitude * (shakeRemaining / max(shakeDuration, 1e-6)) {
            shakeAmplitude = clamp(amplitude, 0, 4)
            shakeDuration = duration
            shakeRemaining = duration
        }
    }

    mutating func updateShake(dt: Double) {
        shakeTick &+= 1
        guard shakeRemaining > 0 else { shakeOffset = (0, 0); return }
        shakeRemaining = max(0, shakeRemaining - dt)
        let k = shakeRemaining / shakeDuration
        let amp = shakeAmplitude * k * k
        // Change direction every 2 ticks (60 Hz) so it reads as shake, not blur.
        let h = SplitMix64.hash(shakeTick / 2, 0x5AE)
        let nx = Double(h & 0xFFFF) / 32767.5 - 1
        let ny = Double((h >> 16) & 0xFFFF) / 32767.5 - 1
        shakeOffset = (snapToPixel(nx * amp), snapToPixel(ny * amp * 0.6))
    }

    /// Builds the projection camera for an (interpolated) rig state.
    public static func camera(for s: State, config: CameraConfig, shake: (x: Int, y: Int) = (0, 0)) -> Camera {
        let pos = Vec3(s.focus.x, s.focus.y - config.backDistance * s.zoom, config.height * s.zoom)
        return Camera(position: pos, pitch: config.pitch, focal: config.focal,
                      centerX: Double(Canvas.width) / 2 + Double(shake.x),
                      centerY: Double(Canvas.height) / 2 + Double(shake.y))
    }
}
