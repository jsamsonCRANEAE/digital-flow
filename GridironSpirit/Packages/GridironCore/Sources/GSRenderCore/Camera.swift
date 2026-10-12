import GSFoundation

/// Pinhole camera for the pseudo-3D field. It never yaws or rolls: it always
/// looks down the +y axis (downfield) with a fixed downward pitch, so the
/// horizon row is constant and yard lines converge to one vanishing point.
///
/// Canvas coordinates: x right, y DOWN, origin top-left, in internal pixels.
public struct Camera: Sendable, Equatable {
    public var position: Vec3
    /// Downward tilt in radians.
    public var pitch: Double
    /// Focal length in canvas pixels.
    public var focal: Double
    /// Principal point (screen-shake offsets are applied here, in whole pixels).
    public var centerX: Double
    public var centerY: Double

    public init(position: Vec3, pitch: Double, focal: Double,
                centerX: Double = Double(Canvas.width) / 2, centerY: Double = Double(Canvas.height) / 2) {
        self.position = position; self.pitch = pitch; self.focal = focal
        self.centerX = centerX; self.centerY = centerY
    }

    public struct Projected: Sendable, Equatable {
        public var x: Double
        public var y: Double
        /// Distance along the view axis (yards). <= near plane means hidden.
        public var depth: Double
        /// Canvas pixels per world yard at this depth.
        public var pixelsPerYard: Double
    }

    public static let nearPlane = 0.5

    /// Canvas row of the horizon (vanishing line of the ground plane).
    public var horizonY: Double { centerY - focal * tanD(pitch) }

    public func project(_ p: Vec3) -> Projected? {
        let c = cosD(pitch), s = sinD(pitch)
        let dx = p.x - position.x, dy = p.y - position.y, dz = p.z - position.z
        let depth = dy * c - dz * s
        guard depth > Self.nearPlane else { return nil }
        let up = dy * s + dz * c
        let ppy = focal / depth
        return Projected(x: centerX + dx * ppy, y: centerY - up * ppy, depth: depth, pixelsPerYard: ppy)
    }

    /// Ground intersection for a canvas row (sampled at the pixel-row center).
    /// Returns world y of the row and `t` = world x-yards per horizontal pixel,
    /// plus the world x at the center of pixel column 0. Nil above the horizon.
    public struct GroundRow: Sendable {
        public var worldY: Double
        public var xAtColumn0: Double
        public var yardsPerPixelX: Double
        /// Euclidean ground distance proxy used for fog.
        public var distance: Double
    }

    public func groundRow(_ row: Int) -> GroundRow? {
        let c = cosD(pitch), s = sinD(pitch)
        let v = centerY - (Double(row) + 0.5)   // pixels above principal point
        let dirY = focal * c + v * s
        let dirZ = -focal * s + v * c
        guard dirZ < -1e-6, position.z > 0 else { return nil }
        let t = -position.z / dirZ
        let worldY = position.y + t * dirY
        let x0 = position.x + t * (0.5 - centerX)
        return GroundRow(worldY: worldY, xAtColumn0: x0, yardsPerPixelX: t, distance: worldY - position.y)
    }
}

/// Tunables for the behind-the-offense "batter's eye" view.
public struct CameraConfig: Sendable, Equatable {
    /// ~50 degree vertical FOV on the 296 px tall canvas.
    public var focal: Double = 317
    /// Canvas row of the horizon; everything above is stadium backdrop.
    public var horizonRow: Double = 96
    /// Camera height and distance behind the focus point at zoom 1 (yards).
    public var height: Double = 6.0
    public var backDistance: Double = 16.0
    /// Seconds of carrier velocity to lead the camera by.
    public var lookAheadTime: Double = 0.35
    public var maxLookAhead: Double = 5.0
    /// Critically damped follow time constants.
    public var followSmoothTime: Double = 0.22
    public var zoomSmoothTime: Double = 0.35
    /// Keep the focus this far inside the sidelines to limit dead space.
    public var lateralMargin: Double = 12
    public init() {}

    public var pitch: Double {
        atanD((Double(Canvas.height) / 2 - horizonRow) / focal)
    }
}
