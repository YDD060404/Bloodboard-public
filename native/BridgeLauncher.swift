// Bloodboard online-coach bridge launcher (V7 COACH-03).
// STATUS: IMPLEMENTED BUT UNVERIFIED. Written in the cloud, which cannot compile Swift or launch the Mac app.
// Compiled only when the app is built with BLOODBOARD_NATIVE_BRIDGE=1 (see build_mac_app.sh, -D BRIDGE); the default build is unchanged.
//
// Contract with online/bridge.mjs (this contract IS tested, with real child processes, in online/test/lifecycle.test.mjs):
//   node bridge.mjs serve --json --auto-port --exit-on-stdin-close --parent-pid <app pid> --dir <state dir>
//   stdout line:  BLOODBOARD_BRIDGE_READY {"version","port","pid","pairingCode",...}
//   The bridge exits by itself when this app exits or crashes (stdin pipe closes / parent pid disappears).
// The pairing code and port are handed to the page only (window.__bloodboardBridge); they are never written to disk or logs.
#if BRIDGE
import Foundation

final class BridgeLauncher {
    struct Ready { let port: Int; let pairingCode: String; let version: String }
    private(set) var process: Process?
    private var stdinPipe: Pipe?
    private var buffer = ""
    var onReady: ((Ready) -> Void)?
    var onStopped: ((String) -> Void)?

    /// Node >= 22.12 is required (the Luna route uses modern fetch/crypto). Looks in the usual Homebrew/nvm/system places.
    static func findNode() -> URL? {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        var candidates = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]
        let nvm = "\(home)/.nvm/versions/node"
        if let versions = try? FileManager.default.contentsOfDirectory(atPath: nvm) {
            candidates += versions.sorted().reversed().map { "\(nvm)/\($0)/bin/node" }
        }
        return candidates.first { FileManager.default.isExecutableFile(atPath: $0) }.map { URL(fileURLWithPath: $0) }
    }

    /// `bridgeScript` is Resources/online/bridge.mjs inside the app bundle.
    func start(bridgeScript: URL, stateDir: URL) -> String? {
        if process?.isRunning == true { return nil }
        guard let node = BridgeLauncher.findNode() else { return "Node.js 22.12 or newer was not found. Install it (for example `brew install node`), then choose Online coaches > Start bridge." }
        let p = Process()
        p.executableURL = node
        p.arguments = [bridgeScript.path, "serve", "--json", "--auto-port", "--exit-on-stdin-close",
                       "--parent-pid", String(ProcessInfo.processInfo.processIdentifier), "--dir", stateDir.path]
        let inPipe = Pipe(), outPipe = Pipe(), errPipe = Pipe()
        p.standardInput = inPipe; p.standardOutput = outPipe; p.standardError = errPipe
        outPipe.fileHandleForReading.readabilityHandler = { [weak self] h in
            let data = h.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async { self?.consume(text) }
        }
        errPipe.fileHandleForReading.readabilityHandler = { h in _ = h.availableData } // drained; bridge errors are content-free and not shown raw
        p.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async { self?.onStopped?(proc.terminationStatus == 3 ? "A bridge is already running for this folder." : "Bridge stopped (exit \(proc.terminationStatus)).") }
        }
        do { try p.run() } catch { return "Could not start the bridge: \(error.localizedDescription)" }
        process = p; stdinPipe = inPipe
        return nil
    }

    private func consume(_ text: String) {
        buffer += text
        while let nl = buffer.firstIndex(of: "\n") {
            let line = String(buffer[..<nl]); buffer = String(buffer[buffer.index(after: nl)...])
            let prefix = "BLOODBOARD_BRIDGE_READY "
            guard line.hasPrefix(prefix), let data = line.dropFirst(prefix.count).data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let port = obj["port"] as? Int, let code = obj["pairingCode"] as? String else { continue }
            onReady?(Ready(port: port, pairingCode: code, version: obj["version"] as? String ?? ""))
        }
    }

    func stop() {
        try? stdinPipe?.fileHandleForWriting.close()   // the bridge exits when stdin closes
        if process?.isRunning == true { process?.terminate() }
        process = nil; stdinPipe = nil
    }

    /// JavaScript that tells the page where the bridge is. The page auto-pairs once (src/ui/onlinecoaches.ts).
    static func injection(_ r: Ready) -> String {
        "window.__bloodboardBridge = {port: \(r.port), pairingCode: \"\(r.pairingCode)\", version: \"\(r.version)\"}; window.dispatchEvent(new Event('bloodboard-bridge'));"
    }
}
#endif
