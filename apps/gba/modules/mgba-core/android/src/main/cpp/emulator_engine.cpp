#include "emulator_engine.h"

#include <android/log.h>
#include <fcntl.h>

#include <algorithm>
#include <chrono>

#include <mgba/core/blip_buf.h>
#include <mgba/core/core.h>
#include <mgba/core/serialize.h>
#include <mgba-util/vfs.h>
// Internal headers: legal here only because this target compiles with the same
// M_CORE_GBA/M_CORE_GB defines as libmgba (see CMakeLists.txt). Never include
// them from a translation unit that doesn't.
#include <mgba/internal/defines.h>
#include <mgba/internal/gb/gb.h>
#include <mgba/internal/gba/gba.h>
#include <mgba/internal/gba/savedata.h>

#define LOG_TAG "MgbaEngine"
#define ALOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define ALOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

using namespace std::chrono;

EmulatorEngine& EmulatorEngine::instance() {
  static EmulatorEngine engine;
  return engine;
}

bool EmulatorEngine::loadRom(const std::string& romPath, const std::string& savPath) {
  unloadRom();

  mCore* core = mCoreFind(romPath.c_str());
  if (!core) {
    ALOGE("mCoreFind failed for %s", romPath.c_str());
    return false;
  }
  if (!core->init(core)) {
    ALOGE("core->init failed");
    return false;
  }
  mCoreInitConfig(core, "android");
  core->setAudioBufferSize(core, 1024);

  core->desiredVideoDimensions(core, &mFbWidth, &mFbHeight);
  mFramebuffer.assign(static_cast<size_t>(mFbWidth) * mFbHeight, 0);
  core->setVideoBuffer(core, mFramebuffer.data(), mFbWidth);

  if (!mCoreLoadFile(core, romPath.c_str())) {
    ALOGE("mCoreLoadFile failed for %s", romPath.c_str());
    mCoreConfigDeinit(&core->config);
    core->deinit(core);
    return false;
  }

  // The core takes ownership of the VFile and streams battery-save reads and
  // writes through it (flushed on deinit), so no config directory plumbing.
  VFile* sav = VFileOpen(savPath.c_str(), O_CREAT | O_RDWR);
  if (sav) {
    core->loadSave(core, sav);
  } else {
    ALOGE("Could not open save file %s; running without battery save", savPath.c_str());
  }

  core->reset(core);

  if (!mAudio.open()) {
    ALOGE("Audio unavailable; continuing without sound");
  }
  blip_set_rates(core->getAudioChannel(core, 0), core->frequency(core), mAudio.sampleRate());
  blip_set_rates(core->getAudioChannel(core, 1), core->frequency(core), mAudio.sampleRate());

  mCore_ = core;
  mKeys.store(0, std::memory_order_relaxed);

  {
    std::lock_guard<std::mutex> lock(mMutex);
    mThreadAlive = true;
    mPaused = true;  // contract: loadRom leaves the core paused at frame 0
  }
  mThread = std::thread(&EmulatorEngine::emuLoop, this);

  // Show frame 0 if the view's surface already exists.
  {
    std::lock_guard<std::mutex> lock(mSurfaceMutex);
    if (mWindow) {
      ANativeWindow_setBuffersGeometry(mWindow, mFbWidth, mFbHeight, WINDOW_FORMAT_RGBX_8888);
      blitLocked();
    }
  }
  return true;
}

void EmulatorEngine::unloadRom() {
  {
    std::lock_guard<std::mutex> lock(mMutex);
    if (!mThreadAlive && !mCore_) {
      return;
    }
    mThreadAlive = false;
    mCv.notify_all();
  }
  if (mThread.joinable()) {
    mThread.join();
  }
  mAudio.close();
  if (mCore_) {
    // The thread is gone, so this runs inline. deinit() msyncs the mapped save
    // but never writes the RTC footer, and it drops a masked save's pending
    // writeback — an in-game save made in the last few frames before exit, or
    // right after loading a state, would be lost without this.
    forceSaveClean();
    mCoreConfigDeinit(&mCore_->config);
    mCore_->deinit(mCore_);  // flushes the battery save through its VFile
    mCore_ = nullptr;
  }
  mFramebuffer.clear();
  mFbWidth = 0;
  mFbHeight = 0;
}

