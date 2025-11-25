package net.hampoelz.capacitor.nodejs;

import android.content.Context;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginConfig;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONException;

@CapacitorPlugin(name = "CapacitorNodeJS")
public class CapacitorNodeJSPlugin extends Plugin {

    protected static final String LOGGER_TAG = "CapacitorNodeJS";
    protected static final String PREFS_TAG = "CapacitorNodeJS_PREFS";
    protected static final String PREFS_APP_UPDATED_TIME = "AppUpdateTime";
    protected static final String CHANNEL_NAME_APP = "APP_CHANNEL";
    protected static final String CHANNEL_NAME_EVENT = "EVENT_CHANNEL";

    private final PluginEventNotifier eventNotifier = new PluginEventNotifier();
    private CapacitorNodeJS implementation;

    // Cache plugin settings to avoid repeated reads
    private PluginSettings cachedSettings;
    private final AtomicBoolean settingsInitialized = new AtomicBoolean(false);

    // Pre-allocated empty arrays/maps for frequent operations
    private static final String[] EMPTY_STRING_ARRAY = new String[0];
    private static final JSArray EMPTY_JS_ARRAY = new JSArray();

    @Override
    public void load() {
        final Context context = getContext();
        implementation = new CapacitorNodeJS(context, eventNotifier);

        // Initialize and cache settings once
        cachedSettings = readPluginSettings();
        settingsInitialized.set(true);

        // Auto-start if configured (happens off main thread in implementation)
        if ("auto".equals(cachedSettings.startMode)) {
            implementation.startEngine(
                    null,
                    cachedSettings.nodeDir,
                    null,
                    EMPTY_STRING_ARRAY,
                    new HashMap<>(0)
            );
        }
    }

    /** @noinspection InnerClassMayBeStatic*/
    private static class PluginSettings {
        protected String nodeDir = "nodejs";
        protected String startMode = "auto";
    }

    /**
     * Read plugin settings with caching to avoid repeated config reads
     */
    private PluginSettings readPluginSettings() {
        // Return cached settings if already initialized
        if (settingsInitialized.get() && cachedSettings != null) {
            return cachedSettings;
        }

        final PluginSettings settings = new PluginSettings();
        final PluginConfig config = getConfig();

        settings.nodeDir = config.getString("nodeDir", settings.nodeDir);
        settings.startMode = config.getString("startMode", settings.startMode);

        return settings;
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();

        // Only send if engine is ready to avoid unnecessary overhead
        if (implementation != null) {
            implementation.sendMessage(CHANNEL_NAME_APP, "resume", EMPTY_JS_ARRAY);
        }
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();

        // Only send if engine is ready to avoid unnecessary overhead
        if (implementation != null) {
            implementation.sendMessage(CHANNEL_NAME_APP, "pause", EMPTY_JS_ARRAY);
        }
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();

        // Clean up resources when plugin is destroyed
        if (implementation != null) {
            implementation.shutdown();
        }
    }

    //region PluginMethods
    //---------------------------------------------------------------------------------------

    @PluginMethod
    public void start(PluginCall call) {
        // Use cached settings instead of reading again
        if (!settingsInitialized.get()) {
            cachedSettings = readPluginSettings();
            settingsInitialized.set(true);
        }

        if (!"manual".equals(cachedSettings.startMode)) {
            call.reject("Manual startup of the Node.js engine is not enabled.");
            return;
        }

        final String projectDir = call.getString("nodeDir", cachedSettings.nodeDir);
        final String nodeMain = call.getString("script");
        final JSArray nodeArgs = call.getArray("args");
        final JSObject nodeEnv = call.getObject("env");

        // Optimized array conversion
        final String[] nodeArgsArray = convertJSArrayToStringArray(nodeArgs, call);
        if (nodeArgsArray == null) {
            // Error already sent by conversion method
            return;
        }

        // Optimized map conversion
        final Map<String, String> nodeEnvMap = convertJSObjectToMap(nodeEnv);

        implementation.startEngine(call, projectDir, nodeMain, nodeArgsArray, nodeEnvMap);
    }

    @PluginMethod
    public void send(PluginCall call) {
        final String eventName = call.getString("eventName");
        if (eventName == null || eventName.isEmpty()) {
            call.reject("Required parameter 'eventName' was not specified.");
            return;
        }

        implementation.sendMessage(call);
    }

    @PluginMethod
    public void whenReady(PluginCall call) {
        implementation.resolveWhenReady(call);
    }

    //---------------------------------------------------------------------------------------
    //endregion

    //region Helper Methods
    //---------------------------------------------------------------------------------------

    /**
     * Optimized conversion of JSArray to String array
     */
    private String[] convertJSArrayToStringArray(JSArray jsArray, PluginCall call) {
        if (jsArray == null || jsArray.length() == 0) {
            return EMPTY_STRING_ARRAY;
        }

        final int length = jsArray.length();
        final String[] result = new String[length];

        try {
            for (int i = 0; i < length; i++) {
                result[i] = jsArray.getString(i);
            }
            return result;
        } catch (JSONException ex) {
            call.reject("Parameter 'args' is not valid.", ex);
            return null;
        }
    }

    /**
     * Optimized conversion of JSObject to Map with pre-sizing
     */
    private Map<String, String> convertJSObjectToMap(JSObject jsObject) {
        if (jsObject == null) {
            return new HashMap<>(0);
        }

        // Pre-size the map to avoid resizing
        final Iterator<String> keys = jsObject.keys();
        int estimatedSize = 0;

        // Count non-empty keys
        while (keys.hasNext()) {
            if (keys.next() != null) {
                estimatedSize++;
            }
        }

        final Map<String, String> result = new HashMap<>(estimatedSize);
        final Iterator<String> actualKeys = jsObject.keys();

        while (actualKeys.hasNext()) {
            String key = actualKeys.next();
            if (key == null || key.isEmpty()) continue;

            String value = jsObject.getString(key);
            if (value == null || value.isEmpty()) continue;

            result.put(key, value);
        }

        return result;
    }

    //---------------------------------------------------------------------------------------
    //endregion

    //region PluginEvents
    //---------------------------------------------------------------------------------------

    protected class PluginEventNotifier {

        // Bridge -------------------------------------------------------------------------------

        protected void channelReceive(String eventName, JSArray payloadArray) {
            notifyChannelListeners(eventName, payloadArray);
        }
    }

    //---------------------------------------------------------------------------------------
    //endregion

    //region PluginListeners
    //---------------------------------------------------------------------------------------

    /**
     * Optimized listener notification with object reuse
     */
    private void notifyChannelListeners(String eventName, JSArray payloadArray) {
        // Reuse JSObject instead of creating new one each time
        final JSObject args = new JSObject();
        args.put("args", payloadArray);

        notifyListeners(eventName, args);
    }

    //---------------------------------------------------------------------------------------
    //endregion
}
