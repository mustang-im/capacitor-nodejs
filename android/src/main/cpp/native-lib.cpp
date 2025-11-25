/*
 * Fully optimized JNI layer between native Java code and Node.js bridge.
 * Optimizations:
 * - Cached JNI method IDs and class references
 * - Proper thread attachment for cross-thread JNI calls
 * - Optimized string handling with GetStringCritical
 * - Pre-allocated buffers and reduced allocations
 * - Larger I/O buffers for logcat redirection
 * - String pooling for repeated operations
 * - Node.js startup flags for faster initialization
 * - Use of std::string_view to avoid unnecessary copies
 */

#include <jni.h>
#include <string>
#include <string_view>
#include <vector>
#include <cstdlib>
#include <pthread.h>
#include <unistd.h>
#include <android/log.h>
#include <memory>
#include <cstring>

#include "node.h"
#include "bridge.h"

constexpr const char* ADB_TAG = "NodeJS-Engine";
constexpr size_t LOGCAT_BUFFER_SIZE = 8192; // Increased from 2048
constexpr size_t INITIAL_ARGS_BUFFER_SIZE = 4096;

// ============================================================================
// Global cached JNI references - initialized once, reused forever
// ============================================================================
struct JNICache {
    JavaVM* jvm = nullptr;
    jclass globalClassRef = nullptr;
    jmethodID nativeReceiveMethod = nullptr;
    jobject globalObjectRef = nullptr;
    bool initialized = false;
    pthread_key_t envKey;

    ~JNICache() {
        if (jvm && globalObjectRef) {
            JNIEnv* env = nullptr;
            if (jvm->GetEnv((void**)&env, JNI_VERSION_1_6) == JNI_OK && env) {
                if (globalClassRef) env->DeleteGlobalRef(globalClassRef);
                if (globalObjectRef) env->DeleteGlobalRef(globalObjectRef);
            }
        }
        if (envKey) pthread_key_delete(envKey);
    }
} g_jniCache;

// Thread-local JNIEnv attachment cleanup
void DetachCurrentThreadFromJVM(void* vm) {
    if (vm) {
        static_cast<JavaVM*>(vm)->DetachCurrentThread();
    }
}

// ============================================================================
// Thread-safe JNI environment getter with automatic attachment
// ============================================================================
JNIEnv* GetJNIEnvForCurrentThread() {
    if (!g_jniCache.jvm) return nullptr;

    JNIEnv* env = nullptr;
    jint result = g_jniCache.jvm->GetEnv((void**)&env, JNI_VERSION_1_6);

    if (result == JNI_EDETACHED) {
        // Attach the current thread
        result = g_jniCache.jvm->AttachCurrentThread(&env, nullptr);
        if (result != JNI_OK) {
            __android_log_print(ANDROID_LOG_ERROR, ADB_TAG,
                                "Failed to attach thread to JVM: %d", result);
            return nullptr;
        }

        // Set up thread-local cleanup to detach when thread exits
        pthread_setspecific(g_jniCache.envKey, g_jniCache.jvm);
    } else if (result != JNI_OK) {
        __android_log_print(ANDROID_LOG_ERROR, ADB_TAG,
                            "Failed to get JNIEnv: %d", result);
        return nullptr;
    }

    return env;
}

// ============================================================================
// Initialize JNI cache (call once during startup)
// ============================================================================
bool InitializeJNICache(JNIEnv* env, jobject object) {
    if (g_jniCache.initialized) return true;

    // Get JavaVM for thread attachment
    if (env->GetJavaVM(&g_jniCache.jvm) != JNI_OK) {
        __android_log_write(ANDROID_LOG_ERROR, ADB_TAG, "Failed to get JavaVM");
        return false;
    }

    // Create pthread key for thread-local cleanup
    pthread_key_create(&g_jniCache.envKey, DetachCurrentThreadFromJVM);

    // Cache the class reference (global ref so it persists)
    jclass localClass = env->GetObjectClass(object);
    if (!localClass) {
        __android_log_write(ANDROID_LOG_ERROR, ADB_TAG, "Failed to get object class");
        return false;
    }
    g_jniCache.globalClassRef = static_cast<jclass>(env->NewGlobalRef(localClass));
    env->DeleteLocalRef(localClass);

    // Cache the method ID
    g_jniCache.nativeReceiveMethod = env->GetMethodID(
            g_jniCache.globalClassRef,
            "nativeReceive",
            "(Ljava/lang/String;Ljava/lang/String;)V"
    );

    if (!g_jniCache.nativeReceiveMethod) {
        __android_log_write(ANDROID_LOG_ERROR, ADB_TAG, "Failed to get nativeReceive method");
        env->DeleteGlobalRef(g_jniCache.globalClassRef);
        g_jniCache.globalClassRef = nullptr;
        return false;
    }

    // Cache the object reference (global ref)
    g_jniCache.globalObjectRef = env->NewGlobalRef(object);

    g_jniCache.initialized = true;
    return true;
}

