import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit
import Speech

enum TranscriptSource: String {
    case microphone
    case system
}

enum TranscriptBackend: String {
    case apple
    case funASRLocal = "funasr-local"
}

protocol AudioPipeline: AnyObject, Sendable {
    func start(localeIdentifier: String) async throws
    func append(_ buffer: AVAudioPCMBuffer)
    func stop()
}

struct TranscriptMessage: Encodable {
    let type: String
    let source: String?
    let speaker: String?
    let status: String?
    let text: String?
    let isFinal: Bool?
    let createdAt: Int64
    let message: String?

    static func status(_ status: String, source: TranscriptSource) -> TranscriptMessage {
        TranscriptMessage(
            type: "status",
            source: source.rawValue,
            speaker: nil,
            status: status,
            text: nil,
            isFinal: nil,
            createdAt: nowMillis(),
            message: nil
        )
    }

    static func segment(
        _ text: String,
        isFinal: Bool,
        source: TranscriptSource,
        speaker: String? = nil,
        createdAt: Int64 = nowMillis()
    ) -> TranscriptMessage {
        TranscriptMessage(
            type: "segment",
            source: source.rawValue,
            speaker: speaker,
            status: nil,
            text: text,
            isFinal: isFinal,
            createdAt: createdAt,
            message: nil
        )
    }

    static func error(_ message: String, source: TranscriptSource) -> TranscriptMessage {
        TranscriptMessage(
            type: "error",
            source: source.rawValue,
            speaker: nil,
            status: nil,
            text: nil,
            isFinal: nil,
            createdAt: nowMillis(),
            message: message
        )
    }

    static func debug(_ message: String, source: TranscriptSource) -> TranscriptMessage {
        TranscriptMessage(
            type: "debug",
            source: source.rawValue,
            speaker: nil,
            status: nil,
            text: nil,
            isFinal: nil,
            createdAt: nowMillis(),
            message: message
        )
    }
}

func nowMillis() -> Int64 {
    Int64(Date().timeIntervalSince1970 * 1000)
}

final class JSONLineWriter: @unchecked Sendable {
    private let encoder = JSONEncoder()
    private let lock = NSLock()

    func emit(_ message: TranscriptMessage) {
        lock.lock()
        defer { lock.unlock() }

        guard let data = try? encoder.encode(message) else {
            return
        }

        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
    }
}

enum NativeTranscriberError: Error, LocalizedError {
    case microphonePermissionDenied
    case speechRecognizerUnavailable(String)
    case speechPermissionDenied(SFSpeechRecognizerAuthorizationStatus)
    case missingAudioInput
    case missingDisplay
    case missingCapturableApplications
    case invalidSampleBuffer
    case missingFunASRPython(String)
    case missingFunASRWorker(String)

    var errorDescription: String? {
        switch self {
        case .microphonePermissionDenied:
            "Microphone permission was denied."
        case .speechRecognizerUnavailable(let locale):
            "Speech recognition is not available for locale \(locale)."
        case .speechPermissionDenied(let status):
            "Speech recognition permission is \(status.description)."
        case .missingAudioInput:
            "No microphone input was found."
        case .missingDisplay:
            "No display was available for ScreenCaptureKit audio capture."
        case .missingCapturableApplications:
            "No other running applications were available for system audio capture."
        case .invalidSampleBuffer:
            "ScreenCaptureKit produced an audio sample buffer that could not be converted."
        case .missingFunASRPython(let path):
            "FunASR Python was not found at \(path)."
        case .missingFunASRWorker(let path):
            "FunASR worker script was not found at \(path)."
        }
    }
}

extension SFSpeechRecognizerAuthorizationStatus {
    var description: String {
        switch self {
        case .authorized:
            "authorized"
        case .denied:
            "denied"
        case .restricted:
            "restricted"
        case .notDetermined:
            "not determined"
        @unknown default:
            "unknown"
        }
    }
}

final class SpeechRecognitionPipeline: AudioPipeline, @unchecked Sendable {
    private let source: TranscriptSource
    private let writer: JSONLineWriter
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var lastText = ""
    private var appendedBuffers = 0
    private var lastAudioDebugAt: Int64 = 0
    private let lock = NSLock()

    init(source: TranscriptSource, writer: JSONLineWriter) {
        self.source = source
        self.writer = writer
    }

