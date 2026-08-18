cmake_minimum_required(VERSION 3.22)
project(melonds-jni C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Build melonDS's `core` (static) from the pinned submodule, headless:
#   BUILD_QT_SDL      OFF  no desktop frontend
#   ENABLE_JIT        OFF  the interpreter carries playback; the JIT needs
#                          Android W^X (executable-mapping) handling, a later stage
#   ENABLE_OGLRENDERER OFF the software renderer is enough; GL comes later
#   ENABLE_GDBSTUB    OFF  drops the debug socket/thread code
# These are FORCE-set into the cache before add_subdirectory so melonDS's
# option()/cmake_dependent_option() calls pick them up.
set(BUILD_QT_SDL OFF CACHE BOOL "" FORCE)
set(ENABLE_JIT OFF CACHE BOOL "" FORCE)
set(ENABLE_OGLRENDERER OFF CACHE BOOL "" FORCE)
set(ENABLE_GDBSTUB OFF CACHE BOOL "" FORCE)
set(USE_VCPKG OFF CACHE BOOL "" FORCE)

get_filename_component(MELONDS_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../../../vendor/melonds" ABSOLUTE)
add_subdirectory("${MELONDS_ROOT}" melonds EXCLUDE_FROM_ALL)

add_library(melonds-jni SHARED
  melonds_jni.cpp
  platform_impl.cpp
  emulator_engine.cpp
  audio_sink.cpp)

find_package(oboe REQUIRED CONFIG)

# `core` exports its source dir and the generated version.h as usage
# requirements, so linking it is what makes <version.h> and the melonDS headers
# reachable from the JNI layer. teakra is a private dep of core and is pulled in
# transitively. libcore.a leaves every melonDS::Platform::* symbol undefined —
# platform_impl.cpp is what satisfies them.
target_link_libraries(melonds-jni PRIVATE core oboe::oboe android log)

# 16 KB page alignment (Google Play requirement for targetSdk 35);
# default on NDK r28+, harmless there, required on r27.
target_link_options(melonds-jni PRIVATE "-Wl,-z,max-page-size=16384")
