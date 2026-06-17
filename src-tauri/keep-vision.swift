import CoreImage
import Foundation
import Vision

struct VisionResult: Codable {
    var tags: [String]
    var ocr_text: String
}

func analyze(path: String) -> VisionResult {
    guard let ciImage = CIImage(contentsOf: URL(fileURLWithPath: path)) else {
        return VisionResult(tags: [], ocr_text: "")
    }

    let classifyReq = VNClassifyImageRequest()
    let ocrReq = VNRecognizeTextRequest()
    ocrReq.recognitionLevel = .accurate
    ocrReq.usesLanguageCorrection = true

    let handler = VNImageRequestHandler(ciImage: ciImage, options: [:])
    try? handler.perform([classifyReq, ocrReq])

    let tags = (classifyReq.results ?? [])
        .filter { $0.confidence > 0.5 && !$0.identifier.hasPrefix("no ") }
        .prefix(6)
        .map { $0.identifier }

    let ocrText = (ocrReq.results ?? [])
        .compactMap { $0.topCandidates(1).first?.string }
        .joined(separator: " ")

    return VisionResult(tags: Array(tags), ocr_text: String(ocrText.prefix(2000)))
}

let path = CommandLine.arguments.dropFirst().first ?? ""
guard !path.isEmpty else {
    print("{\"tags\":[],\"ocr_text\":\"\"}")
    exit(0)
}

let result = analyze(path: path)
if let data = try? JSONEncoder().encode(result), let str = String(data: data, encoding: .utf8) {
    print(str)
} else {
    print("{\"tags\":[],\"ocr_text\":\"\"}")
}
