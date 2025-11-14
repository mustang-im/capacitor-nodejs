import Foundation
import Capacitor

/**
 * CapacitorNodeJS - Main implementation class for Node.js runtime
 * Ported from Android CapacitorNodeJS.java
 */
class CapacitorNodeJS {

    private var packageInfo: [String: Any]?
    private let eventNotifier: PluginEventNotifier
    private let engineStatus = EngineStatus()
    private let nodeProcess: NodeProcess

    // Constants
    static let CHANNEL_NAME_APP = "APP_CHANNEL"
    static let CHANNEL_NAME_EVENT = "EVENT_CHANNEL"
    static let PREFS_TAG = "CapacitorNodeJS_PREFS"
    static let PREFS_APP_UPDATED_TIME = "AppUpdateTime"
    static let LOGGER_TAG = "CapacitorNodeJS"

    init(eventNotifier: PluginEventNotifier) {
        self.eventNotifier = eventNotifier
        self.nodeProcess = NodeProcess(receiveCallback: ReceiveCallbackImpl(parent: self))

        // Get app version info
        if let infoDictionary = Bundle.main.infoDictionary {
            self.packageInfo = [
                "version": infoDictionary["CFBundleShortVersionString"] as? String ?? "",
                "build": infoDictionary["CFBundleVersion"] as? String ?? ""
            ]
        }
    }

    /**
     * Engine status management
     */
    private class EngineStatus {
        private var whenEngineReadyListeners: [CAPPluginCall] = []
        private var isEngineStarted = false
        private var isEngineReady = false

        func setStarted() {
            isEngineStarted = true
        }

        func isStarted() -> Bool {
            return isEngineStarted
        }

        func setReady() {
            isEngineReady = true

            // Resolve all pending listeners
            while !whenEngineReadyListeners.isEmpty {
                let listener = whenEngineReadyListeners.removeFirst()
                listener.resolve()
            }
        }

        func isReady() -> Bool {
            return isEngineReady
        }

        func resolveWhenReady(_ call: CAPPluginCall) {
            if isReady() {
                call.resolve()
            } else {
                whenEngineReadyListeners.append(call)
            }
        }
    }

    /**
     * Start the Node.js engine
     */
    func startEngine(
        call: CAPPluginCall?,
        projectDir: String,
        mainFile: String?,
        args: [String],
        env: [String: String]
    ) {
        let callWrapper = CallWrapper(call: call)

        if engineStatus.isStarted() {
            callWrapper.reject("The Node.js engine has already been started.")
            return
        }
        engineStatus.setStarted()

        // Run engine startup in background thread
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }

            let fileManager = FileManager.default

            // Get app directories using modern URL-based APIs
            guard let cacheURL = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first,
                  let documentsURL = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first,
                  let bundleResourceURL = Bundle.main.resourceURL else {
                callWrapper.reject("Unable to access app directories.")
                return
            }

            let cachePath = cacheURL.path
            let documentsPath = documentsURL.path

            // Project path: Capacitor copies webDir contents to the bundle root
            // The nodeDir is a subdirectory within the bundle resources
            // Try both "nodejs-project" (common pattern) and configured "nodeDir" name
            let projectPath: String
            let nodejsProjectURL = bundleResourceURL.appendingPathComponent("nodejs-project")
            let configuredNodeDirURL = bundleResourceURL.appendingPathComponent(projectDir)

            if fileManager.fileExists(atPath: nodejsProjectURL.path) {
                projectPath = nodejsProjectURL.path
            } else if fileManager.fileExists(atPath: configuredNodeDirURL.path) {
                projectPath = configuredNodeDirURL.path
            } else {
                callWrapper.reject("Unable to find Node.js project directory. Checked: 'nodejs-project' and '\(projectDir)' in bundle resources.")
                return
            }

            // Builtin modules are in the plugin's assets directory
            // Try plugin bundle first, then main bundle
            let modulesPath: String
            if let pluginBundleURL = Bundle(for: type(of: self)).resourceURL,
               fileManager.fileExists(atPath: pluginBundleURL.appendingPathComponent("builtin_modules").path) {
                modulesPath = pluginBundleURL.appendingPathComponent("builtin_modules").path
            } else if fileManager.fileExists(atPath: bundleResourceURL.appendingPathComponent("builtin_modules").path) {
                modulesPath = bundleResourceURL.appendingPathComponent("builtin_modules").path
            } else {
                // Fallback: use project path as module path
                modulesPath = projectPath
            }

            // Data directory for persistent storage (in documents)
            let dataPath = documentsURL.appendingPathComponent("nodejs").appendingPathComponent("data").path

            // Create data directory for persistent storage
            guard FileOperations.createDir(dataPath) else {
                callWrapper.reject("Failed to create data directory: \(dataPath)")
                return
            }