    func start(localeIdentifier: String) async throws {
        let authorizationStatus = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status)
            }
        }

        guard authorizationStatus == .authorized else {
            throw NativeTranscriberError.speechPermissionDenied(authorizationStatus)
        }

        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeIdentifier)),
              recognizer.isAvailable
        else {
            throw NativeTranscriberError.speechRecognizerUnavailable(localeIdentifier)
        }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        if #available(macOS 13.0, *) {
            request.addsPunctuation = true
        }

        self.request = request
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self else {
                return
            }

            if let result {
                let text = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
                if !text.isEmpty {
                    self.writer.emit(.debug("speech result final=\(result.isFinal) text=\(text)", source: self.source))
                    self.emit(text: text, isFinal: result.isFinal)
                }
            }

            if let error {
                self.writer.emit(.error(error.localizedDescription, source: self.source))
            }
        }
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        lock.lock()
        let activeRequest = request
        appendedBuffers += 1
        let shouldDebug = appendedBuffers == 1 || nowMillis() - lastAudioDebugAt > 2_000
        if shouldDebug {
            lastAudioDebugAt = nowMillis()
        }
        lock.unlock()

        activeRequest?.append(buffer)

        if shouldDebug {
            writer.emit(
                .debug(
                    "audio buffers=\(appendedBuffers) frames=\(buffer.frameLength) sampleRate=\(Int(buffer.format.sampleRate)) channels=\(buffer.format.channelCount) rms=\(String(format: "%.5f", Self.rms(buffer)))",
                    source: source
                )
            )
        }
    }

    private static func rms(_ buffer: AVAudioPCMBuffer) -> Float {
        let frameLength = Int(buffer.frameLength)
        guard frameLength > 0 else {
            return 0
        }

        if let channels = buffer.floatChannelData {
            var sum: Float = 0
            let channelCount = Int(buffer.format.channelCount)
            for channelIndex in 0..<channelCount {
                let channel = channels[channelIndex]
                for frameIndex in 0..<frameLength {
                    let sample = channel[frameIndex]
                    sum += sample * sample
                }
            }
            return sqrt(sum / Float(frameLength * max(Int(buffer.format.channelCount), 1)))
        }

        if let channels = buffer.int16ChannelData {
            var sum: Float = 0
            let channelCount = Int(buffer.format.channelCount)
            for channelIndex in 0..<channelCount {
                let channel = channels[channelIndex]
                for frameIndex in 0..<frameLength {
                    let sample = Float(channel[frameIndex]) / Float(Int16.max)
                    sum += sample * sample
                }
            }
            return sqrt(sum / Float(frameLength * max(Int(buffer.format.channelCount), 1)))
        }

        return 0
    }

    func stop() {
        lock.lock()
        let activeRequest = request
        let activeTask = task
        request = nil
        task = nil
        lock.unlock()

        activeRequest?.endAudio()
        activeTask?.cancel()
    }

    private func emit(text: String, isFinal: Bool) {
        lock.lock()
        defer { lock.unlock() }

        guard isFinal || text != lastText else {
            return
        }

        lastText = text
        writer.emit(.segment(text, isFinal: isFinal, source: source))
    }
}

struct AudioSegmentQuality {
    let rms: Float
    let speechRatio: Float
    let duration: Double

    var speechDuration: Double {
        duration * Double(speechRatio)
    }
}

enum TranscriptOutputFilter {
    private static let hallucinatedNoiseTexts: Set<String> = [
        "thank you",
        "thanks",
        "thanks for watching",
        "thank you for watching",
        "you",
        "字幕志愿者",
        "谢谢观看",
        "请不吝点赞 订阅 转发 打赏支持明镜与点点栏目",
        "明镜与点点栏目",
    ]

    static func shouldRejectText(_ text: String) -> String? {
        let normalized = normalize(text)
        guard !normalized.isEmpty else {
            return "empty text"
        }

        if normalized.count <= 1 {
            return "too short"
        }

        if hallucinatedNoiseTexts.contains(normalized) {
            return "known hallucinated silence text"
        }

        if normalized.count <= 5,
           normalized.rangeOfCharacter(from: CharacterSet.alphanumerics.union(.letters)) == nil {
            return "punctuation only"
        }

        let compact = normalized.replacingOccurrences(of: " ", with: "")
        if compact.count >= 6 {
            let uniqueCharacters = Set(compact)
            if uniqueCharacters.count <= 2 {
                return "repeated low-information text"
            }
        }

        return nil
    }

    private static func normalize(_ text: String) -> String {
        text
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: " .,;:!?，。！？、"))
    }
}

