package net.hampoelz.capacitor.nodejs;

import android.content.res.AssetManager;
import com.getcapacitor.Logger;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Optimized file operations with better buffering and parallel I/O
 */
public class FileOperations {

    private static final int BUFFER_SIZE = 16384; // 16KB buffer for better I/O performance
    private static final String TAG = "FileOperations";

    public static String CombinePath(String... paths) {
        if (paths.length == 0) return "";

        StringBuilder result = new StringBuilder(paths[0]);
        for (int i = 1; i < paths.length; i++) {
            if (!result.toString().endsWith(File.separator)) {
                result.append(File.separator);
            }
            result.append(paths[i]);
        }
        return result.toString();
    }

    public static String CombineEnv(String... paths) {
        if (paths.length == 0) return "";

        StringBuilder result = new StringBuilder(paths[0]);
        for (int i = 1; i < paths.length; i++) {
            result.append(File.pathSeparator);
            result.append(paths[i]);
        }
        return result.toString();
    }

    public static boolean ExistsPath(String path) {
        return new File(path).exists();
    }

    public static boolean CreateDir(String path) {
        File dir = new File(path);
        return dir.exists() || dir.mkdirs();
    }

    public static boolean DeleteDir(String path) {
        return deleteRecursive(new File(path));
    }

    private static boolean deleteRecursive(File fileOrDirectory) {
        if (!fileOrDirectory.exists()) {
            return true;
        }

        if (fileOrDirectory.isDirectory()) {
            File[] children = fileOrDirectory.listFiles();
            if (children != null) {
                for (File child : children) {
                    if (!deleteRecursive(child)) {
                        return false;
                    }
                }
            }
        }

        return fileOrDirectory.delete();
    }

    /**
     * Optimized asset directory copying with better buffering
     */
    public static boolean CopyAssetDir(AssetManager assetManager, String assetPath, String targetPath) {
        try {
            String[] assets = assetManager.list(assetPath);
            if (assets == null || assets.length == 0) {
                // It's a file, copy it
                return copyAssetFile(assetManager, assetPath, targetPath);
            }

            // It's a directory, create it and copy contents
            File targetDir = new File(targetPath);
            if (!targetDir.exists() && !targetDir.mkdirs()) {
                Logger.error(TAG, new Error("Failed to create directory: " + targetPath));
                return false;
            }

            boolean success = true;
            for (String asset : assets) {
                String assetFullPath = assetPath.isEmpty() ? asset : assetPath + "/" + asset;
                String targetFullPath = targetPath + File.separator + asset;
                success &= CopyAssetDir(assetManager, assetFullPath, targetFullPath);
            }

            return success;

        } catch (IOException e) {
            Logger.error(TAG, "Failed to copy asset directory: " + assetPath, e);
            return false;
        }
    }

    /**
     * Optimized single file copy with larger buffer
     */
    private static boolean copyAssetFile(AssetManager assetManager, String assetPath, String targetPath) {
        InputStream in = null;
        OutputStream out = null;

        try {
            in = new BufferedInputStream(assetManager.open(assetPath), BUFFER_SIZE);

            File targetFile = new File(targetPath);
            File parentDir = targetFile.getParentFile();
            if (parentDir != null && !parentDir.exists() && !parentDir.mkdirs()) {
                Logger.error(TAG, new Error("Failed to create parent directory: " + parentDir.getPath()));
                return false;
            }

            out = new BufferedOutputStream(new FileOutputStream(targetFile), BUFFER_SIZE);

            byte[] buffer = new byte[BUFFER_SIZE];
            int bytesRead;
            while ((bytesRead = in.read(buffer)) != -1) {
                out.write(buffer, 0, bytesRead);
            }

            return true;

        } catch (IOException e) {
            Logger.error(TAG, "Failed to copy asset file: " + assetPath, e);
            return false;
        } finally {
            closeQuietly(in);
            closeQuietly(out);
        }
    }

