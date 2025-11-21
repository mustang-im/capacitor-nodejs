import Foundation
import Capacitor

/**
 * CapacitorNodeJS - Main implementation class for Node.js runtime
 * Ported from Android CapacitorNodeJS.java
 */
class CapacitorNodeJS {

    private let eventNotifier: PluginEventNotifier
    private let engineStatus = EngineStatus()
    private let nodeProcess: NodeProcess

    // Constants
    static let CHANNEL_NAME_APP = "APP_CHANNEL"
    static let CHANNEL_NAME_EVENT = "EVENT_CHANNEL"
    static let LOGGER_TAG = "CapacitorNodeJS"

    init(eventNotifier: PluginEventNotifier) {
        self.eventNotifier = eventNotifier
        // Initialize nodeProcess after all stored properties are set
        let callback = ReceiveCallbackImpl()
        self.nodeProcess = NodeProcess(receiveCallback: callback)
        // Set parent reference after initialization
        callback.parent = self
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

        // Run engine startup in background thread to avoid blocking UI
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

            // Project path: Capacitor copies webDir contents to "public" folder in bundle
            // The nodeDir is a subdirectory within public (e.g., public/nodejs)
            // Try both "public/nodejs" (where Capacitor copies it) and "nodejs" (fallback)
            let projectPath: String
            let publicNodeDirURL = bundleResourceURL.appendingPathComponent("public").appendingPathComponent(projectDir)
            let directNodeDirURL = bundleResourceURL.appendingPathComponent(projectDir)

            if fileManager.fileExists(atPath: publicNodeDirURL.path) {
                projectPath = publicNodeDirURL.path
            } else if fileManager.fileExists(atPath: directNodeDirURL.path) {
                projectPath = directNodeDirURL.path
            } else {
                callWrapper.reject("Unable to find Node.js project directory. Checked: 'public/\(projectDir)' at \(publicNodeDirURL.path) and '\(projectDir)' at \(directNodeDirURL.path).")
                return
            }

            // Builtin modules are in the plugin's assets directory
            // Try plugin bundle first, then main bundle
            let modulesPath: String
            if let pluginBundleURL = Bundle(for: CapacitorNodeJS.self).resourceURL,
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

            let projectMainPath = projectMainURL.path

            guard fileManager.fileExists(atPath: projectMainPath) else {
                callWrapper.reject("Main script not found: \(projectMainPath)")
                return
            }

            // Check if dlopen override preload script exists
            let dlopenOverridePath = URL(fileURLWithPath: projectPath).appendingPathComponent("override-dlopen-paths-preload.js").path
            let hasDlopenOverride = fileManager.fileExists(atPath: dlopenOverridePath)

            // Combine module paths
            let modulesPaths = FileOperations.combineEnv(projectPath, modulesPath)

            // Prepare environment variables
            var nodeEnv: [String: String] = [
                "DATADIR": dataPath,
                "NODE_PATH": modulesPaths
            ]
            nodeEnv.merge(env) { _, new in new }

            // Prepare arguments: if dlopen override exists, preload it with -r flag before the main script
            var nodeArgs: [String]
            if hasDlopenOverride {
                // Preload the dlopen override script: ["-r", "preload-script.js", "main-script.js", ...args]
                nodeArgs = ["-r", dlopenOverridePath, projectMainPath] + args
                print("\(CapacitorNodeJS.LOGGER_TAG): Using dlopen override preload: \(dlopenOverridePath)")
                NSLog("\(CapacitorNodeJS.LOGGER_TAG): Using dlopen override preload: \(dlopenOverridePath)")
            } else {
                // No preload, just pass main script and args
                nodeArgs = [projectMainPath] + args
            }

            // Start Node.js process
            print("\(CapacitorNodeJS.LOGGER_TAG): Starting Node.js with main file: \(projectMainPath)")
            NSLog("\(CapacitorNodeJS.LOGGER_TAG): Starting Node.js with main file: \(projectMainPath)")
            // Pass empty string as modulePath since we're handling it in nodeArgs
            self.nodeProcess.start(modulePath: "", parameter: nodeArgs, env: nodeEnv, cachePath: cachePath)

            print("\(CapacitorNodeJS.LOGGER_TAG): Node.js process started successfully")
            NSLog("\(CapacitorNodeJS.LOGGER_TAG): Node.js process started successfully")
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

        // Create event message payload - serialize JSArray to JSON string
        let eventMessage: String
        if let jsonData = try? JSONSerialization.data(withJSONObject: args),
           let jsonString = String(data: jsonData, encoding: .utf8) {
            eventMessage = jsonString
        } else {
            eventMessage = "[]"
        }

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

        init() {
            // Parent will be set after CapacitorNodeJS initialization
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

        var args = JSArray()
        if !eventMessage.isEmpty,
           let eventData = eventMessage.data(using: .utf8),
           let eventArray = try? JSONSerialization.jsonObject(with: eventData) as? [Any] {
            for item in eventArray {
                if let stringValue = item as? String {
                    args.append(stringValue)
                } else if let numberValue = item as? NSNumber {
                    args.append(numberValue)
                } else if let boolValue = item as? Bool {
                    args.append(boolValue)
                } else if let dictValue = item as? [String: Any] {
                    var jsObject = JSObject()
                    for (key, value) in dictValue {
                        if let stringVal = value as? String {
                            jsObject[key] = stringVal
                        } else if let numVal = value as? NSNumber {
                            jsObject[key] = numVal
                        } else if let boolVal = value as? Bool {
                            jsObject[key] = boolVal
                        }
                    }
                    args.append(jsObject)
                } else if let arrayValue = item as? [Any] {
                    var nestedArray = JSArray()
                    for nestedItem in arrayValue {
                        if let stringVal = nestedItem as? String {
                            nestedArray.append(stringVal)
                        } else if let numVal = nestedItem as? NSNumber {
                            nestedArray.append(numVal)
                        } else if let boolVal = nestedItem as? Bool {
                            nestedArray.append(boolVal)
                        }
                    }
                    args.append(nestedArray)
                }
            }
        }

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
            if let call = call {
                call.reject(message)
            } else {
                // Log error when call is nil (auto-start mode)
                print("\(CapacitorNodeJS.LOGGER_TAG): ERROR - \(message)")
                NSLog("\(CapacitorNodeJS.LOGGER_TAG): ERROR - \(message)")
            }
        }

        func reject(_ message: String, _ error: Error) {
            if let call = call {
                call.reject(message, error.localizedDescription)
            } else {
                // Log error when call is nil (auto-start mode)
                let errorMessage = "\(message): \(error.localizedDescription)"
                print("\(CapacitorNodeJS.LOGGER_TAG): ERROR - \(errorMessage)")
                NSLog("\(CapacitorNodeJS.LOGGER_TAG): ERROR - \(errorMessage)")
            }
        }
    }
}

/**
 * Plugin event notifier protocol
 */
protocol PluginEventNotifier {
    func channelReceive(eventName: String, payloadArray: JSArray)
}
