import GSFoundation
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

/// Tiny FM + chiptune + virtual-orchestra synthesizer. Everything is generated from code (no
/// samples), deterministic, and cheap enough for the audio thread:
/// two-operator FM voices for leads/bells/bass, a 15-bit LFSR noise channel
/// (NES-style) for drums, crowd and pads, and simple envelopes.
public enum Waveform: Sendable {
    case fm(ratio: Double, index: Double, indexDecay: Double), pulse(duty: Double), triangle, noise(periodic: Bool)
    /// Band-limited (PolyBLEP) sawtooth with up to 4 detuned unison copies:
    /// the basis of the orchestral string, brass and choir sections.
    case saw(unison: Int, detuneCents: Double)
}

public struct Envelope: Sendable {
    public var attack: Double, decay: Double, sustain: Double, release: Double
    public init(_ a: Double, _ d: Double, _ s: Double, _ r: Double) { attack = a; decay = d; sustain = s; release = r }

    /// Level at time t since note-on; `off` = time of note-off (nil while held).
    @inline(__always)
    func level(_ t: Double, off: Double?) -> Double {
        func held(_ t: Double) -> Double {
            if t < attack { return t / max(attack, 1e-5) }
            let td = t - attack
            if td < decay { return 1 - (1 - sustain) * td / max(decay, 1e-5) }
            return sustain
        }
        guard let off, t >= off else { return held(t) }   // off may be scheduled in the future
        let lv = held(off)
        let tr = t - off
        return tr >= release ? 0 : lv * (1 - tr / max(release, 1e-5))
    }
}

public struct Instrument: Sendable {
    public var wave: Waveform
    public var env: Envelope
    public var volume: Double
    /// Pitch slide in semitones per second (negative = drop, e.g. kick drum).
    public var pitchSlide: Double = 0
    /// Vibrato depth (semitones) and rate (Hz).
    public var vibrato: (depth: Double, rate: Double) = (0, 0)
    /// 2-pole low-pass cutoff in Hz (0 = off). `filterEnv` opens it with the
    /// amplitude envelope (cutoff * (1 + filterEnv * env)): brass "blare".
    public var cutoff: Double = 0
    public var filterEnv: Double = 0
    /// Exponential pitch envelope: starts `semis` sharp, decays with time constant `time` (drums).
    public var pitchEnv: (semis: Double, time: Double) = (0, 0)

    public init(_ wave: Waveform, _ env: Envelope, volume: Double, pitchSlide: Double = 0, vibrato: (Double, Double) = (0, 0),
                cutoff: Double = 0, filterEnv: Double = 0, pitchEnv: (Double, Double) = (0, 0)) {
        self.wave = wave; self.env = env; self.volume = volume; self.pitchSlide = pitchSlide; self.vibrato = vibrato
        self.cutoff = cutoff; self.filterEnv = filterEnv; self.pitchEnv = pitchEnv
    }

    // House sounds.
    public static let lead = Instrument(.fm(ratio: 1, index: 2.6, indexDecay: 3), Envelope(0.005, 0.18, 0.6, 0.12), volume: 0.22, vibrato: (0.18, 5.5))
    public static let brass = Instrument(.fm(ratio: 1, index: 3.4, indexDecay: 1.2), Envelope(0.02, 0.2, 0.75, 0.15), volume: 0.2, vibrato: (0.12, 5))
    public static let bell = Instrument(.fm(ratio: 3.5, index: 2.2, indexDecay: 6), Envelope(0.002, 0.35, 0.0, 0.2), volume: 0.12)
    public static let bass = Instrument(.fm(ratio: 0.5, index: 1.6, indexDecay: 4), Envelope(0.003, 0.12, 0.55, 0.06), volume: 0.26)
    public static let pulseBass = Instrument(.pulse(duty: 0.25), Envelope(0.002, 0.1, 0.5, 0.05), volume: 0.12)
    public static let pad = Instrument(.fm(ratio: 2, index: 0.8, indexDecay: 0.2), Envelope(0.25, 0.5, 0.6, 0.6), volume: 0.07)
    public static let triangle = Instrument(.triangle, Envelope(0.002, 0.1, 0.7, 0.05), volume: 0.2)
    public static let kick = Instrument(.fm(ratio: 1, index: 0.4, indexDecay: 20), Envelope(0.001, 0.16, 0, 0.02), volume: 0.5, pitchSlide: -60)
    public static let snare = Instrument(.noise(periodic: false), Envelope(0.001, 0.12, 0, 0.03), volume: 0.22)
    public static let hat = Instrument(.noise(periodic: false), Envelope(0.0005, 0.03, 0, 0.01), volume: 0.08)
    public static let crash = Instrument(.noise(periodic: false), Envelope(0.001, 0.9, 0, 0.2), volume: 0.12)

