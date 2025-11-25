package net.hampoelz.capacitor.nodejs;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import androidx.annotation.Nullable;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.PluginCall;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONException;
import org.json.JSONObject;

public class CapacitorNodeJS {

    private PackageInfo packageInfo;
    private final Context context;
    private final SharedPreferences preferences;
    private final CapacitorNodeJSPlugin.PluginEventNotifier eventNotifier;
    private final EngineStatus engineStatus = new EngineStatus();
    private final NodeProcess nodeProcess = new NodeProcess(new ReceiveCallback());

    // Thread pool for async operations - reuse threads instead of creating new ones
    private static final ExecutorService executorService = Executors.newFixedThreadPool(2);

    // Cache for parsed package.json to avoid repeated file I/O
    private String cachedMainFile = null;
    private final AtomicBoolean projectInitialized = new AtomicBoolean(false);

    // Pre-computed paths - calculate once, reuse everywhere
    private final String filesPath;
    private final String cachePath;
    private final String basePath;
    private final String projectPath;
    private final String modulesPath;
    private final String dataPath;

    protected CapacitorNodeJS(Context context, CapacitorNodeJSPlugin.PluginEventNotifier eventNotifier) {
        this.context = context;
        this.preferences = context.getSharedPreferences(CapacitorNodeJSPlugin.PREFS_TAG, Context.MODE_PRIVATE);
        this.eventNotifier = eventNotifier;

        // Pre-compute all paths during initialization
        this.filesPath = context.getFilesDir().getAbsolutePath();
        this.cachePath = context.getCacheDir().getAbsolutePath();
        this.basePath = FileOperations.CombinePath(filesPath, "nodejs");
        this.projectPath = FileOperations.CombinePath(basePath, "public");
        this.modulesPath = FileOperations.CombinePath(basePath, "builtin_modules");
        this.dataPath = FileOperations.CombinePath(basePath, "data");

        try {
            this.packageInfo = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
        } catch (PackageManager.NameNotFoundException e) {
            Logger.error(CapacitorNodeJSPlugin.LOGGER_TAG, "Failed to get the application's package information.", e);
        }
    }

    /** @noinspection InnerClassMayBeStatic*/
    private class EngineStatus {

        private final ArrayList<PluginCall> whenEngineReadyListeners = new ArrayList<>();
        private final AtomicBoolean isEngineStarted = new AtomicBoolean(false);
        private final AtomicBoolean isEngineReady = new AtomicBoolean(false);

        protected void setStarted() {
            isEngineStarted.set(true);
        }

        protected boolean isStarted() {
            return isEngineStarted.get();
        }

        protected synchronized void setReady() {
            isEngineReady.set(true);

            // Resolve all waiting listeners
            for (PluginCall listener : whenEngineReadyListeners) {
                listener.resolve();
            }
            whenEngineReadyListeners.clear();
        }

        protected boolean isReady() {
            return isEngineReady.get();
        }

        protected synchronized void resolveWhenReady(PluginCall call) {
            if (this.isReady()) {
                call.resolve();
            } else {
                whenEngineReadyListeners.add(call);
            }
        }
    }

