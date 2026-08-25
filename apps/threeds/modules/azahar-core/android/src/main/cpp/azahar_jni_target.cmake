# Defines the azahar-jni library. Included via cmake_language(DEFER) from
# azahar_inject.cmake, so it runs at the end of the vendor root's configure —
# Azahar's own targets already exist, and CMAKE_SOURCE_DIR / CMAKE_BINARY_DIR
# are the vendor root's (which is what its usage requirements assume).
# Deferred execution may create targets but not subdirectories, hence an
# include()d file rather than add_subdirectory.

# AZAHAR_JNI_DIR is set by azahar_inject.cmake; list-dir variables are not
# reliable under deferred execution.
add_library(azahar-jni SHARED
  "${AZAHAR_JNI_DIR}/azahar_jni.cpp"
  "${AZAHAR_JNI_DIR}/emulator_engine.cpp"
  "${AZAHAR_JNI_DIR}/frontend/emu_window.cpp"
  "${AZAHAR_JNI_DIR}/frontend/emu_window_gl.cpp"
  "${AZAHAR_JNI_DIR}/frontend/input_manager.cpp"
  "${AZAHAR_JNI_DIR}/frontend/ndk_motion.cpp")

# Azahar's src/CMakeLists.txt uses directory-scoped include_directories, which
# never reaches a target defined from another directory. CMAKE_BINARY_DIR/src
# is where citra_common's generated headers land.
target_include_directories(azahar-jni PRIVATE
  "${CMAKE_SOURCE_DIR}/src"
  "${CMAKE_BINARY_DIR}/src")

# Mirror the definitions Azahar's src/CMakeLists.txt adds with directory scope
# (they don't reach targets defined outside src/); settings.h #errors without a
# renderer define.
target_compile_definitions(azahar-jni PRIVATE MICROPROFILE_ENABLED=0)
foreach(def ENABLE_OPENGL ENABLE_VULKAN ENABLE_SOFTWARE_RENDERER ENABLE_BUILTIN_KEYBLOB)
  if(${def})
    target_compile_definitions(azahar-jni PRIVATE ${def})
  endif()
endforeach()

target_link_libraries(azahar-jni PRIVATE
  citra_core
  citra_common
  video_core
  audio_core
  input_common
  network
  glad
  EGL
  android
  log)

# 16 KB page alignment (Google Play requirement for targetSdk 35);
# default on NDK r28+, harmless there, required on r27.
target_link_options(azahar-jni PRIVATE "-Wl,-z,max-page-size=16384")
