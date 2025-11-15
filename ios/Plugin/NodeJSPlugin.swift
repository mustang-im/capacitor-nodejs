import Foundation
import Capacitor

/**
 * Capacitor NodeJS Plugin
 * Ported from Android CapacitorNodeJSPlugin.java
 *
 * Please read the Capacitor iOS Plugin Development Guide
 * here: https://capacitorjs.com/docs/plugins/ios
 */
@objc(NodeJSPlugin)
public class NodeJSPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NodeJSPlugin"
    public let jsName = "NodeJS"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "whenReady", returnType: CAPPluginReturnPromise)
    ]

    private lazy var eventNotifier: PluginEventNotifier = PluginEventNotifierImpl(plugin: self)
    private var implementation: CapacitorNodeJS?

    /// Plugin settings from Capacitor config
    private struct PluginSettings {
        let nodeDir: String
        let startMode: String
    }

    private func readPluginSettings() -> PluginSettings {
        let config = getConfig()
        let nodeDir = config.getString("nodeDir") ?? "nodejs"
        let startMode = config.getString("startMode") ?? "auto"
        print("NodeJSPlugin: Reading config - nodeDir: '\(nodeDir)', startMode: '\(startMode)'")
        NSLog("NodeJSPlugin: Reading config - nodeDir: '\(nodeDir)', startMode: '\(startMode)'")
        return PluginSettings(
            nodeDir: nodeDir,
            startMode: startMode
        )
    }

    public override func load() {
        super.load()
        print("NodeJSPlugin: load() called")
        NSLog("NodeJSPlugin: load() called")

        implementation = CapacitorNodeJS(eventNotifier: eventNotifier)

        let pluginSettings = readPluginSettings()
        print("NodeJSPlugin: Settings - nodeDir: \(pluginSettings.nodeDir), startMode: \(pluginSettings.startMode)")
        NSLog("NodeJSPlugin: Settings - nodeDir: \(pluginSettings.nodeDir), startMode: \(pluginSettings.startMode)")

        if pluginSettings.startMode == "auto" {
            print("NodeJSPlugin: Auto-start enabled, calling startEngine...")
            NSLog("NodeJSPlugin: Auto-start enabled, calling startEngine...")
            implementation?.startEngine(
                call: nil,
                projectDir: pluginSettings.nodeDir,
                mainFile: nil,
                args: [],
                env: [:]
            )
        } else {
            print("NodeJSPlugin: Auto-start disabled (startMode: \(pluginSettings.startMode))")
            NSLog("NodeJSPlugin: Auto-start disabled (startMode: \(pluginSettings.startMode))")
        }

        // Listen to app lifecycle notifications
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(applicationWillEnterForeground),
            name: UIApplication.willEnterForegroundNotification,
            object: nil
        )

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(applicationDidEnterBackground),
            name: UIApplication.didEnterBackgroundNotification,
            object: nil
        )
    }

    @objc private func applicationWillEnterForeground() {
        let args = JSArray()
        implementation?.sendMessage(
            channelName: CapacitorNodeJS.CHANNEL_NAME_APP,
            eventName: "resume",
            args: args
        )
    }

    @objc private func applicationDidEnterBackground() {
        let args = JSArray()
        implementation?.sendMessage(
            channelName: CapacitorNodeJS.CHANNEL_NAME_APP,
            eventName: "pause",
            args: args
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    // MARK: - Plugin Methods

    @objc func start(_ call: CAPPluginCall) {
        let pluginSettings = readPluginSettings()

        if pluginSettings.startMode != "manual" {
            call.reject("Manual startup of the Node.js engine is not enabled.")
            return
        }

        let projectDir = call.getString("nodeDir") ?? pluginSettings.nodeDir
        let nodeMain = call.getString("script")
        let nodeArgs = call.getArray("args")
        let nodeEnv = call.getObject("env")

        let argsArray: [String] = {
            guard let args = nodeArgs else { return [] }
            return args.compactMap { $0 as? String }
        }()

        let envMap: [String: String] = {
            guard let env = nodeEnv else { return [:] }
            var result: [String: String] = [:]
            for (key, value) in env {
                guard let keyString = key as? String,
                      let valueString = value as? String else { continue }
                result[keyString] = valueString
            }
            return result
        }()

        implementation?.startEngine(
            call: call,
            projectDir: projectDir,
            mainFile: nodeMain,
            args: argsArray,
            env: envMap
        )
    }

    @objc func send(_ call: CAPPluginCall) {
        implementation?.sendMessage(call)
    }

    @objc func whenReady(_ call: CAPPluginCall) {
        implementation?.resolveWhenReady(call)
    }

    // MARK: - Plugin Event Notifier

    private class PluginEventNotifierImpl: PluginEventNotifier {
        weak var plugin: NodeJSPlugin?

        init(plugin: NodeJSPlugin) {
            self.plugin = plugin
        }

        func channelReceive(eventName: String, payloadArray: JSArray) {
            guard let plugin = plugin else { return }

            // Notify Capacitor listeners
            var args = JSObject()
            args["args"] = payloadArray
            plugin.notifyListeners(eventName, data: args)
        }
    }
}
