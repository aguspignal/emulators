#include <android/native_window_jni.h>
#include <jni.h>

#include <string>

#include <mgba/core/version.h>

#include "emulator_engine.h"

namespace {

std::string toString(JNIEnv* env, jstring jstr) {
  const char* chars = env->GetStringUTFChars(jstr, nullptr);
  std::string result(chars ? chars : "");
  env->ReleaseStringUTFChars(jstr, chars);
  return result;
}

jstring nativeGetCoreVersion(JNIEnv* env, jclass) {
  return env->NewStringUTF(projectVersion);
}

jboolean nativeLoadRom(JNIEnv* env, jclass, jstring romPath, jstring savPath) {
  return EmulatorEngine::instance().loadRom(toString(env, romPath), toString(env, savPath));
}

void nativeUnloadRom(JNIEnv*, jclass) {
  EmulatorEngine::instance().unloadRom();
}

void nativeSetPaused(JNIEnv*, jclass, jboolean paused) {
  EmulatorEngine::instance().setPaused(paused);
}

void nativeReset(JNIEnv*, jclass) {
  EmulatorEngine::instance().reset();
}

jstring nativeGetGameTitle(JNIEnv* env, jclass) {
  return env->NewStringUTF(EmulatorEngine::instance().gameTitle().c_str());
}

jint nativeGetPlatform(JNIEnv*, jclass) {
  return EmulatorEngine::instance().platform();
}

jintArray nativeGetVideoSize(JNIEnv* env, jclass) {
  unsigned width = 0;
  unsigned height = 0;
  EmulatorEngine::instance().videoSize(&width, &height);
  jintArray result = env->NewIntArray(2);
  const jint dims[2] = {static_cast<jint>(width), static_cast<jint>(height)};
  env->SetIntArrayRegion(result, 0, 2, dims);
  return result;
}

void nativeSetKeys(JNIEnv*, jclass, jint keys) {
  EmulatorEngine::instance().setKeys(static_cast<uint32_t>(keys));
}

jboolean nativeSaveState(JNIEnv* env, jclass, jstring path) {
  return EmulatorEngine::instance().saveState(toString(env, path));
}

jboolean nativeLoadState(JNIEnv* env, jclass, jstring path) {
  return EmulatorEngine::instance().loadState(toString(env, path));
}

void nativeSetVolume(JNIEnv*, jclass, jfloat volume) {
  EmulatorEngine::instance().setVolume(volume);
}

void nativeSetSpeed(JNIEnv*, jclass, jfloat multiplier) {
  EmulatorEngine::instance().setSpeed(multiplier);
}

void nativeSurfaceChanged(JNIEnv* env, jclass, jobject surface) {
  ANativeWindow* window = surface ? ANativeWindow_fromSurface(env, surface) : nullptr;
  EmulatorEngine::instance().surfaceChanged(window);
}

void nativeSurfaceDestroyed(JNIEnv*, jclass) {
  EmulatorEngine::instance().surfaceDestroyed();
}

const JNINativeMethod kMethods[] = {
    {"nativeGetCoreVersion", "()Ljava/lang/String;", reinterpret_cast<void*>(nativeGetCoreVersion)},
    {"nativeLoadRom", "(Ljava/lang/String;Ljava/lang/String;)Z", reinterpret_cast<void*>(nativeLoadRom)},
    {"nativeUnloadRom", "()V", reinterpret_cast<void*>(nativeUnloadRom)},
    {"nativeSetPaused", "(Z)V", reinterpret_cast<void*>(nativeSetPaused)},
    {"nativeReset", "()V", reinterpret_cast<void*>(nativeReset)},
    {"nativeGetGameTitle", "()Ljava/lang/String;", reinterpret_cast<void*>(nativeGetGameTitle)},
    {"nativeGetPlatform", "()I", reinterpret_cast<void*>(nativeGetPlatform)},
    {"nativeGetVideoSize", "()[I", reinterpret_cast<void*>(nativeGetVideoSize)},
    {"nativeSetKeys", "(I)V", reinterpret_cast<void*>(nativeSetKeys)},
    {"nativeSaveState", "(Ljava/lang/String;)Z", reinterpret_cast<void*>(nativeSaveState)},
    {"nativeLoadState", "(Ljava/lang/String;)Z", reinterpret_cast<void*>(nativeLoadState)},
    {"nativeSetVolume", "(F)V", reinterpret_cast<void*>(nativeSetVolume)},
    {"nativeSetSpeed", "(F)V", reinterpret_cast<void*>(nativeSetSpeed)},
    {"nativeSurfaceChanged", "(Landroid/view/Surface;)V", reinterpret_cast<void*>(nativeSurfaceChanged)},
    {"nativeSurfaceDestroyed", "()V", reinterpret_cast<void*>(nativeSurfaceDestroyed)},
};

}  // namespace

extern "C" JNIEXPORT jint JNI_OnLoad(JavaVM* vm, void*) {
  JNIEnv* env = nullptr;
  if (vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
    return JNI_ERR;
  }
  jclass clazz = env->FindClass("expo/modules/mgbacore/MgbaCoreNative");
  if (!clazz) {
    return JNI_ERR;
  }
  if (env->RegisterNatives(clazz, kMethods, sizeof(kMethods) / sizeof(kMethods[0])) != JNI_OK) {
    return JNI_ERR;
  }
  return JNI_VERSION_1_6;
}
