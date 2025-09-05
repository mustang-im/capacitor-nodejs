package net.hampoelz.capacitor.nodejs

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONException

@CapacitorPlugin(name = "CapacitorNodeJS")
class CapacitorNodeJSPlugin : Plugin() {
    private val eventNotifier = PluginEventNotifier()
    private var implementation: CapacitorNodeJS? = null

    override fun load() {
        val context = getContext()
        implementation = CapacitorNodeJS(context, eventNotifier)

        val pluginSettings = readPluginSettings()
        if (pluginSettings.startMode == "auto") {
            implementation!!.startEngine(
                null,
                pluginSettings.nodeDir,
                null,
                arrayOf<String?>(),
                HashMap<String?, String?>()
            )
        }
    }

    /** @noinspection InnerClassMayBeStatic
     */
    private inner class PluginSettings {
        var nodeDir: String = "nodejs"
        var startMode: String = "auto"
    }

    private fun readPluginSettings(): PluginSettings {
        val settings = PluginSettings()
        val config = getConfig()

        settings.nodeDir = config.getString("nodeDir", settings.nodeDir)
        settings.startMode = config.getString("startMode", settings.startMode)

        return settings
    }

    protected override fun handleOnResume() {
        super.handleOnResume()
        implementation!!.sendMessage(CHANNEL_NAME_APP, "resume", JSArray())
    }

    protected override fun handleOnPause() {
        super.handleOnPause()
        implementation!!.sendMessage(CHANNEL_NAME_APP, "pause", JSArray())
    }

    //region PluginMethods
    //---------------------------------------------------------------------------------------
    @PluginMethod
    fun start(call: PluginCall) {
        val pluginSettings = readPluginSettings()

        if (pluginSettings.startMode != "manual") {
            call.reject("Manual startup of the Node.js engine is not enabled.")
        }

        val projectDir = call.getString("nodeDir", pluginSettings.nodeDir)
        val nodeMain = call.getString("script")
        val nodeArgs = call.getArray("args")
        val nodeEnv = call.getObject("env")

        val nodeArgsArray: Array<String?>
        if (nodeArgs != null) {
            nodeArgsArray = arrayOfNulls<String>(nodeArgs.length())

            try {
                for (i in 0..<nodeArgs.length()) {
                    nodeArgsArray[i] = nodeArgs.getString(i)
                }
            } catch (ex: JSONException) {
                call.reject("Parameter 'args' is not valid.", ex)
                return
            }
        } else {
            nodeArgsArray = arrayOf<String?>()
        }

        val nodeEnvMap: MutableMap<String?, String?> = HashMap<String?, String?>()
        if (nodeEnv != null) {
            val keys = nodeEnv.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                if (key == null || key.isEmpty()) continue

                val value = nodeEnv.getString(key)
                if (value == null || value.isEmpty()) continue

                nodeEnvMap.put(key, value)
            }
        }

        implementation!!.startEngine(call, projectDir, nodeMain, nodeArgsArray, nodeEnvMap)
    }

    @PluginMethod
    fun send(call: PluginCall) {
        val eventName = call.getString("eventName")
        if (eventName == null || eventName.isEmpty()) {
            call.reject("Required parameter 'eventName' was not specified.")
            return
        }

        implementation!!.sendMessage(call)
    }

    @PluginMethod
    fun whenReady(call: PluginCall) {
        implementation!!.resolveWhenReady(call)
    }

    //---------------------------------------------------------------------------------------
    //endregion
    //region PluginEvents
    //---------------------------------------------------------------------------------------
    inner class PluginEventNotifier {
        // Bridge -------------------------------------------------------------------------------
        fun channelReceive(eventName: String?, payloadArray: JSArray?) {
            notifyChannelListeners(eventName, payloadArray)
        }
    }

    //---------------------------------------------------------------------------------------
    //endregion
    //region PluginListeners
    //---------------------------------------------------------------------------------------
    private fun notifyChannelListeners(eventName: String?, payloadArray: JSArray?) {
        val args = JSObject()
        args.put("args", payloadArray)

        notifyListeners(eventName, args)
    } //---------------------------------------------------------------------------------------

    //endregion
    companion object {
        const val LOGGER_TAG: String = "CapacitorNodeJS"
        const val PREFS_TAG: String = "CapacitorNodeJS_PREFS"
        const val PREFS_APP_UPDATED_TIME: String = "AppUpdateTime"
        const val CHANNEL_NAME_APP: String = "APP_CHANNEL"
        const val CHANNEL_NAME_EVENT: String = "EVENT_CHANNEL"
    }
}