enum AudioSegmentAnalyzer {
    static func quality(of url: URL, windowSeconds: Double = 0.03, speechThreshold: Float) -> AudioSegmentQuality {
        guard let file = try? AVAudioFile(forReading: url),
              let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length))
        else {
            return AudioSegmentQuality(rms: 0, speechRatio: 0, duration: 0)
        }

        do {
            try file.read(into: buffer)
        } catch {
            return AudioSegmentQuality(rms: 0, speechRatio: 0, duration: 0)
        }

        return quality(of: buffer, windowSeconds: windowSeconds, speechThreshold: speechThreshold)
    }

    static func rms(_ buffer: AVAudioPCMBuffer) -> Float {
        let frameLength = Int(buffer.frameLength)
        guard frameLength > 0 else {
            return 0
        }

        if let channels = buffer.floatChannelData {
            var sum: Float = 0
            let channelCount = Int(buffer.format.channelCount)
            for channelIndex in 0..<channelCount {
                let channel = channels[channelIndex]
                for frameIndex in 0..<frameLength {
                    let sample = channel[frameIndex]
                    sum += sample * sample
                }
            }
            return sqrt(sum / Float(frameLength * max(channelCount, 1)))
        }

        if let channels = buffer.int16ChannelData {
            var sum: Float = 0
            let channelCount = Int(buffer.format.channelCount)
            for channelIndex in 0..<channelCount {
                let channel = channels[channelIndex]
                for frameIndex in 0..<frameLength {
                    let sample = Float(channel[frameIndex]) / Float(Int16.max)
                    sum += sample * sample
                }
            }
            return sqrt(sum / Float(frameLength * max(channelCount, 1)))
        }

        return 0
    }

    private static func quality(of buffer: AVAudioPCMBuffer, windowSeconds: Double, speechThreshold: Float) -> AudioSegmentQuality {
        let frameLength = Int(buffer.frameLength)
        let sampleRate = buffer.format.sampleRate
        let channelCount = Int(buffer.format.channelCount)
        let duration = sampleRate > 0 ? Double(frameLength) / sampleRate : 0
        guard frameLength > 0, channelCount > 0, sampleRate > 0 else {
            return AudioSegmentQuality(rms: 0, speechRatio: 0, duration: duration)
        }

        let fullRMS = rms(buffer)
        let windowSize = max(Int(sampleRate * windowSeconds), 1)
        var speechWindows = 0
        var totalWindows = 0

        if let channels = buffer.floatChannelData {
            var frameStart = 0
            while frameStart < frameLength {
                let frameEnd = min(frameStart + windowSize, frameLength)
                var sum: Float = 0
                for channelIndex in 0..<channelCount {
                    let channel = channels[channelIndex]
                    for frameIndex in frameStart..<frameEnd {
                        let sample = channel[frameIndex]
                        sum += sample * sample
                    }
                }

                let windowRMS = sqrt(sum / Float((frameEnd - frameStart) * channelCount))
                if windowRMS >= speechThreshold {
                    speechWindows += 1
                }
                totalWindows += 1
                frameStart = frameEnd
            }
        }

        let speechRatio = totalWindows > 0 ? Float(speechWindows) / Float(totalWindows) : 0
        return AudioSegmentQuality(rms: fullRMS, speechRatio: speechRatio, duration: duration)
    }
}

final class AudioEndpointGate {
    private let source: TranscriptSource
    private let writer: JSONLineWriter
    private var ambientRMS: Float = 0
    private var ambientObservationSeconds = 0.0
    private var lastDebugAt: Int64 = 0

    init(source: TranscriptSource, writer: JSONLineWriter) {
        self.source = source
        self.writer = writer
    }

    func isSpeech(_ buffer: AVAudioPCMBuffer, duration: Double) -> Bool {
        let rms = AudioSegmentAnalyzer.rms(buffer)
        guard source == .system else {
            return rms >= 0.0065
        }

        if ambientObservationSeconds < 0.35 {
            updateAmbient(rms, duration: duration)
            emitSystemDebug(rms: rms, threshold: 0, speech: false, reason: "learning")
            return false
        }

        let threshold = max(0.0045, ambientRMS > 0 ? ambientRMS * 1.35 + 0.003 : 0.0045)
        let speech = rms >= threshold
        if !speech {
            updateAmbient(rms, duration: duration)
        }
        emitSystemDebug(rms: rms, threshold: threshold, speech: speech, reason: "adaptive")

        return speech
    }

    private func updateAmbient(_ rms: Float, duration: Double) {
        guard rms > 0 else {
            ambientObservationSeconds += duration
            return
        }

        if ambientRMS == 0 {
            ambientRMS = rms
        } else {
            ambientRMS = ambientRMS * 0.95 + rms * 0.05
        }
        ambientObservationSeconds += duration
    }

    private func emitSystemDebug(rms: Float, threshold: Float, speech: Bool, reason: String) {
        guard source == .system else {
            return
        }

        let now = nowMillis()
        guard now - lastDebugAt > 2_000 else {
            return
        }

        lastDebugAt = now
        writer.emit(
            .debug(
                "system endpoint gate reason=\(reason) rms=\(String(format: "%.5f", rms)) ambient=\(String(format: "%.5f", ambientRMS)) threshold=\(String(format: "%.5f", threshold)) speech=\(speech)",
                source: source
            )
        )
    }
}

final class FunASRPipeline: AudioPipeline, @unchecked Sendable {
    private struct WorkerRequest: Encodable {
        let type: String
        let id: Int
        let path: String
        let language: String
        let model: String
        let speakerCount: Int
    }

    private struct WorkerLoadRequest: Encodable {
        let type: String
        let id: Int
        let model: String
    }

    private struct WorkerStopRequest: Encodable {
        let type: String
    }

    private struct WorkerResponse: Decodable {
        let type: String
        let id: Int?
        let text: String?
        let segments: [WorkerSegment]?
        let rawText: String?
        let isSpeech: Bool?
        let durationMs: Int?
        let message: String?
    }

    private struct WorkerSegment: Decodable {
        let text: String
        let speaker: String?
        let startMs: Int?
        let endMs: Int?
    }

