/*
 * The JNI layer between the native Java code and the Node.js bridge.
 */

#include <jni.h>
#include <string>
#include <cstdlib>
#include <pthread.h>
#include <unistd.h>
#include <android/log.h>

#include "node.h"
#include "bridge.h"

#ifdef NDEBUG
#undef NDEBUG
#endif
#include <cassert>
#include "cppgc/platform.h"
#include "node.h"
#include "uv.h"

#include <algorithm>

// Note: This file is being referred to from doc/api/embedding.md, and excerpts
// from it are included in the documentation. Try to keep these in sync.
// Snapshot support is not part of the embedder API docs yet due to its
// experimental nature, although it is of course documented in node.h.

using node::CommonEnvironmentSetup;
using node::Environment;
using node::MultiIsolatePlatform;
using v8::Context;
using v8::HandleScope;
using v8::Isolate;
using v8::Locker;
using v8::MaybeLocal;
using v8::V8;
using v8::Value;

const char* AdbTag = "NodeJS-Engine";

// Forward declaration.
int startRedirectingStdoutStderr();

// Cache the variables for the thread running node to call into Java.
JNIEnv* cacheEnvPointer = nullptr;
jobject cacheClassObject = nullptr;

void receiveMessageFromNode(const char* channelName, const char* channelMessage)
{
    auto env = cacheEnvPointer;
    auto object = cacheClassObject;

    if (!env || !object)
        return;

    // Try to find the class.
    auto javaClass = env->GetObjectClass(object);
    if (javaClass != nullptr)
    {
        // Find the method.
        auto javaSendMessageMethod = env->GetMethodID(javaClass, "nativeReceive", "(Ljava/lang/String;Ljava/lang/String;)V");
        if (javaSendMessageMethod != nullptr)
        {
            auto javaChannel = env->NewStringUTF(channelName);
            auto javaMessage = env->NewStringUTF(channelMessage);

            // Call the method.
            env->CallVoidMethod(object, javaSendMessageMethod, javaChannel, javaMessage);

            // Release the JNI references.
            env->DeleteLocalRef(javaChannel);
            env->DeleteLocalRef(javaMessage);
        }

        env->DeleteLocalRef(javaClass);
    }
}

extern "C" JNIEXPORT void JNICALL
Java_net_hampoelz_capacitor_nodejs_NodeProcess_nativeSend(
    JNIEnv* env,
    jobject /* this */,
    jstring channelName,
    jstring channelMessage)
{
    const char* nativeChannel = env->GetStringUTFChars(channelName, nullptr);
    const char* nativeMessage = env->GetStringUTFChars(channelMessage, nullptr);

    SendMessageToNode(nativeChannel, nativeMessage);

    // Release the JNI references.
    env->ReleaseStringUTFChars(channelName, nativeChannel);
    env->ReleaseStringUTFChars(channelMessage, nativeMessage);
}


static Environment *nodeENV;

int RunNodeInstance(MultiIsolatePlatform* platform,
                    const std::vector<std::string>& args,
                    const std::vector<std::string>& exec_args) {
    int exit_code = 0;

    // Setup up a libuv event loop, v8::Isolate, and Node.js Environment.
    std::vector<std::string> errors;
    std::unique_ptr<CommonEnvironmentSetup> setup =
            CommonEnvironmentSetup::Create(platform, &errors, args, exec_args);
    if (!setup) {
        for (const std::string& err : errors)
            fprintf(stderr, "%s: %s\n", args[0].c_str(), err.c_str());
        return 1;
    }

    Isolate* isolate = setup->isolate();
    nodeENV = setup->env();

    {
        Locker locker(isolate);
        Isolate::Scope isolate_scope(isolate);
        HandleScope handle_scope(isolate);
        // The v8::Context needs to be entered when node::CreateEnvironment() and
        // node::LoadEnvironment() are being called.
        Context::Scope context_scope(setup->context());

        // Set up the Node.js instance for execution, and run code inside of it.
        // There is also a variant that takes a callback and provides it with
        // the `require` and `process` objects, so that it can manually compile
        // and run scripts as needed.
        // The `require` function inside this script does *not* access the file
        // system, and can only load built-in Node.js modules.
        // `module.createRequire()` is being used to create one that is able to
        // load files from the disk, and uses the standard CommonJS file loader
        // instead of the internal-only `require` function.
        MaybeLocal<Value> loadenv_ret = node::LoadEnvironment(
                nodeENV,
                "const publicRequire ="
                "  require('node:module').createRequire(process.cwd() + '/');"
                "globalThis.require = publicRequire;"
                "require('node:vm').runInThisContext(process.argv[1]);");

        if (loadenv_ret.IsEmpty())  // There has been a JS exception.
            return 1;

        exit_code = node::SpinEventLoop(nodeENV).FromMaybe(1);

        // node::Stop() can be used to explicitly stop the event loop and keep
        // further JavaScript from running. It can be called from any thread,
        // and will act like worker.terminate() if called from another thread.
        node::Stop(nodeENV);
    }

    return exit_code;
}

