# Included by CMake right after Azahar's root project() call, via
# -DCMAKE_PROJECT_citra_INCLUDE=<this file> (see build.gradle). Azahar's CMake
# assumes it is the top-level project (GenerateSCMRev, boost/zstd paths,
# ${CMAKE_BINARY_DIR}/src includes), so instead of add_subdirectory-ing the
# vendor tree we make it the CMake root and inject ourselves into it.

# Runs before the root option() calls, so these pre-seeded cache entries win:
#   ENABLE_QT/ENABLE_SDL2 OFF   no desktop frontend, no SDL audio/input
#   ENABLE_WEB_SERVICE    OFF   telemetry + its libressl/httplib/cpp-jwt deps
#   ENABLE_SCRIPTING      OFF   RPC server
#   ENABLE_OPENAL         OFF   statically-linked LGPL sink we don't need — cubeb
#                               (ISC, Azahar's Android default) carries audio
#   ENABLE_VULKAN         OFF   OpenGL ES only for now; Vulkan is a later stage
#   ENABLE_OPENGL         ON    the one renderer we use (GLES 3.2 via EGL/glad)
#   ENABLE_LTO            OFF   massive link times/RAM for no shipping need yet
set(ENABLE_QT OFF CACHE BOOL "" FORCE)
set(ENABLE_QT_TRANSLATION OFF CACHE BOOL "" FORCE)
set(ENABLE_SDL2 OFF CACHE BOOL "" FORCE)
set(ENABLE_TESTS OFF CACHE BOOL "" FORCE)
set(ENABLE_ROOM OFF CACHE BOOL "" FORCE)
set(ENABLE_ROOM_STANDALONE OFF CACHE BOOL "" FORCE)
set(ENABLE_WEB_SERVICE OFF CACHE BOOL "" FORCE)
set(ENABLE_SCRIPTING OFF CACHE BOOL "" FORCE)
set(ENABLE_GDBSTUB OFF CACHE BOOL "" FORCE)
set(ENABLE_OPENAL OFF CACHE BOOL "" FORCE)
set(ENABLE_LIBUSB OFF CACHE BOOL "" FORCE)
set(ENABLE_VULKAN OFF CACHE BOOL "" FORCE)
set(ENABLE_OPENGL ON CACHE BOOL "" FORCE)
set(ENABLE_LTO OFF CACHE BOOL "" FORCE)
set(ENABLE_DISCORD_RPC OFF CACHE BOOL "" FORCE)
set(CITRA_WARNINGS_AS_ERRORS OFF CACHE BOOL "" FORCE)

# Define our JNI target once the whole vendor tree (citra_core & friends) has
# been processed. Deferred execution may not create subdirectories, so the
# target definitions live in an include()d file. CMAKE_CURRENT_LIST_DIR is the
# vendor root while this hook runs, so derive our own directory from the hook
# variable itself.
get_filename_component(AZAHAR_JNI_DIR "${CMAKE_PROJECT_citra_INCLUDE}" DIRECTORY)
cmake_language(DEFER CALL include "${AZAHAR_JNI_DIR}/azahar_jni_target.cmake")
