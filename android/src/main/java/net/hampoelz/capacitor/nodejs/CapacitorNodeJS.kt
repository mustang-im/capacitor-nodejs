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
import androidx.core.content.edit

class CapacitorNodeJS {
    private lateinit var packageInfo: PackageInfo
    private val context: Context
    private val eventNotifier: PluginEventNotifier
    private val preferences: SharedPreferences
    private val engineStatus = EngineStatus()
    private val nodeProcess = NodeProcess(this.ReceiveCallback())

    constructor(context: Context, eventNotifier: PluginEventNotifier) {
        this.context = context
        this.preferences = context.getSharedPreferences(CapacitorNodeJSPlugin.PREFS_TAG, Context.MODE_PRIVATE)
        this.eventNotifier = eventNotifier

        try {
            this.packageInfo =
                context.packageManager.getPackageInfo(context.packageName, 0)
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
                val whenEngineReadyListener = whenEngineReadyListeners[0]
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
        projectDir: String,
        mainFile: String,
        args: Array<String>,
        env: MutableMap<String?, String?>
    ) {
        val callWrapper = object {
            fun resolve() {
                call?.resolve()
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
            val filesPath = context.filesDir.absolutePath
            val cachePath = context.cacheDir.absolutePath

            val basePath = FileOperations.combinePath(filesPath, "nodejs")
            val projectPath = FileOperations.combinePath(basePath, "public")
            val modulesPath = FileOperations.combinePath(basePath, "builtin_modules")
            val dataPath = FileOperations.combinePath(basePath, "data")

            val copyNodeProjectSuccess =
                copyNodeProjectFromAPK(projectDir, projectPath, modulesPath)
            if (!copyNodeProjectSuccess) {
                callWrapper.reject("Unable to copy the Node.js project from APK.")
                return@Runnable
            }

            if (!FileOperations.existsPath(projectPath)) {
                callWrapper.reject("Unable to access the Node.js project. (No such directory)")
                return@Runnable
            }

            val createDataDirSuccess = FileOperations.createDir(dataPath)
            if (!createDataDirSuccess) {
                Logger.debug(
                    CapacitorNodeJSPlugin.LOGGER_TAG,
                    "Unable to create a directory for persistent data storage."
                )
            }

            val projectPackageJsonPath = FileOperations.combinePath("package.json")

            var projectMainFile = "index.js"
            if (!mainFile.isEmpty()) {
                projectMainFile = mainFile
            } else if (FileOperations.existsPath(projectPackageJsonPath)) {
                try {
                    val projectPackageJsonData =
                        FileOperations.readFileFromPath(projectPackageJsonPath)
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

            val projectMainPath = FileOperations.combinePath(projectPath, projectMainFile)

            if (!FileOperations.existsPath(projectMainPath)) {
                callWrapper.reject("Unable to access main script of the Node.js project. (No such file)")
                return@Runnable
            }

            val modulesPaths = FileOperations.combineEnv(projectPath, modulesPath)

            val nodeEnv: MutableMap<String?, String?> = HashMap()
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

    inner class ReceiveCallback : NodeProcess.ReceiveCallback {
        override fun receive(channelName: String?, message: String?) {
            receiveMessage(channelName, message)
        }
    }

    fun receiveMessage(channelName: String?, channelMessage: String?) {
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
        projectDir: String,
        projectPath: String,
        modulesPath: String
    ): Boolean {
        val nodeAssetDir = FileOperations.combinePath("public", projectDir)
        val modulesAssetDir = FileOperations.combinePath("builtin_modules")
        val assetManager = context.assets

        var success = true
        if (FileOperations.existsPath(projectPath) && this.isAppUpdated) {
            success = FileOperations.deleteDir(projectPath)
        }
        success = success and FileOperations.copyAssetDir(assetManager, nodeAssetDir, projectPath)

        if (FileOperations.existsPath(modulesPath) && this.isAppUpdated) {
            success = FileOperations.deleteDir(modulesPath)
        }
        success =
            success and FileOperations.copyAssetDir(assetManager, modulesAssetDir, modulesPath)

        saveAppUpdateTime()
        return success
    }

    private val isAppUpdated: Boolean
        get() {
            val previousLastUpdateTime =
                preferences.getLong(CapacitorNodeJSPlugin.PREFS_APP_UPDATED_TIME, 0)
            val lastUpdateTime = packageInfo.lastUpdateTime
            return lastUpdateTime != previousLastUpdateTime
        }

    private fun saveAppUpdateTime() {
        val lastUpdateTime = packageInfo.lastUpdateTime
        preferences.edit {
            putLong(CapacitorNodeJSPlugin.PREFS_APP_UPDATED_TIME, lastUpdateTime)
        }
    }
}
