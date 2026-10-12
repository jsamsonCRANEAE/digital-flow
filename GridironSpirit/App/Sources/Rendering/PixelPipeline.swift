import Metal
import MetalKit
import SpriteKit
import GSFoundation
import GSRenderCore

/// Pixel-perfect presentation pipeline.
///
/// Per frame:
///  1. The CPU-rasterized field+stadium (640x296) is uploaded to one of three
///     ring-buffered textures and blitted into the offscreen canvas.
///  2. SKRenderer draws the SpriteKit scene (players, shadows, UI) on top,
///     *at canvas resolution*, so sprites can only land on canvas pixels.
///  3. The canvas is drawn to the screen at an integer scale with nearest
///     texel fetches; the remainder is letterboxed in a stadium color.
final class PixelPipeline {
    let device: MTLDevice
    private let queue: MTLCommandQueue
    private let canvas: MTLTexture
    private var fieldTextures: [MTLTexture] = []
    private var fieldIndex = 0
    private let inFlight = DispatchSemaphore(value: 3)
    private let upscalePipeline: MTLRenderPipelineState
    let skRenderer: SKRenderer
    private(set) var layout = CanvasLayout(drawableWidth: Canvas.width, drawableHeight: Canvas.height)

    private struct UpscaleUniforms {
        var origin: SIMD2<Float>
        var scale: Float
        var _pad: Float = 0
    }

    init?(view: MTKView, scene: SKScene) {
        guard let device = view.device ?? MTLCreateSystemDefaultDevice(),
              let queue = device.makeCommandQueue(),
              let library = device.makeDefaultLibrary() else { return nil }
        self.device = device
        self.queue = queue

        let canvasDesc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm,
                                                                  width: Canvas.width, height: Canvas.height,
                                                                  mipmapped: false)
        canvasDesc.usage = [.renderTarget, .shaderRead]
        canvasDesc.storageMode = .private
        guard let canvas = device.makeTexture(descriptor: canvasDesc) else { return nil }
        canvas.label = "Canvas 640x296"
        self.canvas = canvas

        let fieldDesc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm,
                                                                 width: Canvas.width, height: Canvas.height,
                                                                 mipmapped: false)
        fieldDesc.usage = [.shaderRead]
        fieldDesc.storageMode = .shared
        for i in 0..<3 {
            guard let t = device.makeTexture(descriptor: fieldDesc) else { return nil }
            t.label = "Field upload \(i)"
            fieldTextures.append(t)
        }

        let pd = MTLRenderPipelineDescriptor()
        pd.label = "Integer upscale"
        pd.vertexFunction = library.makeFunction(name: "upscale_vertex")
        pd.fragmentFunction = library.makeFunction(name: "upscale_fragment")
        pd.colorAttachments[0].pixelFormat = view.colorPixelFormat
        guard let pso = try? device.makeRenderPipelineState(descriptor: pd) else { return nil }
        upscalePipeline = pso

        skRenderer = SKRenderer(device: device)
        skRenderer.scene = scene
        skRenderer.ignoresSiblingOrder = true
        skRenderer.shouldCullNonVisibleNodes = true
    }

    func updateLayout(drawableSize: CGSize) {
        layout = CanvasLayout(drawableWidth: Int(drawableSize.width), drawableHeight: Int(drawableSize.height))
    }

    /// Uploads the field pixels and renders + presents one frame.
    func render(field: PixelBuffer, in view: MTKView, time: TimeInterval) {
        inFlight.wait()
        let fieldTex = fieldTextures[fieldIndex]
        fieldIndex = (fieldIndex + 1) % fieldTextures.count
        field.pixels.withUnsafeBytes { raw in
            fieldTex.replace(region: MTLRegionMake2D(0, 0, Canvas.width, Canvas.height),
                             mipmapLevel: 0, withBytes: raw.baseAddress!, bytesPerRow: Canvas.width * 4)
        }

        guard let cb = queue.makeCommandBuffer() else { inFlight.signal(); return }
        let semaphore = inFlight
        cb.addCompletedHandler { _ in semaphore.signal() }

        // 1. Field -> canvas.
        if let blit = cb.makeBlitCommandEncoder() {
            blit.copy(from: fieldTex, sourceSlice: 0, sourceLevel: 0,
                      sourceOrigin: MTLOrigin(x: 0, y: 0, z: 0),
                      sourceSize: MTLSize(width: Canvas.width, height: Canvas.height, depth: 1),
                      to: canvas, destinationSlice: 0, destinationLevel: 0,
                      destinationOrigin: MTLOrigin(x: 0, y: 0, z: 0))
            blit.endEncoding()
        }

        // 2. SpriteKit layer at canvas resolution, loading (not clearing) the field.
        let spritePass = MTLRenderPassDescriptor()
        spritePass.colorAttachments[0].texture = canvas
        spritePass.colorAttachments[0].loadAction = .load
        spritePass.colorAttachments[0].storeAction = .store
        skRenderer.update(atTime: time)
        skRenderer.render(withViewport: CGRect(x: 0, y: 0, width: Canvas.width, height: Canvas.height),
                          commandBuffer: cb, renderPassDescriptor: spritePass)

        // 3. Integer upscale to the drawable with letterbox.
        if let drawable = view.currentDrawable, let pass = view.currentRenderPassDescriptor {
            pass.colorAttachments[0].loadAction = .clear
            let lb = Palette.letterbox
            pass.colorAttachments[0].clearColor = MTLClearColor(red: Double(lb.r) / 255, green: Double(lb.g) / 255,
                                                                blue: Double(lb.b) / 255, alpha: 1)
            if let enc = cb.makeRenderCommandEncoder(descriptor: pass) {
                let l = layout
                enc.setViewport(MTLViewport(originX: Double(l.originX), originY: Double(l.originY),
                                            width: Double(l.scaledWidth), height: Double(l.scaledHeight),
                                            znear: 0, zfar: 1))
                enc.setRenderPipelineState(upscalePipeline)
                enc.setFragmentTexture(canvas, index: 0)
                var u = UpscaleUniforms(origin: SIMD2(Float(l.originX), Float(l.originY)), scale: Float(l.scale))
                enc.setFragmentBytes(&u, length: MemoryLayout<UpscaleUniforms>.stride, index: 0)
                enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
                enc.endEncoding()
            }
            cb.present(drawable)
        }
        cb.commit()
    }
}
