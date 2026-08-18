#pragma once

#include <android/native_window.h>

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <functional>
#include <future>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "audio_sink.h"

namespace melonDS {
class NDS;
}

// Owns the single melonDS instance, its emulation thread, the composited
// framebuffer, and the output surface. A singleton because the Expo Module and
// the Expo View are separate Kotlin objects that must drive the same emulator.
//
// Both DS screens are composited into ONE stacked 256x384 buffer (top over
// bottom), so the surface handling, the blit and the screenshot path are the
// same single-window code the GBA app uses.
class EmulatorEngine {
public:
  // Native pixel dimensions of the composited frame.
  static constexpr unsigned kScreenWidth = 256;
  static constexpr unsigned kScreenHeight = 192;
  static constexpr unsigned kFbWidth = kScreenWidth;
  static constexpr unsigned kFbHeight = kScreenHeight * 2;

  static EmulatorEngine& instance();

  ~EmulatorEngine();

  // Creates the console, loads ROM + battery save, direct-boots to frame 0, and
  // starts the emulation thread paused. Returns false on any failure.
  bool loadRom(const std::string& romPath, const std::string& savPath);
  void unloadRom();

  void setPaused(bool paused);
  void reset();

  bool saveState(const std::string& path);
  bool loadState(const std::string& path);

  // Copies the frame currently on screen (the retained one while paused).
  // False when no ROM is loaded.
  bool captureFrame(std::vector<uint32_t>& out, unsigned* width, unsigned* height);

  // Writes dirty battery-save data out to disk now, instead of waiting for the
  // quiet frames that only a running game produces.
  void flushSaves();

  // Pressed-high mask in melonDS bit order (A=0 … Y=11). The emulation thread
  // inverts it, because SetKeyMask is active-low.
  void setKeys(uint32_t keys) { mKeys.store(keys, std::memory_order_relaxed); }
  // Touch-screen coordinates in bottom-screen native pixels (0..255, 0..191).
  void setTouch(int x, int y, bool down);

  void setVolume(float volume) { mAudio.setVolume(volume); }
  void setSpeed(float multiplier);

  std::string gameTitle();
  void videoSize(unsigned* width, unsigned* height);

  // Surface handoff from the Kotlin view. surfaceDestroyed() must not return
  // until the window can no longer be touched by the emulation thread.
  void surfaceChanged(ANativeWindow* window);  // takes ownership of the reference
  void surfaceDestroyed();

  // melonDS::Platform callbacks, routed here through the `userdata` pointer
  // handed to NDS and ParseROM. Emulation thread (or the loader, before it
  // starts).
  void onNDSSaveWritten(const uint8_t* savedata, uint32_t savelen, uint32_t writeoffset,
                        uint32_t writelen);
  void onStopSignalled(int reason);

private:
  EmulatorEngine() = default;

  void emuLoop();
  // Runs a closure on the emulation thread between frames; returns its result.
  bool runOnEmuThread(std::function<bool()> fn);
  void compositeFrame();      // emulation thread only
  void pumpAudio();           // emulation thread only
  void writeSaveFile();       // emulation thread only, or once it has been joined
  void blitLocked();          // caller holds mSurfaceMutex

  std::unique_ptr<melonDS::NDS> mNds;

  std::thread mThread;
  std::mutex mMutex;
  std::condition_variable mCv;
  bool mThreadAlive = false;
  bool mPaused = true;

  struct Command {
    std::function<bool()> fn;
    std::promise<bool> done;
  };
  std::deque<Command> mCommands;

  std::atomic<uint32_t> mKeys{0};
  // Packed so the emulation thread reads one consistent snapshot:
  // bit 24 = down, bits 8-15 = y, bits 0-7 = x.
  std::atomic<uint32_t> mTouch{0};
  std::atomic<float> mSpeed{1.0f};

  std::vector<uint32_t> mFramebuffer;
  unsigned mFbWidth = 0;
  unsigned mFbHeight = 0;

  std::string mGameTitle;
  // Base ROM filename; SetupDirectBoot wants it, and reset() direct-boots again.
  std::string mRomName;
  // Set from Platform::SignalStop, which can fire inside RunFrame while mMutex
  // is held — so it is an atomic the loop checks, never a locked field.
  std::atomic<bool> mStopped{false};

  // Battery save. melonDS reports every cart SRAM write through
  // Platform::WriteNDSSave; we only mark the save dirty there and write the
  // whole buffer out once the game has stopped writing, on unload, or when the
  // app is backgrounded.
  std::string mSavPath;
  bool mSaveDirty = false;
  int mFramesSinceSaveWrite = 0;

  std::mutex mSurfaceMutex;
  ANativeWindow* mWindow = nullptr;

  AudioSink mAudio;
};