void EmulatorEngine::setPaused(bool paused) {
  {
    std::lock_guard<std::mutex> lock(mMutex);
    if (!mThreadAlive || mPaused == paused) {
      return;
    }
    mPaused = paused;
    mCv.notify_all();
  }
  if (paused) {
    mAudio.pause();
  } else {
    mAudio.start();
  }
}

void EmulatorEngine::reset() {
  runOnEmuThread([this] {
    mCore_->reset(mCore_);
    return true;
  });
}

bool EmulatorEngine::saveState(const std::string& path) {
  return runOnEmuThread([this, path] {
    VFile* vf = VFileOpen(path.c_str(), O_CREAT | O_TRUNC | O_RDWR);
    if (!vf) {
      return false;
    }
    bool ok = mCoreSaveStateNamed(mCore_, vf,
                                  SAVESTATE_SAVEDATA | SAVESTATE_RTC | SAVESTATE_METADATA);
    vf->close(vf);
    return ok;
  });
}

bool EmulatorEngine::loadState(const std::string& path) {
  return runOnEmuThread([this, path] {
    VFile* vf = VFileOpen(path.c_str(), O_RDONLY);
    if (!vf) {
      return false;
    }
    // No SAVESTATE_SAVEDATA, deliberately. The state's embedded save is applied
    // either way; the flag only decides whether it is written straight over the
    // real .sav (GBASavedataLoad — loading an old state would silently throw
    // away newer in-game progress) or masked over it read-only, committing only
    // if the game itself saves afterwards. The mask is what upstream mGBA
    // defaults to. SAVESTATE_METADATA has no meaning on load.
    bool ok = mCoreLoadStateNamed(mCore_, vf, SAVESTATE_RTC);
    vf->close(vf);
    return ok;
  });
}

bool EmulatorEngine::captureFrame(std::vector<uint32_t>& out, unsigned* width, unsigned* height) {
  // By reference: runOnEmuThread blocks until the closure has run.
  return runOnEmuThread([this, &out, width, height] {
    if (mFramebuffer.empty()) {
      return false;
    }
    out = mFramebuffer;
    *width = mFbWidth;
    *height = mFbHeight;
    return true;
  });
}

void EmulatorEngine::flushSaves() {
  runOnEmuThread([this] {
    forceSaveClean();
    return true;
  });
}

void EmulatorEngine::forceSaveClean() {
  if (!mCore_) {
    return;
  }
  // mGBA syncs a dirty save only once mSAVEDATA_CLEANUP_THRESHOLD frames have
  // passed with no further writes — frames a paused or backgrounded game never
  // runs. Two calls drive that state machine by hand: the first stamps the dirt
  // age, the second ages past the threshold so the sync (with the RTC footer,
  // and a masked save's writeback) actually happens. Both are no-ops on a save
  // that isn't dirty.
  switch (mCore_->platform(mCore_)) {
    case mPLATFORM_GBA: {
      auto* gba = static_cast<struct GBA*>(mCore_->board);
      const uint32_t frame = gba->video.frameCounter;
      GBASavedataClean(&gba->memory.savedata, frame);
      GBASavedataClean(&gba->memory.savedata, frame + mSAVEDATA_CLEANUP_THRESHOLD + 1);
      break;
    }
    case mPLATFORM_GB: {
      auto* gb = static_cast<struct GB*>(mCore_->board);
      const uint32_t frame = gb->video.frameCounter;
      GBSramClean(gb, frame);
      GBSramClean(gb, frame + mSAVEDATA_CLEANUP_THRESHOLD + 1);
      break;
    }
    default:
      break;
  }
}

void EmulatorEngine::setSpeed(float multiplier) {
  mSpeed.store(std::max(multiplier, 0.05f), std::memory_order_relaxed);
}

std::string EmulatorEngine::gameTitle() {
  if (!mCore_) {
    return "";
  }
  char title[17] = {0};
  mCore_->getGameTitle(mCore_, title);
  return title;
}

int EmulatorEngine::platform() {
  if (!mCore_) {
    return -1;  // mPLATFORM_NONE
  }
  return mCore_->platform(mCore_);
}

void EmulatorEngine::videoSize(unsigned* width, unsigned* height) {
  *width = mFbWidth;
  *height = mFbHeight;
}

