#include "emulator_engine.h"

#include <android/log.h>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>

#include <Args.h>
#include <GPU.h>
#include <GPU3D_Soft.h>
#include <NDS.h>
#include <NDSCart.h>
#include <SPU.h>
#include <Savestate.h>

#define LOG_TAG "MelonEngine"
#define ALOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define ALOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

using namespace std::chrono;

namespace {

// A DS frame is 355 dots x 263 lines x 6 system cycles = 560190 cycles at
// 33.513982 MHz, i.e. 59.8261 Hz. Unlike mGBA there is no per-core accessor for
// this, and the DS is the only console here, so it is a constant.
constexpr double kFrameSeconds = 560190.0 / 33513982.0;

constexpr int kAudioChunkFrames = 512;

// melonDS composites to 0xAARRGGBB, which is B,G,R,A in memory (its GPU2D
// comment calls it "32-bit BGRA"). Both the ANativeWindow blit
// (WINDOW_FORMAT_RGBX_8888) and the screenshot swizzle want red in the low
// byte, so red and blue swap on the way into our framebuffer. A blue-tinted
// picture means this broke.
inline uint32_t swapRedBlue(uint32_t pixel) {
  return (pixel & 0xFF00FF00u) | ((pixel >> 16) & 0xFFu) | ((pixel & 0xFFu) << 16);
}

// Reads a whole file. Returns false if it cannot be opened or read.
bool readWholeFile(const std::string& path, std::unique_ptr<uint8_t[]>& out, uint32_t& length) {
  FILE* file = fopen(path.c_str(), "rb");
  if (!file) {
    return false;
  }
  fseek(file, 0, SEEK_END);
  const long size = ftell(file);
  if (size <= 0) {
    fclose(file);
    return false;
  }
  fseek(file, 0, SEEK_SET);
  auto buffer = std::make_unique<uint8_t[]>(static_cast<size_t>(size));
  const size_t read = fread(buffer.get(), 1, static_cast<size_t>(size), file);
  fclose(file);
  if (read != static_cast<size_t>(size)) {
    return false;
  }
  out = std::move(buffer);
  length = static_cast<uint32_t>(size);
  return true;
}

std::string baseName(const std::string& path) {
  const size_t slash = path.find_last_of('/');
  return slash == std::string::npos ? path : path.substr(slash + 1);
}

}  // namespace

EmulatorEngine& EmulatorEngine::instance() {
  static EmulatorEngine engine;
  return engine;
}

// Out of line so the unique_ptr<NDS> member can be destroyed where NDS is a
// complete type; the header only forward-declares it.
EmulatorEngine::~EmulatorEngine() = default;

