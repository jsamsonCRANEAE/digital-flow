import Foundation
import GSFoundation

public enum SoundEffect: Sendable, Equatable {
    case snap, footstep(Double), hit(Double), whistle, catchPop, kick, cheer(Double), spirit, throwWhoosh
    case uiTap, uiBuy, uiBack, uiError
}

/// Mixer for music + SFX + a continuous crowd bed. Thread-safe: game code
/// posts commands from the main thread, the audio callback renders.
public final class AudioCore: @unchecked Sendable {
    public let sampleRate: Double
    let lock = NSLock()
    var music: SongPlayer?
    var stinger: SongPlayer?
    var sfx: [Voice] = []
    var crowd = Voice(Instrument(.noise(periodic: false), Envelope(0.01, 0, 1, 0.5), volume: 0.06), midi: 100)
    var crowdLevel = 0.15, crowdTarget = 0.15
    var footRng = SplitMix64(seed: 3)
    public var musicVolume: Double = 0.8
    public var sfxVolume: Double = 1.0
    public var musicEnabled = true
    public var sfxEnabled = true
    public private(set) var currentSong: String?

    public init(sampleRate: Double = 44_100) {
        self.sampleRate = sampleRate
        crowd.lpAmount = 0.08            // dull roar
    }

    public func play(_ song: Song) {
        lock.lock(); defer { lock.unlock() }
        guard currentSong != song.name || !song.loops else { return }
        if song.loops { music = SongPlayer(song); currentSong = song.name } else { stinger = SongPlayer(song) }
    }

    public func stopMusic() { lock.lock(); music = nil; currentSong = nil; lock.unlock() }

    /// Crowd bed intensity 0...1 (rises on big plays).
    public func setCrowd(_ level: Double) { lock.lock(); crowdTarget = clamp(level, 0.05, 1); lock.unlock() }

    public func play(_ e: SoundEffect) {
        lock.lock(); defer { lock.unlock() }
        guard sfxEnabled else { return }
        func add(_ i: Instrument, _ midi: Double, _ g: Double = 1, lp: Double = 1, dur: Double = 0.05) {
            var v = Voice(i, midi: midi, gain: g)
            v.lpAmount = lp
            v.off = dur
            sfx.append(v)
        }
        switch e {
        case .snap:
            add(Instrument(.noise(periodic: false), Envelope(0.001, 0.06, 0, 0.02), volume: 0.35), 90, lp: 0.3)
            add(Instrument.kick, 48, 0.5)
        case .footstep(let s):
            add(Instrument(.noise(periodic: false), Envelope(0.001, 0.03, 0, 0.01), volume: 0.12 * clamp(s, 0.2, 1)),
                70 + Double(footRng.int(8)), lp: 0.25)
        case .hit(let k):
            let g = clamp(k, 0.3, 1.5)
            add(Instrument(.noise(periodic: false), Envelope(0.001, 0.14, 0, 0.05), volume: 0.4), 76, g, lp: 0.45)
            add(Instrument(.fm(ratio: 1.4, index: 3, indexDecay: 25), Envelope(0.001, 0.12, 0, 0.03), volume: 0.45, pitchSlide: -40), 45, g)
        case .whistle:
            add(Instrument(.fm(ratio: 2, index: 0.15, indexDecay: 0), Envelope(0.01, 0.05, 0.9, 0.08), volume: 0.22,
                           vibrato: (0.6, 28)), 101, dur: 0.42)
        case .catchPop:
            add(Instrument(.fm(ratio: 1, index: 1.5, indexDecay: 30), Envelope(0.001, 0.06, 0, 0.02), volume: 0.3, pitchSlide: 30), 64)
        case .kick:
            add(Instrument.kick, 52, 0.9)
            add(Instrument(.noise(periodic: false), Envelope(0.001, 0.05, 0, 0.02), volume: 0.25), 96, lp: 0.6)
        case .cheer(let k):
            crowdTarget = clamp(0.4 + 0.6 * k, 0, 1)
        case .spirit:
            add(Instrument(.fm(ratio: 3, index: 4, indexDecay: 2), Envelope(0.005, 0.6, 0, 0.3), volume: 0.25, pitchSlide: 24), 72, dur: 0.6)
            add(Instrument.crash, 60, 0.8, dur: 0.5)
        case .throwWhoosh:
            add(Instrument(.noise(periodic: false), Envelope(0.05, 0.15, 0, 0.05), volume: 0.12), 110, lp: 0.15)
        case .uiTap: add(Instrument(.pulse(duty: 0.5), Envelope(0.001, 0.04, 0, 0.01), volume: 0.12), 84)
        case .uiBack: add(Instrument(.pulse(duty: 0.5), Envelope(0.001, 0.05, 0, 0.01), volume: 0.12, pitchSlide: -24), 79)
        case .uiError: add(Instrument(.pulse(duty: 0.25), Envelope(0.001, 0.12, 0, 0.02), volume: 0.12), 52)
        case .uiBuy:
            for (i, m) in [76.0, 79, 84, 88].enumerated() {
                var v = Voice(Instrument.bell, midi: m, gain: 1.4)
                v.t = -Double(i) * 0.07          // staggered starts = arpeggio
                sfx.append(v)
            }
        }
        if sfx.count > 24 { sfx.removeFirst(sfx.count - 24) }
    }

