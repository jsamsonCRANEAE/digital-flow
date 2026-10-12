import GSFoundation
import GSSimulation

public struct Particle: Sendable {
    public var position: Vec3
    public var velocity: Vec3
    public var life: Double
    public var maxLife: Double
    public var color: RGBA
    /// Drawn size in yards (projected, min 1 px).
    public var size: Double
    public var gravity: Double
    public init(position: Vec3, velocity: Vec3, life: Double, color: RGBA, size: Double, gravity: Double = BallPhysics.gravity) {
        self.position = position; self.velocity = velocity; self.life = life; self.maxLife = life
        self.color = color; self.size = size; self.gravity = gravity
    }
}

/// World-space effects that live *on or near the field*: drawn into the CPU
/// canvas after the field, under the sprites (like a real ground layer).
public struct EffectsFrame: Sendable {
    public var particles: [Particle] = []
    /// Ball position (for its ground shadow) when not held.
    public var ballForShadow: Vec3?
    /// Recent ball positions, newest last.
    public var trail: [Vec3] = []
    public var trailKind: ThrowKind?
    public var reticle: Vec3?
    public var reticlePulse: Double = 0
    /// Anime speed lines converging on a screen point (canvas px).
    public var speedLines: (x: Double, y: Double, intensity: Double, seed: Int)?
    /// Draw goal posts at both end lines (they're 3D objects above the turf).
    public var goalPosts = true
    public init() {}
}

public enum EffectsRasterizer {
    public static func render(_ fx: EffectsFrame, camera: Camera, into buf: inout PixelBuffer) {
        if fx.goalPosts { goalPosts(camera: camera, into: &buf) }
        if let sl = fx.speedLines, sl.intensity > 0.02 { speedLines(sl, into: &buf) }
        if let r = fx.reticle { reticle(r, pulse: fx.reticlePulse, camera: camera, into: &buf) }
        if let b = fx.ballForShadow { ballShadow(b, camera: camera, into: &buf) }
        if fx.trail.count > 1 { trail(fx.trail, kind: fx.trailKind ?? .bullet, camera: camera, into: &buf) }
        for p in fx.particles { particle(p, camera: camera, into: &buf) }
    }

    /// The ball's shadow always sits on the ground directly under it. It
    /// shrinks and thins (fewer dithered pixels) as the ball climbs, so height
    /// reads from the shadow alone: big and dark = low, small and faint = high.
    static func ballShadow(_ b: Vec3, camera: Camera, into buf: inout PixelBuffer) {
        guard let g = camera.project(Vec3(b.x, b.y, 0)) else { return }
        let base = max(3, 0.42 * g.pixelsPerYard)
        let k = clamp(1 - b.z / 14, 0.4, 1)
        let rx = base * k * 0.5, ry = max(1, rx * 0.4)
        let density = clamp(1.05 - b.z / 16, 0.3, 1)
        let threshold = Int(density * 16)
        let x0 = Int((g.x - rx).rounded(.down)), x1 = Int((g.x + rx).rounded(.up))
        let y0 = Int((g.y - ry).rounded(.down)), y1 = Int((g.y + ry).rounded(.up))
        for y in y0...y1 {
            for x in x0...x1 where buf.contains(x, y) {
                let dx = (Double(x) + 0.5 - g.x) / rx, dy = (Double(y) + 0.5 - g.y) / ry
                guard dx * dx + dy * dy <= 1, Palette.bayer(x, y) < threshold else { continue }
                buf.set(x, y, buf.color(x, y).mixed(with: Palette.shadow, 0.55))
            }
        }
    }

    static func trail(_ pts: [Vec3], kind: ThrowKind, camera: Camera, into buf: inout PixelBuffer) {
        let proj = pts.compactMap { camera.project($0) }
        guard proj.count > 1 else { return }
        let core = kind == .bullet ? RGBA(hex: 0xFFFFFF) : RGBA(hex: 0xE8F4FF)
        let glow = kind == .bullet ? RGBA(hex: 0xFFD23F) : RGBA(hex: 0x9AD8FF)
        for i in 1..<proj.count {
            let a = proj[i - 1], b = proj[i]
            let age = Double(proj.count - i) / Double(proj.count)       // 1 = oldest
            let thick = kind == .bullet && age < 0.5
            line(Int(a.x.rounded()), Int(a.y.rounded()), Int(b.x.rounded()), Int(b.y.rounded())) { x, y, n in
                if kind == .lob && n % 3 == 2 { return }                // dotted for touch passes
                if age > 0.6 && (x + y) & 1 == 0 { return }              // fade tail by dithering
                buf.set(x, y, core)
                if thick { buf.set(x, y - 1, glow); buf.set(x, y + 1, glow) }
            }
        }
    }

    /// Pulsing ring where the pass will come down (classic arcade aid that
    /// also makes lob height/distance readable at a glance).
    static func reticle(_ p: Vec3, pulse: Double, camera: Camera, into buf: inout PixelBuffer) {
        let r = 0.85 * (1 + 0.15 * sinD(pulse * 11))
        let col = RGBA(hex: 0xFFE45C)
        var last: Camera.Projected?
        for i in 0...32 {
            let a = Double(i) / 32 * 2 * Double.pi
            guard let q = camera.project(Vec3(p.x + cosD(a) * r, p.y + sinD(a) * r, 0)) else { last = nil; continue }
            if let l = last {
                line(Int(l.x.rounded()), Int(l.y.rounded()), Int(q.x.rounded()), Int(q.y.rounded())) { x, y, _ in
                    buf.set(x, y, col)
                }
            }
            last = q
        }
        if let c = camera.project(Vec3(p.x, p.y, 0)) { buf.set(snapToPixel(c.x), snapToPixel(c.y), col) }
    }

