package expo.modules.mgbacore

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

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

// Implements the @emulators/core-interface contract on top of the native
// mGBA engine (modules/mgba-core/android/src/main/cpp). This class owns the
// idle/running/paused state machine; the engine just obeys.
class MgbaCoreModule : Module() {
  @Volatile
  private var state = "idle"

  @Volatile
  private var currentRom: ResolvedRom? = null

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
      MgbaCoreNative.clearKeys()
      setState("paused") // contract: paused at frame 0; start() begins from here
      MgbaCoreView.refreshAllLayouts()

      val console = RomFiles.consoleFor(MgbaCoreNative.nativeGetPlatform(), File(rom.path))
      mapOf(
        "title" to MgbaCoreNative.nativeGetGameTitle().ifBlank { rom.fallbackTitle },
        "console" to console,
        "size" to rom.size,
      )
    }

    AsyncFunction("unloadRom") {
      MgbaCoreNative.nativeUnloadRom()
      MgbaCoreNative.clearKeys()
      currentRom = null
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

    Function("setVolume") { volume: Double ->
      MgbaCoreNative.nativeSetVolume(volume.coerceIn(0.0, 1.0).toFloat())
    }

    Function("setSpeed") { multiplier: Double ->
      MgbaCoreNative.nativeSetSpeed(multiplier.toFloat())
    }

    View(MgbaCoreView::class) {}
  }
}
