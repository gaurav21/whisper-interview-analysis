import Foundation
import AVFoundation
import ScreenCaptureKit

@available(macOS 13.0, *)
final class SegmentedRecorder {
    private let chunkDuration: TimeInterval
    private let sampleRate: Double
    private let channels: Int
    private let mp3BitrateKbps: Int

    private var timer: DispatchSourceTimer?
    private var segmentIndex = 0
    private var isRecording = false

    private var systemRecorder: SystemAudioRecorder?
    private var micRecorder: MicAudioRecorder?
    private var activeSegment: (index: Int, startTime: Date, systemURL: URL, micURL: URL)?

    var onSegmentReady: ((RecordingSegment) -> Void)?

    init(chunkDuration: TimeInterval, sampleRate: Double, channels: Int, mp3BitrateKbps: Int) {
        self.chunkDuration = chunkDuration
        self.sampleRate = sampleRate
        self.channels = channels
        self.mp3BitrateKbps = mp3BitrateKbps
    }

    func start() {
        guard !isRecording else { return }
        isRecording = true
        segmentIndex = 0
        startSegment()
    }

    func stop() {
        isRecording = false
        timer?.cancel()
        timer = nil
        Task {
            await stopSegment(finalize: true)
        }
    }

    private func startSegment() {
        guard isRecording else { return }
        let startTime = Date()
        let segmentId = segmentIndex
        let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent("transcriber_segments", isDirectory: true)
        try? FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)

        let systemURL = tempDir.appendingPathComponent("system_\(segmentId).m4a")
        let micURL = tempDir.appendingPathComponent("mic_\(segmentId).caf")
        activeSegment = (index: segmentId, startTime: startTime, systemURL: systemURL, micURL: micURL)

        systemRecorder = SystemAudioRecorder(outputURL: systemURL, sampleRate: sampleRate, channels: channels)
        micRecorder = MicAudioRecorder(outputURL: micURL, sampleRate: sampleRate, channels: channels)

        Task {
            do {
                try await systemRecorder?.start()
                try micRecorder?.start()
            } catch {
                Log.error("Failed to start recording: \(error)")
            }
        }

        timer?.cancel()
        let timer = DispatchSource.makeTimerSource()
        timer.schedule(deadline: .now() + chunkDuration)
        timer.setEventHandler { [weak self] in
            Task { await self?.stopSegment(finalize: false) }
        }
        timer.resume()
        self.timer = timer

        segmentIndex += 1
    }

    private func stopSegment(finalize: Bool) async {
        timer?.cancel()
        timer = nil

        await systemRecorder?.stop()
        micRecorder?.stop()

        let segment = activeSegment
        systemRecorder = nil
        micRecorder = nil
        activeSegment = nil

        if let segment {
            let endTime = Date()
            let tempDir = segment.systemURL.deletingLastPathComponent()
            let mp3URL = tempDir.appendingPathComponent("segment_\(segment.index).mp3")
            let muxer = AudioMuxer(mp3BitrateKbps: mp3BitrateKbps)
            do {
                try await muxer.mix(systemURL: segment.systemURL, micURL: segment.micURL, outputURL: mp3URL)
                let ready = RecordingSegment(index: segment.index, startTime: segment.startTime, endTime: endTime, fileURL: mp3URL)
                onSegmentReady?(ready)
            } catch {
                Log.error("Failed to mux segment: \(error)")
            }
        }

        if isRecording && !finalize {
            startSegment()
        }
    }
}

@available(macOS 13.0, *)
final class SystemAudioRecorder: NSObject, SCStreamOutput {
    private let outputURL: URL
    private let sampleRate: Double
    private let channels: Int

    private var stream: SCStream?
    private var writer: AVAssetWriter?
    private var writerInput: AVAssetWriterInput?
    private var didStartWriting = false

    init(outputURL: URL, sampleRate: Double, channels: Int) {
        self.outputURL = outputURL
        self.sampleRate = sampleRate
        self.channels = channels
    }

