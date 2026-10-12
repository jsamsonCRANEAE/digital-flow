import AVFoundation
import GSAudio

/// Streams the GridironCore synth (GSAudio.AudioCore) to the speaker through
/// an AVAudioSourceNode. All music and SFX are synthesized live: no audio files.
final class AudioOutput {
    let core: AudioCore
    private let engine = AVAudioEngine()
    private var source: AVAudioSourceNode?
    private var observer: NSObjectProtocol?

    init() {
        let session = AVAudioSession.sharedInstance()
        // .ambient: respects the ring/silent switch and mixes with other apps' audio,
        // the expected behavior for a casual game.
        try? session.setCategory(.ambient, mode: .default, options: [])
        try? session.setPreferredIOBufferDuration(0.010)
        try? session.setActive(true)
        let rate = session.sampleRate > 0 ? session.sampleRate : 44_100
        core = AudioCore(sampleRate: rate)

        guard let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1) else { return }
        let core = self.core
        let node = AVAudioSourceNode(format: format) { _, _, frameCount, ablPointer -> OSStatus in
            let buffers = UnsafeMutableAudioBufferListPointer(ablPointer)
            guard let first = buffers.first, let out = first.mData?.assumingMemoryBound(to: Float.self) else { return noErr }
            let n = Int(frameCount)
            core.render(into: out, count: n)
            for b in buffers.dropFirst() { b.mData?.copyMemory(from: out, byteCount: n * MemoryLayout<Float>.size) }
            return noErr
        }
        engine.attach(node)
        engine.connect(node, to: engine.mainMixerNode, format: format)
        source = node
        try? engine.start()

        // Phone calls / Siri stop the engine; restart when the interruption ends.
        observer = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification,
                                                          object: session, queue: .main) { [weak self] note in
            guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  AVAudioSession.InterruptionType(rawValue: raw) == .ended else { return }
            self?.resume()
        }
    }

    deinit { if let o = observer { NotificationCenter.default.removeObserver(o) } }

    func pause() { engine.pause() }
    func resume() {
        try? AVAudioSession.sharedInstance().setActive(true)
        if !engine.isRunning { try? engine.start() }
    }
}
