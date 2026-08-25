#include "emulator_engine.h"

#include <array>
#include <chrono>

#include <android/log.h>
#include <android/native_window.h>
#include <fmt/format.h>

#include "common/file_util.h"
#include "common/settings.h"
#include "core/core.h"
#include "core/file_sys/archive_source_sd_savedata.h"
#include "core/frontend/applets/default_applets.h"
#include "core/frontend/framebuffer_layout.h"
#include "core/hle/kernel/kernel.h"
#include "core/loader/loader.h"
#include "core/savestate.h"
#include "video_core/gpu.h"
#include "video_core/renderer_base.h"

#include "frontend/emu_window_gl.h"
#include "frontend/input_manager.h"

namespace {

constexpr const char* kLogTag = "AzaharCore";

#define ENGINE_LOGI(...) __android_log_print(ANDROID_LOG_INFO, kLogTag, __VA_ARGS__)
#define ENGINE_LOGE(...) __android_log_print(ANDROID_LOG_ERROR, kLogTag, __VA_ARGS__)

// 3DS native screen sizes, and the composited frames the shared UI assumes
// (packages/ui .../gamepad/layout.ts stackedFrame/sideBySideFrame).
constexpr int kTopWidth = 400;
constexpr int kTopHeight = 240;
constexpr int kBottomWidth = 320;
constexpr int kBottomHeight = 240;
constexpr int kStackedWidth = 400;
constexpr int kStackedHeight = 480;
constexpr int kSideBySideWidth = 720;
constexpr int kSideBySideHeight = 240;

// Same order as Settings::NativeButton — mirrors upstream config.cpp.
constexpr std::array<int, Settings::NativeButton::NumButtons> kDefaultButtons = {
    InputManager::N3DS_BUTTON_A,     InputManager::N3DS_BUTTON_B,
    InputManager::N3DS_BUTTON_X,     InputManager::N3DS_BUTTON_Y,
    InputManager::N3DS_DPAD_UP,      InputManager::N3DS_DPAD_DOWN,
    InputManager::N3DS_DPAD_LEFT,    InputManager::N3DS_DPAD_RIGHT,
    InputManager::N3DS_TRIGGER_L,    InputManager::N3DS_TRIGGER_R,
    InputManager::N3DS_BUTTON_START, InputManager::N3DS_BUTTON_SELECT,
    InputManager::N3DS_BUTTON_DEBUG, InputManager::N3DS_BUTTON_GPIO14,
    InputManager::N3DS_BUTTON_ZL,    InputManager::N3DS_BUTTON_ZR,
    InputManager::N3DS_BUTTON_HOME,
};
constexpr std::array<int, Settings::NativeAnalog::NumAnalogs> kDefaultAnalogs = {
    InputManager::N3DS_CIRCLEPAD,
    InputManager::N3DS_STICK_C,
};

std::string saveStatePath(uint64_t titleId, int slot) {
    // Mirrors the (file-local) GetSaveStatePath in core/savestate.cpp for the
    // no-movie case.
    return fmt::format("{}{:016X}.{:02d}.cst",
                       FileUtil::GetUserPath(FileUtil::UserPath::StatesDir), titleId, slot);
}

} // namespace

EmulatorEngine& EmulatorEngine::instance() {
    static EmulatorEngine engine;
    return engine;
}

EmulatorEngine::~EmulatorEngine() {
    unloadRom();
}

void EmulatorEngine::setErrorCallback(std::function<void(const std::string&)> cb) {
    mOnError = std::move(cb);
}

void EmulatorEngine::setUserDir(const std::string& dir) {
    // Mirrors upstream setUserDirectory: the user tree root doubles as the
    // process working directory. Relative core paths resolve against the same
    // directory through AndroidUtils::GetUserDirectory (the Kotlin statics).
    FileUtil::SetCurrentDir(dir);
}

bool EmulatorEngine::loadRom(const std::string& path) {
    unloadRom();
    std::promise<bool> result;
    auto future = result.get_future();
    {
        std::scoped_lock lk(mMutex);
        mStop = false;
        // Contract: loadRom leaves the core paused at frame 0.
        mPaused = true;
        mThreadAlive = true;
        mTouchDown = false;
    }
    applyVolume();
    mThread = std::thread(&EmulatorEngine::emuLoop, this, path, &result);
    const bool ok = future.get();
    if (!ok) {
        mThread.join();
    }
    return ok;
}