    private let source: TranscriptSource
    private let writer: JSONLineWriter
    private let model: String
    private let speakerCount: Int
    private let silenceTimeoutMs: Int
    private let pythonPath: String
    private let scriptPath: String
    private let endpointGate: AudioEndpointGate
    private let queue = DispatchQueue(label: "com.rhinoc.stiki.transcriber.funasr")
    private let transcriptionQueue = DispatchQueue(label: "com.rhinoc.stiki.transcriber.funasr.transcription")
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private var localeIdentifier = "auto"
    private var currentFile: AVAudioFile?
    private var currentURL: URL?
    private var currentFrameCount: AVAudioFramePosition = 0
    private var currentSampleRate = 0.0
    private var segmentIndex = 0
    private var requestIndex = 0
    private var process: Process?
    private var stdinPipe: Pipe?
    private var stdoutPipe: Pipe?
    private var stderrPipe: Pipe?
    private var stopped = false
    private var acceptingTranscription = true
    private var preRollBuffers: [AVAudioPCMBuffer] = []
    private var preRollFrameCount: AVAudioFramePosition = 0
    private var trailingSilenceSeconds = 0.0
    private var speechSeconds = 0.0
    private let minimumSegmentSeconds = 1.2
    private let maximumSegmentSeconds = 30.0
    private let preRollSeconds = 0.30
    private let minimumSpeechSeconds = 0.25
    private let workDirectory: URL
    private var pendingTranscriptions = 0

    private var minimumRMS: Float {
        source == .microphone ? 0.0045 : 0.0025
    }

    private var minimumSpeechRatio: Float {
        source == .microphone ? 0.06 : 0.04
    }

    private var endpointSpeechRMS: Float {
        source == .microphone ? 0.0065 : 0.0045
    }

    private var silenceTimeoutSeconds: Double {
        if silenceTimeoutMs > 0 {
            return min(max(Double(silenceTimeoutMs) / 1000.0, 0.4), 5.0)
        }

        return source == .microphone ? 0.85 : 0.65
    }

    init(
        source: TranscriptSource,
        writer: JSONLineWriter,
        model: String,
        speakerCount: Int,
        silenceTimeoutMs: Int,
        pythonPath: String,
        scriptPath: String
    ) {
        self.source = source
        self.writer = writer
        self.model = model
        self.speakerCount = min(max(speakerCount, 0), 8)
        self.silenceTimeoutMs = min(max(silenceTimeoutMs, 400), 5_000)
        self.pythonPath = pythonPath
        self.scriptPath = scriptPath
        endpointGate = AudioEndpointGate(source: source, writer: writer)
        workDirectory = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("stiki-native-transcriber-funasr-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: workDirectory, withIntermediateDirectories: true)
    }

    func start(localeIdentifier: String) async throws {
        self.localeIdentifier = localeIdentifier

        guard FileManager.default.isExecutableFile(atPath: pythonPath) else {
            throw NativeTranscriberError.missingFunASRPython(pythonPath)
        }

        guard FileManager.default.fileExists(atPath: scriptPath) else {
            throw NativeTranscriberError.missingFunASRWorker(scriptPath)
        }

        try queue.sync {
            try startWorker()
        }
        writer.emit(.debug("funasr backend started model=\(model) locale=\(localeIdentifier)", source: source))
        preloadModelInBackground()
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        guard buffer.frameLength > 0 else {
            return
        }

        let copiedBuffer = Self.copyBuffer(buffer)
        queue.async { [weak self] in
            guard let self, !self.stopped else {
                return
            }

            self.write(copiedBuffer)
        }
    }

    func stop() {
        queue.sync {
            stopped = true
            acceptingTranscription = false
            finalizeCurrentSegment()
            clearPreRoll()
        }
        stopWorker()
        transcriptionQueue.async { [weak self] in
            guard let self else {
                return
            }
            cleanupPendingAudioFiles()
            try? FileManager.default.removeItem(at: workDirectory)
        }
    }

    private func startWorker() throws {
        let process = Process()
        let stdinPipe = Pipe()
        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()

        process.executableURL = URL(fileURLWithPath: pythonPath)
        process.arguments = [scriptPath]
        process.standardInput = stdinPipe
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        try process.run()
        self.process = process
        self.stdinPipe = stdinPipe
        self.stdoutPipe = stdoutPipe
        self.stderrPipe = stderrPipe
        observeWorkerStderr(stderrPipe)
    }

    private func stopWorker() {
        if process?.isRunning == true {
            sendJSONLine(WorkerStopRequest(type: "stop"))
            process?.terminate()
            process?.waitUntilExit()
        }

        process = nil
        stdinPipe = nil
        stdoutPipe = nil
        stderrPipe = nil
    }

    private func cleanupPendingAudioFiles() {
        guard let entries = try? FileManager.default.contentsOfDirectory(at: workDirectory, includingPropertiesForKeys: nil) else {
            return
        }

        for url in entries where url.pathExtension.lowercased() == "wav" {
            try? FileManager.default.removeItem(at: url)
        }
        pendingTranscriptions = 0
    }

    private func preloadModelInBackground() {
        transcriptionQueue.async { [weak self] in
            guard let self, self.isAcceptingTranscription() else {
                return
            }

            guard self.process?.isRunning == true else {
                self.writer.emit(.error("FunASR worker is not running.", source: self.source))
                return
            }

            self.writer.emit(.debug("funasr preload model request", source: self.source))
            self.sendJSONLine(WorkerLoadRequest(type: "load", id: 0, model: self.model))

            guard let responseData = self.readJSONLine(),
                  let response = try? self.decoder.decode(WorkerResponse.self, from: responseData)
            else {
                if self.isAcceptingTranscription() {
                    self.writer.emit(.error("FunASR worker did not return valid preload JSON.", source: self.source))
                }
                return
            }

            if response.type == "error" {
                self.writer.emit(.debug("funasr preload failed: \(response.message ?? "unknown error")", source: self.source))
                return
            }

            self.writer.emit(
                .debug(
                    "funasr preload complete durationMs=\(response.durationMs ?? 0)",
                    source: self.source
                )
            )
        }
    }

    private func isAcceptingTranscription() -> Bool {
        queue.sync {
            acceptingTranscription
        }
    }

    private func observeWorkerStderr(_ pipe: Pipe) {
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let output = String(data: data, encoding: .utf8) else {
                return
            }

            for line in output.split(whereSeparator: \.isNewline) {
                self?.writer.emit(.debug("funasr worker: \(line)", source: self?.source ?? .microphone))
            }
        }
    }

