package expo.modules.azaharcore

import android.graphics.Bitmap
import android.net.Uri
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream

private class RomLoadException(uri: String, reason: String? = null, cause: Throwable? = null) :
  CodedException(
    "ERR_ROM_LOAD",
    "Failed to load ROM from $uri${reason?.let { ": $it" } ?: ""}",
    cause,
  )

/** Own code so the shared UI can tell the player to decrypt, not re-dump. */
private class RomEncryptedException(uri: String) :
  CodedException("ERR_ROM_ENCRYPTED", "The ROM at $uri is encrypted; Azahar cannot decrypt", null)

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

/** Core::System::ResultStatus::ErrorLoader_ErrorEncrypted (vendor src/core/core.h). */
private const val LOAD_ERROR_ENCRYPTED = 5

/**
 * Human-readable reason for a nativeLoadRom status — for the log and the
 * rejection message, not the alert (the shared UI localizes that). The values
 * are Core::System::ResultStatus (vendor src/core/core.h); -1 is the engine's
 * own surface timeout.
 */
private fun loadFailureReason(status: Int): String = when (status) {
  -1 -> "the emulator view never provided a rendering surface"
  -2 -> "the core failed while booting this ROM (native exception; see logcat)"
  2 -> "no loader recognizes this file type"
  5 -> "the ROM is encrypted, and Azahar cannot decrypt"
  6 -> "the ROM file format is invalid"
  7 -> "GBA Virtual Console titles are not supported"
  10 -> "required system files are missing"
  else -> "Azahar load status $status"
}

// Implements the @emulators/core-interface contract on top of the native
// Azahar engine (modules/azahar-core/android/src/main/cpp). This class owns
// the idle/running/paused state machine; the engine just obeys.
class AzaharCoreModule : Module() {
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
    Name("AzaharCore")

    Events("stateChange", "error")

    // The core roots its whole user tree (config/sdmc/nand/states) here, and
    // the AndroidUtils statics resolve relative core paths against the same
    // directory — set it before anything can touch a file.
    OnCreate {
      appContext.reactContext?.let {
        AzaharCoreNative.initUserDir(RomFiles.userDir(it))
      }
      // Errors the emulation thread surfaces mid-game (the engine parks the
      // core and reports; JS decides whether to exit).
      AzaharCoreNative.errorSink = { message -> emitError(message) }
    }

    // AsyncFunctions run on the module's background dispatcher, so blocking
    // on file copies and emu-thread futures here is fine.
    AsyncFunction("loadRom") { uri: String ->
      val rom = try {
        RomFiles.resolve(context, uri)
      } catch (e: Exception) {
        emitError("Could not read ROM: ${e.message}")
        throw RomLoadException(uri, cause = e)
      }
      val status = AzaharCoreNative.nativeLoadRom(rom.path)
      if (status != 0) {
        val reason = loadFailureReason(status)
        emitError("Azahar could not load this ROM: $reason")
        if (status == LOAD_ERROR_ENCRYPTED) throw RomEncryptedException(uri)
        throw RomLoadException(uri, reason)
      }
      currentRom = rom
      resumeOnForeground = false
      AzaharCoreNative.clearKeys()
      // Azahar keys saves by title id; remember which title this hash boots so
      // deleteSaveData(sha1) can clean up later without the ROM.
      RomFiles.writeTitleIdMap(context, rom.sha1, AzaharCoreNative.nativeGetTitleId())
      setState("paused") // contract: paused at frame 0; start() begins from here
      AzaharCoreView.refreshAllLayouts()

      mapOf(
        "title" to AzaharCoreNative.nativeGetGameTitle().ifBlank { rom.fallbackTitle },
        // One console per app here, so there is no header sniffing to do.
        "console" to "3ds",
        "size" to rom.size,
        "sha1" to rom.sha1,
      )
    }

    AsyncFunction("unloadRom") {
      AzaharCoreNative.nativeUnloadRom()
      AzaharCoreNative.clearKeys()
      currentRom = null
      resumeOnForeground = false
      setState("idle")
    }

