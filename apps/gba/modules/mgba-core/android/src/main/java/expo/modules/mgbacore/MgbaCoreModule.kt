package expo.modules.mgbacore

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Stub implementation of the @emulators/core-interface contract.
// TODO: bridge these calls into mGBA (C core via JNI).
class MgbaCoreModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MgbaCore")

    Events("stateChange", "error")

    AsyncFunction("loadRom") { uri: String ->
      mapOf(
        "title" to uri.substringAfterLast('/'),
        "console" to "gba",
        "size" to 0
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

    Function("setVolume") { volume: Double -> }
    Function("setSpeed") { multiplier: Double -> }

    View(MgbaCoreView::class) {}
  }
}
