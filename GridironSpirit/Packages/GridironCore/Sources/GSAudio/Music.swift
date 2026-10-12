import GSFoundation

/// A looping tracker-style song: each track is a list of 16th-note steps.
/// Tokens: note name ("C#5"), "-" hold, "." release/rest, "x" drum hit.
public struct Song: Sendable {
    public struct Track: Sendable {
        public var instrument: Instrument
        public var steps: [Step]
        public var gain: Double
    }
    public enum Step: Sendable, Equatable { case note(Double), hold, rest }

    public var name: String
    public var bpm: Double
    public var tracks: [Track]
    public var loops: Bool
    public var lengthSteps: Int { tracks.map(\.steps.count).max() ?? 0 }
    public var secondsPerStep: Double { 60 / bpm / 4 }
    public var duration: Double { Double(lengthSteps) * secondsPerStep }

    public static func parse(_ s: String) -> [Step] {
        s.split(whereSeparator: { $0 == " " || $0 == "|" || $0 == "\n" }).map { tok in
            switch tok {
            case "-": return .hold
            case ".": return .rest
            case "x": return .note(36)
            default: return midi(String(tok)).map { .note($0) } ?? .rest
            }
        }
    }

    static let names: [String: Int] = ["C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11]
    public static func midi(_ n: String) -> Double? {
        var chars = Array(n)
        guard let first = chars.first, let base = names[String(first)] else { return nil }
        chars.removeFirst()
        var semis = base
        if chars.first == "#" { semis += 1; chars.removeFirst() } else if chars.first == "b" { semis -= 1; chars.removeFirst() }
        guard let oct = Int(String(chars)) else { return nil }
        return Double((oct + 1) * 12 + semis)
    }

    /// Arpeggio helper: cycles chord tones across `bars` of 16 steps each.
    static func arp(_ chords: [[String]], pattern: [Int], stepsPerNote: Int = 1) -> String {
        var out: [String] = []
        for c in chords {
            var i = 0
            while out.count % 16 != 0 || i == 0 {
                out.append(c[pattern[i % pattern.count] % c.count])
                for _ in 1..<stepsPerNote { out.append("-") }
                i += 1
                if out.count % 16 == 0 { break }
            }
        }
        return out.joined(separator: " ")
    }

    static func drums(_ bars: Int, kick: String, snare: String, hat: String) -> (String, String, String) {
        (Array(repeating: kick, count: bars).joined(separator: " "),
         Array(repeating: snare, count: bars).joined(separator: " "),
         Array(repeating: hat, count: bars).joined(separator: " "))
    }

    static func build(_ name: String, bpm: Double, loops: Bool, _ tracks: [(Instrument, String, Double)]) -> Song {
        Song(name: name, bpm: bpm, tracks: tracks.map { Track(instrument: $0.0, steps: parse($0.1), gain: $0.2) }, loops: loops)
    }
}

/// Original compositions for Gridiron Spirit.
public enum Soundtrack {
    /// "Spirit Rising": heroic title theme, D major, 150 bpm.
    public static let title: Song = {
        let lead = """
        D5 - - - A4 - D5 - E5 - F#5 - - - E5 - | D5 - - - B4 - - - F#5 - - - E5 - D5 - |
        B4 - - - D5 - G5 - - - F#5 - E5 - D5 - | E5 - - - - - A4 - C#5 - E5 - A5 - - - |
        F#5 - - - E5 - D5 - A4 - - - D5 - E5 - | F#5 - - - A5 - - - C#6 - - - A5 - F#5 - |
        G5 - - - F#5 - E5 - D5 - - - B4 - D5 - | E5 - - - - - - - E5 - F#5 - G5 - A5 - |
        """
        let bass = """
        D2 . D3 . D2 . D3 . D2 . D3 . A2 . D3 . | B1 . B2 . B1 . B2 . B1 . B2 . F#2 . B2 . |
        G1 . G2 . G1 . G2 . G1 . G2 . D2 . G2 . | A1 . A2 . A1 . A2 . A1 . A2 . C#2 . E2 . |
        D2 . D3 . D2 . D3 . D2 . D3 . A2 . D3 . | F#1 . F#2 . F#1 . F#2 . F#1 . F#2 . C#2 . F#2 . |
        G1 . G2 . G1 . G2 . G1 . G2 . D2 . G2 . | A1 . A2 . A1 . A2 . A1 - A2 . A2 . A2 . |
        """
        let chords = [["D4", "F#4", "A4"], ["B3", "D4", "F#4"], ["G3", "B3", "D4"], ["A3", "C#4", "E4"],
                      ["D4", "F#4", "A4"], ["F#3", "A3", "C#4"], ["G3", "B3", "D4"], ["A3", "C#4", "E4"]]
        let arp = Song.arp(chords, pattern: [0, 1, 2, 1], stepsPerNote: 2)
        let (k, s, h) = Song.drums(8, kick: "x . . . . . . . x . x . . . . .", snare: ". . . . x . . . . . . . x . . x",
                                   hat: "x . x . x . x . x . x . x . x .")
        return Song.build("SPIRIT RISING", bpm: 150, loops: true, [
            (.brass, lead, 1), (.bass, bass, 1), (.bell, arp, 0.8),
            (.kick, k, 1), (.snare, s, 1), (.hat, h, 1),
        ])
    }()