    private func write(_ buffer: AVAudioPCMBuffer) {
        do {
            let bufferDuration = buffer.format.sampleRate > 0 ? Double(buffer.frameLength) / buffer.format.sampleRate : 0
            let isSpeechBuffer = endpointGate.isSpeech(buffer, duration: bufferDuration)

            if currentFile == nil {
                appendPreRoll(buffer)
                guard isSpeechBuffer else {
                    return
                }

                try startSegment(format: buffer.format)
                for preRollBuffer in preRollBuffers {
                    try writeToCurrentSegment(preRollBuffer)
                }
                clearPreRoll()
                trailingSilenceSeconds = 0
                speechSeconds = bufferDuration
                return
            }

            try writeToCurrentSegment(buffer)

            if isSpeechBuffer {
                trailingSilenceSeconds = 0
                speechSeconds += bufferDuration
            } else {
                trailingSilenceSeconds += bufferDuration
            }

            let duration = currentSampleRate > 0 ? Double(currentFrameCount) / currentSampleRate : 0
            let reachedEndpoint = duration >= minimumSegmentSeconds
                && speechSeconds >= minimumSpeechSeconds
                && trailingSilenceSeconds >= silenceTimeoutSeconds
            let reachedMaximum = duration >= maximumSegmentSeconds
            if reachedEndpoint || reachedMaximum {
                writer.emit(
                    .debug(
                        "funasr endpoint duration=\(String(format: "%.2f", duration)) speech=\(String(format: "%.2f", speechSeconds)) trailingSilence=\(String(format: "%.2f", trailingSilenceSeconds)) max=\(reachedMaximum)",
                        source: source
                    )
                )
                finalizeCurrentSegment()
            }
        } catch {
            writer.emit(.error("FunASR audio write failed: \(error.localizedDescription)", source: source))
        }
    }

    private func writeToCurrentSegment(_ buffer: AVAudioPCMBuffer) throws {
        try currentFile?.write(from: buffer)
        currentFrameCount += AVAudioFramePosition(buffer.frameLength)
        currentSampleRate = buffer.format.sampleRate
    }

    private func appendPreRoll(_ buffer: AVAudioPCMBuffer) {
        preRollBuffers.append(buffer)
        preRollFrameCount += AVAudioFramePosition(buffer.frameLength)

        let sampleRate = buffer.format.sampleRate
        let maximumPreRollFrames = AVAudioFramePosition(sampleRate * preRollSeconds)
        while preRollFrameCount > maximumPreRollFrames, let first = preRollBuffers.first {
            preRollFrameCount -= AVAudioFramePosition(first.frameLength)
            preRollBuffers.removeFirst()
        }
    }

    private func clearPreRoll() {
        preRollBuffers.removeAll()
        preRollFrameCount = 0
    }

    private func startSegment(format: AVAudioFormat) throws {
        segmentIndex += 1
        let url = workDirectory.appendingPathComponent("\(source.rawValue)-\(segmentIndex).wav")
        currentURL = url
        currentFrameCount = 0
        currentSampleRate = format.sampleRate
        currentFile = try AVAudioFile(
            forWriting: url,
            settings: format.settings,
            commonFormat: format.commonFormat,
            interleaved: format.isInterleaved
        )
    }

    private func finalizeCurrentSegment() {
        guard let url = currentURL else {
            return
        }

        let audioDurationMs = currentSampleRate > 0 ? Int(Double(currentFrameCount) / currentSampleRate * 1000) : 0

        currentFile = nil
        currentURL = nil
        currentFrameCount = 0
        trailingSilenceSeconds = 0
        speechSeconds = 0

        enqueueTranscription(url, audioDurationMs: audioDurationMs)
    }

