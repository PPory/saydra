// Saydra system helper for macOS: one long-lived process, the counterpart of
// win-helper.ps1, with the same protocol. Reads JSON requests from stdin, one per
// line, and answers one JSON line each:
//   {"id":1,"cmd":"focus","before":500}  -> text of the focused input box, its selection, text before the caret
//   {"id":2,"cmd":"watch"}                -> like focus, and remembers that element for "watched"
//   {"id":3,"cmd":"watched"}              -> current text of the remembered element, focused or not
//   {"id":4,"cmd":"front"}                -> the app in front: name, bundle path, focused window title
//   {"id":5,"cmd":"mute"} / "unmute" / "muted"  -> mute of the default output device
// Every failure is an answer with "ok": false; the app treats this helper as best effort.
// It runs as Saydra's child process, so it reads the Accessibility API under Saydra's permission.
//
// Build: swiftc -O -target arm64-apple-macos12 mac-helper.swift -o mac-helper

import AppKit
import ApplicationServices
import CoreAudio

struct HelperError: Error {
    let message: String
}

let maxDoc = 20000
let systemWide = AXUIElementCreateSystemWide()
// A hung app must not hang us: the app restarts the helper after two timeouts anyway.
AXUIElementSetMessagingTimeout(systemWide, 1.0)
var watched: AXUIElement?
var manualAccessibility = Set<pid_t>()

func attr(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success ? value : nil
}

func element(_ ref: CFTypeRef?) -> AXUIElement? {
    guard let ref, CFGetTypeID(ref) == AXUIElementGetTypeID() else { return nil }
    return (ref as! AXUIElement)
}

func text(_ el: AXUIElement, _ name: String) -> String? {
    attr(el, name) as? String
}

func processId(of el: AXUIElement) -> pid_t? {
    var pid: pid_t = 0
    return AXUIElementGetPid(el, &pid) == .success ? pid : nil
}

// Chromium-based apps (Electron: Feishu, Slack, VS Code…) only build their
// accessibility tree once asked to.
func enableManualAccessibility(_ app: AXUIElement) {
    guard let pid = processId(of: app), !manualAccessibility.contains(pid) else { return }
    manualAccessibility.insert(pid)
    AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
}

func focusedApp() -> AXUIElement? {
    element(attr(systemWide, kAXFocusedApplicationAttribute))
}

func focusedElement() -> AXUIElement? {
    guard let app = focusedApp() else { return nil }
    enableManualAccessibility(app)
    return element(attr(app, kAXFocusedUIElementAttribute)) ?? element(attr(systemWide, kAXFocusedUIElementAttribute))
}

func describe(_ el: AXUIElement?, before: Int) -> [String: Any] {
    var r: [String: Any] = [:]
    guard let el else { return r }
    if let pid = processId(of: el) {
        r["pid"] = Int(pid)
        if let id = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier { r["cls"] = id }
    }
    r["type"] = text(el, kAXRoleAttribute) ?? ""
    let password = text(el, kAXSubroleAttribute) == (kAXSecureTextFieldSubrole as String)
    r["password"] = password
    if password { return r }
    guard let value = text(el, kAXValueAttribute) else { return r } // not a text control
    let doc = value as NSString
    r["text"] = doc.length > maxDoc ? doc.substring(to: maxDoc) : value
    if let selection = text(el, kAXSelectedTextAttribute) { r["selection"] = selection }
    if before > 0, let ref = attr(el, kAXSelectedTextRangeAttribute), CFGetTypeID(ref) == AXValueGetTypeID() {
        // From the caret (start of the selection) back by `before` characters (UTF-16, as AX counts).
        var range = CFRange()
        if AXValueGetValue(ref as! AXValue, .cfRange, &range) {
            let end = min(max(range.location, 0), doc.length)
            let start = max(0, end - before)
            r["before"] = doc.substring(with: NSRange(location: start, length: end - start))
        }
    }
    return r
}

func front() -> [String: Any] {
    var r: [String: Any] = [:]
    let appEl = focusedApp()
    let app = appEl.flatMap { processId(of: $0) }.flatMap { NSRunningApplication(processIdentifier: $0) }
        ?? NSWorkspace.shared.frontmostApplication
    guard let app else { return r }
    r["pid"] = Int(app.processIdentifier)
    r["name"] = app.localizedName ?? ""
    r["path"] = app.bundleURL?.path ?? ""
    r["bundleId"] = app.bundleIdentifier ?? ""
    if let appEl, let window = element(attr(appEl, kAXFocusedWindowAttribute)) {
        r["title"] = text(window, kAXTitleAttribute) ?? ""
    }
    return r
}

// ---- Core Audio: mute of the default output device ----
func defaultOutput() throws -> AudioDeviceID {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultOutputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var device = AudioDeviceID(0)
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device)
    guard status == noErr, device != 0 else { throw HelperError(message: "no output device (\(status))") }
    return device
}

var muteAddress = AudioObjectPropertyAddress(
    mSelector: kAudioDevicePropertyMute,
    mScope: kAudioDevicePropertyScopeOutput,
    mElement: kAudioObjectPropertyElementMain)

func isMuted() throws -> Bool {
    let device = try defaultOutput()
    var muted: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)
    let status = AudioObjectGetPropertyData(device, &muteAddress, 0, nil, &size, &muted)
    guard status == noErr else { throw HelperError(message: "output device has no mute (\(status))") }
    return muted != 0
}

func setMuted(_ mute: Bool) throws {
    let device = try defaultOutput()
    var value: UInt32 = mute ? 1 : 0
    let status = AudioObjectSetPropertyData(device, &muteAddress, 0, nil, UInt32(MemoryLayout<UInt32>.size), &value)
    guard status == noErr else { throw HelperError(message: "cannot set mute (\(status))") }
}

func reply(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
    FileHandle.standardOutput.write(data + Data([0x0a]))
}

func handle(_ req: [String: Any]) throws -> [String: Any] {
    let before = (req["before"] as? Int) ?? 0
    switch req["cmd"] as? String {
    case "focus":
        return describe(focusedElement(), before: before)
    case "watch":
        let el = focusedElement()
        watched = el
        return describe(el, before: before)
    case "watched":
        guard let el = watched else { return [:] }
        // A closed window's element answers nothing; forget it.
        if text(el, kAXRoleAttribute) == nil { watched = nil; return [:] }
        return describe(el, before: 0)
    case "front":
        return front()
    case "muted":
        return ["muted": try isMuted()]
    case "mute":
        try setMuted(true)
        return [:]
    case "unmute":
        try setMuted(false)
        return [:]
    case let cmd:
        throw HelperError(message: "unknown command \(cmd ?? "nil")")
    }
}

reply(["ready": true])

while let line = readLine() { // nil: the app closed our stdin, exit with it
    if line.trimmingCharacters(in: .whitespaces).isEmpty { continue }
    var id: Any = NSNull()
    do {
        guard let req = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any] else {
            throw HelperError(message: "not a JSON object")
        }
        id = req["id"] ?? NSNull()
        var out = try handle(req)
        out["id"] = id
        out["ok"] = true
        reply(out)
    } catch {
        reply(["id": id, "ok": false, "error": (error as? HelperError)?.message ?? "\(error)"])
    }
}
