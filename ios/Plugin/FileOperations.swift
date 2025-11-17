import Foundation

/// File operations helper class with modern Swift patterns
enum FileOperations {
    private static let fileManager = FileManager.default

    /// Combine environment variable paths with colon separator (Unix PATH style)
    static func combineEnv(_ variables: String...) -> String {
        variables.filter { !$0.isEmpty }.joined(separator: ":")
    }

    /// Create directory with intermediate directories
    static func createDir(_ dirPath: String) -> Bool {
        let url = URL(fileURLWithPath: dirPath)
        var isDirectory: ObjCBool = false

        if fileManager.fileExists(atPath: dirPath, isDirectory: &isDirectory) {
            return isDirectory.boolValue
        }

        do {
            try fileManager.createDirectory(at: url, withIntermediateDirectories: true)
            return true
        } catch {
            print("Failed to create directory: \(dirPath), error: \(error)")
            return false
        }
    }
}