    Function("start") {
      if (state == "paused") {
        AzaharCoreNative.nativeSetPaused(false)
        setState("running")
      }
    }

    Function("pause") {
      if (state == "running") {
        AzaharCoreNative.nativeSetPaused(true)
        setState("paused")
        resumeOnForeground = false // an explicit pause outlives a trip to the background
      }
    }

    Function("resume") {
      if (state == "paused") {
        AzaharCoreNative.nativeSetPaused(false)
        setState("running")
      }
    }

    Function("reset") {
      AzaharCoreNative.nativeReset()
    }

    Function("getState") { state }

    // The emulation thread and the audio stream are native: without this they
    // keep running (and playing) with the app backgrounded or the screen off,
    // whatever JS does. The emulated 3DS writes its saves through the file
    // system as games commit them, so there is no flush call here.
    OnActivityEntersBackground {
      if (state == "running") {
        AzaharCoreNative.nativeSetPaused(true)
        setState("paused")
        resumeOnForeground = true
      }
    }

    OnActivityEntersForeground {
      if (resumeOnForeground) {
        resumeOnForeground = false
        if (state == "paused") {
          AzaharCoreNative.nativeSetPaused(false)
          setState("running")
        }
      }
    }

    Function("setButton") { button: String, pressed: Boolean ->
      AzaharCoreNative.updateKey(button, pressed)
    }

    // Coordinates arrive already mapped into bottom-screen native pixels by the
    // shared UI, which aspect-fits the composited frame the same way the
    // native view does.
    Function("setTouch") { x: Double, y: Double, pressed: Boolean ->
      AzaharCoreNative.nativeSetTouch(x.toInt(), y.toInt(), pressed)
    }

    AsyncFunction("saveState") { slot: Int ->
      if (currentRom == null) throw NoRomLoadedException()
      if (!AzaharCoreNative.nativeSaveState(slot)) {
        throw SaveStateException(slot, loading = false)
      }
    }

    AsyncFunction("loadState") { slot: Int ->
      if (currentRom == null) throw NoRomLoadedException()
      if (!AzaharCoreNative.nativeLoadState(slot)) {
        throw SaveStateException(slot, loading = true)
      }
    }

    AsyncFunction("deleteState") { slot: Int ->
      if (currentRom == null) throw NoRomLoadedException()
      AzaharCoreNative.nativeDeleteState(slot) // absent slot: fine
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
      // No map entry means this ROM never booted here — nothing to delete.
      val titleId = RomFiles.readTitleIdMap(context, sha1) ?: return@AsyncFunction
      AzaharCoreNative.nativeDeleteSaveData(titleId)
      RomFiles.deleteTitleIdMap(context, sha1)
    }

    // Encodes the frame natively and writes it where the caller asked; pixels
    // never reach JS. The frame is both screens stacked, which is the aspect
    // ratio SlotSheet's thumbnails already assume.
    AsyncFunction("captureScreenshot") { uri: String ->
      val parsed = Uri.parse(uri)
      val path = when (parsed.scheme) {
        null, "", "file" -> parsed.path ?: uri
        else -> throw ScreenshotException("unsupported URI scheme ${parsed.scheme}")
      }
      val frame = AzaharCoreNative.nativeCaptureFrame() ?: throw NoRomLoadedException()
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
      AzaharCoreNative.nativeSetVolume(volume.coerceIn(0.0, 1.0).toFloat())
    }

    Function("setSpeed") { multiplier: Double ->
      AzaharCoreNative.nativeSetSpeed(multiplier.toFloat())
    }

    // Last resort: JS normally unloads on unmount, but a dev reload or an
    // activity teardown can skip that. Idempotent when nothing is loaded.
    OnDestroy {
      AzaharCoreNative.errorSink = null
      AzaharCoreNative.nativeUnloadRom()
      currentRom = null
    }

    View(AzaharCoreView::class) {
      // "horizontal" puts the two screens side by side (landscape); anything
      // else stacks them. The shared EmulatorScreen sets it per orientation.
      Prop("screenLayout") { view: AzaharCoreView, layout: String? ->
        view.setScreenLayout(layout == "horizontal")
      }
    }
  }
}