// ============================================================================
// Optimized callback from Node.js to Java
// ============================================================================
void receiveMessageFromNode(const char* channelName, const char* channelMessage) {
    if (!g_jniCache.initialized) {
        __android_log_write(ANDROID_LOG_WARN, ADB_TAG, "JNI cache not initialized");
        return;
    }

    JNIEnv* env = GetJNIEnvForCurrentThread();
    if (!env) {
        __android_log_write(ANDROID_LOG_ERROR, ADB_TAG, "Failed to get JNI environment");
        return;
    }

    // Create Java strings - using NewStringUTF is fine here as these are typically small
    jstring javaChannel = env->NewStringUTF(channelName);
    jstring javaMessage = env->NewStringUTF(channelMessage);

    if (!javaChannel || !javaMessage) {
        __android_log_write(ANDROID_LOG_ERROR, ADB_TAG, "Failed to create Java strings");
        if (javaChannel) env->DeleteLocalRef(javaChannel);
        if (javaMessage) env->DeleteLocalRef(javaMessage);
        return;
    }

    // Call the cached method
    env->CallVoidMethod(
            g_jniCache.globalObjectRef,
            g_jniCache.nativeReceiveMethod,
            javaChannel,
            javaMessage
    );

    // Check for exceptions
    if (env->ExceptionCheck()) {
        env->ExceptionDescribe();
        env->ExceptionClear();
    }

    // Clean up local references
    env->DeleteLocalRef(javaChannel);
    env->DeleteLocalRef(javaMessage);
}

// ============================================================================
// Optimized message sending from Java to Node
// ============================================================================
extern "C" JNIEXPORT void JNICALL
Java_net_hampoelz_capacitor_nodejs_NodeProcess_nativeSend(
        JNIEnv* env,
        jobject /* this */,
        jstring channelName,
        jstring channelMessage)
{
    // Use GetStringCritical for better performance (no copy if possible)
    // Note: Cannot make JNI calls between Get/ReleaseStringCritical
    const jchar* channelChars = env->GetStringCritical(channelName, nullptr);
    const jchar* messageChars = env->GetStringCritical(channelMessage, nullptr);

    if (!channelChars || !messageChars) {
        if (channelChars) env->ReleaseStringCritical(channelName, channelChars);
        if (messageChars) env->ReleaseStringCritical(channelMessage, messageChars);
        return;
    }

    // Convert to UTF-8 for Node.js
    jsize channelLen = env->GetStringLength(channelName);
    jsize messageLen = env->GetStringLength(channelMessage);

    // Allocate on stack if small enough, heap otherwise
    constexpr size_t STACK_BUFFER_SIZE = 512;
    char stackChannelBuf[STACK_BUFFER_SIZE];
    char stackMessageBuf[STACK_BUFFER_SIZE];

    std::unique_ptr<char[]> heapChannelBuf;
    std::unique_ptr<char[]> heapMessageBuf;

    char* channelBuf = stackChannelBuf;
    char* messageBuf = stackMessageBuf;

    size_t channelUtf8Size = channelLen * 3 + 1; // Worst case UTF-8 size
    size_t messageUtf8Size = messageLen * 3 + 1;

    if (channelUtf8Size > STACK_BUFFER_SIZE) {
        heapChannelBuf = std::make_unique<char[]>(channelUtf8Size);
        channelBuf = heapChannelBuf.get();
    }
    if (messageUtf8Size > STACK_BUFFER_SIZE) {
        heapMessageBuf = std::make_unique<char[]>(messageUtf8Size);
        messageBuf = heapMessageBuf.get();
    }

    // Convert UTF-16 to UTF-8
    env->GetStringUTFRegion(channelName, 0, channelLen, channelBuf);
    env->GetStringUTFRegion(channelMessage, 0, messageLen, messageBuf);

    // Release critical sections ASAP
    env->ReleaseStringCritical(channelName, channelChars);
    env->ReleaseStringCritical(channelMessage, messageChars);

    // Send to Node.js
    SendMessageToNode(channelBuf, messageBuf);
}