void EmulatorEngine::unloadRom() {
    {
        std::scoped_lock lk(mMutex);
        if (!mThread.joinable()) {
            return;
        }
        mStop = true;
    }
    mCv.notify_all();
    mSurfaceCv.notify_all();
    mThread.join();
    mStop = false;
}

void EmulatorEngine::setPaused(bool paused) {
    {
        std::scoped_lock lk(mMutex);
        mPaused = paused;
    }
    applyVolume();
    mCv.notify_all();
}

void EmulatorEngine::applyVolume() {
    bool paused;
    {
        std::scoped_lock lk(mMutex);
        paused = mPaused;
    }
    // Upstream's anti-bleed trick: a parked game keeps the sink open, so mute
    // it; the user volume comes back with resume.
    Settings::values.volume = paused ? 0.0f : mVolume;
}

void EmulatorEngine::reset() {
    runOnEmuThread([] {
        auto& system = Core::System::GetInstance();
        if (!system.IsPoweredOn()) {
            return false;
        }
        system.SendSignal(Core::System::Signal::Reset);
        // Signals are processed inside RunLoop; drive one iteration so a reset
        // issued from the pause menu happens now, not on resume.
        return system.RunLoop() == Core::System::ResultStatus::Success;
    });
}

std::string EmulatorEngine::gameTitle() const {
    std::scoped_lock lk(mInfoMutex);
    return mTitle;
}

uint64_t EmulatorEngine::titleId() const {
    std::scoped_lock lk(mInfoMutex);
    return mTitleId;
}

void EmulatorEngine::videoSize(int* width, int* height) const {
    std::scoped_lock lk(mInfoMutex);
    *width = mSideBySide ? kSideBySideWidth : kStackedWidth;
    *height = mSideBySide ? kSideBySideHeight : kStackedHeight;
}

void EmulatorEngine::setScreenLayout(bool sideBySide) {
    {
        std::scoped_lock lk(mInfoMutex);
        mSideBySide = sideBySide;
    }
    applyLayoutRects();
    // The view follows with SurfaceHolder.setFixedSize, and the resulting
    // surfaceChanged applies the new layout through OnFramebufferSizeChanged.
}

void EmulatorEngine::applyLayoutRects() {
    bool sideBySide;
    {
        std::scoped_lock lk(mInfoMutex);
        sideBySide = mSideBySide;
    }
    if (sideBySide) {
        // 720x240 — screens left to right, both full height.
        Settings::values.custom_top_x = 0;
        Settings::values.custom_top_y = 0;
        Settings::values.custom_top_width = kTopWidth;
        Settings::values.custom_top_height = kTopHeight;
        Settings::values.custom_bottom_x = kTopWidth;
        Settings::values.custom_bottom_y = 0;
        Settings::values.custom_bottom_width = kBottomWidth;
        Settings::values.custom_bottom_height = kBottomHeight;
    } else {
        // 400x480 — top over bottom, the narrower bottom screen centred.
        Settings::values.custom_top_x = 0;
        Settings::values.custom_top_y = 0;
        Settings::values.custom_top_width = kTopWidth;
        Settings::values.custom_top_height = kTopHeight;
        Settings::values.custom_bottom_x = (kStackedWidth - kBottomWidth) / 2;
        Settings::values.custom_bottom_y = kTopHeight;
        Settings::values.custom_bottom_width = kBottomWidth;
        Settings::values.custom_bottom_height = kBottomHeight;
    }
}

void EmulatorEngine::setButton(int buttonId, bool pressed) {
    auto* handler = InputManager::ButtonHandler();
    if (!handler) {
        return;
    }
    if (pressed) {
        handler->PressKey(buttonId);
    } else {
        handler->ReleaseKey(buttonId);
    }
}

void EmulatorEngine::setCirclePad(float x, float y) {
    auto* handler = InputManager::AnalogHandler();
    if (handler) {
        handler->MoveJoystick(InputManager::N3DS_CIRCLEPAD, x, y);
    }
}

