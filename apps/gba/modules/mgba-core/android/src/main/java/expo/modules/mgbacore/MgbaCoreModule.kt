package expo.modules.mgbacore

import android.graphics.Bitmap
import android.net.Uri
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream

private class RomLoadException(uri: String, cause: Throwable? = null) :
  CodedException("ERR_ROM_LOAD", "Failed to load ROM from $uri", cause)

private class NoRomLoadedException :
  CodedException("ERR_NO_ROM", "No ROM is loaded", null)

private class SaveStateException(slot: Int, loading: Boolean) :
  CodedException(
    "ERR_SAVESTATE",
    "Failed to ${if (loading) "load" else "save"} state in slot $slot",
    null,
  )

private class ScreenshotException(reason: String, cause: Throwable? = null) :
  CodedException("ERR_SCREENSHOT", "Failed to capture a screenshot: $reason", cause)

private class SaveDataException(reason: String) :
  CodedException("ERR_SAVE_DATA", "Failed to delete save data: $reason", null)

/** The only shape a ROM hash may have; anything else is a path-traversal risk. */
private val SHA1_PATTERN = Regex("^[0-9a-f]{40}$")

// Implements the @emulators/core-interface contract on top of the native
// mGBA engine (modules/mgba-core/android/src/main/cpp). This class owns the
// idle/running/paused state machine; the engine just obeys.
class MgbaCoreModule : Module() {
  @Volatile
  private var state = "idle"

  @Volatile
  private var currentRom: ResolvedRom? = null

  /** Set only when the activity lifecycle paused a running game, so only such a game resumes. */
  @Volatile
  private var resumeOnForeground = false

  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun setState(next: String) {
    if (state != next) {
      state = next
      sendEvent("stateChange", mapOf("state" to next))
    }
  }

  private fun emitError(message: String) {
    sendEvent("error", mapOf("message" to message))
  }

