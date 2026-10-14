// macOS Vision '피사체 분리'로 이미지의 전경 인스턴스 마스크를 뽑는다.
// 사용: swift vmask.swift 입력.png 출력폴더  →  출력폴더/mask_<번호>.png (입력과 같은 크기의 흑백 마스크)
import AppKit
import CoreImage
import Vision

let args = CommandLine.arguments
guard args.count >= 3 else { print("사용: vmask 입력.png 출력폴더"); exit(1) }
let url = URL(fileURLWithPath: args[1]), out = URL(fileURLWithPath: args[2])
try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

let handler = VNImageRequestHandler(url: url)
let req = VNGenerateForegroundInstanceMaskRequest()
try handler.perform([req])
guard let obs = req.results?.first else { print("0"); exit(0) }

let ctx = CIContext()
var n = 0
for i in obs.allInstances {
    let buf = try obs.generateScaledMaskForImage(forInstances: IndexSet(integer: i), from: handler)
    let ci = CIImage(cvPixelBuffer: buf)
    let gray = CGColorSpaceCreateDeviceGray()
    try ctx.writePNGRepresentation(of: ci, to: out.appendingPathComponent("mask_\(i).png"), format: .L8, colorSpace: gray)
    n += 1
}
print(n)