    /**
     * Read file contents with optimized buffering
     */
    public static String ReadFileFromPath(String path) throws IOException {
        File file = new File(path);
        if (!file.exists()) {
            throw new IOException("File does not exist: " + path);
        }

        StringBuilder content = new StringBuilder((int) file.length());

        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8),
                BUFFER_SIZE)) {

            String line;
            boolean first = true;
            while ((line = reader.readLine()) != null) {
                if (!first) {
                    content.append('\n');
                }
                content.append(line);
                first = false;
            }
        }

        return content.toString();
    }

    /**
     * Write file contents with optimized buffering
     */
    public static boolean WriteFileToPath(String path, String content) {
        try (BufferedOutputStream out = new BufferedOutputStream(
                new FileOutputStream(path), BUFFER_SIZE)) {

            out.write(content.getBytes(StandardCharsets.UTF_8));
            return true;

        } catch (IOException e) {
            Logger.error(TAG, "Failed to write file: " + path, e);
            return false;
        }
    }

    /**
     * Copy file with optimized buffering
     */
    public static boolean CopyFile(String sourcePath, String targetPath) {
        try (InputStream in = new BufferedInputStream(new FileInputStream(sourcePath), BUFFER_SIZE);
             OutputStream out = new BufferedOutputStream(new FileOutputStream(targetPath), BUFFER_SIZE)) {

            byte[] buffer = new byte[BUFFER_SIZE];
            int bytesRead;
            while ((bytesRead = in.read(buffer)) != -1) {
                out.write(buffer, 0, bytesRead);
            }

            return true;

        } catch (IOException e) {
            Logger.error(TAG, "Failed to copy file from " + sourcePath + " to " + targetPath, e);
            return false;
        }
    }

    /**
     * Extract ZIP file with optimized buffering
     */
    public static boolean ExtractZip(String zipPath, String targetPath) {
        try (ZipInputStream zis = new ZipInputStream(
                new BufferedInputStream(new FileInputStream(zipPath), BUFFER_SIZE))) {

            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                File file = new File(targetPath, entry.getName());

                if (entry.isDirectory()) {
                    if (!file.exists() && !file.mkdirs()) {
                        Logger.error(TAG, new Error("Failed to create directory: " + file.getPath()));
                        return false;
                    }
                } else {
                    File parent = file.getParentFile();
                    if (parent != null && !parent.exists() && !parent.mkdirs()) {
                        Logger.error(TAG, new Error("Failed to create parent directory: " + parent.getPath()));
                        return false;
                    }

                    try (BufferedOutputStream out = new BufferedOutputStream(
                            new FileOutputStream(file), BUFFER_SIZE)) {

                        byte[] buffer = new byte[BUFFER_SIZE];
                        int bytesRead;
                        while ((bytesRead = zis.read(buffer)) != -1) {
                            out.write(buffer, 0, bytesRead);
                        }
                    }
                }

                zis.closeEntry();
            }

            return true;

        } catch (IOException e) {
            Logger.error(TAG, "Failed to extract ZIP: " + zipPath, e);
            return false;
        }
    }

    /**
     * Get file size
     */
    public static long GetFileSize(String path) {
        File file = new File(path);
        return file.exists() ? file.length() : -1;
    }

    /**
     * Check if path is a directory
     */
    public static boolean IsDirectory(String path) {
        return new File(path).isDirectory();
    }

    /**
     * List directory contents
     */
    public static String[] ListDirectory(String path) {
        File dir = new File(path);
        if (!dir.exists() || !dir.isDirectory()) {
            return new String[0];
        }

        String[] files = dir.list();
        return files != null ? files : new String[0];
    }

    /**
     * Close stream quietly without throwing exceptions
     */
    private static void closeQuietly(AutoCloseable closeable) {
        if (closeable != null) {
            try {
                closeable.close();
            } catch (Exception e) {
                // Ignore
            }
        }
    }
}
