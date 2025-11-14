import Foundation

/// File operations helper class with modern Swift patterns
enum FileOperations {
    private static let fileManager = FileManager.default

    /// Check if a path exists
    static func existsPath(_ path: String) -> Bool {
        fileManager.fileExists(atPath: path)
    }

    /// Combine multiple path components into a single path
    static func combinePath(_ paths: String...) -> String {
        guard let first = paths.first else { return "" }
        let baseURL = URL(fileURLWithPath: first)
        return paths.dropFirst().reduce(baseURL) { $0.appendingPathComponent($1) }.path
    }

    /// Combine environment variable paths with colon separator (Unix PATH style)
    static func combineEnv(_ variables: String...) -> String {
        variables.filter { !$0.isEmpty }.joined(separator: ":")
    }

    /// Read file contents as UTF-8 string
    static func readFileFromPath(_ path: String) throws -> String {
        try String(contentsOf: URL(fileURLWithPath: path), encoding: .utf8)
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

    /// Delete directory
    static func deleteDir(_ dirPath: String) -> Bool {
        let url = URL(fileURLWithPath: dirPath)

        do {
            try fileManager.removeItem(at: url)
            return true
        } catch {
            print("Failed to delete directory: \(dirPath), error: \(error)")
            return false
        }
    }

    /// Copy asset directory from bundle to destination
    static func copyAssetDir(bundle: Bundle, assetPath: String, destinationPath: String) -> Bool {
        guard let resourceURL = bundle.resourceURL else { return false }

        let sourceURL = resourceURL.appendingPathComponent(assetPath)
        let destinationURL = URL(fileURLWithPath: destinationPath)

        var isDirectory: ObjCBool = false
        guard fileManager.fileExists(atPath: sourceURL.path, isDirectory: &isDirectory),
              isDirectory.boolValue else {
            return false
        }

        do {
            try fileManager.createDirectory(at: destinationURL.deletingLastPathComponent(), withIntermediateDirectories: true)

            if fileManager.fileExists(atPath: destinationURL.path) {
                try fileManager.removeItem(at: destinationURL)
            }

            try fileManager.copyItem(at: sourceURL, to: destinationURL)
            return true
        } catch {
            print("Failed to copy asset from '\(assetPath)' to '\(destinationPath)'. Error: \(error)")
            return false
        }
    }

    /// Copy asset file from bundle to destination
    static func copyAsset(bundle: Bundle, assetPath: String, destinationPath: String) -> Bool {
        guard let resourceURL = bundle.resourceURL else { return false }

        let sourceURL = resourceURL.appendingPathComponent(assetPath)
        let destinationURL = URL(fileURLWithPath: destinationPath)

        do {
            try fileManager.createDirectory(at: destinationURL.deletingLastPathComponent(), withIntermediateDirectories: true)

            if fileManager.fileExists(atPath: destinationURL.path) {
                try fileManager.removeItem(at: destinationURL)
            }

            try fileManager.copyItem(at: sourceURL, to: destinationURL)
            return true
        } catch {
            print("Failed to copy asset '\(assetPath)' to '\(destinationPath)'. Error: \(error)")
            return false
        }
    }
}

