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

/// Pattern helpers for writing orchestral parts compactly (16 steps per bar).
enum Score {
    /// 16th-note ostinato: `pattern` indexes each bar's chord voicing (-1 = rest).
    static func ostinato(_ chords: [[String]], _ pattern: [Int]) -> String {
        chords.map { c in (0..<16).map { i in let k = pattern[i % pattern.count]; return k < 0 ? "." : c[k % c.count] }
            .joined(separator: " ") }.joined(separator: " | ")
    }
    /// One held note per bar.
    static func held(_ notes: [String]) -> String {
        notes.map { $0 == "." ? String(repeating: ". ", count: 16) : $0 + String(repeating: " -", count: 15) }.joined(separator: " | ")
    }
    /// Rhythm per bar: "R" = that bar's note, "O" = it an octave up, "-" hold, "." rest.
    static func rhythm(_ notes: [String], _ pattern: String) -> String {
        notes.map { n in
            pattern.split(separator: " ").map { tok -> String in
                switch tok {
                case "R": return n
                case "O": return up(n)
                default: return String(tok)
                }
            }.joined(separator: " ")
        }.joined(separator: " | ")
    }
    static func up(_ n: String) -> String {
        guard let o = n.last?.wholeNumberValue else { return n }
        return String(n.dropLast()) + String(o + 1)
    }
    static func rest(_ bars: Int) -> String { (0..<bars).map { _ in String(repeating: ". ", count: 16) }.joined(separator: " | ") }
    static func times(_ s: String, _ n: Int) -> String { Array(repeating: s, count: n).joined(separator: " | ") }
}

/// Original orchestral compositions for Gridiron Spirit ("hype" anime-sports
/// style: driving string ostinatos, brass melodies, choir, taiko + timpani).
public enum Soundtrack {
    // Shared percussion voicings: pitched notes so noise sounds bright (high
    // clock) and drums sit low.
    static let cym = "C8", snr = "C7"

    /// "Spirit Rising": title anthem, D minor, 156 bpm, 16 bars.
    /// A (1-8): ostinato + taiko build. B (9-16): full brass melody, choir, cymbals.
    public static let title: Song = {
        let prog = [["D3", "A3", "D4", "F4"], ["A#2", "F3", "A#3", "D4"], ["F3", "C4", "F4", "A4"], ["C3", "G3", "C4", "E4"],
                    ["G2", "D3", "G3", "A#3"], ["A#2", "F3", "A#3", "D4"], ["C3", "G3", "C4", "E4"], ["A2", "E3", "A3", "C#4"]]
        let roots1 = ["D2", "A#1", "F2", "C2", "G1", "A#1", "C2", "A1"]
        let ost = Score.ostinato(prog, [0, 1, 2, 1, 3, 1, 2, 1, 0, 1, 2, 1, 3, 2, 3, 1])
        let bass = Score.rhythm(roots1, "R - R . R - O . R - R . R - O .")
        let timp = Score.rhythm(roots1, "R . . . . . . . R . . . R . R .")
        let melody = """
        D5 - - - A4 - D5 - F5 - - - E5 - D5 - | F5 - - - - - G5 - F5 - - - D5 - - - |
        C5 - - - F5 - - - A5 - - - - - G5 - | G5 - - - - - - - E5 - - - C5 - - - |
        D5 - - - G5 - - - A#5 - - - - - A5 - | G5 - - - F5 - - - D5 - - - - - - - |
        E5 - - - G5 - - - C6 - - - - - A#5 - | A5 - - - - - - - - - - - C#5 - E5 -
        """
        let horns = """
        A3 - - - - - - - D4 - - - F4 - - - | F4 - - - - - - - D4 - - - - - - - |
        A3 - - - - - - - C4 - - - F4 - - - | G4 - - - - - - - E4 - - - - - - - |
        G3 - - - - - - - A#3 - - - D4 - - - | D4 - - - - - - - F4 - - - - - - - |
        E4 - - - - - - - G4 - - - C5 - - - | C#5 - - - - - - - - - - - E4 - - -
        """
        let choirA = Score.held(["D4", "D4", "C4", "C4", "D4", "D4", "E4", "E4"])
        let choirB = Score.held(["F4", "F4", "F4", "E4", "G4", "F4", "G4", "A4"])
        let taikoA = Score.times("x . . . x . . x . . x . x . . .", 8)
        let taikoB = Score.times("x . x . x . . x x . x . x . x x", 7) + " | x x x x x x x x x x x x x x x x"
        let snareB = Score.times(". . . . \(snr) . . . . . . . \(snr) . \(snr) \(snr)", 7) + " | " +
            Array(repeating: snr, count: 16).joined(separator: " ")
        let crash = "\(cym) " + String(repeating: ". ", count: 15) + "| " + Score.rest(7) + " | " +
            Score.times("\(cym) " + String(repeating: ". ", count: 15), 8)
        return Song.build("SPIRIT RISING", bpm: 156, loops: true, [
            (.stringsStacc, ost + " | " + ost, 0.9),
            (.contrabass, bass + " | " + bass, 1.0),
            (.timpani, timp + " | " + timp, 0.9),
            (.horn, horns + " | " + Score.rest(8), 0.8),
            (.trumpet, Score.rest(8) + " | " + melody, 1.0),
            (.brassSection, Score.rest(8) + " | " + horns, 0.75),
            (.choir, Score.rest(8) + " | " + choirB, 1.0),
            (.choir, choirA + " | " + choirA, 0.8),
            (.taiko, taikoA + " | " + taikoB, 0.9),
            (.orchSnare, Score.rest(8) + " | " + snareB, 0.8),
            (.cymbal, crash, 0.8),
        ])
    }()

