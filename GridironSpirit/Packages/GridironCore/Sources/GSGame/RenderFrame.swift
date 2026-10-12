import GSFoundation
import GSSimulation
import GSInput
import GSRenderCore

/// Everything the platform renderer needs for one displayed frame, already
/// interpolated, projected and snapped to the pixel grid. The SpriteKit side
/// only copies these numbers onto nodes.
public struct ProjectedSprite: Sendable, Equatable {
    public var id: Int
    public var teamIndex: Int
    public var visible: Bool
    /// Foot contact point in canvas pixels (y down), snapped.
    public var footX: Int
    public var footY: Int
    /// Ground shadow center in canvas pixels (y down), snapped. Always the
    /// projection of (x, y, 0): it does not rise when the player jumps.
    public var shadowX: Int
    public var shadowY: Int
    public var height: Int
    public var shadowWidth: Int
    /// Painter's order: larger = closer to camera.
    public var drawOrder: Double
    public var pose: SpritePose
    public var squash: Int
    public var view: SpriteView
    public var flipX: Bool
    public var isControlled: Bool

    /// Legacy accessor used by M1 tests: 0 idle, 1...4 run.
    public var frame: Int { pose.runIndex.map { $0 + 1 } ?? 0 }
}

public struct ProjectedBall: Sendable, Equatable {
    public var x: Int
    public var y: Int
    public var length: Int
    public var angleBucket: Int
    public var spinFrame: Int
    public var drawOrder: Double
}

public enum OverlayKind: Int, Sendable, Hashable { case starburst, catchFlash }

/// Screen-space anime effects drawn above the players.
public struct OverlayItem: Sendable, Equatable {
    public var kind: OverlayKind
    public var x: Int
    public var y: Int
    public var size: Int
    public var frame: Int
}

public struct HapticPulse: Sendable, Equatable {
    /// 0...1
    public var intensity: Double
    public var sharpness: Double
}

public struct RenderFrame: Sendable {
    public var camera: Camera
    public var sprites: [ProjectedSprite]
    public var ball: ProjectedBall?
    public var effects: EffectsFrame
    public var overlays: [OverlayItem]
    public var icons: [ReceiverIcon]
    public var chargingReceiver: Int?
    public var buttons: [ButtonSlot]
    /// Inverted / high-contrast anime impact frame.
    public var impactFrame: Bool
    public var callout: String?
    public var haptics: [HapticPulse]
    public var crowdFrame: Int
    public var simTime: Double
    public var hitStopped: Bool
    /// Interpolation factor used for this frame (diagnostics).
    public var alpha: Double
    public var stepsThisFrame: Int
}
