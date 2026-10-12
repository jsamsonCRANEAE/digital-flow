import SpriteKit
import GSFoundation
import GSRenderCore

/// Tiny pixel-font diagnostics line (FPS, sim rate, scale). Shown when GameController.showDiagnostics is on.
final class DebugOverlay {
    private let node = SKSpriteNode()
    private var frames = 0
    private var accumulated = 0.0
    private var maxWork = 0.0

    init(parent: SKNode) {
        node.anchorPoint = .zero
        parent.addChild(node)
    }

    /// `safeArea` keeps the text clear of the notch / Dynamic Island.
    func update(frameTime: Double, work: Double, targetFPS: Int, scale: Int, safeArea: Rect,
                makeTexture: (PixelBuffer) -> SKTexture) {
        frames += 1
        accumulated += frameTime
        maxWork = max(maxWork, work)
        guard accumulated >= 0.5 else { return }
        let fps = Double(frames) / accumulated
        let text = String(format: "FPS %.0f/%ld  SIM 120HZ  CPU %.1fMS  %ldX", fps, targetFPS, maxWork * 1000, scale)
        frames = 0; accumulated = 0; maxWork = 0
        var b = PixelBuffer(width: PixelFont.width(of: text) + 2, height: PixelFont.lineHeight + 1)
        b.drawText(text, x: 0, y: 0, RGBA(hex: 0xFFFFFF), shadow: Palette.outline)
        let t = makeTexture(b)
        node.texture = t
        node.size = t.size()
        // Bottom-left: the top edge belongs to the HUD now.
        let left = Int(safeArea.minX) + 4, top = Int(safeArea.maxY) - b.height - 3
        node.position = CGPoint(x: left, y: Canvas.height - top - b.height)
    }
}
