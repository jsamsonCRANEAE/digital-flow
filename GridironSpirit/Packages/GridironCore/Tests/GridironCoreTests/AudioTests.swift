import XCTest
@testable import GSAudio

final class AudioTests: XCTestCase {
    func stats(_ b: [Float]) -> (peak: Float, rms: Float) {
        var p: Float = 0, s: Float = 0
        for x in b { p = max(p, abs(x)); s += x * x }
        return (p, (s / Float(max(1, b.count))).squareRoot())
    }

    func testNoteParsing() {
        XCTAssertEqual(Song.midi("A4"), 69)
        XCTAssertEqual(Song.midi("C4"), 60)
        XCTAssertEqual(Song.midi("G#1"), 32)
        XCTAssertEqual(Song.parse("C4 - . x"), [.note(60), .hold, .rest, .note(36)])   // x = drum trigger
    }

    func testEverySongIsAudibleAndBounded() {
        for song in Soundtrack.all {
            XCTAssertGreaterThan(song.duration, 2, song.name)
            let core = AudioCore()
            core.setCrowd(0.05)
            core.play(song)
            let b = core.renderSeconds(min(song.duration, 6))
            let st = stats(b)
            XCTAssertGreaterThan(st.rms, 0.02, "\(song.name) too quiet")
            XCTAssertLessThanOrEqual(st.peak, 1, "\(song.name) clips")
            XCTAssertFalse(b.contains { $0.isNaN }, song.name)
        }
    }

    func testTracksAlignToWholeBars() {
        for song in Soundtrack.all {
            XCTAssertEqual(song.lengthSteps % 16, 0, song.name)
            for t in song.tracks where song.loops {
                XCTAssertEqual(t.steps.count, song.lengthSteps, "\(song.name) has a ragged track; loops would drift")
            }
        }
    }

    func testRenderIsDeterministic() {
        func run() -> [Float] {
            let c = AudioCore(); c.play(Soundtrack.game); c.play(.hit(1)); c.play(.whistle); c.play(.footstep(0.8))
            return c.renderSeconds(1)
        }
        XCTAssertEqual(run(), run())
    }

    func testEffectsAreAudibleAndMutable() {
        let all: [SoundEffect] = [.snap, .hit(1), .whistle, .catchPop, .kick, .spirit, .throwWhoosh, .uiTap, .uiBuy, .uiBack, .uiError, .footstep(1)]
        for e in all {
            let c = AudioCore(); c.setCrowd(0.05)
            let quiet = stats(c.renderSeconds(0.08)).rms
            c.play(e)
            let loud = stats(c.renderSeconds(0.08)).rms     // short window: ticks/footsteps are ~40 ms
            XCTAssertGreaterThan(loud, quiet * 1.3, "\(e) inaudible")
        }
        let c = AudioCore(); c.sfxEnabled = false; c.musicEnabled = false
        c.play(.hit(1))
        XCTAssertEqual(stats(c.renderSeconds(0.2)).peak, 0)
    }

    func testOneShotStingerEnds() {
        let c = AudioCore(); c.sfxEnabled = false
        c.play(Soundtrack.touchdown)
        _ = c.renderSeconds(Soundtrack.touchdown.duration + 1.5)
        XCTAssertEqual(stats(c.renderSeconds(0.2)).peak, 0, accuracy: 1e-4)
    }

    func testWavHeader() {
        let d = AudioCore.wav([0, 0.5, -0.5])
        XCTAssertEqual(d.count, 44 + 6)
        XCTAssertEqual(String(decoding: d.prefix(4), as: UTF8.self), "RIFF")
    }
}