    protected void startEngine(
            @Nullable PluginCall call,
            String projectDir,
            @Nullable String mainFile,
            String[] args,
            Map<String, String> env
    ) {
        final var callWrapper = new Object() {
            public void resolve() {
                if (call != null) {
                    call.resolve();
                }
            }

            public void reject(String message) {
                if (call != null) {
                    call.reject(message);
                } else {
                    Logger.debug(CapacitorNodeJSPlugin.LOGGER_TAG, message);
                }
            }

            public void reject(String message, Exception e) {
                if (call != null) {
                    call.reject(message, e);
                } else {
                    Logger.error(CapacitorNodeJSPlugin.LOGGER_TAG, message, e);
                }
            }
        };

        if (engineStatus.isStarted()) {
            callWrapper.reject("The Node.js engine has already been started.");
            return;
        }
        engineStatus.setStarted();

        // Use thread pool instead of creating new threads
        executorService.execute(() -> {
            try {
                // Fast path: if project already initialized and app not updated, skip file operations
                boolean needsCopy = !projectInitialized.get() || isAppUpdated();

                if (needsCopy) {
                    final boolean copySuccess = copyNodeProjectFromAPK(projectDir);
                    if (!copySuccess) {
                        callWrapper.reject("Unable to copy the Node.js project from APK.");
                        return;
                    }
                    projectInitialized.set(true);
                }

                // Validate project path exists (should be fast if already copied)
                if (!FileOperations.ExistsPath(projectPath)) {
                    callWrapper.reject("Unable to access the Node.js project. (No such directory)");
                    return;
                }

                // Create data directory only if it doesn't exist
                if (!FileOperations.ExistsPath(dataPath)) {
                    final boolean createDataDirSuccess = FileOperations.CreateDir(dataPath);
                    if (!createDataDirSuccess) {
                        Logger.debug(CapacitorNodeJSPlugin.LOGGER_TAG, "Unable to create a directory for persistent data storage.");
                    }
                }

                // Determine main file with caching
                String projectMainFile = determineMainFile(mainFile);
                if (projectMainFile == null) {
                    callWrapper.reject("Failed to determine the main script of the Node.js project.");
                    return;
                }

                final String projectMainPath = FileOperations.CombinePath(projectPath, projectMainFile);

                if (!FileOperations.ExistsPath(projectMainPath)) {
                    callWrapper.reject("Unable to access main script of the Node.js project. (No such file)");
                    return;
                }

                // Pre-compute module paths
                final String modulesPaths = FileOperations.CombineEnv(projectPath, modulesPath);

                // Build environment map efficiently
                final Map<String, String> nodeEnv = new HashMap<>(env.size() + 2);
                nodeEnv.put("DATADIR", dataPath);
                nodeEnv.put("NODE_PATH", modulesPaths);
                nodeEnv.putAll(env);

                // Start Node.js process
                nodeProcess.start(projectMainPath, args, nodeEnv, cachePath);
                callWrapper.resolve();

            } catch (Exception e) {
                callWrapper.reject("Failed to start Node.js engine", e);
            }
        });
    }

    /**
     * Optimized main file determination with caching
     */
    private String determineMainFile(@Nullable String mainFile) {
        // If explicitly provided, use it
        if (mainFile != null && !mainFile.isEmpty()) {
            return mainFile;
        }

        // If cached, return cached value
        if (cachedMainFile != null) {
            return cachedMainFile;
        }

        // Default fallback
        String projectMainFile = "index.js";

        // Try to read from package.json
        final String projectPackageJsonPath = FileOperations.CombinePath(projectPath, "package.json");
        if (FileOperations.ExistsPath(projectPackageJsonPath)) {
            try {
                final String projectPackageJsonData = FileOperations.ReadFileFromPath(projectPackageJsonPath);
                final JSONObject projectPackageJson = new JSONObject(projectPackageJsonData);

                if (projectPackageJson.has("main")) {
                    final String packageJsonMainFile = projectPackageJson.getString("main");
                    if (!packageJsonMainFile.isEmpty()) {
                        projectMainFile = packageJsonMainFile;
                    }
                }
            } catch (JSONException | IOException e) {
                Logger.warn(CapacitorNodeJSPlugin.LOGGER_TAG, "Failed to read package.json, using default main file");
            }
        }

        // Cache the result
        cachedMainFile = projectMainFile;
        return projectMainFile;
    }

    protected void resolveWhenReady(PluginCall call) {
        if (!engineStatus.isStarted()) {
            call.reject("The Node.js engine has not been started yet.");
            return;
        }

        engineStatus.resolveWhenReady(call);
    }

