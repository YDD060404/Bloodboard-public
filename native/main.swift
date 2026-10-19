// Bloodboard: Endgame Workshop — native macOS wrapper.
//
// A small AppKit shell around a WKWebView that shows the bundled interface
// (Contents/Resources/web/index.html). All game rules run in the bundled
// JavaScript engine; this file only provides the window, the menus and file
// storage:
//
//   * Positions, saved teams and lesson progress are JSON files in
//     ~/Library/Application Support/Bloodboard Endgame Workshop/{Positions,Teams,Progress}
//   * V5.5: the match set-up choices in .../Settings (kept across restarts); AI profiles (.json) and strategy
//     modules (.js) in ~/Library/Application Support/Bloodboard/AI — ONE folder shared with the Match Lab (docs/AI_FOLDER.md) — the app lists
//     and reads them, it never runs them natively.
//   * Import / Export use the standard macOS Open and Save panels.
//
// The page talks to this code through `window.webkit.messageHandlers.bloodboard`
// with messages {id, cmd, name?, json?, folder?}; every message is answered by calling
// `window.__bloodboardNativeReply(id, ok, payload)`.
//
// Build with build_mac_app.sh (needs the Xcode Command Line Tools). No network
// access, accounts or external services are used.

import Cocoa
import UniformTypeIdentifiers
import WebKit

private let appTitle = "Bloodboard Unified 0.2.0"
private let supportFolderName = "Bloodboard V6"
private let legacySupportFolderName = "Bloodboard Endgame Workshop"

/// Forwards script messages without the content controller retaining the app delegate.
final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
        super.init()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var closeConfirmed = false
#if BRIDGE
    // V7 COACH-03 (UNVERIFIED — never compiled in the cloud): the app starts and owns the online-coach bridge. See native/BridgeLauncher.swift.
    private let bridge = BridgeLauncher()
    private var bridgeInjection: String?
#endif

    private let positionsFolder: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support", isDirectory: true)
        return base
            .appendingPathComponent(supportFolderName, isDirectory: true)
            .appendingPathComponent("Positions", isDirectory: true)
    }()

    // MARK: - V5 data import

    /// V6 keeps its own data folder. On first launch, files the V5 app saved (positions, matches, teams, progress, settings, AI files)
    /// are COPIED into it; nothing is moved, replaced or deleted, and files already present in the V6 folder are never overwritten.
    private func importFromV5() {
        let fm = FileManager.default
        let base = positionsFolder.deletingLastPathComponent()
        let marker = base.appendingPathComponent(".imported-from-v5")
        if fm.fileExists(atPath: marker.path) { return }
        let old = base.deletingLastPathComponent().appendingPathComponent(legacySupportFolderName, isDirectory: true)
        guard fm.fileExists(atPath: old.path) else { return }
        var copied = 0
        for sub in ["Positions", "Teams", "Progress", "Settings"] {  // AI files live in the shared folder (Bloodboard/AI), not in a per-version copy
            let src = old.appendingPathComponent(sub, isDirectory: true)
            let dst = base.appendingPathComponent(sub, isDirectory: true)
            guard let names = try? fm.contentsOfDirectory(atPath: src.path) else { continue }
            try? fm.createDirectory(at: dst, withIntermediateDirectories: true)
            for n in names where !n.hasPrefix(".") {
                let to = dst.appendingPathComponent(n)
                if fm.fileExists(atPath: to.path) { continue }
                if (try? fm.copyItem(at: src.appendingPathComponent(n), to: to)) != nil { copied += 1 }
            }
        }
        fm.createFile(atPath: marker.path, contents: Data("Copied \(copied) items from the V5 data folder (originals untouched)\n".utf8))
    }

    // MARK: - Launch

    func applicationDidFinishLaunching(_ notification: Notification) {
        try? FileManager.default.createDirectory(at: positionsFolder, withIntermediateDirectories: true)
        importFromV5()
        installAIFolder()
        NSApp.mainMenu = buildMainMenu()

        let contentController = WKUserContentController()
        contentController.add(WeakScriptHandler(self), name: "bloodboard")
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = contentController

        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1440, height: 900), configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = appTitle
        window.minSize = NSSize(width: 1024, height: 680)
        window.contentView = webView
        window.delegate = self
        window.center()
        window.setFrameAutosaveName("BloodboardMainWindow")
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(webView)

        loadInterface()
        NSApp.activate(ignoringOtherApps: true)
#if BRIDGE
        startBridge()
#endif
    }