    private func enqueueTranscription(_ url: URL, audioDurationMs: Int) {
        guard acceptingTranscription else {
            try? FileManager.default.removeItem(at: url)
            return
        }

        pendingTranscriptions += 1
        writer.emit(
            .debug(
                "funasr queued segment=\(url.lastPathComponent) pendingTranscriptions=\(pendingTranscriptions)",
                source: source
            )
        )
        transcriptionQueue.async { [weak self] in
            guard let self else {
                try? FileManager.default.removeItem(at: url)
                return
            }

            self.transcribe(url, audioDurationMs: audioDurationMs)
            self.queue.async { [weak self] in
                guard let self else {
                    return
                }
                self.pendingTranscriptions = max(self.pendingTranscriptions - 1, 0)
            }
        }
    }

    private func transcribe(_ url: URL, audioDurationMs: Int) {
        guard isAcceptingTranscription() else {
            try? FileManager.default.removeItem(at: url)
            return
        }

        let quality = AudioSegmentAnalyzer.quality(of: url, speechThreshold: minimumRMS * 1.6)
        writer.emit(
            .debug(
                "funasr segment=\(url.lastPathComponent) rms=\(String(format: "%.5f", quality.rms)) speechRatio=\(String(format: "%.2f", quality.speechRatio)) duration=\(String(format: "%.2f", quality.duration))",
                source: source
            )
        )

        guard quality.rms >= minimumRMS,
              quality.speechRatio >= minimumSpeechRatio,
              quality.speechDuration >= 0.30
        else {
            writer.emit(.debug("funasr skipped low-speech segment", source: source))
            try? FileManager.default.removeItem(at: url)
            return
        }

        guard process?.isRunning == true else {
            writer.emit(.error("FunASR worker is not running.", source: source))
            try? FileManager.default.removeItem(at: url)
            return
        }

        requestIndex += 1
        writer.emit(
            .debug(
                "funasr transcribe request id=\(requestIndex) file=\(url.lastPathComponent) audioDurationMs=\(audioDurationMs)",
                source: source
            )
        )
        sendJSONLine(
            WorkerRequest(
                type: "transcribe",
                id: requestIndex,
                path: url.path,
                language: localeIdentifier,
                model: model,
                speakerCount: speakerCount
            )
        )

        guard let responseData = readJSONLine(),
              let response = try? decoder.decode(WorkerResponse.self, from: responseData)
        else {
            writer.emit(.error("FunASR worker did not return valid JSON.", source: source))
            try? FileManager.default.removeItem(at: url)
            return
        }
        writer.emit(.debug("funasr transcribe response id=\(response.id ?? requestIndex) type=\(response.type)", source: source))

        if response.type == "error" {
            writer.emit(.debug("funasr worker skipped segment: \(response.message ?? "unknown error")", source: source))
        } else {
            emitAcceptedResponse(response, url: url, audioDurationMs: audioDurationMs)
        }

        try? FileManager.default.removeItem(at: url)
    }

    private func emitAcceptedResponse(_ response: WorkerResponse, url: URL, audioDurationMs: Int) {
        let text = response.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard response.isSpeech != false else {
            writer.emit(.debug("funasr rejected non-speech tags raw=\(response.rawText ?? "")", source: source))
            return
        }

        if let reason = TranscriptOutputFilter.shouldRejectText(text) {
            writer.emit(.debug("funasr rejected segment: \(reason) text=\(text)", source: source))
            return
        }

        let segments = normalizedWorkerSegments(response)
        guard !segments.isEmpty else {
            writer.emit(.debug("funasr rejected segment: no transcript segments", source: source))
            return
        }

        writer.emit(
            .debug(
                "funasr accepted segment=\(url.lastPathComponent) transcriptSegments=\(segments.count) durationMs=\(response.durationMs ?? 0)",
                source: source
            )
        )

        let completedAt = nowMillis()
        for segment in segments {
            let segmentText = segment.text.trimmingCharacters(in: .whitespacesAndNewlines)
            if let reason = TranscriptOutputFilter.shouldRejectText(segmentText) {
                writer.emit(.debug("funasr rejected segment part: \(reason) text=\(segmentText)", source: source))
                continue
            }

            writer.emit(
                .segment(
                    segmentText,
                    isFinal: true,
                    source: source,
                    speaker: segment.speaker,
                    createdAt: eventTime(completedAt: completedAt, audioDurationMs: audioDurationMs, segmentStartMs: segment.startMs)
                )
            )
        }
    }

    private func normalizedWorkerSegments(_ response: WorkerResponse) -> [WorkerSegment] {
        let segments = response.segments?.filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } ?? []
        if !segments.isEmpty {
            return segments
        }

        let text = response.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if text.isEmpty {
            return []
        }