    /// Regulation uprights on the end line: 18 ft 6 in apart, crossbar at
    /// 10 ft, uprights to 30 ft above the bar. Projected as true 3D lines.
    static func goalPosts(camera: Camera, into buf: inout PixelBuffer) {
        let half = 18.5 / 3 / 2, bar = 10.0 / 3, top = bar + 10
        let yellow = RGBA(hex: 0xFFD23F), dark = RGBA(hex: 0xB8902A)
        for y in [Field.length, 0.0] {
            let cx = Field.centerX
            let segs: [(Vec3, Vec3, RGBA)] = [
                (Vec3(cx, y + 1.5, 0), Vec3(cx, y + 0.6, bar), dark),           // gooseneck base
                (Vec3(cx, y + 0.6, bar), Vec3(cx, y, bar), dark),
                (Vec3(cx - half, y, bar), Vec3(cx + half, y, bar), yellow),     // crossbar
                (Vec3(cx - half, y, bar), Vec3(cx - half, y, top), yellow),     // uprights
                (Vec3(cx + half, y, bar), Vec3(cx + half, y, top), yellow),
            ]
            for (a, b, col) in segs {
                guard let pa = camera.project(a), let pb = camera.project(b) else { continue }
                let thick = pa.pixelsPerYard > 12
                line(snapToPixel(pa.x), snapToPixel(pa.y), snapToPixel(pb.x), snapToPixel(pb.y)) { x, y, _ in
                    guard buf.contains(x, y) else { return }
                    buf.set(x, y, col)
                    if thick { buf.set(x + 1, y, col.hueShifted(-0.4)) }
                }
            }
        }
    }

    static func particle(_ p: Particle, camera: Camera, into buf: inout PixelBuffer) {
        guard let q = camera.project(p.position) else { return }
        let s = max(1, Int((p.size * q.pixelsPerYard).rounded()))
        let x = snapToPixel(q.x) - s / 2, y = snapToPixel(q.y) - s / 2
        // Fade by thinning, never by alpha: stays on palette.
        let fade = p.life / p.maxLife
        if fade < 0.35 && (x + y) & 1 == 0 { return }
        buf.fillRect(x: x, y: y, width: s, height: s, p.color)
    }

    /// Manga speed lines: tapered white wedges from the screen edge toward the
    /// runner (thick outside, a point near them), leaving a clear window
    /// around the player. Re-seeded ~30x per second for the flicker.
    static func speedLines(_ sl: (x: Double, y: Double, intensity: Double, seed: Int), into buf: inout PixelBuffer) {
        var rng = SplitMix64(seed: UInt64(truncatingIfNeeded: sl.seed) &* 0x9E37)
        let k = clamp(sl.intensity, 0, 1)
        let count = Int(8 + 22 * k)
        let clearRadius = 72.0 + 40 * (1 - k)
        let white = RGBA(hex: 0xFFFFFF), pale = RGBA(hex: 0xD8F4FF)
        for _ in 0..<count {
            let a = rng.unit() * 2 * Double.pi
            let dir = Vec2(cosD(a), sinD(a))
            let inner = clearRadius + rng.unit() * 70
            // Outer end: where the ray leaves the canvas.
            let tx = dir.x > 0 ? (Double(buf.width) - sl.x) / dir.x : dir.x < 0 ? -sl.x / dir.x : 1e9
            let ty = dir.y > 0 ? (Double(buf.height) - sl.y) / dir.y : dir.y < 0 ? -sl.y / dir.y : 1e9
            let outer = min(tx, ty) + 2
            guard outer > inner + 8 else { continue }
            let maxW = (1.5 + 2.5 * rng.unit()) * (0.6 + 0.4 * k)
            let col = rng.unit() < 0.65 ? white : pale
            let perp = Vec2(-dir.y, dir.x)
            var d = inner
            while d <= outer {
                let t = (d - inner) / (outer - inner)          // 0 at tip, 1 at edge
                let half = maxW * t
                let cx = sl.x + dir.x * d, cy = sl.y + dir.y * d
                var o = -half
                repeat {
                    let px = Int((cx + perp.x * o).rounded()), py = Int((cy + perp.y * o).rounded())
                    if buf.contains(px, py) { buf.set(px, py, col) }
                    o += 0.7
                } while o <= half
                d += 0.8
            }
        }
    }

    /// Bresenham; body gets (x, y, stepIndex).
    @inline(__always)
    static func line(_ x0: Int, _ y0: Int, _ x1: Int, _ y1: Int, _ body: (Int, Int, Int) -> Void) {
        var x = x0, y = y0
        let dx = abs(x1 - x0), dy = -abs(y1 - y0)
        let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
        var err = dx + dy
        var n = 0
        while true {
            body(x, y, n)
            if x == x1 && y == y1 { break }
            n += 1
            if n > 2000 { break }
            let e2 = 2 * err
            if e2 >= dy { err += dy; x += sx }
            if e2 <= dx { err += dx; y += sy }
        }
    }
}
