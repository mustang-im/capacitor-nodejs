package net.hampoelz.capacitor.nodejs

import android.system.ErrnoException
import android.system.Os
import com.getcapacitor.Logger

class NodeProcess protected constructor(private val receiveCallback: ReceiveCallback) {
    private external fun nativeStart(
        arguments: Array<String?>?,
        environmentVariables: Array<Array<String?>?>?,
        redirectOutputToLogcat: Boolean
    ): Int

    private external fun nativeSend(channelName: String?, message: String?)

    /** @noinspection unused
     */
    private fun nativeReceive(channelName: String?, message: String?) {
        receiveCallback.receive(channelName, message)
    }

    protected fun start(
        modulePath: String?,
        parameter: Array<String?>,
        env: MutableMap<String?, String?>,
        cachePath: String?
    ) {
        try {
            Os.setenv("TMPDIR", cachePath, true)
        } catch (e: ErrnoException) {
            Logger.error(
                CapacitorNodeJSPlugin.LOGGER_TAG,
                "Failed to set the environment variable for the Node.js cache directory.",
                e
            )
        }

        val arguments = arrayOfNulls<String>(parameter.size + 2)
        System.arraycopy(parameter, 0, arguments, 2, parameter.size)
        arguments[0] = "node"
        arguments[1] = modulePath

        val environmentVariables = Array<Array<String?>?>(env.size) { arrayOfNulls<String>(2) }

        var envCount = 0
        for (entry in env.entries) {
            environmentVariables[envCount]!![0] = entry.key
            environmentVariables[envCount]!![1] = entry.value
            envCount++
        }

        nativeStart(arguments, environmentVariables, true)
    }

    protected interface ReceiveCallback {
        fun receive(channelName: String?, message: String?)
    }

    protected fun send(channelName: String?, message: String?) {
        nativeSend(channelName, message)
    }

    companion object {
        init {
            System.loadLibrary("native-lib")
            System.loadLibrary("node")
        }
    }
}