void EmulatorEngine::surfaceChanged(ANativeWindow* window) {
  std::lock_guard<std::mutex> lock(mSurfaceMutex);
  if (mWindow) {
    ANativeWindow_release(mWindow);
  }
  mWindow = window;
  if (mWindow && mFbWidth > 0) {
    ANativeWindow_setBuffersGeometry(mWindow, mFbWidth, mFbHeight, WINDOW_FORMAT_RGBX_8888);
    blitLocked();  // repaint the retained frame so a paused game is visible after remount
  }
}

void EmulatorEngine::surfaceDestroyed() {
  // Blocks until any in-flight blit finishes: Android invalidates the surface
  // as soon as the Kotlin surfaceDestroyed callback returns.
  std::lock_guard<std::mutex> lock(mSurfaceMutex);
  if (mWindow) {
    ANativeWindow_release(mWindow);
    mWindow = nullptr;
  }
}

bool EmulatorEngine::runOnEmuThread(std::function<bool()> fn) {
  std::future<bool> result;
  {
    std::lock_guard<std::mutex> lock(mMutex);
    if (!mThreadAlive) {
      return false;
    }
    Command cmd;
    cmd.fn = std::move(fn);
    result = cmd.done.get_future();
    mCommands.push_back(std::move(cmd));
    mCv.notify_all();
  }
  return result.get();
}

void EmulatorEngine::pumpAudio() {
  blip_t* left = mCore_->getAudioChannel(mCore_, 0);
  blip_t* right = mCore_->getAudioChannel(mCore_, 1);
  int available = blip_samples_avail(left);
  int16_t buffer[512 * 2];
  while (available > 0) {
    const int n = std::min(available, 512);
    blip_read_samples(left, buffer, n, 1);
    blip_read_samples(right, buffer + 1, n, 1);
    mAudio.push(buffer, n);
    available -= n;
  }
}

void EmulatorEngine::blitLocked() {
  if (!mWindow || mFramebuffer.empty()) {
    return;
  }
  ANativeWindow_Buffer out;
  if (ANativeWindow_lock(mWindow, &out, nullptr) != 0) {
    return;
  }
  const unsigned rows = std::min<unsigned>(mFbHeight, out.height);
  const unsigned cols = std::min<unsigned>(mFbWidth, out.width);
  auto* dst = static_cast<uint32_t*>(out.bits);
  for (unsigned y = 0; y < rows; y++) {
    memcpy(dst + static_cast<size_t>(y) * out.stride, mFramebuffer.data() + static_cast<size_t>(y) * mFbWidth,
           cols * sizeof(uint32_t));
  }
  ANativeWindow_unlockAndPost(mWindow);
}

void EmulatorEngine::emuLoop() {
  auto next = steady_clock::now();
  for (;;) {
    std::deque<Command> commands;
    {
      std::unique_lock<std::mutex> lock(mMutex);
      mCv.wait(lock, [this] { return !mCommands.empty() || !mPaused || !mThreadAlive; });
      commands.swap(mCommands);
      if (!mThreadAlive) {
        // Fulfill stragglers so no caller blocks forever, then exit.
        for (auto& cmd : commands) {
          cmd.done.set_value(false);
        }
        return;
      }
      if (commands.empty() && mPaused) {
        continue;
      }
    }

    for (auto& cmd : commands) {
      cmd.done.set_value(cmd.fn());
    }

    bool ranFrame = false;
    {
      std::lock_guard<std::mutex> lock(mMutex);
      if (!mPaused && mThreadAlive) {
        mCore_->setKeys(mCore_, mKeys.load(std::memory_order_relaxed));
        mCore_->runFrame(mCore_);
        ranFrame = true;
      }
    }
    if (!ranFrame) {
      next = steady_clock::now();
      continue;
    }

    pumpAudio();
    {
      std::lock_guard<std::mutex> lock(mSurfaceMutex);
      blitLocked();
    }

    // GBA: 280896 cycles / 16.78 MHz ≈ 16.74 ms per frame; GB differs, so
    // derive from the core each iteration. setSpeed scales the frame budget.
    const double frameSeconds =
        static_cast<double>(mCore_->frameCycles(mCore_)) / mCore_->frequency(mCore_);
    next += duration_cast<steady_clock::duration>(
        duration<double>(frameSeconds / mSpeed.load(std::memory_order_relaxed)));
    const auto now = steady_clock::now();
    if (next < now) {
      next = now;  // fell behind; don't spiral
    } else {
      std::this_thread::sleep_until(next);
    }
  }
}
