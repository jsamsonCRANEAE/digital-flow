import GSFoundation
import GSSimulation

public struct FieldStyle: Sendable {
    /// End zone the offense defends (low y) and attacks (high y).
    public var homeEndZone: RGBA
    public var awayEndZone: RGBA
    public init(homeEndZone: RGBA, awayEndZone: RGBA) {
        self.homeEndZone = homeEndZone; self.awayEndZone = awayEndZone
    }
}

/// "Mode 7"-style scanline rasterizer for the ground plane.
///
/// For each canvas row below the horizon we intersect one ray with the
/// ground, so world y is constant across the row and world x is linear in
/// the column. Thin features (lines, hashes, numbers) are widened to at
/// least one pixel's ground footprint so they never flicker in and out as
/// the camera moves; far away detail is replaced by a dithered haze.
public final class FieldRasterizer {
    public var style: FieldStyle
    public let backdrop: StadiumBackdrop

    // Pre-shaded colors (computed once, not per pixel).
    var homeA: UInt32, homeB: UInt32, awayA: UInt32, awayB: UInt32

    public init(style: FieldStyle, backdrop: StadiumBackdrop) {
        self.style = style
        self.backdrop = backdrop
        homeA = style.homeEndZone.argb
        homeB = style.homeEndZone.hueShifted(-0.45).argb
        awayA = style.awayEndZone.argb
        awayB = style.awayEndZone.hueShifted(-0.45).argb
    }

    /// End zones follow possession: the near (home) end zone is always the
    /// offense's, because the camera always sits behind the offense.
    public func setEndZones(near: RGBA, far: RGBA) {
        style = FieldStyle(homeEndZone: near, awayEndZone: far)
        homeA = near.argb; homeB = near.hueShifted(-0.45).argb
        awayA = far.argb; awayB = far.hueShifted(-0.45).argb
    }

    static let lineHalfWidth = 0.11            // ~4 in wide lines
    static let boundaryHalfWidth = 0.33         // 2 yd... real is 6 ft; arcade reads better thick
    static let hashHalfLength = 0.4
    static let fogStart = 38.0
    static let fogEnd = 130.0
    static let numberCell = 0.36                // yards per font pixel
    static let numberFromSideline = 12.0        // top of numbers 12 yd from sideline

    /// Renders the full canvas: backdrop above the horizon, field below.
    public func render(into buf: inout PixelBuffer, camera: Camera, crowdFrame: Int) {
        precondition(buf.width == Canvas.width && buf.height == Canvas.height)
        let w = buf.width
        let shiftX = Int((camera.position.x - Field.centerX) * 4) + Int(camera.centerX) - Canvas.width / 2
        let backdropRowOffset = StadiumBackdrop.margin - Int(camera.centerY) + Canvas.height / 2
        buf.pixels.withUnsafeMutableBufferPointer { px in
            for row in 0..<buf.height {
                let base = row * w
                guard let g = camera.groundRow(row) else {
                    backdrop.copyRow(row + backdropRowOffset, frame: crowdFrame, shiftX: shiftX,
                                     into: px, offset: base, count: w)
                    continue
                }
                // Footprint = gap to the row above (the larger neighbour gap), so a
                // line lying between two row centers is always caught by one of them.
                let footprintY: Double
                if let prev = camera.groundRow(row - 1) {
                    footprintY = abs(prev.worldY - g.worldY)
                } else {
                    footprintY = abs((camera.groundRow(row + 1)?.worldY ?? g.worldY) - g.worldY) * 1.2
                }
                rasterizeRow(px, base: base, width: w, row: row, g: g, footprintY: footprintY)
            }
        }
    }

