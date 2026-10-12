import SpriteKit
import GSRenderCore

/// Wiring only: a canvas-sized scene with ordered layers. All game logic is in
/// GridironCore; WorldRenderer copies RenderFrames onto these nodes.
final class GameScene: SKScene {
    let shadowLayer = SKNode()
    let playerLayer = SKNode()
    let overlayLayer = SKNode()
    let uiLayer = SKNode()

    static func make() -> GameScene { GameScene(size: CGSize(width: Canvas.width, height: Canvas.height)) }

    override init(size: CGSize) {
        super.init(size: size)
        scaleMode = .fill
        anchorPoint = .zero
        backgroundColor = .clear
        shadowLayer.zPosition = 1
        playerLayer.zPosition = 10
        overlayLayer.zPosition = 1000
        uiLayer.zPosition = 2000
        [shadowLayer, playerLayer, overlayLayer, uiLayer].forEach(addChild)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }
}