    /// Fills `count` mono float samples in [-1, 1].
    public func render(into out: UnsafeMutablePointer<Float>, count: Int) {
        lock.lock(); defer { lock.unlock() }
        let dt = 1 / sampleRate
        for i in 0..<count {
            var s = 0.0
            if musicEnabled {
                if var m = music { s += m.sample(dt) * musicVolume; music = m }
            }
            if var st = stinger { s += st.sample(dt) * 0.9; stinger = st.finished ? nil : st }
            var fx = 0.0
            var j = 0
            while j < sfx.count {
                if sfx[j].t < 0 { sfx[j].t += dt; j += 1; continue }        // delayed start
                fx += sfx[j].sample(dt)
                if sfx[j].finished { sfx.remove(at: j) } else { j += 1 }
            }
            crowdLevel += (crowdTarget - crowdLevel) * dt * 1.5
            if crowdTarget > 0.2 { crowdTarget = max(0.15, crowdTarget - dt * 0.12) }  // swells decay back
            fx += crowd.sample(dt) * crowdLevel * 1.6
            s += sfxEnabled ? fx * sfxVolume : 0
            out[i] = Float(tanhApprox(s))          // soft clip
        }
    }

    @inline(__always) func tanhApprox(_ x: Double) -> Double { let x2 = x * x; return x * (27 + x2) / (27 + 9 * x2) }

    /// Offline render (tests, previews, WAV export).
    public func renderSeconds(_ seconds: Double) -> [Float] {
        var buf = [Float](repeating: 0, count: Int(seconds * sampleRate))
        buf.withUnsafeMutableBufferPointer { render(into: $0.baseAddress!, count: $0.count) }
        return buf
    }

    public static func wav(_ samples: [Float], sampleRate: Int = 44_100) -> Data {
        var d = Data()
        func u32(_ v: UInt32) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 4)) }
        func u16(_ v: UInt16) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 2)) }
        d.append(contentsOf: Array("RIFF".utf8)); u32(UInt32(36 + samples.count * 2))
        d.append(contentsOf: Array("WAVEfmt ".utf8)); u32(16); u16(1); u16(1)
        u32(UInt32(sampleRate)); u32(UInt32(sampleRate * 2)); u16(2); u16(16)
        d.append(contentsOf: Array("data".utf8)); u32(UInt32(samples.count * 2))
        for s in samples { u16(UInt16(bitPattern: Int16(clamp(Double(s), -1, 1) * 32767))) }
        return d
    }
}