void EmulatorEngine::setTouch(int x, int y, bool down) {
    std::scoped_lock lk(mSurfaceMutex);
    if (!mWindow) {
        return;
    }
    const auto& layout = mWindow->GetFramebufferLayout();
    const auto& bottom = layout.bottom_screen;
    if (bottom.GetWidth() == 0 || bottom.GetHeight() == 0) {
        return;
    }
    // Contract coordinates are bottom-screen native pixels; the custom layout
    // renders that screen 1:1, but map through the live rect anyway.
    const int fx = static_cast<int>(bottom.left) + x * static_cast<int>(bottom.GetWidth()) / kBottomWidth;
    const int fy = static_cast<int>(bottom.top) + y * static_cast<int>(bottom.GetHeight()) / kBottomHeight;
    if (down) {
        if (mTouchDown) {
            mWindow->OnTouchMoved(fx, fy);
        } else {
            mWindow->OnTouchEvent(fx, fy, true);
            mTouchDown = true;
        }
    } else if (mTouchDown) {
        mWindow->OnTouchEvent(0, 0, false);
        mTouchDown = false;
    }
}

bool EmulatorEngine::saveState(int slot) {
    return runOnEmuThread([slot] {
        auto& system = Core::System::GetInstance();
        if (!system.IsPoweredOn()) {
            return false;
        }
        try {
            system.SaveState(static_cast<u32>(slot));
            return true;
        } catch (const std::exception& e) {
            ENGINE_LOGE("saveState(%d): %s", slot, e.what());
            return false;
        }
    });
}

bool EmulatorEngine::loadState(int slot) {
    return runOnEmuThread([slot] {
        auto& system = Core::System::GetInstance();
        if (!system.IsPoweredOn()) {
            return false;
        }
        try {
            system.LoadState(static_cast<u32>(slot));
            return true;
        } catch (const std::exception& e) {
            ENGINE_LOGE("loadState(%d): %s", slot, e.what());
            return false;
        }
    });
}

bool EmulatorEngine::deleteState(int slot) {
    const auto path = saveStatePath(titleId(), slot);
    if (!FileUtil::Exists(path)) {
        return true; // a slot with no state is not an error
    }
    return FileUtil::Delete(path);
}

bool EmulatorEngine::deleteSaveData(uint64_t titleId) {
    bool ok = true;
    for (u32 slot = 0; slot < Core::SaveStateSlotCount; ++slot) {
        const auto path = saveStatePath(titleId, slot);
        if (FileUtil::Exists(path) && !FileUtil::Delete(path)) {
            ok = false;
        }
    }
    const auto saveDir = FileSys::ArchiveSource_SDSaveData::GetSaveDataPathFor(
        FileUtil::GetUserPath(FileUtil::UserPath::SDMCDir), titleId);
    if (FileUtil::Exists(saveDir) && !FileUtil::DeleteDirRecursively(saveDir)) {
        ok = false;
    }
    return ok;
}

bool EmulatorEngine::captureFrame(std::vector<int32_t>& out) {
    std::vector<u32> pixels(static_cast<size_t>(kStackedWidth) * kStackedHeight);
    bool flipped = false;
    const bool ok = runOnEmuThread([&pixels, &flipped] {
        auto& system = Core::System::GetInstance();
        if (!system.IsPoweredOn()) {
            return false;
        }
        // Always the stacked shape, whatever is on screen — SlotSheet's
        // thumbnails assume it.
        Layout::FramebufferLayout layout{};
        layout.width = kStackedWidth;
        layout.height = kStackedHeight;
        layout.top_screen_enabled = true;
        layout.bottom_screen_enabled = true;
        layout.top_screen = {0, 0, kTopWidth, kTopHeight};
        layout.bottom_screen = {(kStackedWidth - kBottomWidth) / 2, kTopHeight,
                                (kStackedWidth - kBottomWidth) / 2 + kBottomWidth, kStackedHeight};
        layout.is_rotated = true;

        std::promise<void> done;
        auto future = done.get_future();
        system.GPU().Renderer().RequestScreenshot(
            pixels.data(),
            [&done, &flipped](bool invert) {
                flipped = invert;
                done.set_value();
            },
            layout);

        // The renderer fills the buffer on the next frame; drive frames until
        // the callback fires (a paused game runs no frames on its own).
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(3);
        while (future.wait_for(std::chrono::seconds(0)) != std::future_status::ready) {
            if (std::chrono::steady_clock::now() > deadline) {
                return false;
            }
            if (system.RunLoop() != Core::System::ResultStatus::Success) {
                return false;
            }
        }
        return true;
    });
    if (!ok) {
        return false;
    }

    out.resize(2 + pixels.size());
    out[0] = kStackedWidth;
    out[1] = kStackedHeight;
    for (int row = 0; row < kStackedHeight; ++row) {
        const int srcRow = flipped ? (kStackedHeight - 1 - row) : row;
        for (int col = 0; col < kStackedWidth; ++col) {
            // RGBA bytes (R in the low byte) -> ARGB ints for android.graphics.Bitmap.
            const u32 p = pixels[static_cast<size_t>(srcRow) * kStackedWidth + col];
            const u32 r = p & 0xFF;
            const u32 g = (p >> 8) & 0xFF;
            const u32 b = (p >> 16) & 0xFF;
            out[2 + static_cast<size_t>(row) * kStackedWidth + col] =
                static_cast<int32_t>(0xFF000000u | (r << 16) | (g << 8) | b);
        }
    }
    return true;
}

