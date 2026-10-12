/// Small Freeverb-style hall (mono): 4 damped feedback combs in parallel
/// into 2 series allpasses. Gives the orchestra a concert-hall tail for a
/// few hundred multiply-adds per sample. Delay lengths are Freeverb's
/// classic mutually-prime tunings, scaled to the sample rate.
struct Reverb {
    struct Comb { var buf: [Double]; var i = 0; var store = 0.0 }
    struct Allpass { var buf: [Double]; var i = 0 }
    var combs: [Comb]
    var allpasses: [Allpass]
    var feedback = 0.80
    var damp = 0.30

    init(sampleRate: Double) {
        let k = sampleRate / 44_100
        combs = [1116, 1188, 1277, 1356].map { Comb(buf: [Double](repeating: 0, count: max(1, Int(Double($0) * k)))) }
        allpasses = [556, 441].map { Allpass(buf: [Double](repeating: 0, count: max(1, Int(Double($0) * k)))) }
    }

    mutating func process(_ x: Double) -> Double {
        var out = 0.0
        let input = x * 0.25
        for c in combs.indices {
            let y = combs[c].buf[combs[c].i]
            combs[c].store = y * (1 - damp) + combs[c].store * damp
            combs[c].buf[combs[c].i] = input + combs[c].store * feedback
            combs[c].i += 1
            if combs[c].i == combs[c].buf.count { combs[c].i = 0 }
            out += y
        }
        for a in allpasses.indices {
            let b = allpasses[a].buf[allpasses[a].i]
            allpasses[a].buf[allpasses[a].i] = out + b * 0.5
            out = b - out
            allpasses[a].i += 1
            if allpasses[a].i == allpasses[a].buf.count { allpasses[a].i = 0 }
        }
        return out
    }
}
