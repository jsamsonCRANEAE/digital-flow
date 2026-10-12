import CoreHaptics
import GSGame

/// Plays the transient pulses the runtime emits (snap, catch, tackle, bounce).
/// Falls back to silence on devices without a haptic engine.
final class HapticsPlayer {
    private var engine: CHHapticEngine?

    init() {
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else { return }
        engine = try? CHHapticEngine()
        engine?.isAutoShutdownEnabled = true
        engine?.resetHandler = { [weak self] in try? self?.engine?.start() }
        try? engine?.start()
    }

    func play(_ pulses: [HapticPulse]) {
        guard let engine, !pulses.isEmpty else { return }
        // Several pulses in one frame (e.g. catch + tackle): play the strongest.
        guard let p = pulses.max(by: { $0.intensity < $1.intensity }) else { return }
        let event = CHHapticEvent(eventType: .hapticTransient, parameters: [
            CHHapticEventParameter(parameterID: .hapticIntensity, value: Float(p.intensity)),
            CHHapticEventParameter(parameterID: .hapticSharpness, value: Float(p.sharpness)),
        ], relativeTime: 0)
        do {
            let player = try engine.makePlayer(with: CHHapticPattern(events: [event], parameters: []))
            try player.start(atTime: CHHapticTimeImmediate)
        } catch {
            try? engine.start()
        }
    }
}
