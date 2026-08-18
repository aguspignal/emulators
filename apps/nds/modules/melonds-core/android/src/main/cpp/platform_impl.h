#pragma once

#include <string>

// melonDS's `core` calls melonDS::Platform::* free functions that the library
// itself never defines — upstream only implements them in the Qt/SDL frontend,
// which this build excludes. platform_impl.cpp supplies them all.
namespace melonds_platform {

// Where Platform::OpenLocalFile and friends resolve relative names. The JNI
// layer sets this to the app's files dir once, before any ROM is loaded.
void setLocalDir(const std::string& dir);

}  // namespace melonds_platform