#if BRIDGE
    private func startBridge() {
        guard let script = Bundle.main.resourceURL?.appendingPathComponent("online/bridge.mjs"), FileManager.default.fileExists(atPath: script.path) else { return }
        let stateDir = (FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support", isDirectory: true))
            .appendingPathComponent("Bloodboard Online", isDirectory: true)
        bridge.onReady = { [weak self] ready in
            guard let self = self else { return }
            self.bridgeInjection = BridgeLauncher.injection(ready)
            self.webView?.evaluateJavaScript(self.bridgeInjection!, completionHandler: nil)
        }
        bridge.onStopped = { [weak self] _ in self?.bridgeInjection = nil }
        // A failure here is not fatal: the panel then shows the manual instructions (start the bridge yourself and enter the code).
        _ = bridge.start(bridgeScript: script, stateDir: stateDir)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let js = bridgeInjection { webView.evaluateJavaScript(js, completionHandler: nil) }
    }

    func applicationWillTerminate(_ notification: Notification) { bridge.stop() }
#endif

    private func loadInterface() {
        guard let webFolder = Bundle.main.resourceURL?.appendingPathComponent("web", isDirectory: true) else { return }
        let index = webFolder.appendingPathComponent("index.html")
        if FileManager.default.fileExists(atPath: index.path) {
            webView.loadFileURL(index, allowingReadAccessTo: webFolder)
        } else {
            let html = """
            <body style="font-family:-apple-system;padding:40px">
            <h2>The interface files are missing</h2>
            <p>Rebuild the app with <code>bash build_mac_app.sh</code> from the Bloodboard folder.</p>
            </body>
            """
            webView.loadHTMLString(html, baseURL: nil)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    // MARK: - Unsaved changes

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if closeConfirmed || webView == nil {
            return .terminateNow
        }
        confirmDiscardingChanges { proceed in
            if proceed {
                self.closeConfirmed = true
            }
            sender.reply(toApplicationShouldTerminate: proceed)
        }
        return .terminateLater
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if closeConfirmed {
            return true
        }
        confirmDiscardingChanges { proceed in
            if proceed {
                self.closeConfirmed = true
                sender.close()
            }
        }
        return false
    }

    /// Asks the page whether the current position has unsaved changes.
    private func confirmDiscardingChanges(_ done: @escaping (Bool) -> Void) {
        let script = "(function(){var a=window.bloodboard;return !!(a&&a.st&&a.st.dirty);})()"
        webView.evaluateJavaScript(script) { result, _ in
            let dirty = (result as? Bool) ?? false
            if !dirty {
                done(true)
                return
            }
            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = "Discard unsaved changes?"
            alert.informativeText = "The current position has changes that have not been saved. Choose Cancel and use File > Save to keep them."
            alert.addButton(withTitle: "Cancel")
            alert.addButton(withTitle: "Discard Changes")
            done(alert.runModal() == .alertSecondButtonReturn)
        }
    }

    // MARK: - Menus

    private func buildMainMenu() -> NSMenu {
        let mainMenu = NSMenu()

        // Application menu
        let appMenu = NSMenu(title: "Bloodboard")
        appMenu.addItem(withTitle: "About \(appTitle)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Hide Bloodboard", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = appMenu.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Quit Bloodboard", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        addSubmenu(appMenu, to: mainMenu)

        // File
        let fileMenu = NSMenu(title: "File")
        addCommand(fileMenu, "New Position", "new", "n")
        addCommand(fileMenu, "Open Saved Position…", "open", "o")
        addCommand(fileMenu, "Example Positions…", "examples", "")
        fileMenu.addItem(NSMenuItem.separator())
        addCommand(fileMenu, "Save", "save", "s")
        addCommand(fileMenu, "Save As…", "saveAs", "S")
        fileMenu.addItem(NSMenuItem.separator())
        addCommand(fileMenu, "Import Position File…", "import", "i")
        addCommand(fileMenu, "Export Position File…", "export", "e")
        let reveal = fileMenu.addItem(withTitle: "Show Positions Folder in Finder", action: #selector(revealPositionsFolder(_:)), keyEquivalent: "")
        reveal.target = self
        let revealAI = fileMenu.addItem(withTitle: "Show AI Folder in Finder", action: #selector(revealAIFolder(_:)), keyEquivalent: "")
        revealAI.target = self
        let chooseAI = fileMenu.addItem(withTitle: "Choose AI Folder…", action: #selector(chooseAIFolder(_:)), keyEquivalent: "")
        chooseAI.target = self
        fileMenu.addItem(NSMenuItem.separator())
        fileMenu.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        addSubmenu(fileMenu, to: mainMenu)

        // Edit (standard actions so copy and paste work in the text fields)
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        addSubmenu(editMenu, to: mainMenu)

        // View
        let viewMenu = NSMenu(title: "View")
        addCommand(viewMenu, "Show or Hide Tackle Zones", "toggleTZ", "")
        viewMenu.addItem(NSMenuItem.separator())
        let zoomIn = viewMenu.addItem(withTitle: "Zoom In", action: #selector(zoomIn(_:)), keyEquivalent: "+")
        zoomIn.target = self
        let zoomOut = viewMenu.addItem(withTitle: "Zoom Out", action: #selector(zoomOut(_:)), keyEquivalent: "-")
        zoomOut.target = self
        let actualSize = viewMenu.addItem(withTitle: "Actual Size", action: #selector(actualSize(_:)), keyEquivalent: "0")
        actualSize.target = self
        viewMenu.addItem(NSMenuItem.separator())
        let fullScreen = viewMenu.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullScreen.keyEquivalentModifierMask = [.command, .control]
        addSubmenu(viewMenu, to: mainMenu)

        // Window
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        addSubmenu(windowMenu, to: mainMenu)
        NSApp.windowsMenu = windowMenu

        // Help
        let helpMenu = NSMenu(title: "Help")
        addCommand(helpMenu, "Bloodboard Help", "help", "?")
        addSubmenu(helpMenu, to: mainMenu)
        NSApp.helpMenu = helpMenu

        return mainMenu
    }

    private func addSubmenu(_ submenu: NSMenu, to mainMenu: NSMenu) {
        let item = NSMenuItem(title: submenu.title, action: nil, keyEquivalent: "")
        item.submenu = submenu
        mainMenu.addItem(item)
    }

    private func addCommand(_ menu: NSMenu, _ title: String, _ command: String, _ key: String) {
        let item = NSMenuItem(title: title, action: #selector(menuCommand(_:)), keyEquivalent: key)
        item.target = self
        item.representedObject = command
        menu.addItem(item)
    }

    /// Menu commands are handled by the page (same code as its toolbar buttons).
    @objc private func menuCommand(_ sender: NSMenuItem) {
        guard let command = sender.representedObject as? String else { return }
        let script = "window.__bloodboardNativeMenu && window.__bloodboardNativeMenu('\(command)')"
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    /// V5.5: the AI folder. On the first launch of V5.5 the bundled AI files (Resources/web/ai/*.json, *.js) are put
    /// there once; afterwards the folder holds exactly what the user leaves in it (restoreAI puts missing ones back).
    /// The examples go to AI/Examples (not loaded) and a README.txt explains the folder.
    /// ONE AI folder shared with the Match Lab: ~/Library/Application Support/Bloodboard/AI (same resolution table as online/aidir.mjs):
    /// 1. BLOODBOARD_AI_DIR (absolute path), 2. Bloodboard/ai-location.json {"path": "..."} written by "Choose AI Folder…", 3. the canonical folder.
    /// There is no other fallback: a folder that cannot be created is reported, never replaced by a second copy.
    private var sharedSupportRoot: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support", isDirectory: true)
        return base.appendingPathComponent("Bloodboard", isDirectory: true)
    }

    private var aiFolder: URL {
        if let env = ProcessInfo.processInfo.environment["BLOODBOARD_AI_DIR"], env.hasPrefix("/") {
            return URL(fileURLWithPath: env, isDirectory: true)
        }
        let choice = sharedSupportRoot.appendingPathComponent("ai-location.json")
        if let data = try? Data(contentsOf: choice),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let path = obj["path"] as? String, path.hasPrefix("/") {
            return URL(fileURLWithPath: path, isDirectory: true)
        }
        return sharedSupportRoot.appendingPathComponent("AI", isDirectory: true)
    }

    /// Older version-specific AI folders (Application Support/Bloodboard*/AI, except the shared one and the credential folder) with the
    /// number of coach files (.js/.json) the shared folder does not have by name and that the last migration report does not mention.
    private func legacyAIReport() -> [[String: Any]] {
        let fm = FileManager.default
        let base = sharedSupportRoot.deletingLastPathComponent()
        guard let entries = try? fm.contentsOfDirectory(at: base, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]) else { return [] }
        let reportText = (try? String(contentsOf: aiFolder.appendingPathComponent(".migration/last-report.json"), encoding: .utf8)) ?? ""
        var out: [[String: Any]] = []
        for e in entries where e.lastPathComponent.hasPrefix("Bloodboard") && e.lastPathComponent != "Bloodboard" && e.lastPathComponent != "Bloodboard Online" {
            let ai = e.appendingPathComponent("AI", isDirectory: true)
            guard let files = try? fm.contentsOfDirectory(at: ai, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]) else { continue }
            let coaches = files.filter { ["js", "json"].contains($0.pathExtension.lowercased()) }
            let pending = coaches.filter { f in
                !fm.fileExists(atPath: aiFolder.appendingPathComponent(f.lastPathComponent).path) && !reportText.contains("\"\(f.lastPathComponent)\"")
            }.count
            if !coaches.isEmpty { out.append(["path": ai.path, "files": coaches.count, "pending": pending]) }
        }
        return out
    }

    /// The supported folder-selection flow: the choice is saved in Bloodboard/ai-location.json, which the Match Lab and the online-coach
    /// tools read as well, so all three keep using the same folder.
    @objc private func chooseAIFolder(_ sender: Any?) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.message = "Choose the ONE AI folder shared by Bloodboard and the Match Lab"
        panel.prompt = "Use This Folder"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        try? FileManager.default.createDirectory(at: sharedSupportRoot, withIntermediateDirectories: true)
        let info: [String: Any] = ["path": url.path, "chosenAt": ISO8601DateFormatter().string(from: Date()), "policy": 1]
        if let data = try? JSONSerialization.data(withJSONObject: info, options: [.prettyPrinted]) {
            try? data.write(to: sharedSupportRoot.appendingPathComponent("ai-location.json"))
        }
        installAIFolder()
        NSWorkspace.shared.activateFileViewerSelecting([aiFolder])
    }

    @discardableResult
    private func installAIFolder(restore: Bool = false) -> Int {
        let fm = FileManager.default
        let examples = aiFolder.appendingPathComponent("Examples", isDirectory: true)
        try? fm.createDirectory(at: examples, withIntermediateDirectories: true)
        guard let bundled = Bundle.main.resourceURL?.appendingPathComponent("web/ai", isDirectory: true) else { return 0 }
        let marker = aiFolder.appendingPathComponent(".bloodboard-v5.5-seeded")
        let seed = restore || !fm.fileExists(atPath: marker.path)
        var copied = 0
        if let files = try? fm.contentsOfDirectory(at: bundled, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]) {
            // bundled.js is the browser's copy of these files, not an AI file.
            for file in files where ["json", "js"].contains(file.pathExtension.lowercased()) && file.lastPathComponent != "bundled.js" && seed {
                let target = aiFolder.appendingPathComponent(file.lastPathComponent)
                if !fm.fileExists(atPath: target.path), (try? fm.copyItem(at: file, to: target)) != nil { copied += 1 }
            }
            let readme = bundled.appendingPathComponent("README.txt")
            let readmeTarget = aiFolder.appendingPathComponent("README.txt")
            if fm.fileExists(atPath: readme.path), !fm.fileExists(atPath: readmeTarget.path) { try? fm.copyItem(at: readme, to: readmeTarget) }
        }
        if let ex = try? fm.contentsOfDirectory(at: bundled.appendingPathComponent("examples", isDirectory: true), includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]) {
            for file in ex {
                let target = examples.appendingPathComponent(file.lastPathComponent)
                if !fm.fileExists(atPath: target.path) { try? fm.copyItem(at: file, to: target) }
            }
        }
        if seed { fm.createFile(atPath: marker.path, contents: Data("V5.5 bundled AI files installed\n".utf8)) }
        return copied
    }

    @objc private func revealAIFolder(_ sender: Any?) {
        installAIFolder()
        NSWorkspace.shared.activateFileViewerSelecting([aiFolder])
    }

    @objc private func revealPositionsFolder(_ sender: Any?) {
        try? FileManager.default.createDirectory(at: positionsFolder, withIntermediateDirectories: true)
        NSWorkspace.shared.activateFileViewerSelecting([positionsFolder])
    }

    @objc private func zoomIn(_ sender: Any?) {
        webView.pageZoom = min(webView.pageZoom + 0.1, 2.0)
    }

    @objc private func zoomOut(_ sender: Any?) {
        webView.pageZoom = max(webView.pageZoom - 0.1, 0.5)
    }

    @objc private func actualSize(_ sender: Any?) {
        webView.pageZoom = 1.0
    }

    // MARK: - Page <-> native bridge

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let command = body["cmd"] as? String else { return }
        let id = (body["id"] as? NSNumber)?.intValue ?? 0
        let name = body["name"] as? String ?? ""
        let json = body["json"] as? String ?? ""
        // "Positions" (default), "Teams" (saved League / Tournament teams) or "Progress" (lesson progress).
        let folder = storageFolder(body["folder"] as? String)
        do {
            switch command {
            case "list":
                let entries = try listPositions(in: folder)
                reply(id, true, entries)
            case "save":
                try savePosition(name: name, json: json, in: folder, exclusive: (body["exclusive"] as? Bool) ?? false)
                reply(id, true, NSNull())
            case "load":
                let text = try String(contentsOf: fileURL(for: name, in: folder), encoding: .utf8)
                reply(id, true, text)
            case "delete":
                // Moved to the Trash rather than deleted, so it can be recovered.
                try FileManager.default.trashItem(at: fileURL(for: name, in: folder), resultingItemURL: nil)
                reply(id, true, NSNull())
            case "export":
                exportPosition(id: id, suggestedName: name, json: json)
            case "import":
                importPosition(id: id)
            case "reveal":
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                NSWorkspace.shared.activateFileViewerSelecting([folder])
                reply(id, true, NSNull())
            case "listFiles":
                // V5.5: the AI folder — parameter files (.json) and strategy modules (.js), by file name.
                let files = try listFiles(in: folder)
                reply(id, true, files)
            case "loadFile":
                let url = try namedFile(name, in: folder)
                let text = try String(contentsOf: url, encoding: .utf8)
                reply(id, true, text)
            case "legacyAI":
                reply(id, true, legacyAIReport())
            case "restoreAI":
                reply(id, true, installAIFolder(restore: true))
            case "folderPath":
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                reply(id, true, folder.path)
            default:
                reply(id, false, "Unknown command: \(command)")
            }
        } catch {
            reply(id, false, error.localizedDescription)
        }
    }

    private func reply(_ id: Int, _ ok: Bool, _ payload: Any) {
        var literal = "null"
        let wrapped: [Any] = [payload]
        if JSONSerialization.isValidJSONObject(wrapped),
           let data = try? JSONSerialization.data(withJSONObject: wrapped, options: []),
           let text = String(data: data, encoding: .utf8) {
            literal = "(\(text))[0]"
        }
        let script = "window.__bloodboardNativeReply && window.__bloodboardNativeReply(\(id), \(ok ? "true" : "false"), \(literal));"
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    // MARK: - Position files

    private func safeFileName(_ name: String) -> String {
        let forbidden = CharacterSet(charactersIn: "/\\:?%*|\"<>").union(.controlCharacters).union(.newlines)
        var clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
            .components(separatedBy: forbidden)
            .joined(separator: "-")
        while clean.hasPrefix(".") {
            clean.removeFirst()
        }
        if clean.isEmpty {
            clean = "Untitled position"
        }
        if clean.count > 120 {
            clean = String(clean.prefix(120))
        }
        return clean
    }

    /// Only these sub-folders of the support folder can be used by the page.
    private func storageFolder(_ requested: String?) -> URL {
        // V5.5: "Settings" (the match set-up choices, kept across restarts) and "AI" (AI profiles and strategy modules).
        let allowed = ["Positions", "Teams", "Progress", "Settings", "AI"]
        let name = allowed.contains(requested ?? "") ? requested! : "Positions"
        if name == "AI" { return aiFolder }
        return positionsFolder.deletingLastPathComponent().appendingPathComponent(name, isDirectory: true)
    }

    private func fileURL(for name: String, in folder: URL) -> URL {
        return folder.appendingPathComponent(safeFileName(name)).appendingPathExtension("json")
    }

    private func listPositions(in folder: URL) throws -> [[String: Any]] {
        let fm = FileManager.default
        try fm.createDirectory(at: folder, withIntermediateDirectories: true)
        let urls = try fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.contentModificationDateKey], options: [.skipsHiddenFiles])
        let iso = ISO8601DateFormatter()
        var entries: [[String: Any]] = []
        for url in urls where url.pathExtension.lowercased() == "json" {
            var entry: [String: Any] = ["name": url.deletingPathExtension().lastPathComponent]
            let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? Date()
            entry["savedAt"] = iso.string(from: modified)
            if let data = try? Data(contentsOf: url),
               let object = try? JSONSerialization.jsonObject(with: data, options: []),
               let dict = object as? [String: Any] {
                if let savedAt = dict["savedAt"] as? String { entry["savedAt"] = savedAt }
                if let notes = dict["notes"] as? String { entry["notes"] = notes }
            }
            entries.append(entry)
        }
        entries.sort { ($0["savedAt"] as? String ?? "") > ($1["savedAt"] as? String ?? "") }
        return entries
    }

    /// V5.5: every .json / .js file of a folder (the AI folder), by file name.
    private func listFiles(in folder: URL) throws -> [[String: Any]] {
        let fm = FileManager.default
        try fm.createDirectory(at: folder, withIntermediateDirectories: true)
        let urls = try fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.contentModificationDateKey], options: [.skipsHiddenFiles])
        let iso = ISO8601DateFormatter()
        var entries: [[String: Any]] = []
        for url in urls where ["json", "js"].contains(url.pathExtension.lowercased()) {
            let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? Date()
            entries.append(["name": url.lastPathComponent, "savedAt": iso.string(from: modified)])
        }
        entries.sort { ($0["name"] as? String ?? "") < ($1["name"] as? String ?? "") }
        return entries
    }

    /// A file of `folder` named exactly `name` (.json or .js, no path separators).
    private func namedFile(_ name: String, in folder: URL) throws -> URL {
        let ext = (name as NSString).pathExtension.lowercased()
        guard !name.contains("/"), !name.contains("\\"), !name.hasPrefix("."), ["json", "js"].contains(ext) else {
            throw NSError(domain: "Bloodboard", code: 1, userInfo: [NSLocalizedDescriptionKey: "Not a .json or .js file name: \(name)"])
        }
        return folder.appendingPathComponent(name)
    }

    /// V6: `exclusive` creates the file only if no file of that name exists (atomic: the data is written to a temporary
    /// file and hard-linked to the final name, which fails with EEXIST if the name is taken — even against a concurrent save).
    private func savePosition(name: String, json: String, in folder: URL, exclusive: Bool = false) throws {
        let fm = FileManager.default
        try fm.createDirectory(at: folder, withIntermediateDirectories: true)
        let target = fileURL(for: name, in: folder)
        if !exclusive {
            try Data(json.utf8).write(to: target, options: .atomic)
            return
        }
        let temp = folder.appendingPathComponent(".new-\(UUID().uuidString).tmp")
        try Data(json.utf8).write(to: temp, options: .atomic)
        defer { try? fm.removeItem(at: temp) }
        if link(temp.path, target.path) != 0 {
            let code = errno
            let text = code == EEXIST ? "exists" : String(cString: strerror(code))
            throw NSError(domain: "Bloodboard", code: Int(code), userInfo: [NSLocalizedDescriptionKey: text])
        }
    }

    private func exportPosition(id: Int, suggestedName: String, json: String) {
        let panel = NSSavePanel()
        panel.title = "Export Position"
        panel.nameFieldStringValue = suggestedName.lowercased().hasSuffix(".json") ? suggestedName : suggestedName + ".json"
        panel.allowedContentTypes = [UTType.json]
        panel.canCreateDirectories = true
        panel.beginSheetModal(for: window) { response in
            guard response == .OK, let url = panel.url else {
                self.reply(id, true, false)
                return
            }
            do {
                try Data(json.utf8).write(to: url, options: .atomic)
                self.reply(id, true, true)
            } catch {
                self.reply(id, false, error.localizedDescription)
            }
        }
    }

    private func importPosition(id: Int) {
        let panel = NSOpenPanel()
        panel.title = "Import Position"
        panel.allowedContentTypes = [UTType.json]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.beginSheetModal(for: window) { response in
            guard response == .OK, let url = panel.url else {
                self.reply(id, true, NSNull())
                return
            }
            do {
                let text = try String(contentsOf: url, encoding: .utf8)
                self.reply(id, true, text)
            } catch {
                self.reply(id, false, error.localizedDescription)
            }
        }
    }

    // MARK: - Web view behaviour

    /// Links to web pages open in the default browser, never inside the app.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url, let scheme = url.scheme?.lowercased(), ["http", "https", "mailto"].contains(scheme) {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.runModal()
        completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    /// If the page's process ends unexpectedly, reload the interface instead of showing a blank window.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        loadInterface()
    }
}

let application = NSApplication.shared
let appDelegate = AppDelegate()
application.delegate = appDelegate
application.setActivationPolicy(.regular)
application.run()
