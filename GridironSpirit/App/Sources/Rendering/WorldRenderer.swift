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
    private struct SpriteKey: Hashable {
        let team: Int, height: Int, view: SpriteView, pose: SpritePose, squash: Int
        let number: Int, big: Bool, aura: RGBA?
    }
    private struct ShadowKey: Hashable { let width: Int }
    private struct BallKey: Hashable { let length: Int, angle: Int, spin: Int }
    private struct OverlayKey: Hashable { let kind: OverlayKind, size: Int, frame: Int }
    private struct IconKey: Hashable { let slot: Int, charging: Bool }
    private struct ButtonKey: Hashable { let radius: Int, slot: Int, label: String, enabled: Bool, pressed: Bool }
    private struct TextKey: Hashable { let text: String }

    private let scene: GameScene
    private let textures: TextureFactory
    private let looks: [PlayerLook]
    private var playerNodes: [Int: SKSpriteNode] = [:]
    private var shadowNodes: [Int: SKSpriteNode] = [:]
    private let marker: SKSpriteNode
    private let joyBase: SKSpriteNode
    private let joyKnob: SKSpriteNode
    private let ballNode = SKSpriteNode()
    private let calloutNode = SKSpriteNode()
    private var overlayPool: [SKSpriteNode] = []
    private var iconPool: [SKSpriteNode] = []
    private var buttonNodes: [SKSpriteNode] = []
    private var uiPool: [SKSpriteNode] = []

    init(scene: GameScene, looks: [PlayerLook]) {
        self.scene = scene
        self.looks = looks
        let tf = TextureFactory()
        textures = tf
        marker = SKSpriteNode(texture: tf.texture("marker") { PlaceholderSprites.controlMarker() })
        joyBase = SKSpriteNode(texture: tf.texture("joyBase") { PlaceholderSprites.joystickBase(radius: 22) })
        joyKnob = SKSpriteNode(texture: tf.texture("joyKnob") { PlaceholderSprites.joystickKnob(radius: 9) })
        for n in [marker, joyBase, joyKnob, ballNode, calloutNode] { n.anchorPoint = .zero }
        joyBase.alpha = 0.55
        joyKnob.alpha = 0.85
        joyKnob.zPosition = 1
        scene.overlayLayer.addChild(marker)
        scene.uiLayer.addChild(joyBase)
        scene.uiLayer.addChild(joyKnob)
        scene.playerLayer.addChild(ballNode)
        scene.uiLayer.addChild(calloutNode)
        for i in 0..<3 {
            let b = SKSpriteNode(); b.anchorPoint = .zero; b.zPosition = CGFloat(10 + i)
            scene.uiLayer.addChild(b); buttonNodes.append(b)
        }
        prewarm()
    }

    /// Generate the most common size buckets up front so the first sprint
    /// across the field doesn't hitch on texture creation.
    private func prewarm() {
        let poses: [SpritePose] = [.idle, .run0, .run1, .run2, .run3]
        for team in looks.indices {
            for h in stride(from: 34, through: 54, by: 2) {
                for view in [SpriteView.back, .front] {
                    for pose in poses { _ = playerTexture(team: team, height: h, view: view, pose: pose, squash: 0,
                                                          number: -1, big: false, aura: nil) }
                }
            }
        }
    }

    private func playerTexture(team: Int, height: Int, view: SpriteView, pose: SpritePose, squash: Int,
                               number: Int, big: Bool, aura: RGBA?) -> SKTexture {
        let look = looks[team]
        // Numbers only appear on near (big) sprites, so far ones share textures.
        let n = height >= 44 ? number : -1
        return textures.texture(SpriteKey(team: team, height: height, view: view, pose: pose, squash: squash,
                                          number: n, big: big, aura: aura)) {
            PlaceholderSprites.player(height: height, look: look, view: view, pose: pose, squash: squash,
                                      number: n >= 0 ? n : nil, big: big, aura: aura)
        }
    }

    /// Converts a canvas (y-down) top-left pixel to a scene (y-up) bottom-left origin.
    @inline(__always)
    private func scenePoint(left: Int, top: Int, height: Int) -> CGPoint {
        CGPoint(x: left, y: Canvas.height - top - height)
    }

    /// Places a node so its texture is centered on a canvas pixel (integer origin).
    private func place(_ node: SKSpriteNode, centerX: Int, centerY: Int) {
        let w = Int(node.size.width), h = Int(node.size.height)
        node.position = scenePoint(left: centerX - w / 2, top: centerY - h / 2, height: h)
    }

    private func setTexture(_ node: SKSpriteNode, _ tex: SKTexture) {
        if node.texture !== tex { node.texture = tex; node.size = tex.size() }
    }

    func apply(_ frame: RenderFrame, joystick: VirtualJoystick, safeArea: Rect, accent: RGBA) {
        marker.isHidden = true
        for s in frame.sprites {
            let node = playerNodes[s.id] ?? makeNode(id: s.id, in: scene.playerLayer, store: &playerNodes)
            let shadow = shadowNodes[s.id] ?? makeNode(id: s.id, in: scene.shadowLayer, store: &shadowNodes)
            node.isHidden = !s.visible
            shadow.isHidden = !s.visible
            guard s.visible else { continue }

            let tex = playerTexture(team: s.teamIndex, height: s.height, view: s.view, pose: s.pose, squash: s.squash,
                                    number: s.number, big: s.big, aura: s.aura)
            setTexture(node, tex)
            let w = Int(tex.size().width), h = Int(tex.size().height)
            // Bottom row of the sprite sits on the foot pixel.
            var p = scenePoint(left: s.footX - w / 2, top: s.footY - h + 1, height: h)
            if s.flipX { p.x += CGFloat(w); node.xScale = -1 } else { node.xScale = 1 }
            node.position = p
            // Painter's order shared with the ball (frame.sprites is sorted).
            node.zPosition = CGFloat(s.drawOrder * 0.001 + 100)

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

        // Ball (its ground shadow is drawn into the field layer by EffectsRasterizer).
        if let b = frame.ball {
            ballNode.isHidden = false
            setTexture(ballNode, textures.texture(BallKey(length: b.length, angle: b.angleBucket, spin: b.spinFrame)) {
                FXSprites.ball(length: b.length, angleBucket: b.angleBucket, spinFrame: b.spinFrame)
            })
            place(ballNode, centerX: b.x, centerY: b.y)
            ballNode.zPosition = CGFloat(b.drawOrder * 0.001 + 100)
        } else { ballNode.isHidden = true }

        // Anime overlays: starbursts and catch flashes.
        syncPool(&overlayPool, count: frame.overlays.count, parent: scene.overlayLayer)
        for (node, o) in zip(overlayPool, frame.overlays) {
            setTexture(node, textures.texture(OverlayKey(kind: o.kind, size: o.size, frame: o.frame)) {
                o.kind == .starburst ? FXSprites.starburst(size: o.size, frame: o.frame)
                                     : FXSprites.catchFlash(size: o.size, frame: o.frame)
            })
            place(node, centerX: o.x, centerY: o.y)
        }

        // Receiver icons.
        syncPool(&iconPool, count: frame.icons.count, parent: scene.overlayLayer)
        for (node, icon) in zip(iconPool, frame.icons) {
            let charging = frame.chargingReceiver == icon.receiverID
            setTexture(node, textures.texture(IconKey(slot: icon.slot, charging: charging)) {
                FXSprites.receiverIcon(slot: icon.slot, charging: charging)
            })
            place(node, centerX: snapToPixel(icon.center.x), centerY: snapToPixel(icon.center.y))
        }

        // Context buttons.
        for (i, node) in buttonNodes.enumerated() {
            guard i < frame.buttons.count, frame.buttons[i].action != nil else { node.isHidden = true; continue }
            let b = frame.buttons[i]
            node.isHidden = false
            let key = ButtonKey(radius: Int(b.radius), slot: i, label: b.label, enabled: b.enabled, pressed: b.pressed)
            setTexture(node, textures.texture(key) {
                FXSprites.button(radius: key.radius, slot: i, label: b.label, enabled: b.enabled, pressed: b.pressed)
            })
            place(node, centerX: snapToPixel(b.center.x), centerY: snapToPixel(b.center.y))
        }

        // HUD, play-call cards, kick meter and callouts (shared layout with the preview tool).
        calloutNode.isHidden = true
        let items = UILayout.items(for: frame, safeArea: safeArea, accent: accent)
        syncPool(&uiPool, count: items.count, parent: scene.uiLayer)
        for (node, item) in zip(uiPool, items) {
            setTexture(node, textures.texture(item.key, make: item.make))
            let h = Int(node.size.height)
            node.position = scenePoint(left: item.x, top: item.y, height: h)
            node.zPosition = 1
        }

        joyBase.isHidden = !joystick.isActive
        joyKnob.isHidden = !joystick.isActive
        if joystick.isActive {
            place(joyBase, centerX: snapToPixel(joystick.base.x), centerY: snapToPixel(joystick.base.y))
            place(joyKnob, centerX: snapToPixel(joystick.knob.x), centerY: snapToPixel(joystick.knob.y))
        }
    }

    private func syncPool(_ pool: inout [SKSpriteNode], count: Int, parent: SKNode) {
        while pool.count < count {
            let n = SKSpriteNode(); n.anchorPoint = .zero; n.zPosition = 5
            parent.addChild(n); pool.append(n)
        }
        for (i, n) in pool.enumerated() { n.isHidden = i >= count }
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
