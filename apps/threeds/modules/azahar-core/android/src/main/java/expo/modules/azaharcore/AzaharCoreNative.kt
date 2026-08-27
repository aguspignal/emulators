package expo.modules.azaharcore

import android.view.Surface
import java.io.File
import kotlin.math.sqrt

/**
 * JNI surface of the Azahar core. The native side registers its methods against
 * this class by name (see azahar_jni.cpp); consumer-rules.pro keeps R8 away.
 *
 * Beyond the engine calls, Azahar's own citra_common calls the @JvmStatic
 * methods below (AndroidUtils::InitJNI caches them at load): they answer file
 * system questions on Android. This app always uses raw paths ("vanilla"
 * flavor semantics), so the SAF-style entry points are plain java.io.File.
 */
object AzaharCoreNative {
  init {
    System.loadLibrary("azahar-jni")
  }

  /** Where the core's user tree (config/sdmc/nand/states/...) lives. */
  @Volatile
  private var userDir: String? = null

  /** Receives core errors posted from the emulation thread. */
  @Volatile
  var errorSink: ((String) -> Unit)? = null

  fun initUserDir(dir: String) {
    userDir = dir
    nativeSetUserDir(dir)
  }

  // Contract button name -> Azahar's InputManager::ButtonType id.
  private val BUTTON_IDS = mapOf(
    "a" to 700,
    "b" to 701,
    "x" to 702,
    "y" to 703,
    "start" to 704,
    "select" to 705,
    "zl" to 707,
    "zr" to 708,
    "up" to 709,
    "down" to 710,
    "left" to 711,
    "right" to 712,
    "l" to 773,
    "r" to 774,
  )
  private val DPAD = setOf("up", "down", "left", "right")

  private val pressedDpad = HashSet<String>()

  /**
   * Most 3DS games move with the analog Circle Pad, which the digital gamepad
   * has no widget for — so the D-pad drives both: its real buttons (menus) and
   * a full-tilt Circle Pad vector (games). Diagonals are normalized.
   */
  fun updateKey(button: String, pressed: Boolean) {
    val id = BUTTON_IDS[button] ?: return
    nativeSetButton(id, pressed)
    if (button in DPAD) {
      synchronized(pressedDpad) {
        if (pressed) pressedDpad.add(button) else pressedDpad.remove(button)
        var x = 0f
        var y = 0f
        if ("left" in pressedDpad) x -= 1f
        if ("right" in pressedDpad) x += 1f
        if ("down" in pressedDpad) y -= 1f
        if ("up" in pressedDpad) y += 1f
        if (x != 0f && y != 0f) {
          val inv = 1f / sqrt(2f)
          x *= inv
          y *= inv
        }
        nativeSetCirclePad(x, y)
      }
    }
  }

  fun clearKeys() {
    for (id in BUTTON_IDS.values) {
      nativeSetButton(id, false)
    }
    synchronized(pressedDpad) { pressedDpad.clear() }
    nativeSetCirclePad(0f, 0f)
  }

  // ---- called from native ----

  @JvmStatic
  fun onCoreError(message: String) {
    errorSink?.invoke(message)
  }

  // ---- AndroidUtils statics (citra_common) ----

  @JvmStatic
  fun getBuildFlavor(): String = "vanilla"

  @JvmStatic
  fun getUserDirectory(): String? = userDir

  @JvmStatic
  fun isPortraitMode(): Boolean = false

  @JvmStatic
  fun isUsingAngleForOpenGL(): Boolean = false

  @JvmStatic
  fun createFile(directory: String, filename: String): Boolean =
    try {
      File(directory, filename).createNewFile()
    } catch (e: Exception) {
      false
    }

  @JvmStatic
  fun createDir(directory: String, filename: String): Boolean {
    val dir = File(directory, filename)
    return dir.isDirectory || dir.mkdirs()
  }

  /** No SAF in this app; content URIs never reach the core. */
  @JvmStatic
  fun openContentUri(filepath: String, openmode: String): Int = -1

  @JvmStatic
  fun getFilesName(filepath: String): Array<String> = File(filepath).list() ?: emptyArray()

  @JvmStatic
  fun copyFile(source: String, destinationPath: String, destinationFilename: String): Boolean =
    try {
      File(source).copyTo(File(destinationPath, destinationFilename), overwrite = true)
      true
    } catch (e: Exception) {
      false
    }

  @JvmStatic
  fun renameFile(source: String, filename: String): Boolean {
    val file = File(source)
    val parent = file.parentFile ?: return false
    return file.renameTo(File(parent, filename))
  }

  @JvmStatic
  fun updateDocumentLocation(sourcePath: String, destinationPath: String): Boolean = false

  @JvmStatic
  fun moveFile(filename: String, sourceDirPath: String, destinationDirPath: String): Boolean =
    try {
      val source = File(sourceDirPath, filename)
      val dest = File(destinationDirPath, filename)
      source.copyTo(dest, overwrite = true)
      source.delete()
      true
    } catch (e: Exception) {
      false
    }

  @JvmStatic
  fun isDirectory(path: String): Boolean = File(path).isDirectory

  @JvmStatic
  fun fileExists(path: String): Boolean = File(path).exists()

  @JvmStatic
  fun getSize(path: String): Long = File(path).length()

  @JvmStatic
  fun deleteDocument(path: String): Boolean = File(path).delete()

  // ---- engine ----

  external fun nativeGetCoreVersion(): String
  external fun nativeSetUserDir(dir: String)
  /** 0 on success, -1 for the engine's surface timeout, else Core::System::ResultStatus. */
  external fun nativeLoadRom(path: String): Int
  external fun nativeUnloadRom()
  external fun nativeSetPaused(paused: Boolean)
  external fun nativeReset()
  external fun nativeGetGameTitle(): String
  external fun nativeGetTitleId(): Long
  external fun nativeGetVideoSize(): IntArray
  external fun nativeSetScreenLayout(sideBySide: Boolean)
  external fun nativeSetButton(buttonId: Int, pressed: Boolean)
  external fun nativeSetCirclePad(x: Float, y: Float)
  external fun nativeSetTouch(x: Int, y: Int, down: Boolean)
  external fun nativeSaveState(slot: Int): Boolean
  external fun nativeLoadState(slot: Int): Boolean
  external fun nativeDeleteState(slot: Int): Boolean
  external fun nativeDeleteSaveData(titleId: Long): Boolean
  external fun nativeCaptureFrame(): IntArray?
  external fun nativeSetVolume(volume: Float)
  external fun nativeSetSpeed(multiplier: Float)
  external fun nativeSurfaceChanged(surface: Surface?)
  external fun nativeSurfaceDestroyed()
  external fun nativeTryPresent()
}
