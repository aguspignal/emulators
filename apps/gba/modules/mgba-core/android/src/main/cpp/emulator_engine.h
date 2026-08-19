#pragma once

#include <android/native_window.h>

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <functional>
#include <future>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "audio_sink.h"

struct mCore;

// Owns the single mGBA core instance, its emulation thread, the framebuffer,
// and the output surface. A singleton because the Expo Module and the Expo
// View are separate Kotlin objects that must drive the same emulator.
class EmulatorEngine {
public:
  static EmulatorEngine& instance();

  // Creates the core, loads ROM + battery save, resets to frame 0, and starts
  // the emulation thread paused. Returns false on any failure.
  bool loadRom(const std::string& romPath, const std::string& savPath);
  void unloadRom();

  void setPaused(bool paused);
  void reset();

  bool saveState(const std::string& path);
  bool loadState(const std::string& path);

  // Copies the frame currently on screen (the retained one while paused).
  // False when no ROM is loaded.
  bool captureFrame(std::vector<uint32_t>& out, unsigned* width, unsigned* height);

  // Pushes dirty battery-save data out to disk now, instead of waiting for the
  // idle frames that only a running game produces.
  void flushSaves();

  void setKeys(uint32_t keys) { mKeys.store(keys, std::memory_order_relaxed); }
  void setVolume(float volume) { mAudio.setVolume(volume); }
  void setSpeed(float multiplier);

  std::string gameTitle();
  int platform();  // mPlatform value; -1 when nothing is loaded
  void videoSize(unsigned* width, unsigned* height);

  // Surface handoff from the Kotlin view. surfaceDestroyed() must not return
  // until the window can no longer be touched by the emulation thread.
  void surfaceChanged(ANativeWindow* window);  // takes ownership of the reference
  void surfaceDestroyed();

private:
  EmulatorEngine() = default;

  void emuLoop();
  // Runs a closure on the emulation thread between frames; returns its result.
  bool runOnEmuThread(std::function<bool()> fn);
  // Emulation thread only, or once it has been joined.
  void forceSaveClean();
  // Load path only: (re)allocates the framebuffer for the core's current size.
  void syncVideoBuffer(mCore* core);
  void pumpAudio();
  void blitLocked();  // caller holds mSurfaceMutex

  mCore* mCore_ = nullptr;

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
  std::atomic<float> mSpeed{1.0f};

  std::vector<uint32_t> mFramebuffer;
  unsigned mFbWidth = 0;
  unsigned mFbHeight = 0;

  std::mutex mSurfaceMutex;
  ANativeWindow* mWindow = nullptr;

  AudioSink mAudio;
};