    protected void sendMessage(PluginCall call) {
        if (!engineStatus.isStarted()) {
            call.reject("The Node.js engine has not been started yet.");
            return;
        }

        if (!engineStatus.isReady()) {
            call.reject("The Node.js engine is not ready yet.");
            return;
        }

        final String eventName = call.getString("eventName");
        final JSArray args = call.getArray("args", new JSArray());

        sendMessage(CapacitorNodeJSPlugin.CHANNEL_NAME_EVENT, eventName, args);

        call.resolve();
    }

    protected void sendMessage(String channelName, String eventName, JSArray args) {
        if (eventName == null || args == null) return;

        final String eventMessage = args.toString();

        final JSObject data = new JSObject();
        data.put("eventName", eventName);
        data.put("eventMessage", eventMessage);

        final String channelMessage = data.toString();

        nodeProcess.send(channelName, channelMessage);
    }

    class ReceiveCallback implements NodeProcess.ReceiveCallback {

        @Override
        public void receive(String channelName, String message) {
            receiveMessage(channelName, message);
        }
    }

    protected void receiveMessage(String channelName, String channelMessage) {
        try {
            final JSObject payload = new JSObject(channelMessage);

            final String eventName = payload.getString("eventName");
            final String eventMessage = payload.getString("eventMessage");

            JSArray args = new JSArray();
            if (eventMessage != null && !eventMessage.isEmpty()) {
                args = new JSArray(eventMessage);
            }

            if (Objects.equals(channelName, CapacitorNodeJSPlugin.CHANNEL_NAME_APP) && Objects.equals(eventName, "ready")) {
                engineStatus.setReady();
            } else if (Objects.equals(channelName, CapacitorNodeJSPlugin.CHANNEL_NAME_EVENT)) {
                eventNotifier.channelReceive(eventName, args);
            }
        } catch (JSONException e) {
            Logger.error(CapacitorNodeJSPlugin.LOGGER_TAG, "Failed to deserialize received data from the Node.js process.", e);
        }
    }

    /**
     * Optimized file copying with smart update detection
     */
    private boolean copyNodeProjectFromAPK(String projectDir) {
        final String nodeAssetDir = FileOperations.CombinePath("public", projectDir);
        final String modulesAssetDir = "builtin_modules";
        final AssetManager assetManager = context.getAssets();

        boolean appUpdated = isAppUpdated();
        boolean success = true;

        // Only delete and recopy if app was updated
        if (appUpdated) {
            if (FileOperations.ExistsPath(projectPath)) {
                success = FileOperations.DeleteDir(projectPath);
            }
            success &= FileOperations.CopyAssetDir(assetManager, nodeAssetDir, projectPath);

            if (FileOperations.ExistsPath(modulesPath)) {
                success &= FileOperations.DeleteDir(modulesPath);
            }
            success &= FileOperations.CopyAssetDir(assetManager, modulesAssetDir, modulesPath);

            if (success) {
                saveAppUpdateTime();
            }
        } else if (!FileOperations.ExistsPath(projectPath)) {
            // First time installation
            success = FileOperations.CopyAssetDir(assetManager, nodeAssetDir, projectPath);
            success &= FileOperations.CopyAssetDir(assetManager, modulesAssetDir, modulesPath);

            if (success) {
                saveAppUpdateTime();
            }
        }
        // else: files already exist and app not updated, skip copying

        return success;
    }

    private boolean isAppUpdated() {
        final long previousLastUpdateTime = preferences.getLong(CapacitorNodeJSPlugin.PREFS_APP_UPDATED_TIME, 0);
        final long lastUpdateTime = packageInfo.lastUpdateTime;
        return lastUpdateTime != previousLastUpdateTime;
    }

    private void saveAppUpdateTime() {
        final long lastUpdateTime = packageInfo.lastUpdateTime;
        final SharedPreferences.Editor editor = preferences.edit();
        editor.putLong(CapacitorNodeJSPlugin.PREFS_APP_UPDATED_TIME, lastUpdateTime);
        editor.apply(); // Use apply() instead of commit() for async write
    }

    /**
     * Call this when the app is being destroyed to clean up resources
     */
    public void shutdown() {
        executorService.shutdown();
    }
}