int RunNodeProcess(int argc, char** argv) {
    argv = uv_setup_args(argc, argv);
    std::vector<std::string> args(argv, argv + argc);
    // Parse Node.js CLI options, and print any errors that have occurred while
    // trying to parse them.
    std::shared_ptr<node::InitializationResult> result =
            node::InitializeOncePerProcess(args, {
                    node::ProcessInitializationFlags::kNoInitializeV8,
                    node::ProcessInitializationFlags::kNoInitializeNodeV8Platform
            });

    for (const std::string& error : result->errors())
        fprintf(stderr, "%s: %s\n", args[0].c_str(), error.c_str());
    if (result->early_return() != 0) {
        return result->exit_code();
    }

    // Create a v8::Platform instance. `MultiIsolatePlatform::Create()` is a way
    // to create a v8::Platform instance that Node.js can use when creating
    // Worker threads. When no `MultiIsolatePlatform` instance is present,
    // Worker threads are disabled.
    std::unique_ptr<MultiIsolatePlatform> platform =
            MultiIsolatePlatform::Create(4);
    V8::InitializePlatform(platform.get());
    V8::Initialize();

    // See below for the contents of this function.
    int ret = RunNodeInstance(
            platform.get(), result->args(), result->exec_args());

    V8::Dispose();
    V8::DisposePlatform();

    node::TearDownOncePerProcess();
    return ret;
}

