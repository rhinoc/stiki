// swift-tools-version: 6.0

import PackageDescription
import Foundation

let packageDirectory = URL(fileURLWithPath: #filePath).deletingLastPathComponent().path
let infoPlistPath = "\(packageDirectory)/Info.plist"

let package = Package(
    name: "StikiNativeTranscriber",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(
            name: "stiki-native-transcriber",
            targets: ["StikiNativeTranscriber"]
        )
    ],
    targets: [
        .executableTarget(
            name: "StikiNativeTranscriber",
            linkerSettings: [
                .unsafeFlags([
                    "-Xlinker", "-sectcreate",
                    "-Xlinker", "__TEXT",
                    "-Xlinker", "__info_plist",
                    "-Xlinker", infoPlistPath,
                ])
            ]
        )
    ]
)
