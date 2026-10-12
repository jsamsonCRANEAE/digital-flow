// swift-tools-version:5.9
// GridironCore: all platform-independent game code (no UIKit / SpriteKit / Metal).
// Builds and tests on macOS, iOS and Linux so the simulation stays deterministic
// and verifiable outside Xcode.
import PackageDescription

let package = Package(
    name: "GridironCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "GridironCore",
                 targets: ["GSFoundation", "GSData", "GSSimulation", "GSInput", "GSAI", "GSRenderCore", "GSGame"]),
    ],
    targets: [
        .target(name: "GSFoundation"),
        .target(name: "GSData", dependencies: ["GSFoundation"], resources: [.process("Resources")]),
        .target(name: "GSSimulation", dependencies: ["GSFoundation", "GSData"]),
        .target(name: "GSInput", dependencies: ["GSFoundation"]),
        .target(name: "GSAI", dependencies: ["GSFoundation", "GSData", "GSSimulation"]),
        .target(name: "GSRenderCore", dependencies: ["GSFoundation", "GSSimulation"]),
        .target(name: "GSGame", dependencies: ["GSFoundation", "GSData", "GSSimulation", "GSInput", "GSAI", "GSRenderCore"]),
        .testTarget(name: "GridironCoreTests",
                    dependencies: ["GSFoundation", "GSData", "GSSimulation", "GSInput", "GSAI", "GSRenderCore", "GSGame"]),
    ]
)
// Dev-only CPU preview renderer (writes PNGs). Not linked into the app.
package.targets.append(.executableTarget(name: "gs-preview", dependencies: ["GSFoundation", "GSData", "GSSimulation", "GSInput", "GSRenderCore", "GSGame"]))
