import CoreGraphics
import Foundation

let mode = CommandLine.arguments.dropFirst().first ?? "request"
if mode == "check" {
  print(CGPreflightScreenCaptureAccess() ? "granted" : "not-granted")
} else {
  print(CGRequestScreenCaptureAccess() ? "granted" : "not-granted")
}
