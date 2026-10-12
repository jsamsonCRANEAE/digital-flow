import UIKit
import MetalKit

final class GameViewController: UIViewController {
    private var metalView: PixelMetalView!
    private var controller: GameController?

    override func loadView() {
        let v = PixelMetalView(frame: .zero, device: MTLCreateSystemDefaultDevice())
        v.colorPixelFormat = .bgra8Unorm
        v.framebufferOnly = true
        v.enableSetNeedsDisplay = false
        v.isPaused = false
        v.autoResizeDrawable = true
        v.backgroundColor = .black
        metalView = v
        view = v
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        let maxFPS = UIScreen.main.maximumFramesPerSecond
        guard let c = GameController(view: metalView, displayMaxFPS: maxFPS) else {
            fatalError("Metal or bundled game data unavailable")
        }
        controller = c
        metalView.delegate = c
        metalView.onTouch = { [weak c] id, phase, p in c?.touch(id: id, phase: phase, drawablePoint: p) }
        NotificationCenter.default.addObserver(self, selector: #selector(didBecomeActive),
                                               name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(willResignActive),
                                               name: UIApplication.willResignActiveNotification, object: nil)
    }

    override func viewWillLayoutSubviews() {
        super.viewWillLayoutSubviews()
        // Render at the panel's *native* pixel density. On devices whose
        // nativeScale differs from scale (e.g. iPhone 12/13 mini: 2.88 vs 3),
        // the default would be resampled by the compositor and blur the pixels.
        let native = view.window?.windowScene?.screen.nativeScale ?? UIScreen.main.nativeScale
        if metalView.contentScaleFactor != native { metalView.contentScaleFactor = native }
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        controller?.updateSafeArea(view.safeAreaInsets, contentScale: metalView.contentScaleFactor)
    }

    @objc private func didBecomeActive() { controller?.resetClock() }
    /// Calls, Control Center, app switch: auto-pause the match and the audio.
    @objc private func willResignActive() { controller?.suspend() }

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    /// Thumbs live near the edges; require a second swipe for system gestures.
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }
}
