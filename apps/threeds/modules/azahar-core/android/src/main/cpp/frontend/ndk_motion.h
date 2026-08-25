// Copied from vendor/azahar/src/android/app/src/main/jni (GPLv2+), trimmed// for azahar-core: no IDCache, no cameras, layout driven by the engine.
// Copyright 2020 Citra Emulator Project
// Licensed under GPLv2+
// Refer to the license.txt file included.

#pragma once

#include "core/frontend/input.h"

namespace InputManager {

inline std::atomic<int> screen_rotation;

class NDKMotion;

class NDKMotionFactory final : public Input::Factory<Input::MotionDevice> {
public:
    /**
     * Creates a motion device that obtains data from device sensors
     */
    std::unique_ptr<Input::MotionDevice> Create(const Common::ParamPackage& params) override;

    void EnableSensors();
    void DisableSensors();

private:
    NDKMotion* ndk_motion_device;
};
} // namespace InputManager