    // Orchestra (M5.1): built from detuned PolyBLEP saws through envelope-driven filters.
    public static let strings = Instrument(.saw(unison: 3, detuneCents: 9), Envelope(0.12, 0.3, 0.85, 0.35), volume: 0.24,
                                           vibrato: (0.10, 5.2), cutoff: 2600, filterEnv: 0.4)
    public static let stringsStacc = Instrument(.saw(unison: 3, detuneCents: 10), Envelope(0.004, 0.09, 0.0, 0.05), volume: 0.36,
                                                cutoff: 2200, filterEnv: 0.8)
    public static let contrabass = Instrument(.saw(unison: 2, detuneCents: 6), Envelope(0.01, 0.2, 0.7, 0.08), volume: 0.24,
                                              cutoff: 420, filterEnv: 1.0)
    public static let brassSection = Instrument(.saw(unison: 2, detuneCents: 7), Envelope(0.035, 0.25, 0.7, 0.15), volume: 0.26,
                                                vibrato: (0.08, 5), cutoff: 700, filterEnv: 3.2)
    public static let trumpet = Instrument(.saw(unison: 2, detuneCents: 4), Envelope(0.02, 0.2, 0.75, 0.12), volume: 0.26,
                                           vibrato: (0.12, 5.5), cutoff: 1100, filterEnv: 3.0)
    public static let horn = Instrument(.saw(unison: 2, detuneCents: 6), Envelope(0.06, 0.3, 0.75, 0.25), volume: 0.28,
                                        vibrato: (0.06, 4.5), cutoff: 600, filterEnv: 1.6)
    public static let brassStab = Instrument(.saw(unison: 3, detuneCents: 8), Envelope(0.005, 0.16, 0.0, 0.06), volume: 0.30,
                                             cutoff: 800, filterEnv: 4.0)
    public static let choir = Instrument(.saw(unison: 3, detuneCents: 13), Envelope(0.3, 0.4, 0.8, 0.5), volume: 0.17,
                                         vibrato: (0.10, 4.8), cutoff: 1300, filterEnv: 0.2)
    public static let pizz = Instrument(.fm(ratio: 1, index: 1.4, indexDecay: 14), Envelope(0.001, 0.22, 0, 0.08), volume: 0.20)
    public static let harp = Instrument(.fm(ratio: 2, index: 0.9, indexDecay: 5), Envelope(0.001, 0.6, 0, 0.3), volume: 0.09)
    public static let glock = Instrument(.fm(ratio: 3.5, index: 1.3, indexDecay: 3), Envelope(0.001, 1.0, 0, 0.4), volume: 0.14)
    public static let timpani = Instrument(.fm(ratio: 1, index: 0.7, indexDecay: 9), Envelope(0.002, 0.8, 0, 0.3), volume: 0.14,
                                           pitchEnv: (3, 0.04))
    public static let taiko = Instrument(.fm(ratio: 1, index: 1.1, indexDecay: 28), Envelope(0.001, 0.32, 0, 0.1), volume: 0.20,
                                         pitchEnv: (14, 0.022))
    public static let orchSnare = Instrument(.noise(periodic: false), Envelope(0.001, 0.14, 0, 0.04), volume: 0.16)
    public static let cymbal = Instrument(.noise(periodic: false), Envelope(0.002, 1.8, 0, 0.4), volume: 0.10)
}

