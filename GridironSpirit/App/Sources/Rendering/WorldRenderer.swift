import SpriteKit
import GSFoundation
import GSInput
import GSRenderCore
import GSGame

/// Copies an already projected + pixel-snapped RenderFrame onto SpriteKit nodes.
///
/// All nodes use anchorPoint (0, 0) and are positioned at integer canvas
/// coordinates, so every texel maps 1:1 to a canvas pixel. (A centered
/// anchor on an odd-sized texture would put edges on half pixels.)
final class WorldRenderer {
    private struct SpriteKey: Hashable { let team: Int, height: Int, view: SpriteView, frame: Int }
    private struct ShadowKey: Hashable { let width: Int }

    private let scene: GameScene
    private let textures: TextureFactory
    private let looks: [PlayerLook]
    private var playerNodes: [Int: SKSpriteNode] = [:]
    private var shadowNodes: [Int: SKSpriteNode] = [:]
    private let marker: SKSpriteNode
    private let joyBase: SKSpriteNode
    private let joyKnob: SKSpriteNode

    init(scene: GameScene, looks: [PlayerLook]) {
        self.scene = scene
        self.looks = looks
        let tf = TextureFactory()
        textures = tf
        marker = SKSpriteNode(texture: tf.texture("marker") { PlaceholderSprites.controlMarker() })
        joyBase = SKSpriteNode(texture: tf.texture("joyBase") { PlaceholderSprites.joystickBase(radius: 22) })
        joyKnob = SKSpriteNode(texture: tf.texture("joyKnob") { PlaceholderSprites.joystickKnob(radius: 9) })
        for n in [marker, joyBase, joyKnob] { n.anchorPoint = .zero }
        joyBase.alpha = 0.55
        joyKnob.alpha = 0.85
        joyKnob.zPosition = 1
        scene.overlayLayer.addChild(marker)
        scene.uiLayer.addChild(joyBase)
        scene.uiLayer.addChild(joyKnob)
        prewarm()
    }

    /// Generate the most common size buckets up front so the first sprint
    /// across the field doesn't hitch on texture creation.
    private func prewarm() {
        for team in looks.indices {
            for h in stride(from: 30, through: 56, by: 2) {
                for view in [SpriteView.back, .front] {
                    for f in 0..<PlaceholderSprites.frameCount { _ = playerTexture(team: team, height: h, view: view, frame: f) }
                }
            }
        }
    }

    private func playerTexture(team: Int, height: Int, view: SpriteView, frame: Int) -> SKTexture {
        let look = looks[team]
        return textures.texture(SpriteKey(team: team, height: height, view: view, frame: frame)) {
            PlaceholderSprites.player(height: height, look: look, view: view, frame: frame)
        }
    }

    /// Converts a canvas (y-down) top-left pixel to a scene (y-up) bottom-left origin.
    @inline(__always)
    private func scenePoint(left: Int, top: Int, height: Int) -> CGPoint {
        CGPoint(x: left, y: Canvas.height - top - height)
    }

    func apply(_ frame: RenderFrame, joystick: VirtualJoystick) {
        marker.isHidden = true
        for (order, s) in frame.sprites.enumerated() {
            let node = playerNodes[s.id] ?? makeNode(id: s.id, in: scene.playerLayer, store: &playerNodes)
            let shadow = shadowNodes[s.id] ?? makeNode(id: s.id, in: scene.shadowLayer, store: &shadowNodes)
            node.isHidden = !s.visible
            shadow.isHidden = !s.visible
            guard s.visible else { continue }

            let tex = playerTexture(team: s.teamIndex, height: s.height, view: s.view, frame: s.frame)
            if node.texture !== tex { node.texture = tex; node.size = tex.size() }
            let w = Int(tex.size().width), h = Int(tex.size().height)
            // Bottom row of the sprite sits on the foot pixel.
            var p = scenePoint(left: s.footX - w / 2, top: s.footY - h + 1, height: h)
            if s.flipX { p.x += CGFloat(w); node.xScale = -1 } else { node.xScale = 1 }
            node.position = p
            node.zPosition = CGFloat(order)

            let sw = s.shadowWidth
            let stex = textures.texture(ShadowKey(width: sw)) { PlaceholderSprites.shadow(width: sw) }
            if shadow.texture !== stex { shadow.texture = stex; shadow.size = stex.size(); shadow.alpha = 0.45 }
            let shW = Int(stex.size().width), shH = Int(stex.size().height)
            shadow.position = scenePoint(left: s.shadowX - shW / 2, top: s.shadowY - shH / 2, height: shH)

            if s.isControlled {
                marker.isHidden = false
                let mw = Int(marker.size.width), mh = Int(marker.size.height)
                marker.position = scenePoint(left: s.footX - mw / 2, top: s.footY - h - mh - 1, height: mh)
            }
        }

        joyBase.isHidden = !joystick.isActive
        joyKnob.isHidden = !joystick.isActive
        if joystick.isActive {
            let bw = Int(joyBase.size.width), kw = Int(joyKnob.size.width)
            joyBase.position = scenePoint(left: snapToPixel(joystick.base.x) - bw / 2,
                                          top: snapToPixel(joystick.base.y) - bw / 2, height: bw)
            joyKnob.position = scenePoint(left: snapToPixel(joystick.knob.x) - kw / 2,
                                          top: snapToPixel(joystick.knob.y) - kw / 2, height: kw)
        }
    }

    private func makeNode(id: Int, in parent: SKNode, store: inout [Int: SKSpriteNode]) -> SKSpriteNode {
        let n = SKSpriteNode()
        n.anchorPoint = .zero
        parent.addChild(n)
        store[id] = n
        return n
    }

    var textureCount: Int { textures.count }
    func makeTexture(_ b: PixelBuffer) -> SKTexture { textures.makeTexture(b) }
}
