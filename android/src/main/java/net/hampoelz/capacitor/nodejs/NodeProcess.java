package net.hampoelz.capacitor.nodejs;

import android.system.ErrnoException;
import android.system.Os;
import com.getcapacitor.Logger;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

public class NodeProcess {

    // Load native libraries once during class initialization
    static {
        System.loadLibrary("native-lib");
        System.loadLibrary("node");
    }

    // Native method declarations
    private native int nativeStart(String[] arguments, String[][] environmentVariables, boolean redirectOutputToLogcat);
    private native void nativeSend(String channelName, String message);

    /** @noinspection unused*/
    private void nativeReceive(String channelName, String message) {
        receiveCallback.receive(channelName, message);
    }

    private final ReceiveCallback receiveCallback;
    private final AtomicBoolean isStarted = new AtomicBoolean(false);

    protected NodeProcess(ReceiveCallback receiveCallback) {
        this.receiveCallback = receiveCallback;
    }

    /**
     * Optimized Node.js process startup
     */
    protected void start(String modulePath, String[] parameter, Map<String, String> env, String cachePath) {
        // Prevent multiple starts
        if (!isStarted.compareAndSet(false, true)) {
            Logger.warn(CapacitorNodeJSPlugin.LOGGER_TAG, "Node.js process already started");
            return;
        }

        // Set cache directory environment variable
        try {
            Os.setenv("TMPDIR", cachePath, true);
        } catch (ErrnoException e) {
            Logger.error(CapacitorNodeJSPlugin.LOGGER_TAG, "Failed to set TMPDIR environment variable.", e);
        }

        // Pre-allocate exact size needed for arguments array
        final String[] arguments = new String[parameter.length + 2];
        arguments[0] = "node";
        arguments[1] = modulePath;

        // Use System.arraycopy for efficient bulk copy (faster than manual loop)
        System.arraycopy(parameter, 0, arguments, 2, parameter.length);

        // Convert environment map to 2D array efficiently
        final String[][] environmentVariables = convertEnvMapToArray(env);

        // Start Node.js engine
        nativeStart(arguments, environmentVariables, true);
    }

    /**
     * Efficiently convert Map to 2D array for JNI
     */
    private String[][] convertEnvMapToArray(Map<String, String> env) {
        final int size = env.size();
        final String[][] result = new String[size][2];

        int index = 0;
        for (Map.Entry<String, String> entry : env.entrySet()) {
            result[index][0] = entry.getKey();
            result[index][1] = entry.getValue();
            index++;
        }

        return result;
    }

    protected interface ReceiveCallback {
        void receive(String channelName, String message);
    }

    /**
     * Send message to Node.js process
     */
    protected void send(String channelName, String message) {
        if (!isStarted.get()) {
            Logger.warn(CapacitorNodeJSPlugin.LOGGER_TAG, "Cannot send message: Node.js process not started");
            return;
        }

        nativeSend(channelName, message);
    }
}
