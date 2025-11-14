import Foundation

/// NodeProcess handles the native Node.js process using NodeMobile framework
class NodeProcess {
    /// Callback protocol for receiving messages from Node.js
    protocol ReceiveCallback {
        func receive(channelName: String, message: String)
    }

    private let receiveCallback: ReceiveCallback

    init(receiveCallback: ReceiveCallback) {
        self.receiveCallback = receiveCallback
    }

    /// Start the Node.js process
    /// - Parameters:
    ///   - modulePath: Path to the main Node.js script
    ///   - parameter: Command line arguments
    ///   - env: Environment variables
    ///   - cachePath: Path for temporary files
    func start(modulePath: String, parameter: [String], env: [String: String], cachePath: String) {
        // Set TMPDIR environment variable
        setenv("TMPDIR", cachePath, 1)

        // Prepare arguments: ["node", modulePath, ...parameter]
        let arguments = ["node", modulePath] + parameter

        // Convert environment variables to C array format
        let envArray = env.map { "\($0.key)=\($0.value)" }

        // Start Node.js in a background thread
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.startNode(arguments: arguments, env: envArray)
        }
    }

    /// Start Node.js engine using NodeMobile framework
    /// Requires NodeMobile framework to be linked and node_start function available
    private func startNode(arguments: [String], env: [String]) {
        // Set environment variables
        for envVar in env {
            let components = envVar.split(separator: "=", maxSplits: 1)
            guard components.count == 2 else { continue }
            setenv(String(components[0]), String(components[1]), 1)
        }

        // Convert Swift strings to C strings
        let argc = Int32(arguments.count)
        var argv = arguments.map { strdup($0) }
        defer {
            argv.forEach { free($0) }
        }

        // Start Node.js engine
        // Note: This requires the NodeMobile framework to be linked
        // The node_start function should be declared in the bridging header
        node_start(argc, &argv)
    }

    /// Send a message to the Node.js process
    func send(channelName: String, message: String) {
        // Send message to Node.js via native bridge
        // The native_send function should be implemented in the native bridge
        native_send(channelName, message)
    }

    /// Called from native code when a message is received from Node.js
    /// This method should be called from the native bridge implementation
    @objc func nativeReceive(channelName: String, message: String) {
        receiveCallback.receive(channelName: channelName, message: message)
    }
}

// MARK: - NodeMobile Framework Functions
// These functions should be declared in the bridging header or imported from NodeMobile framework

/// Start Node.js runtime with command line arguments
/// - Parameters:
///   - argc: Argument count
///   - argv: Argument vector (array of C strings)
@_silgen_name("node_start")
private func node_start(_ argc: Int32, _ argv: UnsafeMutablePointer<UnsafeMutablePointer<Int8>?>?)

/// Send a message to Node.js process
/// - Parameters:
///   - channelName: Channel name for message routing
///   - message: Message content as C string
@_silgen_name("native_send")
private func native_send(_ channelName: UnsafePointer<Int8>, _ message: UnsafePointer<Int8>)

