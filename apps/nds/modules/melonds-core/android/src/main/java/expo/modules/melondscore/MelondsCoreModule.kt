package expo.modules.melondscore

import android.net.Uri
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.security.MessageDigest

// Stub implementation of the @emulators/core-interface contract.
// TODO: bridge these calls into melonDS (C++ core via JNI).
class MelondsCoreModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("MelondsCore")

    Events("stateChange", "error")

    AsyncFunction("loadRom") { uri: String ->
      mapOf(
        "title" to uri.substringAfterLast('/'),
        "console" to "nds",
        "size" to 0,
        // Hashed for real even though nothing emulates yet: the library stores
        // this per ROM, and a missing key would arrive in JS as `undefined`,
        // which SQLite refuses to bind.
        "sha1" to sha1Of(uri),
      )
    }

    AsyncFunction("unloadRom") {}

    Function("start") {}
    Function("pause") {}
    Function("resume") {}
    Function("reset") {}

    Function("getState") { "idle" }

    Function("setButton") { button: String, pressed: Boolean -> }
    Function("setTouch") { x: Double, y: Double, pressed: Boolean -> }

    AsyncFunction("saveState") { slot: Int -> }
    AsyncFunction("loadState") { slot: Int -> }
    AsyncFunction("deleteState") { slot: Int -> }
    AsyncFunction("deleteSaveData") { sha1: String -> }
    AsyncFunction("captureScreenshot") { uri: String -> }

    Function("setVolume") { volume: Double -> }
    Function("setSpeed") { multiplier: Double -> }

    View(MelondsCoreView::class) {}
  }

  /** Empty string when the ROM can't be read — the contract allows that. */
  private fun sha1Of(uri: String): String {
    return try {
      val parsed = Uri.parse(uri)
      val stream: InputStream = when (parsed.scheme) {
        null, "", "file" -> FileInputStream(File(parsed.path ?: uri))
        else -> context.contentResolver.openInputStream(parsed)
      } ?: return ""
      stream.use { input ->
        val digest = MessageDigest.getInstance("SHA-1")
        val buffer = ByteArray(64 * 1024)
        while (true) {
          val read = input.read(buffer)
          if (read < 0) break
          digest.update(buffer, 0, read)
        }
        digest.digest().joinToString("") { "%02x".format(it) }
      }
    } catch (e: Exception) {
      ""
    }
  }
}
