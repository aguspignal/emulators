cmake_minimum_required(VERSION 3.22)
project(mgba-jni C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Build libmgba (static, no frontends, no external deps) from the pinned submodule.
# LIBMGBA_ONLY forces BUILD_STATIC=ON / BUILD_SHARED=OFF / DISABLE_FRONTENDS / DISABLE_DEPS.
set(LIBMGBA_ONLY ON CACHE BOOL "" FORCE)
set(M_CORE_GBA ON CACHE BOOL "" FORCE)
set(M_CORE_GB ON CACHE BOOL "" FORCE) # GB core also covers Game Boy Color

get_filename_component(MGBA_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../../../vendor/mgba" ABSOLUTE)
add_subdirectory("${MGBA_ROOT}" mgba EXCLUDE_FROM_ALL)

add_library(mgba-jni SHARED
  mgba_jni.cpp
  emulator_engine.cpp
  audio_sink.cpp)

# The 'mgba' static target exports its include dirs PUBLIC, but its compile
# definitions are PRIVATE. Any TU including mGBA headers must define the same
# M_CORE_* set or struct layouts silently diverge. COLOR_16_BIT stays OFF on
# this path, so color_t is uint32_t with red in the low byte (RGBX_8888).
target_compile_definitions(mgba-jni PRIVATE M_CORE_GBA M_CORE_GB)

find_package(oboe REQUIRED CONFIG)

target_link_libraries(mgba-jni PRIVATE mgba oboe::oboe android log)

# 16 KB page alignment (Google Play requirement for targetSdk 35);
# default on NDK r28+, harmless there, required on r27.
target_link_options(mgba-jni PRIVATE "-Wl,-z,max-page-size=16384")