    /// "Locker Room": laid-back menu loop, F major, 108 bpm.
    public static let menu: Song = {
        let chords = [["F4", "A4", "C5", "E5"], ["E4", "G4", "B4", "D5"], ["D4", "F4", "A4", "C5"], ["C4", "E4", "G4", "B4"]]
        let arp = Song.arp(chords + chords, pattern: [0, 2, 1, 3, 2, 1])
        let bass = """
        F2 - - - . . F2 . C3 - - - . . A2 . | E2 - - - . . E2 . B2 - - - . . G2 . |
        D2 - - - . . D2 . A2 - - - . . F2 . | C2 - - - . . C2 . G2 - - - . . E2 . |
        F2 - - - . . F2 . C3 - - - . . A2 . | E2 - - - . . E2 . B2 - - - . . G2 . |
        D2 - - - . . D2 . A2 - - - . . F2 . | C2 - - - . . C2 . G2 - - - G2 . A2 B2 |
        """
        let melody = """
        . . . . . . . . A5 - - - G5 - E5 - | G5 - - - - - . . . . . . . . . . |
        . . . . . . . . F5 - - - E5 - C5 - | D5 - - - - - . . . . . . . . . . |
        . . . . . . . . A5 - - - C6 - A5 - | B5 - - - G5 - - - . . . . . . . . |
        . . . . . . . . F5 - - - E5 - D5 - | C5 - - - - - - - - - - - . . . . |
        """
        let (k, s, h) = Song.drums(8, kick: "x . . . . . . x . . x . . . . .", snare: ". . . . x . . . . . . . x . . .",
                                   hat: ". . x . . . x . . . x . . . x .")
        return Song.build("LOCKER ROOM", bpm: 108, loops: true, [
            (.bell, arp, 0.9), (.pulseBass, bass, 1), (.lead, melody, 0.7),
            (.kick, k, 0.7), (.snare, s, 0.6), (.hat, h, 0.8),
        ])
    }()

    /// "Gridiron Drive": in-game loop, A minor, 140 bpm, kept sparse so SFX cut through.
    public static let game: Song = {
        let bass = """
        A1 . A2 . A1 A1 A2 . A1 . A2 . G1 . G2 . | F1 . F2 . F1 F1 F2 . F1 . F2 . E1 . E2 . |
        C2 . C3 . C2 C2 C3 . C2 . C3 . B1 . B2 . | G1 . G2 . G1 G1 G2 . G1 . G2 . G#1 . G#2 . |
        """
        let stabs = """
        . . A4 . . . C5 . . . E5 - . . . . | . . F4 . . . A4 . . . C5 - . . . . |
        . . C5 . . . E5 . . . G5 - . . . . | . . B4 . . . D5 . . . G#5 - . . . . |
        """
        let hook = """
        E5 - - - D5 - C5 - D5 - - - . . . . | C5 - - - B4 - A4 - B4 - - - . . . . |
        C5 - - - D5 - E5 - G5 - - - E5 - . . | D5 - - - - - B4 - G#4 - - - - - . . |
        """
        let (k, s, h) = Song.drums(4, kick: "x . . . x . . . x . . . x . x .", snare: ". . . . x . . . . . . . x . . .",
                                   hat: "x x x x x x x x x x x x x x x x")
        return Song.build("GRIDIRON DRIVE", bpm: 140, loops: true, [
            (.bass, bass + " " + bass, 1), (.bell, stabs + " " + stabs, 0.8), (.lead, ". . . . . . . . . . . . . . . . " + String(repeating: ". ", count: 48) + hook, 0.7),
            (.kick, k + " " + k, 0.9), (.snare, s + " " + s, 0.8), (.hat, h + " " + h, 0.5),
        ])
    }()

    /// Touchdown fanfare (one-shot, 2 bars).
    public static let touchdown: Song = {
        let lead = "C5 . E5 . G5 . C6 - - - G5 . C6 - - - | E6 - - - - - - - - - - - . . . ."
        let harm = "E4 . G4 . C5 . E5 - - - C5 . E5 - - - | G5 - - - - - - - - - - - . . . ."
        let bass = "C2 . C2 . C2 . C3 - - - G2 . C3 - - - | C2 - - - - - - - - - - - . . . ."
        let roll = "x x x x x x x x x x x x x x x x | x . . . . . . . . . . . . . . ."
        return Song.build("TOUCHDOWN", bpm: 168, loops: false, [
            (.brass, lead, 1.1), (.brass, harm, 0.7), (.bass, bass, 1), (.snare, roll, 0.6),
            (.crash, ". . . . . . . . . . . . . . . . | x . . . . . . . . . . . . . . .", 1),
        ])
    }()

    public static let all = [title, menu, game, touchdown]
}

/// Plays a Song step by step, generating voices.
struct SongPlayer {
    let song: Song
    var step = -1
    var stepTime = 0.0
    var voices: [Voice?]
    var finished = false

    init(_ s: Song) {
        song = s
        voices = Array(repeating: nil, count: s.tracks.count)
    }

    mutating func sample(_ dt: Double) -> Double {
        if finished { return 0 }
        stepTime -= dt
        if stepTime <= 0 {
            stepTime += song.secondsPerStep
            step += 1
            if step >= song.lengthSteps {
                if song.loops { step = 0 } else { finished = true; return 0 }
            }
            for (i, tr) in song.tracks.enumerated() {
                let st = step < tr.steps.count ? tr.steps[step] : .rest
                switch st {
                case .note(let m):
                    voices[i] = Voice(tr.instrument, midi: m, gain: tr.gain)
                case .rest:
                    if var v = voices[i], v.off == nil { v.off = v.t; voices[i] = v }
                case .hold: break
                }
            }
        }
        var s = 0.0
        for i in voices.indices where voices[i] != nil {
            s += voices[i]!.sample(dt)
            if voices[i]!.finished { voices[i] = nil }
        }
        return s
    }
}