            // Determine main file
            let projectPackageJsonURL = URL(fileURLWithPath: projectPath).appendingPathComponent("package.json")
            var projectMainFile = "index.js"

            if let mainFile = mainFile, !mainFile.isEmpty {
                projectMainFile = mainFile
            } else if fileManager.fileExists(atPath: projectPackageJsonURL.path) {
                do {
                    let packageJsonData = try Data(contentsOf: projectPackageJsonURL)
                    if let json = try JSONSerialization.jsonObject(with: packageJsonData) as? [String: Any],
                       let main = json["main"] as? String, !main.isEmpty {
                        projectMainFile = main
                    }
                } catch {
                    callWrapper.reject("Failed to read package.json: \(error.localizedDescription)", error)
                    return
                }
            }

            let projectMainURL = URL(fileURLWithPath: projectPath).appendingPathComponent(projectMainFile)

            guard fileManager.fileExists(atPath: projectMainURL.path) else {
                callWrapper.reject("Main script not found: \(projectMainURL.path)")
                return
            }

            let projectMainPath = projectMainURL.path

            // Combine module paths
            let modulesPaths = FileOperations.combineEnv(projectPath, modulesPath)

            // Prepare environment variables
            var nodeEnv: [String: String] = [
                "DATADIR": dataPath,
                "NODE_PATH": modulesPaths
            ]
            nodeEnv.merge(env) { _, new in new }

            // Start Node.js process
            self.nodeProcess.start(modulePath: projectMainPath, parameter: args, env: nodeEnv, cachePath: cachePath)

            callWrapper.resolve()
        }
    }

    func resolveWhenReady(_ call: CAPPluginCall) {
        if !engineStatus.isStarted() {
            call.reject("The Node.js engine has not been started yet.")
            return
        }

        engineStatus.resolveWhenReady(call)
    }

    func sendMessage(_ call: CAPPluginCall) {
        if !engineStatus.isStarted() {
            call.reject("The Node.js engine has not been started yet.")
            return
        }

        if !engineStatus.isReady() {
            call.reject("The Node.js engine is not ready yet.")
            return
        }

        guard let eventName = call.getString("eventName") else {
            call.reject("Required parameter 'eventName' was not specified.")
            return
        }

        let args = call.getArray("args") ?? []

        sendMessage(channelName: CapacitorNodeJS.CHANNEL_NAME_EVENT, eventName: eventName, args: args)

        call.resolve()
    }

    func sendMessage(channelName: String, eventName: String, args: JSArray) {
        guard !eventName.isEmpty else { return }

        // Create event message payload
        let eventMessage = args.toString() ?? "[]"

        let payload: [String: Any] = [
            "eventName": eventName,
            "eventMessage": eventMessage
        ]

        guard let channelMessage = try? JSONSerialization.data(withJSONObject: payload),
              let channelMessageString = String(data: channelMessage, encoding: .utf8) else {
            return
        }

        nodeProcess.send(channelName: channelName, message: channelMessageString)
    }

    /**
     * Receive message callback implementation
     */
    private class ReceiveCallbackImpl: NodeProcess.ReceiveCallback {
        weak var parent: CapacitorNodeJS?

        init(parent: CapacitorNodeJS) {
            self.parent = parent
        }

        func receive(channelName: String, message: String) {
            parent?.receiveMessage(channelName: channelName, channelMessage: message)
        }
    }

    private func receiveMessage(channelName: String, channelMessage: String) {
        guard let data = channelMessage.data(using: .utf8),
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let eventName = payload["eventName"] as? String,
              let eventMessage = payload["eventMessage"] as? String else {
            print("\(CapacitorNodeJS.LOGGER_TAG): Failed to deserialize received data from the Node.js process.")
            return
        }

        let args: JSArray = {
            guard !eventMessage.isEmpty,
                  let eventData = eventMessage.data(using: .utf8),
                  let eventArray = try? JSONSerialization.jsonObject(with: eventData) as? [Any] else {
                return JSArray()
            }
            return JSArray(eventArray)
        }()

        if channelName == CapacitorNodeJS.CHANNEL_NAME_APP && eventName == "ready" {
            engineStatus.setReady()
        } else if channelName == CapacitorNodeJS.CHANNEL_NAME_EVENT {
            eventNotifier.channelReceive(eventName: eventName, payloadArray: args)
        }
    }


    /**
     * Call wrapper helper
     */
    private class CallWrapper {
        weak var call: CAPPluginCall?

        init(call: CAPPluginCall?) {
            self.call = call
        }

        func resolve() {
            call?.resolve()
        }

        func reject(_ message: String) {
            call?.reject(message)
        }

        func reject(_ message: String, _ error: Error) {
            call?.reject(message, error)
        }
    }
}

/**
 * Plugin event notifier protocol
 */
protocol PluginEventNotifier {
    func channelReceive(eventName: String, payloadArray: JSArray)
}