        return [WorkerSegment(text: text, speaker: nil, startMs: nil, endMs: nil)]
    }

    private func eventTime(completedAt: Int64, audioDurationMs: Int, segmentStartMs: Int?) -> Int64 {
        guard audioDurationMs > 0 else {
            return completedAt
        }

        let offsetMs = min(max(segmentStartMs ?? audioDurationMs, 0), audioDurationMs)
        return completedAt - Int64(audioDurationMs - offsetMs)
    }

    private func sendJSONLine<T: Encodable>(_ value: T) {
        guard let data = try? encoder.encode(value) else {
            return
        }

        stdinPipe?.fileHandleForWriting.write(data)
        stdinPipe?.fileHandleForWriting.write(Data([0x0A]))
    }

    private func readJSONLine() -> Data? {
        guard let handle = stdoutPipe?.fileHandleForReading else {
            return nil
        }

        var data = Data()
        while true {
            let next = handle.readData(ofLength: 1)
            if next.isEmpty {
                return nil
            }

            if next.first == 0x0A {
                return data
            }

            data.append(next)
        }
    }

    private func languageArguments() -> [String] {
        switch localeIdentifier {
        case "zh-CN", "zh-HK", "zh-TW":
            ["zh"]
        case "en-US", "en-GB":
            ["en"]
        case "ja-JP":
            ["ja"]
        case "ko-KR":
            ["ko"]
        default:
            ["auto"]
        }
    }

    private static func copyBuffer(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer {
        guard let copy = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength) else {
            return buffer
        }

        copy.frameLength = buffer.frameLength

        let frameLength = Int(buffer.frameLength)
        let channelCount = Int(buffer.format.channelCount)

        if let sourceChannels = buffer.floatChannelData,
           let destinationChannels = copy.floatChannelData {
            for channelIndex in 0..<channelCount {
                destinationChannels[channelIndex].assign(from: sourceChannels[channelIndex], count: frameLength)
            }
            return copy
        }

        if let sourceChannels = buffer.int16ChannelData,
           let destinationChannels = copy.int16ChannelData {
            for channelIndex in 0..<channelCount {
                destinationChannels[channelIndex].assign(from: sourceChannels[channelIndex], count: frameLength)
            }
            return copy
        }

        return copy
    }
}

final class MicrophoneCapture {
    private let pipeline: AudioPipeline
    private let engine = AVAudioEngine()

    init(pipeline: AudioPipeline) {
        self.pipeline = pipeline
    }

    func start() async throws {
        let hasPermission = await AVCaptureDevice.requestAccess(for: .audio)
        guard hasPermission else {
            throw NativeTranscriberError.microphonePermissionDenied
        }

        let input = engine.inputNode
        let inputFormat = input.outputFormat(forBus: 0)
        guard inputFormat.channelCount > 0 else {
            throw NativeTranscriberError.missingAudioInput
        }

        input.installTap(onBus: 0, bufferSize: 1024, format: inputFormat) { [pipeline] buffer, _ in
            pipeline.append(buffer)
        }

        engine.prepare()
        try engine.start()
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }
}

final class SystemAudioCapture: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    private let pipeline: AudioPipeline
    private let queue = DispatchQueue(label: "com.rhinoc.stiki.transcriber.system-audio")
    private var stream: SCStream?

    init(pipeline: AudioPipeline) {
        self.pipeline = pipeline
    }

    func start() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)

        guard let display = content.displays.first else {
            throw NativeTranscriberError.missingDisplay
        }

        let currentBundleID = Bundle.main.bundleIdentifier
        let excludedApplications = content.applications.filter { application in
            application.bundleIdentifier == currentBundleID || application.bundleIdentifier == "com.rhinoc.stiki"
        }

        let filter = SCContentFilter(display: display, excludingApplications: excludedApplications, exceptingWindows: [])
        let configuration = SCStreamConfiguration()
        configuration.capturesAudio = true
        configuration.excludesCurrentProcessAudio = true
        configuration.sampleRate = 48_000
        configuration.channelCount = 1
        configuration.width = 2
        configuration.height = 2
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        configuration.showsCursor = false

        let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
        try? stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        self.stream = stream

        try await stream.startCapture()
    }

    func stop() async {
        guard let stream else {
            return
        }

        try? await stream.stopCapture()
        self.stream = nil
    }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of outputType: SCStreamOutputType
    ) {
        guard outputType == .audio else {
            return
        }

        guard sampleBuffer.isValid,
              sampleBuffer.numSamples > 0,
              let buffer = Self.makeAudioPCMBuffer(from: sampleBuffer)
        else {
            return
        }

        pipeline.append(buffer)
    }

    private static func makeAudioPCMBuffer(from sampleBuffer: CMSampleBuffer) -> AVAudioPCMBuffer? {
        guard let formatDescription = sampleBuffer.formatDescription,
              let streamDescription = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription),
              let format = AVAudioFormat(streamDescription: streamDescription)
        else {
            return nil
        }

        let frameCount = AVAudioFrameCount(sampleBuffer.numSamples)
        guard let pcmBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else {
            return nil
        }

        pcmBuffer.frameLength = frameCount
        let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(
            sampleBuffer,
            at: 0,
            frameCount: Int32(frameCount),
            into: pcmBuffer.mutableAudioBufferList
        )

        guard status == noErr else {
            return nil
        }

        return pcmBuffer
    }
}

