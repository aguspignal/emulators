package expo.modules.mgbacore

import android.view.Surface
import java.util.concurrent.atomic.AtomicInteger

/**
 * JNI mirror of the native engine (mgba_jni.cpp registers these via
 * RegisterNatives in JNI_OnLoad). Also owns the pressed-key bitmask, built
 * from the shared contract's button names using mGBA's key bit layout
 * (mgba/internal/gba/input.h; the GB core shares the low 8 bits).
 */
object MgbaCoreNative {
  init {
    System.loadLibrary("mgba-jni")
  }

  // mPlatform values from mgba/core/core.h
  const val PLATFORM_GBA = 0
  const val PLATFORM_GB = 1

  private val BUTTON_BITS = mapOf(
    "a" to 0,
    "b" to 1,
    "select" to 2,
    "start" to 3,
    "right" to 4,
    "left" to 5,
    "up" to 6,
    "down" to 7,
    "r" to 8,
    "l" to 9,
    // x/y/zl/zr exist in the shared button union but have no GBA/GB mapping
  )

  private val keyMask = AtomicInteger(0)

  fun updateKey(button: String, pressed: Boolean) {
    val bit = BUTTON_BITS[button] ?: return
    val mask = if (pressed) {
      keyMask.updateAndGet { it or (1 shl bit) }
    } else {
      keyMask.updateAndGet { it and (1 shl bit).inv() }
    }
    nativeSetKeys(mask)
  }

  fun clearKeys() {
    keyMask.set(0)
    nativeSetKeys(0)
  }

  external fun nativeGetCoreVersion(): String
  external fun nativeLoadRom(romPath: String, savPath: String): Boolean
  external fun nativeUnloadRom()
  external fun nativeSetPaused(paused: Boolean)
  external fun nativeReset()
  external fun nativeGetGameTitle(): String
  external fun nativeGetPlatform(): Int
  external fun nativeGetVideoSize(): IntArray
  external fun nativeSetKeys(keys: Int)
  external fun nativeSaveState(path: String): Boolean
  external fun nativeLoadState(path: String): Boolean
  /** [width, height, pixels...] as opaque ARGB, or null when no ROM is loaded. */
  external fun nativeCaptureFrame(): IntArray?
  external fun nativeFlushSaves()
  external fun nativeSetVolume(volume: Float)
  external fun nativeSetSpeed(multiplier: Float)
  external fun nativeSurfaceChanged(surface: Surface?)
  external fun nativeSurfaceDestroyed()
}
