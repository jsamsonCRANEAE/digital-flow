import MetalKit
import UIKit

/// MTKView that forwards raw touches (in drawable pixels) with no gesture
/// recognizers in between, for the lowest possible input latency.
final class PixelMetalView: MTKView {
    enum Phase { case began, moved, ended }
    var onTouch: ((_ id: Int, _ phase: Phase, _ drawablePoint: CGPoint) -> Void)?

    override init(frame: CGRect, device: MTLDevice?) {
        super.init(frame: frame, device: device)
        isMultipleTouchEnabled = true
        isExclusiveTouch = true
    }

    required init(coder: NSCoder) { fatalError("init(coder:) is not used") }

    private func forward(_ touches: Set<UITouch>, _ phase: Phase) {
        let s = contentScaleFactor
        for t in touches {
            let p = t.location(in: self)
            onTouch?(ObjectIdentifier(t).hashValue, phase, CGPoint(x: p.x * s, y: p.y * s))
        }
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) { forward(touches, .began) }
    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) { forward(touches, .moved) }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) { forward(touches, .ended) }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) { forward(touches, .ended) }
}
