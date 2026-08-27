// Engine owning the Azahar core: one emulation thread mirroring the upstream
// Android frontend's RunCitra loop, a command queue for everything that must
// touch the core between RunLoop iterations, and the EGL window handoff.

#pragma once

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

struct ANativeWindow;
class EmuWindow_Android;

class EmulatorEngine {
public:
    static EmulatorEngine& instance();

    EmulatorEngine(const EmulatorEngine&) = delete;
    EmulatorEngine& operator=(const EmulatorEngine&) = delete;

    /// Called once per error the core surfaces while running; posts to Kotlin.
    void setErrorCallback(std::function<void(const std::string&)> cb);

    void setUserDir(const std::string& dir);

    /// The view never delivered a surface, so the core was not even asked.
    static constexpr int kLoadNoSurface = -1;
    /// System::Load threw instead of returning a status (details in logcat).
    static constexpr int kLoadException = -2;

    /// Blocks until the core accepted or rejected the ROM. Returns 0 on
    /// success, kLoadNoSurface, or the Core::System::ResultStatus that
    /// System::Load failed with. On success the emulation thread is parked
    /// before its first frame (contract: paused at frame 0). `path` is a
    /// plain absolute path (no "!" prefix).
    int loadRom(const std::string& path);
    void unloadRom();

    void setPaused(bool paused);
    void reset();

    std::string gameTitle() const;
    uint64_t titleId() const;

    /// Composited frame size for the current layout: 400x480 stacked,
    /// 720x240 side by side.
    void videoSize(int* width, int* height) const;
    void setScreenLayout(bool sideBySide);

    void setButton(int buttonId, bool pressed);
    void setCirclePad(float x, float y);
    /// x/y in bottom-screen native pixels (0..319, 0..239).
    void setTouch(int x, int y, bool down);

    bool saveState(int slot);
    bool loadState(int slot);
    bool deleteState(int slot);
    /// Battery save + every savestate for a title. Only valid with no ROM
    /// loaded (the Kotlin module enforces that).
    bool deleteSaveData(uint64_t titleId);

    /// Fills [width, height, ARGB pixels...] of the stacked 400x480 frame.
    bool captureFrame(std::vector<int32_t>& out);

    void setVolume(float volume);
    void setSpeed(float multiplier);

    /// Takes ownership of the window reference (may be null).
    void surfaceChanged(ANativeWindow* window);
    void surfaceDestroyed();
    /// Called from the UI thread (Choreographer) every display frame.
    void tryPresent();

private:
    EmulatorEngine() = default;
    ~EmulatorEngine();

    struct Command {
        std::function<bool()> fn;
        std::promise<bool> done;
    };

    void emuLoop(std::string romPath, std::promise<int>* loadResult);
    /// Runs fn on the emulation thread between RunLoop iterations (works while
    /// paused) and returns its result; false if the thread is gone.
    bool runOnEmuThread(std::function<bool()> fn);
    void applyCoreSettings();
    void applyLayoutRects();
    /// Drives RunLoop until the kernel has no pending async operations — the
    /// same safe point the upstream savestate signals wait for.
    bool driveToKernelIdle();
    void applyVolume();

    std::function<void(const std::string&)> mOnError;

    std::thread mThread;
    mutable std::mutex mMutex;
    std::condition_variable mCv;
    std::deque<Command> mCommands;
    bool mThreadAlive = false;
    /// Atomic because the disk-shader-cache loader polls it lock-free.
    std::atomic<bool> mStop{false};
    bool mPaused = false;
    bool mTouchDown = false;

    std::mutex mSurfaceMutex;
    std::condition_variable mSurfaceCv;
    ANativeWindow* mSurface = nullptr;
    std::unique_ptr<EmuWindow_Android> mWindow;

    /// Serializes EGL window-surface use between the emulation thread
    /// (PollEvents recreating it) and the UI thread (TryPresenting).
    std::mutex mPresentMutex;

    mutable std::mutex mInfoMutex;
    std::string mTitle;
    uint64_t mTitleId = 0;

    bool mSideBySide = false;
    float mVolume = 1.0f;
};
