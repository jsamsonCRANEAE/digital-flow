import GSFoundation
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

/// Tiny FM + chiptune synthesizer. Everything is generated from code (no
/// samples), deterministic, and cheap enough for the audio thread:
/// two-operator FM voices for leads/bells/bass, a 15-bit LFSR noise channel
/// (NES-style) for drums, crowd and pads, and simple envelopes.
public enum Waveform: Sendable { case fm(ratio: Double, index: Double, indexDecay: Double), pulse(duty: Double), triangle, noise(periodic: Bool) }

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

    public init(_ wave: Waveform, _ env: Envelope, volume: Double, pitchSlide: Double = 0, vibrato: (Double, Double) = (0, 0)) {
        self.wave = wave; self.env = env; self.volume = volume; self.pitchSlide = pitchSlide; self.vibrato = vibrato
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

    init(_ inst: Instrument, midi: Double, gain: Double = 1) {
        self.inst = inst
        freq = 440 * powD(2, (midi - 69) / 12)
        self.gain = gain
    }

    var finished: Bool { if let o = off { return t - o > inst.env.release } ; return false }

    @inline(__always)
    mutating func sample(_ dt: Double) -> Double {
        let env = inst.env.level(t, off: off)
        var f = freq * powD(2, inst.pitchSlide * t / 12)
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
        }
        t += dt
        return s * env * inst.volume * gain
    }
}
