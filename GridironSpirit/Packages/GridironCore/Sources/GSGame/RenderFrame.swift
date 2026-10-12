import GSFoundation
import GSSimulation
import GSInput
import GSRenderCore
import GSRules

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

public enum MatchPhase: Sendable, Equatable { case playCall, preSnap, live, postPlay, banner, final }

public struct HUDInfo: Sendable, Equatable {
    public var abbreviations: [String]
    public var scores: [Int]
    public var possession: Int
    public var quarter: Int
    public var clock: String
    public var downDistance: String
    public var fieldPosition: String
    public var playClock: Int?
    public var windMPH: Int
    /// Screen-space wind direction bucket (of 16), see UIArt.windArrow.
    public var windBucket: Int
    /// Active (controlled) player: name, SPD, POW, CATCH.
    public var activePlayer: (name: String, spd: Int, pow: Int, cat: Int)?
    /// 0...1 progress along the field for the mini strip (offense frame).
    public var ballProgress: Double
    public var lineToGainProgress: Double?
    public static func == (a: HUDInfo, b: HUDInfo) -> Bool {
        a.abbreviations == b.abbreviations && a.scores == b.scores && a.possession == b.possession && a.quarter == b.quarter
            && a.clock == b.clock && a.downDistance == b.downDistance && a.fieldPosition == b.fieldPosition
            && a.playClock == b.playClock && a.windMPH == b.windMPH && a.windBucket == b.windBucket
            && a.activePlayer?.name == b.activePlayer?.name && a.ballProgress == b.ballProgress
    }
}

public struct PlayCallCard: Sendable, Equatable {
    public var title: String
    public var category: String
    public var diagram: CardDiagram
    public var rect: Rect
}

public struct PlayCallVisual: Sendable, Equatable {
    public var header: String
    public var cards: [PlayCallCard]
    public var page: Int
    public var pageCount: Int
    public var accent: RGBA
}

public struct KickMeterVisual: Sendable, Equatable {
    public var power: Double
    public var aim: Double
    public var stage: Int
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
    public var phase: MatchPhase
    public var hud: HUDInfo?
    public var playCall: PlayCallVisual?
    public var kickMeter: KickMeterVisual?
    /// Near (offense) and far end-zone colors for the field rasterizer.
    public var endZones: (near: RGBA, far: RGBA)
    public var simTime: Double
    public var hitStopped: Bool
    /// Interpolation factor used for this frame (diagnostics).
    public var alpha: Double
    public var stepsThisFrame: Int
}
