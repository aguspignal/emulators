# to test

- once rom picker is implemented

Video — loadRom leaves the core paused at frame 0 and blits it, then EmulatorScreen.tsx:17 calls start(), so you should see the BIOS/boot logo animate immediately. Watch for: black screen with audio (surface never handed over), wrong colors (RGBX_8888 byte-order mismatch), torn/stale frames.

Aspect fit — the screen forces landscape while the app is portrait. Check the rotation transition doesn't leave a stretched or 240×160-sized surface, and load a GB/GBC ROM too — 160×144 exercises refreshAllLayouts() re-fitting after load, and the GBC detection at header 0x143.

Audio — Oboe + blip_buf ring buffer. Listen for crackling/underruns and for drift out of sync with video. Audio unavailable; continuing without sound in logcat means it fell back to silent.

Speed — the loop is clock-paced, so correct behavior is exactly 100%, not "fast". See the perf caveat below before judging this.

Input — nothing drives it yet. No on-screen gamepad, and MgbaCoreView handles no key events, so a Bluetooth controller does nothing. Test via temporary buttons calling core.setButton('a', true/false); the x/y/zl/zr names are intentionally no-ops on GBA.

Persistence — the battery .sav is only flushed on unloadRom → core->deinit (emulator_engine.cpp:104). So: save in-game → press Android back (unmounts the screen, unloads) → re-enter → confirm the save survived. Then the nastier one: save in-game and swipe-kill the app instead — nothing flushes, and you should expect to lose it. Worth confirming so you know it's a real gap rather than a bug hunt later.

Lifecycle — no background handling exists in the module. Expect emulation and audio to keep running with the screen off / app backgrounded. Confirm that returning to the app repaints correctly (the surface was destroyed and recreated) rather than showing black or crashing.