void EmulatorEngine::setVolume(float volume) {
    mVolume = volume;
    applyVolume();
}

void EmulatorEngine::setSpeed(float multiplier) {
    // Azahar's frame limiter is a percentage of full speed.
    Settings::values.frame_limit = static_cast<double>(multiplier) * 100.0;
}

void EmulatorEngine::surfaceChanged(ANativeWindow* window) {
    std::scoped_lock plk(mPresentMutex);
    std::scoped_lock lk(mSurfaceMutex);
    if (mSurface && mSurface != window) {
        ANativeWindow_release(mSurface);
    }
    mSurface = window;
    if (mWindow) {
        const bool notify = mWindow->OnSurfaceChanged(window);
        auto& system = Core::System::GetInstance();
        if (notify && system.IsPoweredOn()) {
            system.GPU().Renderer().NotifySurfaceChanged(false);
        }
    }
    mSurfaceCv.notify_all();
}

void EmulatorEngine::surfaceDestroyed() {
    std::scoped_lock plk(mPresentMutex);
    std::scoped_lock lk(mSurfaceMutex);
    if (mWindow) {
        mWindow->OnSurfaceChanged(nullptr);
    }
    if (mSurface) {
        ANativeWindow_release(mSurface);
        mSurface = nullptr;
    }
}

void EmulatorEngine::tryPresent() {
    std::scoped_lock plk(mPresentMutex);
    // Presenting while paused is deliberate: it repaints the last frame after
    // a surface remount (rotation) instead of leaving the view black.
    if (mWindow && Core::System::GetInstance().IsPoweredOn()) {
        mWindow->TryPresenting();
    }
}

bool EmulatorEngine::runOnEmuThread(std::function<bool()> fn) {
    std::future<bool> future;
    {
        std::scoped_lock lk(mMutex);
        if (!mThreadAlive || mStop) {
            return false;
        }
        Command cmd;
        cmd.fn = std::move(fn);
        future = cmd.done.get_future();
        mCommands.push_back(std::move(cmd));
    }
    mCv.notify_all();
    return future.get();
}

bool EmulatorEngine::driveToKernelIdle() {
    auto& system = Core::System::GetInstance();
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
    while (system.Kernel().AreAsyncOperationsPending()) {
        if (std::chrono::steady_clock::now() > deadline) {
            return false;
        }
        if (system.RunLoop() != Core::System::ResultStatus::Success) {
            return false;
        }
    }
    return true;
}

void EmulatorEngine::applyCoreSettings() {
    Settings::values.graphics_api = Settings::GraphicsAPI::OpenGL;
    Settings::values.layout_option = Settings::LayoutOption::CustomLayout;
    Settings::values.use_cpu_jit = true;
    applyLayoutRects();
    applyVolume();

    auto& profile = Settings::values.current_input_profile;
    for (int i = 0; i < Settings::NativeButton::NumButtons; ++i) {
        profile.buttons[i] = InputManager::GenerateButtonParamPackage(kDefaultButtons[i]);
    }
    for (int i = 0; i < Settings::NativeAnalog::NumAnalogs; ++i) {
        profile.analogs[i] = InputManager::GenerateAnalogParamPackage(kDefaultAnalogs[i]);
    }
    profile.touch_device = "engine:emu_window";
    profile.motion_device = "engine:motion_emu,update_period:100,sensitivity:0.01";
}