bool EmulatorEngine::loadRom(const std::string& romPath, const std::string& savPath) {
  unloadRom();

  std::unique_ptr<uint8_t[]> romData;
  uint32_t romLength = 0;
  if (!readWholeFile(romPath, romData, romLength)) {
    ALOGE("Could not read ROM %s", romPath.c_str());
    return false;
  }

  // Battery save, if one exists. melonDS sizes a fresh buffer from the cart
  // header when SRAMLength is 0, so a first boot needs no file.
  melonDS::NDSCart::NDSCartArgs cartArgs;
  {
    std::unique_ptr<uint8_t[]> savData;
    uint32_t savLength = 0;
    if (readWholeFile(savPath, savData, savLength)) {
      cartArgs.SRAM = std::move(savData);
      cartArgs.SRAMLength = savLength;
    }
  }

  // Open audio first: the console is constructed with the sink's actual device
  // rate, so the SPU resamples for us and there is no resampler here.
  if (!mAudio.open()) {
    ALOGE("Audio unavailable; continuing without sound");
  }

  melonDS::NDSArgs args{};  // FreeBIOS + generated firmware + software renderer
  args.OutputSampleRate = static_cast<double>(mAudio.sampleRate());
  auto nds = std::make_unique<melonDS::NDS>(std::move(args), this);

  auto cart = melonDS::NDSCart::ParseROM(std::move(romData), romLength, this, std::move(cartArgs));
  if (!cart) {
    ALOGE("ParseROM failed for %s", romPath.c_str());
    mAudio.close();
    return false;
  }

  {
    // GameTitle is a fixed 12-byte field and need not be NUL-terminated.
    char title[13] = {0};
    memcpy(title, cart->GetHeader().GameTitle, 12);
    mGameTitle = title;
    while (!mGameTitle.empty() && (mGameTitle.back() == ' ' || mGameTitle.back() == '\0')) {
      mGameTitle.pop_back();
    }
  }

  mRomName = baseName(romPath);
  mSavPath = savPath;
  mSaveDirty = false;
  mFramesSinceSaveWrite = 0;
  mStopped.store(false, std::memory_order_relaxed);

  // Cart first, then Reset, then direct boot — the order upstream's
  // EmuInstance::reset() uses. Resetting after the cart is inserted is what
  // lets SetupDirectBoot copy the ROM's secure area into main RAM.
  nds->SetNDSCart(std::move(cart));
  nds->Reset();
  if (nds->NeedsDirectBoot()) {
    // Always true with FreeBIOS and generated firmware, which is what makes
    // retail carts boot without the user supplying any BIOS dump.
    nds->SetupDirectBoot(mRomName);
  }
  nds->SetKeyMask(0xFFF);  // active-low: all twelve buttons released
  nds->Start();

  // The threaded rasterizer moves scanline rendering off the emulation thread.
  // Only the software renderer is compiled in, so CurrentRenderer is always the
  // SoftRenderer NDSArgs defaulted to.
  static_cast<melonDS::SoftRenderer&>(nds->GPU.GPU3D.GetCurrentRenderer())
      .SetThreaded(true, nds->GPU);

  mNds = std::move(nds);

  {
    // The layout prop can land before the ROM does; honour whatever it said.
    std::lock_guard<std::mutex> lock(mMutex);
    mFbWidth = mSideBySide ? kScreenWidth * 2 : kScreenWidth;
    mFbHeight = mSideBySide ? kScreenHeight : kScreenHeight * 2;
  }
  mFramebuffer.assign(static_cast<size_t>(mFbWidth) * mFbHeight, 0);
  mKeys.store(0, std::memory_order_relaxed);
  mTouch.store(0, std::memory_order_relaxed);
  compositeFrame();

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
    if (!mThreadAlive && !mNds) {
      return;
    }
    mThreadAlive = false;
    mCv.notify_all();
  }
  if (mThread.joinable()) {
    mThread.join();
  }
  mAudio.close();
  if (mNds) {
    // The emulation thread is gone, so this runs inline. Nothing else writes
    // the battery save to disk, so skipping it loses whatever the game stored
    // since the last flush.
    writeSaveFile();
    mNds.reset();  // ~SoftRenderer stops the render thread
  }
  mFramebuffer.clear();
  mFbWidth = 0;
  mFbHeight = 0;
  mGameTitle.clear();
  mRomName.clear();
  mSavPath.clear();
  mSaveDirty = false;
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
    mNds->Reset();
    if (mNds->NeedsDirectBoot()) {
      mNds->SetupDirectBoot(mRomName);
    }
    mNds->Start();
    mStopped.store(false, std::memory_order_relaxed);
    compositeFrame();
    return true;
  });
}

bool EmulatorEngine::saveState(const std::string& path) {
  return runOnEmuThread([this, path] {
    melonDS::Savestate state;  // owning 32 MB buffer, header written by the ctor
    if (state.Error) {
      return false;
    }
    // DoSavestate calls Finish() itself, which patches the length field the
    // loader validates — so Length() is correct on return.
    mNds->DoSavestate(&state);
    if (state.Error) {
      return false;
    }
    FILE* file = fopen(path.c_str(), "wb");
    if (!file) {
      return false;
    }
    const size_t written = fwrite(state.Buffer(), 1, state.Length(), file);
    fclose(file);
    return written == state.Length();
  });
}

bool EmulatorEngine::loadState(const std::string& path) {
  return runOnEmuThread([this, path] {
    std::unique_ptr<uint8_t[]> data;
    uint32_t length = 0;
    if (!readWholeFile(path, data, length)) {
      return false;
    }
    // Non-owning: the buffer must outlive the Savestate, and its size has to be
    // exactly the file length — the ctor checks it against the header.
    melonDS::Savestate state(data.get(), length, false);
    if (state.Error) {
      return false;
    }
    if (!mNds->DoSavestate(&state) || state.Error) {
      return false;
    }
    compositeFrame();
    return true;
  });
}

