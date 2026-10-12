import CoreGraphics
import SpriteKit
import GSFoundation
import GSRenderCore

/// Converts core PixelBuffers (0xAARRGGBB, top-left origin) to nearest-filtered
/// SpriteKit textures, caching by key.
final class TextureFactory {
    private var cache: [AnyHashable: SKTexture] = [:]
    private let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()

    func texture(_ key: AnyHashable, make: () -> PixelBuffer) -> SKTexture {
        if let t = cache[key] { return t }
        let t = Self.texture(from: make(), colorSpace: colorSpace)
        cache[key] = t
        return t
    }

    /// Uncached (e.g. debug text that changes).
    func makeTexture(_ buffer: PixelBuffer) -> SKTexture { Self.texture(from: buffer, colorSpace: colorSpace) }

    var count: Int { cache.count }
    func removeAll() { cache.removeAll() }

    static func texture(from b: PixelBuffer, colorSpace: CGColorSpace) -> SKTexture {
        // Little-endian 32-bit ARGB == BGRA bytes. Pixels are either fully
        // opaque or fully transparent (rgb = 0), so they are valid premultiplied.
        let data = b.pixels.withUnsafeBytes { Data($0) } as CFData
        let info = CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
        guard let provider = CGDataProvider(data: data),
              let image = CGImage(width: b.width, height: b.height, bitsPerComponent: 8, bitsPerPixel: 32,
                                  bytesPerRow: b.width * 4, space: colorSpace, bitmapInfo: info,
                                  provider: provider, decode: nil, shouldInterpolate: false,
                                  intent: .defaultIntent) else {
            return SKTexture()
        }
        let t = SKTexture(cgImage: image)
        t.filteringMode = .nearest
        return t
    }
}