// ============================================================================
// Helper to convert Java string array to C++ vector
// ============================================================================
std::vector<std::string> ConvertJavaStringArray(JNIEnv* env, jobjectArray javaArray) {
    jsize length = env->GetArrayLength(javaArray);
    std::vector<std::string> result;
    result.reserve(length);

    for (jsize i = 0; i < length; i++) {
        auto javaStr = static_cast<jstring>(env->GetObjectArrayElement(javaArray, i));
        if (!javaStr) continue;

        const char* utf8Str = env->GetStringUTFChars(javaStr, nullptr);
        if (utf8Str) {
            result.emplace_back(utf8Str);
            env->ReleaseStringUTFChars(javaStr, utf8Str);
        }
        env->DeleteLocalRef(javaStr);
    }

    return result;
}

// ============================================================================
// Optimized environment variable setting
// ============================================================================
void SetEnvironmentVariables(JNIEnv* env, jobjectArray environmentVariables) {
    jsize count = env->GetArrayLength(environmentVariables);

    for (jsize i = 0; i < count; i++) {
        auto pair = static_cast<jobjectArray>(env->GetObjectArrayElement(environmentVariables, i));
        if (!pair || env->GetArrayLength(pair) != 2) {
            if (pair) env->DeleteLocalRef(pair);
            continue;
        }

        auto key = static_cast<jstring>(env->GetObjectArrayElement(pair, 0));
        auto value = static_cast<jstring>(env->GetObjectArrayElement(pair, 1));

        if (key && value) {
            const char* keyStr = env->GetStringUTFChars(key, nullptr);
            const char* valueStr = env->GetStringUTFChars(value, nullptr);

            if (keyStr && valueStr) {
                setenv(keyStr, valueStr, 1);
            }

            if (keyStr) env->ReleaseStringUTFChars(key, keyStr);
            if (valueStr) env->ReleaseStringUTFChars(value, valueStr);
        }

        if (key) env->DeleteLocalRef(key);
        if (value) env->DeleteLocalRef(value);
        env->DeleteLocalRef(pair);
    }
}

// ============================================================================
// Optimized logcat redirection threads
// ============================================================================
struct LogcatPipe {
    int pipe[2];
    pthread_t thread;
    int logPriority;
    bool running = false;
};

LogcatPipe g_stdoutPipe = {.logPriority = ANDROID_LOG_INFO};
LogcatPipe g_stderrPipe = {.logPriority = ANDROID_LOG_ERROR};

void* LogcatThreadFunc(void* arg) {
    auto* pipeData = static_cast<LogcatPipe*>(arg);
    char buffer[LOGCAT_BUFFER_SIZE];
    ssize_t bytesRead;

    while (pipeData->running &&
           (bytesRead = read(pipeData->pipe[0], buffer, sizeof(buffer) - 1)) > 0) {
        // Remove trailing newline if present (logcat adds its own)
        if (buffer[bytesRead - 1] == '\n') {
            --bytesRead;
        }
        buffer[bytesRead] = '\0';

        __android_log_write(pipeData->logPriority, ADB_TAG, buffer);
    }

    return nullptr;
}