    @inline(__always)
    func rasterizeRow(_ px: UnsafeMutableBufferPointer<UInt32>, base: Int, width: Int, row: Int,
                      g: Camera.GroundRow, footprintY fy: Double) {
        let y = g.worldY
        let fx = g.yardsPerPixelX
        let fog = clamp((g.distance - Self.fogStart) / (Self.fogEnd - Self.fogStart), 0, 1)
        let fogLevel = Int(fog * 16)

        // --- Per-row classification (world y is constant along the row) ---
        let inLength = y >= 0 && y <= Field.length
        let lineTol = max(Self.lineHalfWidth, fy * 0.5)
        let nearest5 = (y / 5).rounded() * 5
        let onYardLine = inLength && nearest5 >= Field.homeGoalLine && nearest5 <= Field.awayGoalLine
            && abs(y - nearest5) <= lineTol
        let onEndLine = abs(y - 0) <= max(Self.boundaryHalfWidth, fy * 0.5)
            || abs(y - Field.length) <= max(Self.boundaryHalfWidth, fy * 0.5)
        let nearest1 = y.rounded()
        let onHashRow = y > Field.homeGoalLine && y < Field.awayGoalLine && fy < 0.9
            && abs(y - nearest1) <= max(0.07, fy * 0.5)
        let inEndZone = inLength && (y < Field.homeGoalLine || y > Field.awayGoalLine)
        let stripe = Int(((y - Field.homeGoalLine) / 5).rounded(.down)) & 1
        let turf = stripe == 0 ? Palette.turfLight.argb : Palette.turfDark.argb
        // Yard numbers: only when close enough to be legible (anti-shimmer LOD).
        let tens = (y / 10).rounded() * 10
        let numberDigits = (fy < 0.6 && abs(y - tens) < 1.0 + Self.numberCell * 6) ? Self.digits(forTens: tens) : nil
        let endZoneHomeSide = y < Field.homeGoalLine
        let bayerRow = (row & 3) << 2

        let line = Palette.line.argb, dirt = Palette.dirt.argb, dirtDark = Palette.dirtDark.argb
        let sideline = Palette.turfSideline.argb
        let haze = Palette.turfHaze.argb, lineHaze = Palette.lineHaze.argb, dirtHaze = Palette.dirtHaze.argb
        let bW = max(Self.boundaryHalfWidth, fx * 0.5)
        let width53 = Field.width

        for col in 0..<width {
            let x = g.xAtColumn0 + Double(col) * fx
            var c: UInt32
            var kind = 0   // 0 turf, 1 line, 2 dirt

            let inWidth = x >= 0 && x <= width53
            if abs(x) <= bW || abs(x - width53) <= bW {
                c = (y > -bW && y < Field.length + bW) ? line : dirt
                kind = (y > -bW && y < Field.length + bW) ? 1 : 2
            } else if !inWidth || !inLength {
                // Apron: team bench turf strip then a warm dirt track.
                let side = inWidth ? 0.0 : (x < 0 ? -x : x - width53)
                let end = inLength ? 0.0 : (y < 0 ? -y : y - Field.length)
                let d = max(side, end)
                if onEndLine && inWidth { c = line; kind = 1 }
                else if d < 3.5 && end == 0 { c = sideline }
                else {
                    // Sparse pebble speckle anchored in world space (only up close,
                    // where it can't alias into moire).
                    let ix = Int((x * 3).rounded(.down)), iy = Int((y * 3).rounded(.down))
                    let speckle = ((ix &* 73_856_093) ^ (iy &* 19_349_663)) & 15 == 0
                    c = (speckle && fx < 0.12 && fy < 0.25) ? dirtDark : dirt
                    kind = 2
                }
            } else if onYardLine || onEndLine {
                c = line; kind = 1
            } else if inEndZone {
                // Diagonal two-tone stripes in team color.
                let band = Int(((x + y) / 1.6).rounded(.down)) & 1
                c = endZoneHomeSide ? (band == 0 ? homeA : homeB) : (band == 0 ? awayA : awayB)
                kind = 3
            } else {
                c = turf
                if onHashRow {
                    let xTol = Self.hashHalfLength
                    if abs(x - Field.leftHash) < xTol || abs(x - Field.rightHash) < xTol
                        || abs(x - 1.0) < xTol || abs(x - (width53 - 1.0)) < xTol {
                        c = line; kind = 1
                    }
                }
                if let d = numberDigits, kind == 0, numberBit(x: x, y: y, tens: tens, digits: d) {
                    c = line; kind = 1
                }
            }

            if fogLevel > 0 && Palette.bayer4[bayerRow | (col & 3)] < fogLevel {
                switch kind {
                case 1: c = lineHaze
                case 2: c = dirtHaze
                case 3: break
                default: c = haze
                }
            }
            px[base + col] = c
        }
    }

    /// Two digit values for the yard number at a 10-yard line, e.g. 30 -> (3, 0).
    @inline(__always)
    static func digits(forTens tens: Double) -> (Int, Int)? {
        let t = Int(tens)
        let n = t <= 60 ? t - 10 : 110 - t
        guard n >= 10, n <= 50 else { return nil }
        return (n / 10, n % 10)
    }

    /// Yard numbers painted in world space, oriented to be read from each
    /// sideline (so from the behind-the-offense camera they appear rotated,
    /// exactly like a real field seen from the end zone).
    @inline(__always)
    func numberBit(x: Double, y: Double, tens: Double, digits: (Int, Int)) -> Bool {
        let cell = Self.numberCell
        let glyphH = Double(PixelFont.glyphHeight) * cell   // extent across the field (x)
        let glyphW = Double(PixelFont.glyphWidth) * cell    // extent along the field (y)
        let gap = 0.45
        let leftTop = Self.numberFromSideline
        let rightTop = Field.width - Self.numberFromSideline
        // Left side: reader stands on x=0 facing +x; glyph top is at larger x,
        // and the reading direction (left->right) runs toward -y.
        if x <= leftTop && x > leftTop - glyphH {
            let r = Int(((leftTop - x) / cell).rounded(.down))
            let along = (tens + gap + glyphW) - y
            return digitBit(digits, along: along, row: r, cell: cell, glyphW: glyphW, gap: gap)
        }
        // Right side: reader on x=width facing -x; reading direction runs toward +y.
        if x >= rightTop && x < rightTop + glyphH {
            let r = Int(((x - rightTop) / cell).rounded(.down))
            let along = y - (tens - gap - glyphW)
            return digitBit(digits, along: along, row: r, cell: cell, glyphW: glyphW, gap: gap)
        }
        return false
    }

    @inline(__always)
    func digitBit(_ digits: (Int, Int), along: Double, row: Int, cell: Double, glyphW: Double, gap: Double) -> Bool {
        if along >= 0 && along < glyphW {
            return PixelFont.digitBit(digits.0, Int((along / cell).rounded(.down)), row)
        }
        let second = along - glyphW - gap * 2
        if second >= 0 && second < glyphW {
            return PixelFont.digitBit(digits.1, Int((second / cell).rounded(.down)), row)
        }
        return false
    }
}