final class NativeTranscriber: @unchecked Sendable {
    private let source: TranscriptSource
    private let localeIdentifier: String
    private let backend: TranscriptBackend
    private let model: String
    private let speakerCount: Int
    private let silenceTimeoutMs: Int
    private let funASRPython: String
    private let funASRScript: String
    private let writer = JSONLineWriter()
    private var pipeline: AudioPipeline?
    private var microphoneCapture: MicrophoneCapture?
    private var systemAudioCapture: SystemAudioCapture?

    init(
        source: TranscriptSource,
        localeIdentifier: String,
        backend: TranscriptBackend,
        model: String,
        speakerCount: Int,
        silenceTimeoutMs: Int,
        funASRPython: String,
        funASRScript: String
    ) {
        self.source = source
        self.localeIdentifier = localeIdentifier
        self.backend = backend
        self.model = model
        self.speakerCount = speakerCount
        self.silenceTimeoutMs = silenceTimeoutMs
        self.funASRPython = funASRPython
        self.funASRScript = funASRScript
    }

    func start() async throws {
        let pipeline: AudioPipeline = switch backend {
        case .apple:
            SpeechRecognitionPipeline(source: source, writer: writer)
        case .funASRLocal:
            FunASRPipeline(
                source: source,
                writer: writer,
                model: model,
                speakerCount: speakerCount,
                silenceTimeoutMs: silenceTimeoutMs,
                pythonPath: funASRPython,
                scriptPath: funASRScript
            )
        }

        try await pipeline.start(localeIdentifier: localeIdentifier)
        self.pipeline = pipeline

        switch source {
        case .microphone:
            let capture = MicrophoneCapture(pipeline: pipeline)
            try await capture.start()
            microphoneCapture = capture
        case .system:
            let capture = SystemAudioCapture(pipeline: pipeline)
            try await capture.start()
            systemAudioCapture = capture
        }

        writer.emit(.status("started", source: source))
    }

    func stop() async {
        microphoneCapture?.stop()
        await systemAudioCapture?.stop()
        pipeline?.stop()
        writer.emit(.status("stopped", source: source))
    }
}

func parsePositiveInt(_ value: String, fallback: Int) -> Int {
    guard let parsed = Int(value), parsed >= 0 else {
        return fallback
    }

    return parsed
}

func parseArguments() -> (TranscriptSource, String, TranscriptBackend, String, Int, Int, String, String) {
    var source = TranscriptSource.system
    var locale = Locale.current.identifier.replacingOccurrences(of: "_", with: "-")
    var backend = TranscriptBackend.apple
    var model = ""
    var speakerCount = 2
    var silenceTimeoutMs = 1200
    var funASRPython = ""
    var funASRScript = ""
    let arguments = CommandLine.arguments
    var index = 1

    while index < arguments.count {
        let argument = arguments[index]

        switch argument {
        case "--source" where index + 1 < arguments.count:
            source = TranscriptSource(rawValue: arguments[index + 1]) ?? source
            index += 1
        case "--locale" where index + 1 < arguments.count:
            locale = arguments[index + 1]
            index += 1
        case "--backend" where index + 1 < arguments.count:
            backend = TranscriptBackend(rawValue: arguments[index + 1]) ?? backend
            index += 1
        case "--model" where index + 1 < arguments.count:
            model = arguments[index + 1]
            index += 1
        case "--speaker-count" where index + 1 < arguments.count:
            speakerCount = min(parsePositiveInt(arguments[index + 1], fallback: speakerCount), 8)
            index += 1
        case "--silence-timeout-ms" where index + 1 < arguments.count:
            silenceTimeoutMs = min(max(parsePositiveInt(arguments[index + 1], fallback: silenceTimeoutMs), 400), 5_000)
            index += 1
        case "--funasr-python" where index + 1 < arguments.count:
            funASRPython = arguments[index + 1]
            index += 1
        case "--funasr-script" where index + 1 < arguments.count:
            funASRScript = arguments[index + 1]
            index += 1
        default:
            break
        }

        index += 1
    }

    return (source, locale, backend, model, speakerCount, silenceTimeoutMs, funASRPython, funASRScript)
}

@main
struct Main {
    static func main() async {
        let (source, locale, backend, model, speakerCount, silenceTimeoutMs, funASRPython, funASRScript) = parseArguments()
        let transcriber = NativeTranscriber(
            source: source,
            localeIdentifier: locale,
            backend: backend,
            model: model,
            speakerCount: speakerCount,
            silenceTimeoutMs: silenceTimeoutMs,
            funASRPython: funASRPython,
            funASRScript: funASRScript
        )
        let writer = JSONLineWriter()

        let signalSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        signal(SIGTERM, SIG_IGN)
        signalSource.setEventHandler {
            Task {
                await transcriber.stop()
                Foundation.exit(0)
            }
        }
        signalSource.resume()

        do {
            try await transcriber.start()
            while true {
                try await Task.sleep(nanoseconds: 60_000_000_000)
            }
        } catch {
            writer.emit(.error(error.localizedDescription, source: source))
            Foundation.exit(1)
        }
    }
}
