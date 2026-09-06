import AVFoundation
import Foundation
import Speech

func writeLine(_ payload: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: payload),
    let line = String(data: data, encoding: .utf8)
  else { return }
  print(line)
  fflush(stdout)
}

func die(_ reason: String) -> Never {
  writeLine(["error": reason])
  exit(1)
}

SFSpeechRecognizer.requestAuthorization { status in
  guard status == .authorized else { die("speech-not-authorized") }

  guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")),
    recognizer.isAvailable
  else { die("recognizer-unavailable") }

  let request = SFSpeechAudioBufferRecognitionRequest()
  request.shouldReportPartialResults = true
  if recognizer.supportsOnDeviceRecognition {
    request.requiresOnDeviceRecognition = true
  }

  let engine = AVAudioEngine()
  let microphone = engine.inputNode
  var lastLevelAt = Date.distantPast
  microphone.installTap(
    onBus: 0, bufferSize: 1024, format: microphone.outputFormat(forBus: 0)
  ) { buffer, _ in
    request.append(buffer)

    let now = Date()
    if now.timeIntervalSince(lastLevelAt) >= 0.1, let channel = buffer.floatChannelData?[0] {
      lastLevelAt = now
      let count = Int(buffer.frameLength)
      guard count > 0 else { return }
      var sum: Float = 0
      for i in 0..<count { sum += channel[i] * channel[i] }
      let rms = (sum / Float(count)).squareRoot()
      writeLine(["level": min(1.0, Double(rms) * 12)])
    }
  }

  do {
    engine.prepare()
    try engine.start()
  } catch {
    die("mic-failed")
  }

  recognizer.recognitionTask(with: request) { result, error in
    if let result {
      writeLine(["partial": !result.isFinal, "text": result.bestTranscription.formattedString])
      if result.isFinal { exit(0) }
    }
    if error != nil { die("recognition-error") }
  }
}

RunLoop.main.run()