    func start() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        guard let display = content.displays.first else {
            throw NSError(domain: "SystemAudioRecorder", code: 1, userInfo: [NSLocalizedDescriptionKey: "No display available for capture"]) 
        }

        let filter = SCContentFilter(display: display, excludingWindows: [])
        let configuration = SCStreamConfiguration()
        configuration.capturesAudio = true
        configuration.capturesVideo = false
        configuration.sampleRate = Int(sampleRate)
        configuration.channelCount = channels

        let writer = try AVAssetWriter(url: outputURL, fileType: .m4a)
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: channels,
            AVEncoderBitRateKey: 96000
        ]
        let input = AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
        input.expectsMediaDataInRealTime = true
        writer.add(input)

        self.writer = writer
        self.writerInput = input

        let stream = SCStream(filter: filter, configuration: configuration, delegate: nil)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: DispatchQueue(label: "system-audio-queue"))
        try await stream.startCapture()
        self.stream = stream
    }

    func stop() async {
        try? await stream?.stopCapture()
        stream = nil
        writerInput?.markAsFinished()
        await writer?.finishWriting()
        writer = nil
        writerInput = nil
        didStartWriting = false
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio else { return }
        guard CMSampleBufferDataIsReady(sampleBuffer) else { return }
        guard let writer = writer, let input = writerInput else { return }

        if !didStartWriting {
            writer.startWriting()
            writer.startSession(atSourceTime: CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
            didStartWriting = true
        }

        if input.isReadyForMoreMediaData {
            input.append(sampleBuffer)
        }
    }
}

final class MicAudioRecorder {
    private let outputURL: URL
    private let sampleRate: Double
    private let channels: Int

    private let engine = AVAudioEngine()
    private var audioFile: AVAudioFile?

    init(outputURL: URL, sampleRate: Double, channels: Int) {
        self.outputURL = outputURL
        self.sampleRate = sampleRate
        self.channels = channels
    }

    func start() throws {
        let input = engine.inputNode
        let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: AVAudioChannelCount(channels))
        audioFile = try AVAudioFile(forWriting: outputURL, settings: format?.settings ?? [:])

        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let file = self?.audioFile else { return }
            do {
                try file.write(from: buffer)
            } catch {
                Log.error("Failed to write mic audio: \(error)")
            }
        }

        engine.prepare()
        try engine.start()
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        audioFile = nil
    }
}

final class AudioMuxer {
    private let mp3BitrateKbps: Int

    init(mp3BitrateKbps: Int) {
        self.mp3BitrateKbps = mp3BitrateKbps
    }

    func mix(systemURL: URL, micURL: URL, outputURL: URL) async throws {
        let ffmpegPath = resolveFFmpegPath()
        guard let ffmpegPath else {
            throw NSError(domain: "AudioMuxer", code: 2, userInfo: [NSLocalizedDescriptionKey: "ffmpeg not found at /opt/homebrew/bin/ffmpeg or /usr/local/bin/ffmpeg"]) 
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: ffmpegPath)
        process.arguments = [
            "-y",
            "-i", systemURL.path,
            "-i", micURL.path,
            "-filter_complex", "amix=inputs=2:duration=longest",
            "-c:a", "libmp3lame",
            "-b:a", "\(mp3BitrateKbps)k",
            "-ac", "1",
            outputURL.path
        ]

        try process.run()
        process.waitUntilExit()

        if process.terminationStatus != 0 {
            throw NSError(domain: "AudioMuxer", code: 1, userInfo: [NSLocalizedDescriptionKey: "ffmpeg failed to mux audio"]) 
        }
    }

    private func resolveFFmpegPath() -> String? {
        var candidates: [String] = []
        if let bundled = Bundle.main.path(forResource: "ffmpeg", ofType: nil, inDirectory: "bin") {
            candidates.append(bundled)
        }
        candidates.append(contentsOf: ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"])
        for path in candidates {
            if FileManager.default.fileExists(atPath: path) {
                return path
            }
        }
        return nil
    }
}
