// RegisterNatives table for expo.modules.azaharcore.AzaharCoreNative, plus the
// AndroidUtils bridge init (citra_common calls static Kotlin methods for file
// system decisions on Android) and the error-event path back into Kotlin.

#include <jni.h>

#include <string>
#include <vector>

#include <android/native_window_jni.h>

#include "common/android_utils.h"
#include "common/scm_rev.h"

namespace AndroidUtils {
// Defined in citra_common's android_utils.cpp but not declared in its header;
// attaches the calling thread to the JVM on demand.
JNIEnv* GetEnvForThread();
} // namespace AndroidUtils

#include "emulator_engine.h"

namespace {

jclass g_nativeClass = nullptr;
jmethodID g_onCoreError = nullptr;

std::string toString(JNIEnv* env, jstring str) {
    if (str == nullptr) {
        return {};
    }
    const char* chars = env->GetStringUTFChars(str, nullptr);
    std::string result{chars ? chars : ""};
    env->ReleaseStringUTFChars(str, chars);
    return result;
}

void postCoreError(const std::string& message) {
    // Safe from the emulation thread: GetEnvForThread attaches it on demand.
    JNIEnv* env = AndroidUtils::GetEnvForThread();
    if (env == nullptr || g_nativeClass == nullptr || g_onCoreError == nullptr) {
        return;
    }
    jstring jmessage = env->NewStringUTF(message.c_str());
    env->CallStaticVoidMethod(g_nativeClass, g_onCoreError, jmessage);
    env->DeleteLocalRef(jmessage);
}

jstring GetCoreVersion(JNIEnv* env, jclass) {
    return env->NewStringUTF(Common::g_build_fullname);
}

void SetUserDir(JNIEnv* env, jclass, jstring dir) {
    EmulatorEngine::instance().setUserDir(toString(env, dir));
}

jint LoadRom(JNIEnv* env, jclass, jstring path) {
    return static_cast<jint>(EmulatorEngine::instance().loadRom(toString(env, path)));
}

void UnloadRom(JNIEnv*, jclass) {
    EmulatorEngine::instance().unloadRom();
}

void SetPaused(JNIEnv*, jclass, jboolean paused) {
    EmulatorEngine::instance().setPaused(paused == JNI_TRUE);
}

void Reset(JNIEnv*, jclass) {
    EmulatorEngine::instance().reset();
}

jstring GetGameTitle(JNIEnv* env, jclass) {
    return env->NewStringUTF(EmulatorEngine::instance().gameTitle().c_str());
}

jlong GetTitleId(JNIEnv*, jclass) {
    return static_cast<jlong>(EmulatorEngine::instance().titleId());
}

jintArray GetVideoSize(JNIEnv* env, jclass) {
    int width = 0;
    int height = 0;
    EmulatorEngine::instance().videoSize(&width, &height);
    jintArray result = env->NewIntArray(2);
    const jint values[2] = {width, height};
    env->SetIntArrayRegion(result, 0, 2, values);
    return result;
}

void SetScreenLayout(JNIEnv*, jclass, jboolean sideBySide) {
    EmulatorEngine::instance().setScreenLayout(sideBySide == JNI_TRUE);
}

void SetButton(JNIEnv*, jclass, jint buttonId, jboolean pressed) {
    EmulatorEngine::instance().setButton(buttonId, pressed == JNI_TRUE);
}

void SetCirclePad(JNIEnv*, jclass, jfloat x, jfloat y) {
    EmulatorEngine::instance().setCirclePad(x, y);
}

void SetTouch(JNIEnv*, jclass, jint x, jint y, jboolean down) {
    EmulatorEngine::instance().setTouch(x, y, down == JNI_TRUE);
}

jboolean SaveState(JNIEnv*, jclass, jint slot) {
    return EmulatorEngine::instance().saveState(slot) ? JNI_TRUE : JNI_FALSE;
}

jboolean LoadState(JNIEnv*, jclass, jint slot) {
    return EmulatorEngine::instance().loadState(slot) ? JNI_TRUE : JNI_FALSE;
}

jboolean DeleteState(JNIEnv*, jclass, jint slot) {
    return EmulatorEngine::instance().deleteState(slot) ? JNI_TRUE : JNI_FALSE;
}

jboolean DeleteSaveData(JNIEnv*, jclass, jlong titleId) {
    return EmulatorEngine::instance().deleteSaveData(static_cast<uint64_t>(titleId)) ? JNI_TRUE
                                                                                     : JNI_FALSE;
}

jintArray CaptureFrame(JNIEnv* env, jclass) {
    std::vector<int32_t> frame;
    if (!EmulatorEngine::instance().captureFrame(frame)) {
        return nullptr;
    }
    jintArray result = env->NewIntArray(static_cast<jsize>(frame.size()));
    env->SetIntArrayRegion(result, 0, static_cast<jsize>(frame.size()),
                           reinterpret_cast<const jint*>(frame.data()));
    return result;
}

void SetVolume(JNIEnv*, jclass, jfloat volume) {
    EmulatorEngine::instance().setVolume(volume);
}

void SetSpeed(JNIEnv*, jclass, jfloat multiplier) {
    EmulatorEngine::instance().setSpeed(multiplier);
}

void SurfaceChanged(JNIEnv* env, jclass, jobject surface) {
    ANativeWindow* window = surface ? ANativeWindow_fromSurface(env, surface) : nullptr;
    EmulatorEngine::instance().surfaceChanged(window);
}

void SurfaceDestroyed(JNIEnv*, jclass) {
    EmulatorEngine::instance().surfaceDestroyed();
}

void TryPresent(JNIEnv*, jclass) {
    EmulatorEngine::instance().tryPresent();
}

const JNINativeMethod kMethods[] = {
    {"nativeGetCoreVersion", "()Ljava/lang/String;", reinterpret_cast<void*>(GetCoreVersion)},
    {"nativeSetUserDir", "(Ljava/lang/String;)V", reinterpret_cast<void*>(SetUserDir)},
    {"nativeLoadRom", "(Ljava/lang/String;)I", reinterpret_cast<void*>(LoadRom)},
    {"nativeUnloadRom", "()V", reinterpret_cast<void*>(UnloadRom)},
    {"nativeSetPaused", "(Z)V", reinterpret_cast<void*>(SetPaused)},
    {"nativeReset", "()V", reinterpret_cast<void*>(Reset)},
    {"nativeGetGameTitle", "()Ljava/lang/String;", reinterpret_cast<void*>(GetGameTitle)},
    {"nativeGetTitleId", "()J", reinterpret_cast<void*>(GetTitleId)},
    {"nativeGetVideoSize", "()[I", reinterpret_cast<void*>(GetVideoSize)},
    {"nativeSetScreenLayout", "(Z)V", reinterpret_cast<void*>(SetScreenLayout)},
    {"nativeSetButton", "(IZ)V", reinterpret_cast<void*>(SetButton)},
    {"nativeSetCirclePad", "(FF)V", reinterpret_cast<void*>(SetCirclePad)},
    {"nativeSetTouch", "(IIZ)V", reinterpret_cast<void*>(SetTouch)},
    {"nativeSaveState", "(I)Z", reinterpret_cast<void*>(SaveState)},
    {"nativeLoadState", "(I)Z", reinterpret_cast<void*>(LoadState)},
    {"nativeDeleteState", "(I)Z", reinterpret_cast<void*>(DeleteState)},
    {"nativeDeleteSaveData", "(J)Z", reinterpret_cast<void*>(DeleteSaveData)},
    {"nativeCaptureFrame", "()[I", reinterpret_cast<void*>(CaptureFrame)},
    {"nativeSetVolume", "(F)V", reinterpret_cast<void*>(SetVolume)},
    {"nativeSetSpeed", "(F)V", reinterpret_cast<void*>(SetSpeed)},
    {"nativeSurfaceChanged", "(Landroid/view/Surface;)V", reinterpret_cast<void*>(SurfaceChanged)},
    {"nativeSurfaceDestroyed", "()V", reinterpret_cast<void*>(SurfaceDestroyed)},
    {"nativeTryPresent", "()V", reinterpret_cast<void*>(TryPresent)},
};

} // namespace

extern "C" JNIEXPORT jint JNI_OnLoad(JavaVM* vm, void*) {
    JNIEnv* env = nullptr;
    if (vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
        return JNI_ERR;
    }
    jclass clazz = env->FindClass("expo/modules/azaharcore/AzaharCoreNative");
    if (clazz == nullptr) {
        return JNI_ERR;
    }
    g_nativeClass = static_cast<jclass>(env->NewGlobalRef(clazz));

    const jint count = sizeof(kMethods) / sizeof(kMethods[0]);
    if (env->RegisterNatives(g_nativeClass, kMethods, count) != JNI_OK) {
        return JNI_ERR;
    }

    // citra_common's FileUtil consults these Kotlin statics on Android;
    // InitJNI keeps the jclass, so it must be the global ref.
    AndroidUtils::InitJNI(env, g_nativeClass);

    g_onCoreError = env->GetStaticMethodID(g_nativeClass, "onCoreError", "(Ljava/lang/String;)V");
    if (g_onCoreError == nullptr) {
        return JNI_ERR;
    }
    EmulatorEngine::instance().setErrorCallback(postCoreError);

    return JNI_VERSION_1_6;
}