  override fun definition() = ModuleDefinition {
    Name("MgbaCore")

    Events("stateChange", "error")

    // AsyncFunctions run on the module's background dispatcher, so blocking
    // on file copies and emu-thread futures here is fine.
    AsyncFunction("loadRom") { uri: String ->
      val rom = try {
        RomFiles.resolve(context, uri)
      } catch (e: Exception) {
        emitError("Could not read ROM: ${e.message}")
        throw RomLoadException(uri, e)
      }
      if (!MgbaCoreNative.nativeLoadRom(rom.path, RomFiles.savPath(context, rom.sha1))) {
        emitError("mGBA could not load this ROM")
        throw RomLoadException(uri)
      }
      currentRom = rom
      resumeOnForeground = false
      MgbaCoreNative.clearKeys()
      setState("paused") // contract: paused at frame 0; start() begins from here
      MgbaCoreView.refreshAllLayouts()

      val console = RomFiles.consoleFor(MgbaCoreNative.nativeGetPlatform(), File(rom.path))
      mapOf(
        "title" to MgbaCoreNative.nativeGetGameTitle().ifBlank { rom.fallbackTitle },
        "console" to console,
        "size" to rom.size,
        "sha1" to rom.sha1,
      )
    }

    AsyncFunction("unloadRom") {
      MgbaCoreNative.nativeUnloadRom()
      MgbaCoreNative.clearKeys()
      currentRom = null
      resumeOnForeground = false
      setState("idle")
    }

    Function("start") {
      if (state == "paused") {
        MgbaCoreNative.nativeSetPaused(false)
        setState("running")
      }
    }

    Function("pause") {
      if (state == "running") {
        MgbaCoreNative.nativeSetPaused(true)
        setState("paused")
        resumeOnForeground = false // an explicit pause outlives a trip to the background
      }
    }

    Function("resume") {
      if (state == "paused") {
        MgbaCoreNative.nativeSetPaused(false)
        setState("running")
      }
    }

    Function("reset") {
      MgbaCoreNative.nativeReset()
    }

    Function("getState") { state }

    // The emulation thread and the audio stream are native: without this they
    // keep running (and playing) with the app backgrounded or the screen off,
    // whatever JS does. Fires on the activity's onPause/onResume, so it also
    // covers the screen simply being switched off. The shared UI pauses on
    // AppState too; both paths are guarded on `state`, so they can't fight.
    OnActivityEntersBackground {
      if (state == "running") {
        MgbaCoreNative.nativeSetPaused(true)
        setState("paused")
        resumeOnForeground = true
      }
      // A paused game runs no frames, and frames are what normally flush the
      // battery save — so an in-game save made just before switching away would
      // sit in memory until the process is killed. Costs at most one frame's
      // wait on the emulation thread.
      if (currentRom != null) {
        MgbaCoreNative.nativeFlushSaves()
      }
    }

    OnActivityEntersForeground {
      if (resumeOnForeground) {
        resumeOnForeground = false
        if (state == "paused") {
          MgbaCoreNative.nativeSetPaused(false)
          setState("running")
        }
      }
    }

    Function("setButton") { button: String, pressed: Boolean ->
      MgbaCoreNative.updateKey(button, pressed)
    }

    // GBA/GB/GBC have no touch screen.
    Function("setTouch") { _: Double, _: Double, _: Boolean -> }

    AsyncFunction("saveState") { slot: Int ->
      val rom = currentRom ?: throw NoRomLoadedException()
      if (!MgbaCoreNative.nativeSaveState(RomFiles.statePath(context, rom.sha1, slot))) {
        throw SaveStateException(slot, loading = false)
      }
    }

    AsyncFunction("loadState") { slot: Int ->
      val rom = currentRom ?: throw NoRomLoadedException()
      if (!MgbaCoreNative.nativeLoadState(RomFiles.statePath(context, rom.sha1, slot))) {
        throw SaveStateException(slot, loading = true)
      }
    }

    AsyncFunction("deleteState") { slot: Int ->
      val rom = currentRom ?: throw NoRomLoadedException()
      File(RomFiles.statePath(context, rom.sha1, slot)).delete() // absent slot: fine
    }

    // Takes the hash instead of acting on the loaded ROM: the library deletes
    // saves for a ROM it is removing, which by definition isn't playing.
    AsyncFunction("deleteSaveData") { sha1: String ->
      if (!SHA1_PATTERN.matches(sha1)) {
        throw SaveDataException("'$sha1' is not a ROM hash")
      }
      if (currentRom?.sha1 == sha1) {
        throw SaveDataException("that ROM is loaded")
      }
      RomFiles.deleteSaveData(context, sha1)
    }

    // Encodes the frame natively and writes it where the caller asked; pixels
    // never reach JS.
    AsyncFunction("captureScreenshot") { uri: String ->
      val parsed = Uri.parse(uri)
      val path = when (parsed.scheme) {
        null, "", "file" -> parsed.path ?: uri
        else -> throw ScreenshotException("unsupported URI scheme ${parsed.scheme}")
      }
      val frame = MgbaCoreNative.nativeCaptureFrame() ?: throw NoRomLoadedException()
      val width = frame[0]
      val height = frame[1]
      if (width <= 0 || height <= 0) {
        throw ScreenshotException("empty frame")
      }
      // Reads the pixels straight out of the JNI array, past the two dimensions.
      val bitmap = Bitmap.createBitmap(frame, 2, width, width, height, Bitmap.Config.ARGB_8888)
      try {
        val file = File(path)
        file.parentFile?.mkdirs()
        FileOutputStream(file).use { out -> bitmap.compress(Bitmap.CompressFormat.PNG, 100, out) }
      } catch (e: Exception) {
        throw ScreenshotException("could not write $path", e)
      } finally {
        bitmap.recycle()
      }
    }

    Function("setVolume") { volume: Double ->
      MgbaCoreNative.nativeSetVolume(volume.coerceIn(0.0, 1.0).toFloat())
    }

    Function("setSpeed") { multiplier: Double ->
      MgbaCoreNative.nativeSetSpeed(multiplier.toFloat())
    }

    // Last resort: JS normally unloads on unmount, but a dev reload or an
    // activity teardown can skip that, and unloadRom is what commits the
    // battery save. Idempotent when nothing is loaded.
    OnDestroy {
      MgbaCoreNative.nativeUnloadRom()
      currentRom = null
    }

    View(MgbaCoreView::class) {}
  }
}