bool EmulatorEngine::captureFrame(std::vector<uint32_t>& out, unsigned* width, unsigned* height) {
  // By reference: runOnEmuThread blocks until the closure has run.
  return runOnEmuThread([this, &out, width, height] {
    if (!mNds || mFramebuffer.empty()) {
      return false;
    }
    // Always the stacked shape, whatever the view is showing: SlotSheet's
    // thumbnails derive their aspect from the screens top-to-bottom, and a
    // slot saved in landscape must look like every other slot.
    const int front = mNds->GPU.FrontBuffer;
    const uint32_t* top = mNds->GPU.Framebuffer[front][0].get();
    const uint32_t* bottom = mNds->GPU.Framebuffer[front][1].get();
    if (!top || !bottom) {
      return false;
    }
    constexpr size_t kScreenPixels = static_cast<size_t>(kScreenWidth) * kScreenHeight;
    out.resize(kScreenPixels * 2);
    for (size_t i = 0; i < kScreenPixels; i++) {
      out[i] = swapRedBlue(top[i]);
      out[kScreenPixels + i] = swapRedBlue(bottom[i]);
    }
    *width = kScreenWidth;
    *height = kScreenHeight * 2;
    return true;
  });
}

void EmulatorEngine::flushSaves() {
  runOnEmuThread([this] {
    writeSaveFile();
    return true;
  });
}

void EmulatorEngine::writeSaveFile() {
  if (!mNds || !mSaveDirty || mSavPath.empty()) {
    return;
  }
  const uint8_t* save = mNds->GetNDSSave();
  const uint32_t length = mNds->GetNDSSaveLength();
  if (!save || length == 0) {
    mSaveDirty = false;
    return;
  }
  FILE* file = fopen(mSavPath.c_str(), "wb");
  if (!file) {
    ALOGE("Could not open save file %s", mSavPath.c_str());
    return;
  }
  const size_t written = fwrite(save, 1, length, file);
  fflush(file);
  fclose(file);
  if (written != length) {
    ALOGE("Short write to save file %s", mSavPath.c_str());
    return;
  }
  mSaveDirty = false;
  mFramesSinceSaveWrite = 0;
}

void EmulatorEngine::onNDSSaveWritten(const uint8_t*, uint32_t, uint32_t, uint32_t) {
  // Called for every cart SRAM write, so this only marks the save dirty and
  // restarts the quiet-period counter; the emulation loop does the file write
  // once the game stops writing.
  mSaveDirty = true;
  mFramesSinceSaveWrite = 0;
}

void EmulatorEngine::onStopSignalled(int reason) {
  // Fires from inside RunFrame, where mMutex is already held — never lock here.
  ALOGI("melonDS signalled stop, reason %d", reason);
  mStopped.store(true, std::memory_order_relaxed);
}

void EmulatorEngine::setTouch(int x, int y, bool down) {
  const uint32_t cx = static_cast<uint32_t>(std::clamp(x, 0, static_cast<int>(kScreenWidth) - 1));
  const uint32_t cy = static_cast<uint32_t>(std::clamp(y, 0, static_cast<int>(kScreenHeight) - 1));
  mTouch.store((down ? (1u << 24) : 0u) | (cy << 8) | cx, std::memory_order_relaxed);
}

void EmulatorEngine::setSpeed(float multiplier) {
  mSpeed.store(std::max(multiplier, 0.05f), std::memory_order_relaxed);
}

std::string EmulatorEngine::gameTitle() {
  return mGameTitle;
}

void EmulatorEngine::videoSize(unsigned* width, unsigned* height) {
  *width = mFbWidth;
  *height = mFbHeight;
}