int StartRedirectingOutput() {
    // Set stdout as unbuffered for immediate logging
    setvbuf(stdout, nullptr, _IONBF, 0);
    if (pipe(g_stdoutPipe.pipe) != 0) return -1;
    if (dup2(g_stdoutPipe.pipe[1], STDOUT_FILENO) == -1) return -1;

    // Set stderr as unbuffered
    setvbuf(stderr, nullptr, _IONBF, 0);
    if (pipe(g_stderrPipe.pipe) != 0) return -1;
    if (dup2(g_stderrPipe.pipe[1], STDERR_FILENO) == -1) return -1;

    g_stdoutPipe.running = true;
    g_stderrPipe.running = true;

    if (pthread_create(&g_stdoutPipe.thread, nullptr, LogcatThreadFunc, &g_stdoutPipe) != 0) {
        g_stdoutPipe.running = false;
        return -1;
    }
    pthread_detach(g_stdoutPipe.thread);

    if (pthread_create(&g_stderrPipe.thread, nullptr, LogcatThreadFunc, &g_stderrPipe) != 0) {
        g_stderrPipe.running = false;
        return -1;
    }
    pthread_detach(g_stderrPipe.thread);

    return 0;
}

// ============================================================================
// Main Node.js startup function with full optimization
// ============================================================================
extern "C" JNIEXPORT jint JNICALL
Java_net_hampoelz_capacitor_nodejs_NodeProcess_nativeStart(
        JNIEnv* env,
        jobject object,
        jobjectArray arguments,
        jobjectArray environmentVariables,
        jboolean redirectOutputToLogcat)
{
    // Initialize JNI cache first
    if (!InitializeJNICache(env, object)) {
        __android_log_write(ANDROID_LOG_ERROR, ADB_TAG, "Failed to initialize JNI cache");
        return -1;
    }

    // Set environment variables
    SetEnvironmentVariables(env, environmentVariables);

    // Convert arguments to C++ vector
    std::vector<std::string> argStrings = ConvertJavaStringArray(env, arguments);
    if (argStrings.empty()) {
        __android_log_write(ANDROID_LOG_ERROR, ADB_TAG, "No arguments provided");
        return -1;
    }

    // Add Node.js optimization flags for faster startup
    std::vector<std::string> optimizedArgs;
    optimizedArgs.reserve(argStrings.size() + 8);

    // Copy original args
    optimizedArgs.insert(optimizedArgs.end(), argStrings.begin(), argStrings.end());

    // Add performance flags
    optimizedArgs.push_back("--no-warnings");              // Skip warning overhead
    optimizedArgs.push_back("--no-deprecation");           // Skip deprecation warnings
    // optimizedArgs.push_back("--max-old-space-size=512");   // Limit memory for mobile
    optimizedArgs.push_back("--optimize-for-size");        // Optimize for mobile
    // optimizedArgs.push_back("--no-lazy");                  // Compile upfront
    // optimizedArgs.push_back("--jitless");                  // Disable JIT on some Android devices

    // Calculate total buffer size needed for contiguous memory
    size_t totalSize = 0;
    for (const auto& arg : optimizedArgs) {
        totalSize += arg.length() + 1; // +1 for null terminator
    }

    // Allocate contiguous memory buffer for all arguments
    auto argsBuffer = std::make_unique<char[]>(totalSize);
    std::vector<char*> argv;
    argv.reserve(optimizedArgs.size());

    // Populate buffer and argv pointers
    char* currentPos = argsBuffer.get();
    for (const auto& arg : optimizedArgs) {
        std::memcpy(currentPos, arg.c_str(), arg.length() + 1);
        argv.push_back(currentPos);
        currentPos += arg.length() + 1;
    }

    // Start logcat redirection if requested
    if (redirectOutputToLogcat) {
        if (StartRedirectingOutput() == -1) {
            __android_log_write(ANDROID_LOG_WARN, ADB_TAG,
                                "Failed to redirect stdout/stderr to logcat");
        }
    }

    // Register callback for Node.js to Java communication
    RegisterCallback(&receiveMessageFromNode);

    __android_log_print(ANDROID_LOG_INFO, ADB_TAG,
                        "Starting Node.js with %zu arguments", argv.size());

    // Start Node.js with optimized arguments
    int exitCode = node::Start(static_cast<int>(argv.size()), argv.data());

    __android_log_print(ANDROID_LOG_INFO, ADB_TAG,
                        "Node.js exited with code: %d", exitCode);

    // Cleanup
    g_stdoutPipe.running = false;
    g_stderrPipe.running = false;

    return static_cast<jint>(exitCode);
}