    /// "Locker Room": menu theme, F major, 116 bpm, 8 bars. Pizzicato and
    /// harp under a warm horn tune: hype but easy to sit with in the shop.
    public static let menu: Song = {
        let prog = [["F3", "C4", "F4", "A4"], ["D3", "A3", "D4", "F4"], ["A#2", "F3", "A#3", "D4"], ["C3", "G3", "C4", "E4"],
                    ["F3", "C4", "F4", "A4"], ["A2", "E3", "A3", "C4"], ["A#2", "F3", "A#3", "D4"], ["C3", "G3", "C4", "E4"]]
        let roots = ["F2", "D2", "A#1", "C2", "F2", "A1", "A#1", "C2"]
        let pizz = Score.ostinato(prog, [0, -1, 2, -1, 1, -1, 3, -1, 0, -1, 2, -1, 3, -1, 1, -1])
        let harp = Score.ostinato(prog.map { $0.map(Score.up) }, [-1, 2, -1, 3, -1, 1, -1, 2, -1, 3, -1, 2, -1, 1, -1, 3])
        let melody = """
        A4 - - - C5 - - - F5 - - - - - - - | E5 - - - D5 - - - A4 - - - - - - - |
        A#4 - - - D5 - - - F5 - - - - - E5 - | E5 - - - - - - - - - - - C5 - - - |
        A4 - - - C5 - - - F5 - - - A5 - - - | G5 - - - E5 - - - C5 - - - - - - - |
        D5 - - - F5 - - - A#5 - - - - - A5 - | G5 - - - - - - - - - - - . . . .
        """
        return Song.build("LOCKER ROOM", bpm: 116, loops: true, [
            (.pizz, pizz, 1.0),
            (.harp, harp, 0.9),
            (.contrabass, Score.rhythm(roots, "R - - - . . R . R - - - . . O ."), 0.9),
            (.horn, melody, 1.0),
            (.strings, Score.held(["A3", "A3", "A#3", "G3", "A3", "A3", "A#3", "G3"]), 0.7),
            (.strings, Score.held(["C4", "D4", "D4", "C4", "C4", "C4", "D4", "E4"]), 0.6),
            (.taiko, Score.times("x . . . . . . . x . . . . . . .", 8), 0.5),
            (.orchSnare, Score.times(". . . . \(snr) . . . . . . . \(snr) . . .", 8), 0.45),
            (.glock, Score.rest(4) + " | " + Score.ostinato(Array(prog.suffix(4)).map { $0.map { Score.up(Score.up($0)) } },
                                                         [3, -1, -1, -1, 2, -1, -1, -1, 1, -1, -1, -1, 2, -1, -1, -1]), 0.8),
        ])
    }()