// Node's libUV requires all arguments being on contiguous memory.
extern "C" jint JNICALL
Java_net_hampoelz_capacitor_nodejs_NodeProcess_nativeStart(
    JNIEnv* env,
    jobject object /* this */,
    jobjectArray arguments,
    jobjectArray environmentVariables,
    jboolean redirectOutputToLogcat)
{
    auto environmentVariablesCount = env->GetArrayLength(environmentVariables);
    for (int i = 0; i < environmentVariablesCount; i++) {
        auto environmentVariablePair = (jobjectArray)env->GetObjectArrayElement(environmentVariables, i);
        auto environmentVariablePairSize = env->GetArrayLength(environmentVariablePair);
        if (environmentVariablePairSize != 2) {
            continue;
        }

        auto key = (jstring)env->GetObjectArrayElement(environmentVariablePair, 0);
        auto value = (jstring)env->GetObjectArrayElement(environmentVariablePair, 1);

        // Node's libuv requires all arguments being on contiguous memory.
        const char* keyContents = env->GetStringUTFChars(key, nullptr);
        const char* valueContents = env->GetStringUTFChars(value, nullptr);

        setenv(keyContents, valueContents, 1);

        env->ReleaseStringUTFChars(key, keyContents);
        env->ReleaseStringUTFChars(value, valueContents);

        env->DeleteLocalRef(key);
        env->DeleteLocalRef(value);
        env->DeleteLocalRef(environmentVariablePair);
    }

    // argc
    auto argumentCount = env->GetArrayLength(arguments);

    // Compute byte size need for all arguments in contiguous memory.
    size_t argumentsSize = 0;
    for (int i = 0; i < argumentCount; i++)
    {
        auto arg = (jstring)env->GetObjectArrayElement(arguments, i);
        const char* argContents = env->GetStringUTFChars(arg, nullptr);

        argumentsSize += strlen(argContents);
        argumentsSize++; // for '\0'

        // Release the JNI references.
        env->ReleaseStringUTFChars(arg, argContents);
        env->DeleteLocalRef(arg);
    }

    // Stores arguments in contiguous memory.
    char* argsBuffer = (char*)calloc(argumentsSize, sizeof(char));

    // argv to pass into node.
    char* argv[argumentCount];

    // To iterate through the expected start position of each argument in argsBuffer.
    char* currentArgsPosition = argsBuffer;

    // Populate the argsBuffer and argv.
    for (int i = 0; i < argumentCount; i++)
    {
        auto arg = (jstring)env->GetObjectArrayElement(arguments, i);
        const char* currentArgument = env->GetStringUTFChars(arg, nullptr);

        // Copy current argument to its expected position in argsBuffer
        strncpy(currentArgsPosition, currentArgument, strlen(currentArgument));

        // Release the JNI references.
        env->ReleaseStringUTFChars(arg, currentArgument);
        env->DeleteLocalRef(arg);

        // Save current argument start position in argv
        argv[i] = currentArgsPosition;

        // Increment to the next argument's expected position.
        currentArgsPosition += strlen(currentArgsPosition) + 1;
    }

    if (redirectOutputToLogcat == true)
    {
        // Start threads to show stdout and stderr in logcat.
        if (startRedirectingStdoutStderr() == -1)
            __android_log_write(ANDROID_LOG_ERROR, AdbTag, "Couldn't start redirecting stdout and stderr to logcat.");
    }

    RegisterCallback(&receiveMessageFromNode);

    cacheEnvPointer = env;
    cacheClassObject = object;

    // Start node, with argc and argv.
    auto exitCode = RunNodeProcess(argumentCount, argv);
    free(argsBuffer);

    return jint(exitCode);
}

extern "C" void JNICALL
Java_net_hampoelz_capacitor_nodejs_NodeProcess_nativeStop(JNIEnv *env, jobject thiz) {
    node::Stop(nodeENV);
}

// Start threads to redirect stdout and stderr to logcat.
int stdoutPipe[2];
int stderrPipe[2];
pthread_t stdoutThread;
pthread_t stderrThread;

void* stderrThreadFunc(void*)
{
    ssize_t redirectSize;
    char buf[2048];
    while ((redirectSize = read(stderrPipe[0], buf, sizeof buf - 1)) > 0)
    {
        // __android_log will add a new line anyway.
        if (buf[redirectSize - 1] == '\n')
            --redirectSize;
        buf[redirectSize] = 0;
        __android_log_write(ANDROID_LOG_ERROR, AdbTag, buf);
    }
    return nullptr;
}

void* stdoutThreadFunc(void*)
{
    ssize_t redirectSize;
    char buf[2048];
    while ((redirectSize = read(stdoutPipe[0], buf, sizeof buf - 1)) > 0)
    {
        // __android_log will add a new line anyway.
        if (buf[redirectSize - 1] == '\n')
            --redirectSize;
        buf[redirectSize] = 0;
        __android_log_write(ANDROID_LOG_INFO, AdbTag, buf);
    }
    return nullptr;
}

int startRedirectingStdoutStderr()
{
    // Set stdout as unbuffered.
    setvbuf(stdout, nullptr, _IONBF, 0);
    pipe(stdoutPipe);
    dup2(stdoutPipe[1], STDOUT_FILENO);

    // Set stderr as unbuffered.
    setvbuf(stderr, nullptr, _IONBF, 0);
    pipe(stderrPipe);
    dup2(stderrPipe[1], STDERR_FILENO);

    if (pthread_create(&stdoutThread, nullptr, stdoutThreadFunc, nullptr) != 0)
        return -1;
    pthread_detach(stdoutThread);

    if (pthread_create(&stderrThread, nullptr, stderrThreadFunc, nullptr) != 0)
        return -1;
    pthread_detach(stderrThread);

    return 0;
}
