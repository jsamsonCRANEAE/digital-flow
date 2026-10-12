import UIKit
import MetalKit
import QuartzCore
import GSFoundation
import GSData
import GSInput
import GSRenderCore
import GSGame

/// Drives one frame per display refresh: input -> fixed-step sim ->
/// CPU field raster -> SpriteKit node sync -> GPU present.
final class GameController: NSObject, MTKViewDelegate {
    let runtime: GameRuntime
    private let scene: GameScene
    private let pipeline: PixelPipeline
    private let field: FieldRasterizer
    private let world: WorldRenderer
    private var fieldBuffer = PixelBuffer(width: Canvas.width, height: Canvas.height)
    private var lastTime: CFTimeInterval?
    private var governor: FrameRateGovernor
    /// M1 ships with diagnostics on (Release run scheme) so frame rate can be
    /// verified on device. Flip off for the M5 menus build.
    static let showDiagnostics = true
    private let debug: DebugOverlay?
    private var safeArea = Canvas.bounds
    private let haptics = HapticsPlayer()

    init?(view: MTKView, displayMaxFPS: Int) {
        guard let league = try? DataLoader.bundledLeague() else { return nil }
        runtime = GameRuntime(league: league)
        let scene = GameScene.make()
        self.scene = scene
        guard let pipeline = PixelPipeline(view: view, scene: scene) else { return nil }
        self.pipeline = pipeline
        let home = runtime.offenseTeam.colors.primaryRGBA, away = runtime.defenseTeam.colors.primaryRGBA
        field = FieldRasterizer(style: FieldStyle(homeEndZone: home, awayEndZone: away),
                                backdrop: StadiumBackdrop(horizonRow: Int(runtime.cameraConfig.horizonRow),
                                                          home: home, away: away))
        world = WorldRenderer(scene: scene, looks: runtime.looks)
        governor = FrameRateGovernor(displayMaxFPS: displayMaxFPS)
        debug = Self.showDiagnostics ? DebugOverlay(parent: scene.uiLayer) : nil
        super.init()
        view.preferredFramesPerSecond = governor.targetFPS
    }

    // MARK: Layout & input

    /// Safe-area insets in points; converted to canvas pixels for UI layout.
    func updateSafeArea(_ insets: UIEdgeInsets, contentScale: CGFloat) {
        let s = Double(contentScale)
        safeArea = pipeline.layout.safeRect(insetTop: insets.top * s, insetLeft: insets.left * s,
                                            insetBottom: insets.bottom * s, insetRight: insets.right * s)
        runtime.setSafeArea(safeArea)
        // 44 pt minimum touch target expressed in canvas pixels for this device.
        runtime.setMinTouchSize(canvasPixels: 44 * s / Double(pipeline.layout.scale))
    }

    func touch(id: Int, phase: PixelMetalView.Phase, drawablePoint p: CGPoint) {
        let c = pipeline.layout.canvasPoint(drawableX: Double(p.x), drawableY: Double(p.y))
        let ph: TouchEvent.Phase = phase == .began ? .began : phase == .moved ? .moved : .ended
        runtime.handle(TouchEvent(id: id, phase: ph, location: c))
    }

    // MARK: MTKViewDelegate

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {
        pipeline.updateLayout(drawableSize: size)
        updateSafeArea(view.safeAreaInsets, contentScale: view.contentScaleFactor)
    }

    func draw(in view: MTKView) {
        let now = CACurrentMediaTime()
        let frameTime = lastTime.map { now - $0 } ?? (1.0 / Double(governor.targetFPS))
        lastTime = now

        let frame = runtime.advance(frameTime: frameTime)
        field.render(into: &fieldBuffer, camera: frame.camera, crowdFrame: frame.crowdFrame)
        // Ground-layer effects: ball shadow, trail, reticle, particles, speed lines.
        EffectsRasterizer.render(frame.effects, camera: frame.camera, into: &fieldBuffer)
        world.apply(frame, joystick: runtime.touches.joystick)
        haptics.play(frame.haptics)

        let work = CACurrentMediaTime() - now
        debug?.update(frameTime: frameTime, work: work, targetFPS: governor.targetFPS,
                     scale: pipeline.layout.scale, safeArea: safeArea, makeTexture: world.makeTexture)
        pipeline.render(field: fieldBuffer, in: view, time: now, impactFrame: frame.impactFrame)

        if let fps = governor.record(frameWork: work) { view.preferredFramesPerSecond = fps }
    }

    /// Avoid a giant catch-up step after returning from background.
    func resetClock() { lastTime = nil }
}
