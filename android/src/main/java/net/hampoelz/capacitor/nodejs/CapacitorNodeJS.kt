package net.hampoelz.capacitor.nodejs

import android.content.Context
import android.content.SharedPreferences
import android.content.pm.PackageInfo
import android.content.pm.PackageManager.NameNotFoundException
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Logger
import com.getcapacitor.PluginCall
import net.hampoelz.capacitor.nodejs.CapacitorNodeJSPlugin.PluginEventNotifier
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException

class CapacitorNodeJS(
    private val context: Context,
    private val eventNotifier: PluginEventNotifier
) {
    private val packageInfo: PackageInfo? = null
    private val preferences: SharedPreferences
    private val engineStatus = EngineStatus()
    private val nodeProcess = NodeProcess(CapacitorNodeJS.ReceiveCallback())

    init {
        this.preferences =
            context.getSharedPreferences(CapacitorNodeJSPlugin.PREFS_TAG, Context.MODE_PRIVATE)

        try {
            this.packageInfo =
                context.getPackageManager().getPackageInfo(context.getPackageName(), 0)
        } catch (e: NameNotFoundException) {
            Logger.error(
                CapacitorNodeJSPlugin.LOGGER_TAG,
                "Failed to get the application's package information.",
                e
            )
        }
    }

    /** @noinspection InnerClassMayBeStatic
     */
    private inner class EngineStatus {
        private val whenEngineReadyListeners = ArrayList<PluginCall>()
        var isStarted: Boolean = false
            private set
        var isReady: Boolean = false
            private set

        fun setStarted() {
            this.isStarted = true
        }

        fun setReady() {
            this.isReady = true

            while (!whenEngineReadyListeners.isEmpty()) {
                val whenEngineReadyListener = whenEngineReadyListeners.get(0)
                whenEngineReadyListeners.removeAt(0)
                whenEngineReadyListener.resolve()
            }
        }

        fun resolveWhenReady(call: PluginCall) {
            if (this.isReady) {
                call.resolve()
            } else {
                whenEngineReadyListeners.add(call)
            }
        }
    }

    fun startEngine(
        call: PluginCall?,
        projectDir: String?,
        mainFile: String?,
        args: Array<String?>?,
        env: MutableMap<String?, String?>
    ) {
        val callWrapper: Any? = object : Any() {
            fun resolve() {
                if (call != null) {
                    call.resolve()
                }
            }

            fun reject(message: String?) {
                if (call != null) {
                    call.reject(message)
                } else {
                    Logger.debug(CapacitorNodeJSPlugin.LOGGER_TAG, message)
                }
            }

            fun reject(message: String?, e: Exception?) {
                if (call != null) {
                    call.reject(message, e)
                } else {
                    Logger.error(CapacitorNodeJSPlugin.LOGGER_TAG, message, e)
                }
            }
        }

        if (engineStatus.isStarted) {
            callWrapper.reject("The Node.js engine has already been started.")
            return
        }
        engineStatus.setStarted()

        val engine = Thread(Runnable {
            val filesPath = context.getFilesDir().getAbsolutePath()
            val cachePath = context.getCacheDir().getAbsolutePath()

            val basePath = FileOperations.CombinePath(filesPath, "nodejs")
            val projectPath = FileOperations.CombinePath(basePath, "public")
            val modulesPath = FileOperations.CombinePath(basePath, "builtin_modules")
            val dataPath = FileOperations.CombinePath(basePath, "data")

            val copyNodeProjectSuccess =
                copyNodeProjectFromAPK(projectDir, projectPath, modulesPath)
            if (!copyNodeProjectSuccess) {
                callWrapper.reject("Unable to copy the Node.js project from APK.")
                return@Runnable
            }

            if (!FileOperations.ExistsPath(projectPath)) {
                callWrapper.reject("Unable to access the Node.js project. (No such directory)")
                return@Runnable
            }

            val createDataDirSuccess = FileOperations.CreateDir(dataPath)
            if (!createDataDirSuccess) {
                Logger.debug(
                    CapacitorNodeJSPlugin.LOGGER_TAG,
                    "Unable to create a directory for persistent data storage."
                )
            }

            val projectPackageJsonPath = FileOperations.CombinePath(projectPath, "package.json")

            var projectMainFile: String? = "index.js"
            if (mainFile != null && !mainFile.isEmpty()) {
                projectMainFile = mainFile
            } else if (FileOperations.ExistsPath(projectPackageJsonPath)) {
                try {
                    val projectPackageJsonData =
                        FileOperations.ReadFileFromPath(projectPackageJsonPath)
                    val projectPackageJson = JSONObject(projectPackageJsonData)
                    val projectPackageJsonMainFile = projectPackageJson.getString("main")

                    if (!projectPackageJsonMainFile.isEmpty()) {
                        projectMainFile = projectPackageJsonMainFile
                    }
                } catch (e: JSONException) {
                    callWrapper.reject(
                        "Failed to read the package.json file of the Node.js project.",
                        e
                    )
                    return@Runnable
                } catch (e: IOException) {
                    callWrapper.reject(
                        "Failed to read the package.json file of the Node.js project.",
                        e
                    )
                    return@Runnable
                }
            }

            val projectMainPath = FileOperations.CombinePath(projectPath, projectMainFile)

            if (!FileOperations.ExistsPath(projectMainPath)) {
                callWrapper.reject("Unable to access main script of the Node.js project. (No such file)")
                return@Runnable
            }

            val modulesPaths = FileOperations.CombineEnv(projectPath, modulesPath)

            val nodeEnv: MutableMap<String?, String?> = HashMap<String?, String?>()
            nodeEnv.put("DATADIR", dataPath)
            nodeEnv.put("NODE_PATH", modulesPaths)
            nodeEnv.putAll(env)

            nodeProcess.start(projectMainPath, args, nodeEnv, cachePath)
            callWrapper.resolve()
        })

        engine.start()
    }

    fun resolveWhenReady(call: PluginCall) {
        if (!engineStatus.isStarted) {
            call.reject("The Node.js engine has not been started yet.")
        }

        engineStatus.resolveWhenReady(call)
    }

    fun sendMessage(call: PluginCall) {
        if (!engineStatus.isStarted) {
            call.reject("The Node.js engine has not been started yet.")
            return
        }

        if (!engineStatus.isReady) {
            call.reject("The Node.js engine is not ready yet.")
            return
        }

        val eventName = call.getString("eventName")
        val args = call.getArray("args", JSArray())

        sendMessage(CapacitorNodeJSPlugin.CHANNEL_NAME_EVENT, eventName, args)

        call.resolve()
    }

    fun sendMessage(channelName: String?, eventName: String?, args: JSArray?) {
        if (eventName == null || args == null) return

        val eventMessage = args.toString()

        val data = JSObject()
        data.put("eventName", eventName)
        data.put("eventMessage", eventMessage)

        val channelMessage = data.toString()

        nodeProcess.send(channelName, channelMessage)
    }

    internal inner class ReceiveCallback : NodeProcess.ReceiveCallback {
        override fun receive(channelName: String?, message: String?) {
            receiveMessage(channelName, message)
        }
    }

    protected fun receiveMessage(channelName: String?, channelMessage: String?) {
        try {
            val payload = JSObject(channelMessage)

            val eventName = payload.getString("eventName")
            val eventMessage = payload.getString("eventMessage")

            var args = JSArray()
            if (eventMessage != null && !eventMessage.isEmpty()) {
                args = JSArray(eventMessage)
            }

            if (channelName == CapacitorNodeJSPlugin.CHANNEL_NAME_APP && eventName == "ready") {
                engineStatus.setReady()
            } else if (channelName == CapacitorNodeJSPlugin.CHANNEL_NAME_EVENT) {
                eventNotifier.channelReceive(eventName, args)
            }
        } catch (e: JSONException) {
            Logger.error(
                CapacitorNodeJSPlugin.LOGGER_TAG,
                "Failed to deserialize received data from the Node.js process.",
                e
            )
        }
    }

    private fun copyNodeProjectFromAPK(
        projectDir: String?,
        projectPath: String?,
        modulesPath: String?
    ): Boolean {
        val nodeAssetDir = FileOperations.CombinePath("public", projectDir)
        val modulesAssetDir = FileOperations.CombinePath("builtin_modules")
        val assetManager = context.getAssets()

        var success = true
        if (FileOperations.ExistsPath(projectPath) && this.isAppUpdated) {
            success = FileOperations.DeleteDir(projectPath)
        }
        success = success and FileOperations.CopyAssetDir(assetManager, nodeAssetDir, projectPath)

        if (FileOperations.ExistsPath(modulesPath) && this.isAppUpdated) {
            success = FileOperations.DeleteDir(modulesPath)
        }
        success =
            success and FileOperations.CopyAssetDir(assetManager, modulesAssetDir, modulesPath)

        saveAppUpdateTime()
        return success
    }

    private val isAppUpdated: Boolean
        get() {
            val previousLastUpdateTime =
                preferences.getLong(CapacitorNodeJSPlugin.PREFS_APP_UPDATED_TIME, 0)
            val lastUpdateTime = packageInfo!!.lastUpdateTime
            return lastUpdateTime != previousLastUpdateTime
        }

    private fun saveAppUpdateTime() {
        val lastUpdateTime = packageInfo!!.lastUpdateTime
        val editor = preferences.edit()
        editor.putLong(CapacitorNodeJSPlugin.PREFS_APP_UPDATED_TIME, lastUpdateTime)
        editor.apply()
    }
}
