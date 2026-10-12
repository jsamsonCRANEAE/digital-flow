/// FNV-1a 64-bit: stable across launches (Swift's hashValue is randomly seeded).
public func stableHash(_ s: String) -> UInt64 {
    var h: UInt64 = 0xcbf2_9ce4_8422_2325
    for b in s.utf8 { h = (h ^ UInt64(b)) &* 0x0000_0100_0000_01B3 }
    return h
}
