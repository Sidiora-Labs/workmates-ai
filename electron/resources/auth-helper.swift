import Foundation
import LocalAuthentication

let arguments = CommandLine.arguments.dropFirst()
let mode = arguments.first ?? "check"

let policy = LAPolicy.deviceOwnerAuthentication

let context = LAContext()
context.localizedCancelTitle = "Cancel"

var problem: NSError?
let available = context.canEvaluatePolicy(policy, error: &problem)

if mode == "check" {
    if available {
        print(context.biometryType == .none ? "password" : "biometry")
    } else {
        print("unavailable")
    }
    exit(0)
}

guard mode == "ask" else {
    print("unavailable")
    exit(0)
}

guard available else {
    print("unavailable")
    exit(0)
}

let reason = arguments.dropFirst().joined(separator: " ")
let semaphore = DispatchSemaphore(value: 0)
var answer = "denied"

context.evaluatePolicy(policy, localizedReason: reason.isEmpty ? "confirm this action" : reason) {
    granted, error in
    if granted {
        answer = "granted"
    } else if let code = (error as NSError?)?.code,
        code == LAError.userCancel.rawValue || code == LAError.appCancel.rawValue
            || code == LAError.systemCancel.rawValue
    {
        answer = "cancelled"
    }
    semaphore.signal()
}

if semaphore.wait(timeout: .now() + 120) == .timedOut {
    answer = "cancelled"
}
print(answer)