void EmulatorEngine::emuLoop(std::string romPath, std::promise<bool>* loadResult) {
    auto& system = Core::System::GetInstance();

    auto finishThread = [this] {
        std::scoped_lock lk(mMutex);
        for (auto& cmd : mCommands) {
            cmd.done.set_value(false);
        }
        mCommands.clear();
        mThreadAlive = false;
    };

    // The view mounts in parallel with loadRom; Azahar cannot boot without a
    // real surface (the renderer is created from it).
    {
        std::unique_lock lk(mSurfaceMutex);
        const bool got = mSurfaceCv.wait_for(lk, std::chrono::seconds(10),
                                             [&] { return mSurface != nullptr || mStop; });
        if (!got || mStop || !mSurface) {
            ENGINE_LOGE("loadRom: no surface");
            loadResult->set_value(false);
            finishThread();
            return;
        }
    }

    applyCoreSettings();

    {
        std::scoped_lock lk(mSurfaceMutex);
        mWindow = std::make_unique<EmuWindow_Android_OpenGL>(system, mSurface, false);
    }

    Frontend::RegisterDefaultApplets(system);
    system.RegisterMicPermissionCheck([] { return false; });

    // "!" marks an already-native absolute path for AndroidUtils::TranslateFilePath.
    const std::string corePath = "!" + romPath;
    FileUtil::SetCurrentRomPath(corePath);
    u64 programId{};
    std::string title;
    auto app_loader = Loader::GetLoader(corePath);
    if (app_loader) {
        app_loader->ReadProgramId(programId);
        app_loader->ReadTitle(title);
        system.RegisterAppLoaderEarly(app_loader);
    }
    {
        std::scoped_lock lk(mInfoMutex);
        mTitleId = programId;
        mTitle = title;
    }

    system.ApplySettings();
    InputManager::Init();

    mWindow->MakeCurrent();
    const auto loadStatus = system.Load(*mWindow, corePath);
    if (loadStatus != Core::System::ResultStatus::Success) {
        ENGINE_LOGE("System::Load failed: %d", static_cast<int>(loadStatus));
        mWindow->DoneCurrent();
        InputManager::Shutdown();
        {
            std::scoped_lock plk(mPresentMutex);
            std::scoped_lock slk(mSurfaceMutex);
            mWindow.reset();
        }
        loadResult->set_value(false);
        finishThread();
        return;
    }

    system.GPU().ApplyPerProgramSettings(programId);
    system.GPU().Renderer().Rasterizer()->LoadDefaultDiskResources(
        mStop, [](VideoCore::LoadCallbackStage, std::size_t, std::size_t, const std::string&) {});

    ENGINE_LOGI("Booted \"%s\" (%016llx)", title.c_str(),
                static_cast<unsigned long long>(programId));
    // Contract: paused at frame 0 — the caller resolves now, frames start on
    // the first resume.
    loadResult->set_value(true);

    while (true) {
        {
            std::unique_lock lk(mMutex);
            mCv.wait(lk, [&] { return mStop || !mPaused || !mCommands.empty(); });
            if (mStop) {
                break;
            }
            if (!mCommands.empty()) {
                Command cmd = std::move(mCommands.front());
                mCommands.pop_front();
                lk.unlock();
                bool ok = false;
                try {
                    ok = cmd.fn();
                } catch (const std::exception& e) {
                    ENGINE_LOGE("emu-thread command: %s", e.what());
                }
                cmd.done.set_value(ok);
                continue;
            }
        }

        {
            // Applies a pending surface change (no-op otherwise). Guarded so it
            // cannot race the UI thread's TryPresenting on the EGL surface.
            std::scoped_lock plk(mPresentMutex);
            if (mWindow) {
                mWindow->PollEvents();
            }
        }

        const auto result = system.RunLoop();
        if (result == Core::System::ResultStatus::Success) {
            continue;
        }
        // Park instead of dying: JS owns the decision to exit.
        {
            std::scoped_lock lk(mMutex);
            mPaused = true;
        }
        applyVolume();
        if (result == Core::System::ResultStatus::ShutdownRequested) {
            ENGINE_LOGI("Game requested shutdown");
            if (mOnError) {
                mOnError("The game requested shutdown");
            }
        } else {
            const std::string details = system.GetStatusDetails();
            ENGINE_LOGE("RunLoop error %d: %s", static_cast<int>(result), details.c_str());
            if (mOnError) {
                mOnError(details.empty() ? "Emulation error" : details);
            }
        }
    }

    {
        std::scoped_lock plk(mPresentMutex);
        if (mWindow) {
            mWindow->DoneCurrent();
        }
    }
    if (system.IsPoweredOn()) {
        system.Shutdown();
    }
    {
        std::scoped_lock plk(mPresentMutex);
        std::scoped_lock slk(mSurfaceMutex);
        mWindow.reset();
    }
    InputManager::Shutdown();
    finishThread();
}