/// One sounding note.
struct Voice {
    var inst: Instrument
    var freq: Double
    var t: Double = 0
    var off: Double?
    var phaseC = 0.0, phaseM = 0.0
    var lfsr: UInt16 = 1
    var noiseCounter = 0.0
    var noiseValue = 1.0
    var gain: Double = 1
    /// Optional low-pass state for noise (crowd, pads).
    var lp = 0.0
    var lpAmount = 1.0
    /// Unison saw phases (staggered so copies don't start in phase).
    var u0 = 0.0, u1 = 0.37, u2 = 0.71, u3 = 0.13
    /// 2-pole filter state.
    var f1 = 0.0, f2 = 0.0

    init(_ inst: Instrument, midi: Double, gain: Double = 1) {
        self.inst = inst
        freq = 440 * powD(2, (midi - 69) / 12)
        self.gain = gain
    }

    /// PolyBLEP residual: removes the saw's aliasing at the wrap discontinuity.
    @inline(__always)
    static func polyBlep(_ t: Double, _ dt: Double) -> Double {
        if t < dt { let x = t / dt; return x + x - x * x - 1 }
        if t > 1 - dt { let x = (t - 1) / dt; return x * x + x + x + 1 }
        return 0
    }

    var finished: Bool { if let o = off { return t - o > inst.env.release } ; return false }

    @inline(__always)
    mutating func sample(_ dt: Double) -> Double {
        let env = inst.env.level(t, off: off)
        var f = freq * powD(2, inst.pitchSlide * t / 12)
        if inst.pitchEnv.semis != 0 { f *= powD(2, inst.pitchEnv.semis * expD(-t / max(1e-4, inst.pitchEnv.time)) / 12) }
        if inst.vibrato.depth > 0 && t > 0.12 { f *= powD(2, inst.vibrato.depth * sinD(2 * Double.pi * inst.vibrato.rate * t) / 12) }
        var s: Double
        switch inst.wave {
        case .fm(let ratio, let index, let decay):
            phaseM += f * ratio * dt
            phaseC += f * dt
            let idx = index * expD(-decay * t)
            s = sinD(2 * Double.pi * phaseC + idx * sinD(2 * Double.pi * phaseM))
        case .pulse(let duty):
            phaseC += f * dt
            s = phaseC.truncatingRemainder(dividingBy: 1) < duty ? 0.8 : -0.8
        case .triangle:
            phaseC += f * dt
            let x = phaseC.truncatingRemainder(dividingBy: 1)
            s = (x < 0.5 ? x * 4 - 1 : 3 - x * 4) * 0.9
        case .noise(let periodic):
            // Clocked LFSR: frequency sets the clock, like the NES noise channel.
            noiseCounter += f * 8 * dt
            while noiseCounter >= 1 {
                noiseCounter -= 1
                let bit = (lfsr ^ (lfsr >> (periodic ? 6 : 1))) & 1
                lfsr = (lfsr >> 1) | (bit << 14)
                noiseValue = (lfsr & 1) == 0 ? 1 : -1
            }
            lp += (noiseValue - lp) * lpAmount
            s = lp
        case .saw(let n, let cents):
            let k = max(1, min(4, n))
            var acc = 0.0
            for i in 0..<k {
                let c = k == 1 ? 0 : (Double(i) / Double(k - 1) - 0.5) * 2 * cents
                let inc = f * powD(2, c / 1200) * dt
                var ph: Double
                switch i { case 0: ph = u0; case 1: ph = u1; case 2: ph = u2; default: ph = u3 }
                ph += inc
                if ph >= 1 { ph -= 1 }
                acc += 2 * ph - 1 - Self.polyBlep(ph, inc)
                switch i { case 0: u0 = ph; case 1: u1 = ph; case 2: u2 = ph; default: u3 = ph }
            }
            s = acc / Double(k).squareRoot() * 0.7
        }
        if inst.cutoff > 0 {
            let fc = min(16_000, inst.cutoff * (1 + inst.filterEnv * env))
            let x = 2 * Double.pi * fc * dt
            let a = x / (1 + x)
            f1 += (s - f1) * a
            f2 += (f1 - f2) * a
            s = f2
        }
        t += dt
        return s * env * inst.volume * gain
    }
}
