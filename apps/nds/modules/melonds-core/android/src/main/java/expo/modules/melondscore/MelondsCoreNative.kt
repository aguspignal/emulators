package expo.modules.melondscore

/**
 * JNI mirror of the melonDS native layer (melonds_jni.cpp registers these via
 * RegisterNatives in JNI_OnLoad).
 *
 * Minimal for now: only a version probe, which is enough to validate that
 * libmelonds-jni loads and the linked core is reachable. The real engine,
 * input, save and video methods are added as the core is wired in — see the
 * gba module's MgbaCoreNative for the target shape.
 */
object MelondsCoreNative {
  init {
    System.loadLibrary("melonds-jni")
  }

  /** Version string reported by the linked melonDS core (e.g. "1.1"). */
  external fun nativeGetCoreVersion(): String
}
