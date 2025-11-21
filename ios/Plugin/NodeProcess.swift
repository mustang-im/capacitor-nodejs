import Foundation
import NodeMobile

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
    ///   - modulePath: Path to the main Node.js script (or empty if parameter contains full args)
    ///   - parameter: Command line arguments (if modulePath is empty, should start with script path or -r flag)
    ///   - env: Environment variables
    ///   - cachePath: Path for temporary files
    func start(modulePath: String, parameter: [String], env: [String: String], cachePath: String) {
        // Set TMPDIR environment variable
        setenv("TMPDIR", cachePath, 1)

        // Prepare arguments
        let arguments: [String]
        if modulePath.isEmpty {
            // Full argument list provided (e.g., when using -r preload)
            arguments = ["node"] + parameter
        } else {
            // Standard: ["node", modulePath, ...parameter]
            arguments = ["node", modulePath] + parameter
        }

        // Convert environment variables to C array format
        let envArray = env.map { "\($0.key)=\($0.value)" }

        // Start Node.js directly (already called from background thread)
        print("NodeProcess: Starting Node.js with arguments: \(arguments)")
        startNode(arguments: arguments, env: envArray)
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
        var cStrings = arguments.map { strdup($0) }
        defer {
            cStrings.forEach { free($0) }
        }

        // Allocate array of pointers
        let argv = UnsafeMutablePointer<UnsafeMutablePointer<Int8>?>.allocate(capacity: Int(argc))
        defer {
            argv.deallocate()
        }

        // Copy pointers to the array
        for (index, cString) in cStrings.enumerated() {
            argv[index] = cString
        }

        // Start Node.js engine
        // Note: This requires the NodeMobile framework to be linked
        // The node_start function should be declared in the bridging header
        print("NodeProcess: Calling node_start(\(argc), ...)")
        node_start(argc, argv)
        print("NodeProcess: node_start returned")
    }

    /// Send a message to the Node.js process
    /// Note: Message sending functionality is not yet implemented
    func send(channelName: String, message: String) {
        // TODO: Implement message sending to Node.js process
        // This requires implementing the native bridge for message passing
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