void EmulatorEngine::setScreenLayout(bool sideBySide) {
  {
    std::lock_guard<std::mutex> lock(mMutex);
    if (mSideBySide == sideBySide) {
      return;
    }
    mSideBySide = sideBySide;
    if (!mThreadAlive) {
      return;  // no ROM running: the next loadRom sizes the framebuffer from the flag
    }
  }
  // Resized on the emulation thread, where every other framebuffer write
  // lives. The surface lock spans the reallocation and recomposite because
  // surfaceChanged() blits from another thread.
  runOnEmuThread([this, sideBySide] {
    std::lock_guard<std::mutex> lock(mSurfaceMutex);
    mFbWidth = sideBySide ? kScreenWidth * 2 : kScreenWidth;
    mFbHeight = sideBySide ? kScreenHeight : kScreenHeight * 2;
    mFramebuffer.assign(static_cast<size_t>(mFbWidth) * mFbHeight, 0);
    compositeFrame();
    if (mWindow) {
      ANativeWindow_setBuffersGeometry(mWindow, mFbWidth, mFbHeight, WINDOW_FORMAT_RGBX_8888);
      blitLocked();  // repaint now, so a paused game re-arranges too
    }
    return true;
  });
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

void EmulatorEngine::compositeFrame() {
  if (!mNds || mFramebuffer.empty()) {
    return;
  }
  const int front = mNds->GPU.FrontBuffer;
  const uint32_t* top = mNds->GPU.Framebuffer[front][0].get();
  const uint32_t* bottom = mNds->GPU.Framebuffer[front][1].get();
  if (!top || !bottom) {
    return;
  }
  // Branches on the buffer actually allocated, not mSideBySide: the flag can
  // flip ahead of the emu-thread resize, and the write must match the buffer.
  if (mFbWidth == kScreenWidth * 2) {
    // Side by side: each 512-wide row is a top-screen row then a bottom one.
    for (unsigned y = 0; y < kScreenHeight; y++) {
      uint32_t* dst = mFramebuffer.data() + static_cast<size_t>(y) * mFbWidth;
      const uint32_t* topRow = top + static_cast<size_t>(y) * kScreenWidth;
      const uint32_t* bottomRow = bottom + static_cast<size_t>(y) * kScreenWidth;
      for (unsigned x = 0; x < kScreenWidth; x++) {
        dst[x] = swapRedBlue(topRow[x]);
        dst[kScreenWidth + x] = swapRedBlue(bottomRow[x]);
      }
    }
    return;
  }
  // Stack the two 256x192 screens into one 256x384 buffer, top over bottom.
  constexpr size_t kScreenPixels = static_cast<size_t>(kScreenWidth) * kScreenHeight;
  uint32_t* dst = mFramebuffer.data();
  for (size_t i = 0; i < kScreenPixels; i++) {
    dst[i] = swapRedBlue(top[i]);
  }
  for (size_t i = 0; i < kScreenPixels; i++) {
    dst[kScreenPixels + i] = swapRedBlue(bottom[i]);
  }
}

void EmulatorEngine::pumpAudio() {
  int16_t buffer[kAudioChunkFrames * 2];
  for (;;) {
    const int frames = mNds->SPU.ReadOutput(buffer, kAudioChunkFrames);
    if (frames <= 0) {
      break;
    }
    mAudio.push(buffer, frames);
    if (frames < kAudioChunkFrames) {
      break;
    }
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
    memcpy(dst + static_cast<size_t>(y) * out.stride,
           mFramebuffer.data() + static_cast<size_t>(y) * mFbWidth, cols * sizeof(uint32_t));
  }
  ANativeWindow_unlockAndPost(mWindow);
}

void EmulatorEngine::emuLoop() {
  // A game usually writes its save in one burst; wait for it to go quiet rather
  // than rewriting the whole buffer on every frame it touches SRAM.
  constexpr int kSaveQuietFrames = 120;

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
      if (mStopped.load(std::memory_order_relaxed)) {
        // The console powered itself off. Park the thread rather than spinning:
        // the wait predicate only blocks while paused.
        mPaused = true;
      } else if (!mPaused && mThreadAlive) {
        // SetKeyMask is active-low: a clear bit is a pressed button.
        mNds->SetKeyMask((~mKeys.load(std::memory_order_relaxed)) & 0xFFF);
        const uint32_t touch = mTouch.load(std::memory_order_relaxed);
        if (touch & (1u << 24)) {
          mNds->TouchScreen(static_cast<uint16_t>(touch & 0xFF),
                            static_cast<uint16_t>((touch >> 8) & 0xFF));
        } else {
          mNds->ReleaseScreen();
        }
        mNds->RunFrame();
        ranFrame = true;
      }
    }
    if (!ranFrame) {
      next = steady_clock::now();
      continue;
    }

    compositeFrame();
    pumpAudio();
    {
      std::lock_guard<std::mutex> lock(mSurfaceMutex);
      blitLocked();
    }

    if (mSaveDirty && ++mFramesSinceSaveWrite >= kSaveQuietFrames) {
      writeSaveFile();
    }

    next += duration_cast<steady_clock::duration>(
        duration<double>(kFrameSeconds / mSpeed.load(std::memory_order_relaxed)));
    const auto now = steady_clock::now();
    if (next < now) {
      next = now;  // fell behind; don't spiral
    } else {
      std::this_thread::sleep_until(next);
    }
  }
}
