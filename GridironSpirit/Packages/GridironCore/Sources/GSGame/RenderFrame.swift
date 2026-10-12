import GSFoundation
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
    public var frame: Int
    public var view: SpriteView
    public var flipX: Bool
    public var isControlled: Bool
}

public struct RenderFrame: Sendable {
    public var camera: Camera
    public var sprites: [ProjectedSprite]
    public var crowdFrame: Int
    public var simTime: Double
    /// Interpolation factor used for this frame (diagnostics).
    public var alpha: Double
    public var stepsThisFrame: Int
}