    /// "Gridiron Drive": in-game loop, E minor, 148 bpm, 16 bars. Staccato
    /// strings and taiko drive it; the melody stays in the horns' mid range
    /// and leaves space so hits, whistles and the crowd cut through.
    public static let game: Song = {
        let prog = [["E3", "B3", "E4", "G4"], ["C3", "G3", "C4", "E4"], ["G2", "D3", "G3", "B3"], ["D3", "A3", "D4", "F#4"],
                    ["E3", "B3", "E4", "G4"], ["C3", "G3", "C4", "E4"], ["A2", "E3", "A3", "C4"], ["B2", "F#3", "B3", "D#4"]]
        let roots = ["E2", "C2", "G1", "D2", "E2", "C2", "A1", "B1"]
        let ost = Score.ostinato(prog, [0, 1, 2, 1, 0, 1, 3, 1, 0, 1, 2, 1, 3, 1, 2, 1])
        let bass = Score.rhythm(roots, "R . R . R . O . R . R . R . O R")
        let stabsRoot = Score.rhythm(prog.map { $0[2] }, "R . . R . . R . . . . . R . . .")
        let stabsThird = Score.rhythm(prog.map { $0[3] }, "R . . R . . R . . . . . R . . .")
        let horns = """
        B4 - - - - - - - G4 - - - - - - - | E5 - - - - - - - D5 - - - C5 - - - |
        D5 - - - - - - - B4 - - - - - - - | A4 - - - - - - - F#4 - - - A4 - - - |
        B4 - - - - - - - E5 - - - - - - - | G5 - - - - - - - E5 - - - C5 - - - |
        C5 - - - - - - - E5 - - - - - - - | D#5 - - - - - - - F#5 - - - B4 - - -
        """
        let taiko = Score.times("x . . x . . x . x . . . x . x .", 7) + " | x . x . x . x . x x x x x x x x"
        let snare = Score.times(". . . . \(snr) . . . . . . . \(snr) . . .", 8)
        let crash = Score.times("\(cym) " + String(repeating: ". ", count: 15) + "| " + Score.rest(3), 4)
        return Song.build("GRIDIRON DRIVE", bpm: 148, loops: true, [
            (.stringsStacc, ost + " | " + ost, 0.75),
            (.contrabass, bass + " | " + bass, 0.9),
            (.brassStab, stabsRoot + " | " + Score.rest(8), 0.8),
            (.brassStab, stabsThird + " | " + Score.rest(8), 0.6),
            (.horn, Score.rest(8) + " | " + horns, 0.9),
            (.strings, Score.rest(8) + " | " + Score.held(["G5", "G5", "B5", "A5", "G5", "G5", "E5", "F#5"]), 0.5),
            (.timpani, Score.rhythm(roots, "R . . . . . . . . . . . . . . .") + " | " + Score.rhythm(roots, "R . . . . . . . R . . . . . . ."), 0.8),
            (.taiko, taiko + " | " + taiko, 0.8),
            (.orchSnare, snare + " | " + snare, 0.6),
            (.cymbal, crash, 0.6),
        ])
    }()

    /// Touchdown fanfare: D major, 150 bpm, 2 bars, one-shot. A string rip
    /// up two octaves into a trumpet call and a full-orchestra hit.
    public static let touchdown: Song = {
        let run = "D4 E4 F#4 G4 A4 B4 C#5 D5 E5 F#5 G5 A5 B5 C#6 D6 E6"
        let tpt1 = "D5 . D5 D5 A5 - - - F#5 - A5 - D6 - - - | D6 - - - - - - - - - - - . . . ."
        let tpt2 = "F#4 . F#4 F#4 D5 - - - A4 - D5 - F#5 - - - | A5 - - - - - - - - - - - . . . ."
        let hit = String(repeating: ". ", count: 16) + "| "
        return Song.build("TOUCHDOWN", bpm: 150, loops: false, [
            (.stringsStacc, run + " | " + "D6 . . . . . . . . . . . . . . .", 0.9),
            (.trumpet, tpt1, 1.1),
            (.brassSection, tpt2, 0.9),
            (.strings, hit + "D5 - - - - - - - - - - - . . . .", 1.0),
            (.strings, hit + "A4 - - - - - - - - - - - . . . .", 0.9),
            (.contrabass, "D2 . D2 D2 A1 - - - D2 - A1 - D2 - - - | D2 - - - - - - - - - - - . . . .", 1.0),
            (.choir, hit + "F#4 - - - - - - - - - - - . . . .", 1.0),
            (.timpani, "D2 D2 D2 D2 D2 D2 D2 D2 A1 A1 A1 A1 A1 A1 A1 A1 | D2 . . . . . . . . . . . . . . .", 0.8),
            (.taiko, ". . . . . . . . . . . . x . x x | x . . . . . . . . . . . . . . .", 0.9),
            (.cymbal, hit + "\(cym) . . . . . . . . . . . . . . .", 1.1),
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
