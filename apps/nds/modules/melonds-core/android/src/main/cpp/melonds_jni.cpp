#include <jni.h>

#include <version.h>

// Minimal JNI layer for the first melonDS bring-up. It exposes a single version
// probe so that loading libmelonds-jni exercises the whole chain: the core
// compiled and linked, its headers (version.h here) are reachable, and the
// JNI_OnLoad -> RegisterNatives round-trip resolves. The real engine, input,
// save and video entry points land as the core is wired in — see the gba
// module's mgba_jni.cpp for the target shape.

namespace {

jstring nativeGetCoreVersion(JNIEnv* env, jclass) {
  return env->NewStringUTF(MELONDS_VERSION);
}

const JNINativeMethod kMethods[] = {
    {"nativeGetCoreVersion", "()Ljava/lang/String;", reinterpret_cast<void*>(nativeGetCoreVersion)},
};

}  // namespace

extern "C" JNIEXPORT jint JNI_OnLoad(JavaVM* vm, void*) {
  JNIEnv* env = nullptr;
  if (vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
    return JNI_ERR;
  }
  jclass clazz = env->FindClass("expo/modules/melondscore/MelondsCoreNative");
  if (!clazz) {
    return JNI_ERR;
  }
  if (env->RegisterNatives(clazz, kMethods, sizeof(kMethods) / sizeof(kMethods[0])) != JNI_OK) {
    return JNI_ERR;
  }
  return JNI_VERSION_1_6;
}
