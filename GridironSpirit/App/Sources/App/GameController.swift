import UIKit
import MetalKit
import QuartzCore
import GSFoundation
import GSData
import GSInput
import GSRenderCore
import GSGame
import GSUI

/// Drives one frame per display refresh: input -> AppFlow (menus or the
/// fixed-step match) -> CPU raster -> SpriteKit node sync -> GPU present.
final class GameController: NSObject, MTKViewDelegate {
    let flow: AppFlow
    private let audio: AudioOutput
    private let scene: GameScene
    private let pipeline: PixelPipeline
    private let field: FieldRasterizer
    private let world: WorldRenderer
    private var fieldBuffer = PixelBuffer(width: Canvas.width, height: Canvas.height)
    private var lastTime: CFTimeInterval?
    private var governor: FrameRateGovernor
    /// FPS / frame-time overlay: on in Debug builds, or in Release with the
    /// `-diagnostics` launch argument (for on-device frame-rate checks).
    static let showDiagnostics: Bool = {
        #if DEBUG
        return true
        #else
        return ProcessInfo.processInfo.arguments.contains("-diagnostics")
        #endif
    }()
    private let debug: DebugOverlay?
    private var safeArea = Canvas.bounds
    private var insets = UIEdgeInsets.zero
    private var contentScale: CGFloat = 1
    private let haptics = HapticsPlayer()
    private let gamepad = GamepadInput()
    private var endZones: (near: RGBA, far: RGBA) = (RGBA.clear, RGBA.clear)
    private var shownRuntime: ObjectIdentifier?

    static let profileKey = "gs.profile.v1"

    init?(view: MTKView, displayMaxFPS: Int) {
        guard let league = try? DataLoader.bundledLeague(), let gear = try? DataLoader.bundledGear() else { return nil }
        let audio = AudioOutput()
        self.audio = audio
        let defaults = UserDefaults.standard
        let flow = AppFlow(league: league, gear: gear, savedProfile: defaults.data(forKey: Self.profileKey),
                           persist: { defaults.set($0, forKey: Self.profileKey) }, audio: audio.core)
        self.flow = flow
        let scene = GameScene.make()
        self.scene = scene
        guard let pipeline = PixelPipeline(view: view, scene: scene) else { return nil }
        self.pipeline = pipeline
        let home = league.teams[0].colors.primaryRGBA, away = league.teams[1].colors.primaryRGBA
        let horizon = CameraConfig().horizonRow
        field = FieldRasterizer(style: FieldStyle(homeEndZone: home, awayEndZone: away),
                                backdrop: StadiumBackdrop(horizonRow: Int(horizon), home: home, away: away))
        world = WorldRenderer(scene: scene, looks: [])
        governor = FrameRateGovernor(displayMaxFPS: displayMaxFPS)
        debug = Self.showDiagnostics ? DebugOverlay(parent: scene.uiLayer) : nil
        super.init()
        Self.migrateLegacyProgress(into: flow.store, defaults: defaults)
        pipeline.sharpFit = flow.sharpFit
        view.preferredFramesPerSecond = governor.targetFPS
    }

    /// M4 stored coins/records as loose UserDefaults keys; fold them into the profile once.
    private static func migrateLegacyProgress(into store: ProfileStore, defaults d: UserDefaults) {
        guard d.object(forKey: "gs.coins") != nil else { return }
        store.profile.coins += d.integer(forKey: "gs.coins")
        store.profile.gamesPlayed += d.integer(forKey: "gs.games")
        store.profile.wins += d.integer(forKey: "gs.wins")
        if let g = d.string(forKey: "gs.bestGrade"), store.profile.bestGrade == "-" { store.profile.bestGrade = g }
        for k in ["gs.coins", "gs.games", "gs.wins", "gs.bestGrade"] { d.removeObject(forKey: k) }
        store.save()
    }

    // MARK: Layout & input

    /// Safe-area insets in points; converted to canvas pixels for UI layout.
    func updateSafeArea(_ insets: UIEdgeInsets, contentScale: CGFloat) {
        self.insets = insets
        self.contentScale = contentScale
        let s = Double(contentScale)
        safeArea = pipeline.layout.safeRect(insetTop: insets.top * s, insetLeft: insets.left * s,
                                            insetBottom: insets.bottom * s, insetRight: insets.right * s)
        flow.setSafeArea(safeArea)
        // 44 pt minimum touch target expressed in canvas pixels for this device.
        flow.setMinTouchSize(canvasPixels: 44 * s / pipeline.layout.pixelScale)
    }

    func touch(id: Int, phase: PixelMetalView.Phase, drawablePoint p: CGPoint) {
        let c = pipeline.layout.canvasPoint(drawableX: Double(p.x), drawableY: Double(p.y))
        let ph: TouchEvent.Phase = phase == .began ? .began : phase == .moved ? .moved : .ended
        flow.handle(TouchEvent(id: id, phase: ph, location: c))
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

        flow.handle(pad: gamepad.poll())                 // Bluetooth controller, if any
        let output = flow.advance(frameTime: frameTime)
        if pipeline.sharpFit != flow.sharpFit {          // settings changed the scaling mode
            pipeline.sharpFit = flow.sharpFit
            updateSafeArea(insets, contentScale: contentScale)
        }
        var impact = false
        switch output {
        case .menu(let screen):
            world.hideAll()
            fieldBuffer = screen
        case .game(let frame, let rt, let extraUI, let accent):
            if shownRuntime != ObjectIdentifier(rt) {      // new match or attract game
                shownRuntime = ObjectIdentifier(rt)
                world.setLooks(rt.looks)
                endZones = (.clear, .clear)
            }
            if frame.endZones.near != endZones.near || frame.endZones.far != endZones.far {
                endZones = frame.endZones
                field.setEndZones(near: endZones.near, far: endZones.far)       // possession changed
            }
            if fieldBuffer.width != Canvas.width || fieldBuffer.height != Canvas.height {
                fieldBuffer = PixelBuffer(width: Canvas.width, height: Canvas.height)
            }
            field.render(into: &fieldBuffer, camera: frame.camera, crowdFrame: frame.crowdFrame)
            // Ground-layer effects: ball shadow, trail, reticle, particles, speed lines.
            EffectsRasterizer.render(frame.effects, camera: frame.camera, into: &fieldBuffer)
            world.apply(frame, joystick: rt.touches.joystick, safeArea: safeArea, accent: accent, extraUI: extraUI)
            if flow.hapticsEnabled { haptics.play(frame.haptics) }
            impact = frame.impactFrame
        }

        let work = CACurrentMediaTime() - now
        debug?.update(frameTime: frameTime, work: work, targetFPS: governor.targetFPS,
                     scale: pipeline.layout.scale, safeArea: safeArea, makeTexture: world.makeTexture)
        pipeline.render(field: fieldBuffer, in: view, time: now, impactFrame: impact)

        if let fps = governor.record(frameWork: work) { view.preferredFramesPerSecond = fps }
    }

    /// Avoid a giant catch-up step after returning from background.
    func resetClock() { lastTime = nil; audio.resume() }

    /// App resigned active: pause a match in progress and silence audio.
    func suspend() { flow.pauseIfPlaying(); audio.pause() }
}
