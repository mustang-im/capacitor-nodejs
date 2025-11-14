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
public class NodeJSPlugin: CAPPlugin {

    private lazy var eventNotifier: PluginEventNotifier = PluginEventNotifierImpl(plugin: self)
    private var implementation: CapacitorNodeJS?

    public override func load() {
        implementation = CapacitorNodeJS(eventNotifier: eventNotifier)

        let pluginSettings = readPluginSettings()
        if pluginSettings.startMode == "auto" {
            implementation?.startEngine(
                call: nil,
                projectDir: pluginSettings.nodeDir,
                mainFile: nil,
                args: [],
                env: [:]
            )
        }
    }

    /// Plugin settings from Capacitor config
    private struct PluginSettings {
        let nodeDir: String
        let startMode: String
    }

    private func readPluginSettings() -> PluginSettings {
        let config = getConfig()
        return PluginSettings(
            nodeDir: config.getString("nodeDir") ?? "nodejs",
            startMode: config.getString("startMode") ?? "auto"
        )
    }

    public override func handleOnResume() {
        super.handleOnResume()
        let args = JSArray()
        implementation?.sendMessage(
            channelName: CapacitorNodeJS.CHANNEL_NAME_APP,
            eventName: "resume",
            args: args
        )
    }

    public override func handleOnPause() {
        super.handleOnPause()
        let args = JSArray()
        implementation?.sendMessage(
            channelName: CapacitorNodeJS.CHANNEL_NAME_APP,
            eventName: "pause",
            args: args
        )
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
            return (0..<args.length()).compactMap { args.getString($0) }
        }()

        let envMap: [String: String] = {
            guard let env = nodeEnv else { return [:] }
            var result: [String: String] = [:]
            for key in env.keys() {
                guard let keyString = key as? String,
                      let value = env.getString(keyString) else { continue }
                result[keyString] = value
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
            let args = JSObject()
            args.set("args", payloadArray)
            plugin.notifyListeners(eventName, data: args)
        }
    }
}
