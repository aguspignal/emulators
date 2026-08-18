#include "platform_impl.h"

#include <Platform.h>
#include <android/log.h>

#include <chrono>
#include <condition_variable>
#include <cstdarg>
#include <cstdio>
#include <mutex>
#include <thread>

#include "emulator_engine.h"

// The melonDS::Platform implementation for this app.
//
// Upstream ships one only in src/frontend/qt_sdl, which BUILD_QT_SDL=OFF
// excludes, so every function declared in Platform.h has to be defined here or
// libcore.a will not link. Three groups:
//
//   * real     — threading, logging, timing, file I/O, save write-back, stop.
//                SPU's constructor creates a Mutex before the first frame, so
//                the sync primitives must work from the very first boot.
//   * routed   — WriteNDSSave and SignalStop reach the engine through the
//                `userdata` pointer handed to NDS/ParseROM.
//   * stubbed  — local multiplayer, networking, camera, mic, AAC (DSi DSP),
//                Slot-2 addons and dynamic libraries. Unreachable in a retail
//                single-player DS build, but still needed at link time.
//
// Default arguments live in Platform.h; repeating them here is a compile error.

#define LOG_TAG "melonDS"

namespace {

std::string gLocalDir;

android_LogPriority logPriority(melonDS::Platform::LogLevel level) {
  switch (level) {
    case melonDS::Platform::LogLevel::Debug:
      return ANDROID_LOG_DEBUG;
    case melonDS::Platform::LogLevel::Info:
      return ANDROID_LOG_INFO;
    case melonDS::Platform::LogLevel::Warn:
      return ANDROID_LOG_WARN;
    case melonDS::Platform::LogLevel::Error:
      return ANDROID_LOG_ERROR;
  }
  return ANDROID_LOG_INFO;
}

// fopen mode for a FileMode, mirroring upstream's AccessMode/IsExtended:
// "r" unless we may create, "+" whenever both Read and Write are set, and "b"
// unless the caller asked for text.
std::string modeString(melonDS::Platform::FileMode mode, bool fileExists) {
  using melonDS::Platform::FileMode;
  std::string out;

  if (mode & FileMode::Append) {
    out += 'a';
  } else if (!(mode & FileMode::Write)) {
    out += 'r';
  } else if (mode & FileMode::NoCreate) {
    out += 'r';
  } else if ((mode & FileMode::Preserve) && fileExists) {
    out += 'r';
  } else {
    out += 'w';
  }

  if ((mode & FileMode::ReadWrite) == FileMode::ReadWrite) {
    out += '+';
  }
  if (!(mode & FileMode::Text)) {
    out += 'b';
  }
  return out;
}

FILE* asFile(melonDS::Platform::FileHandle* file) {
  return reinterpret_cast<FILE*>(file);
}

bool exists(const std::string& path) {
  FILE* f = fopen(path.c_str(), "rb");
  if (!f) {
    return false;
  }
  fclose(f);
  return true;
}

}  // namespace

namespace melonds_platform {

void setLocalDir(const std::string& dir) {
  gLocalDir = dir;
}

}  // namespace melonds_platform

namespace melonDS::Platform {

// The core only ever holds pointers to these, so the frontend defines them.
struct Mutex {
  std::mutex m;
};

struct Semaphore {
  std::mutex m;
  std::condition_variable cv;
  int count = 0;
};

struct Thread {
  std::thread t;
};

// ---------------------------------------------------------------- stop / log

void SignalStop(StopReason reason, void* userdata) {
  if (auto* engine = static_cast<EmulatorEngine*>(userdata)) {
    engine->onStopSignalled(static_cast<int>(reason));
  }
}

void Log(LogLevel level, const char* fmt, ...) {
  va_list args;
  va_start(args, fmt);
  __android_log_vprint(logPriority(level), LOG_TAG, fmt, args);
  va_end(args);
}

// -------------------------------------------------------------------- timing

void Sleep(u64 usecs) {
  std::this_thread::sleep_for(std::chrono::microseconds(usecs));
}

u64 GetMSCount() {
  using namespace std::chrono;
  return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

u64 GetUSCount() {
  using namespace std::chrono;
  return duration_cast<microseconds>(steady_clock::now().time_since_epoch()).count();
}

// ------------------------------------------------------------------- threads

Thread* Thread_Create(std::function<void()> func) {
  auto* thread = new Thread();
  thread->t = std::thread(std::move(func));
  return thread;
}

void Thread_Free(Thread* thread) {
  if (!thread) {
    return;
  }
  if (thread->t.joinable()) {
    thread->t.join();
  }
  delete thread;
}

void Thread_Wait(Thread* thread) {
  if (thread && thread->t.joinable()) {
    thread->t.join();
  }
}

Semaphore* Semaphore_Create() {
  return new Semaphore();
}

void Semaphore_Free(Semaphore* sema) {
  delete sema;
}

void Semaphore_Reset(Semaphore* sema) {
  if (!sema) {
    return;
  }
  std::lock_guard<std::mutex> lock(sema->m);
  sema->count = 0;
}

void Semaphore_Wait(Semaphore* sema) {
  if (!sema) {
    return;
  }
  std::unique_lock<std::mutex> lock(sema->m);
  sema->cv.wait(lock, [sema] { return sema->count > 0; });
  sema->count--;
}

bool Semaphore_TryWait(Semaphore* sema, int timeout_ms) {
  if (!sema) {
    return false;
  }
  std::unique_lock<std::mutex> lock(sema->m);
  if (timeout_ms <= 0) {
    // Documented as "return immediately if not signaled".
    if (sema->count <= 0) {
      return false;
    }
  } else if (!sema->cv.wait_for(lock, std::chrono::milliseconds(timeout_ms),
                                [sema] { return sema->count > 0; })) {
    return false;
  }
  sema->count--;
  return true;
}

void Semaphore_Post(Semaphore* sema, int count) {
  if (!sema) {
    return;
  }
  {
    std::lock_guard<std::mutex> lock(sema->m);
    sema->count += count;
  }
  if (count > 1) {
    sema->cv.notify_all();
  } else {
    sema->cv.notify_one();
  }
}

Mutex* Mutex_Create() {
  return new Mutex();
}

void Mutex_Free(Mutex* mutex) {
  delete mutex;
}

void Mutex_Lock(Mutex* mutex) {
  if (mutex) {
    mutex->m.lock();
  }
}

void Mutex_Unlock(Mutex* mutex) {
  if (mutex) {
    mutex->m.unlock();
  }
}

bool Mutex_TryLock(Mutex* mutex) {
  return mutex ? mutex->m.try_lock() : false;
}

// ------------------------------------------------------------------ file I/O
// FileHandle is an opaque forward declaration the core never looks inside, so
// it is just a cast FILE* — Platform.h explicitly sanctions that.

std::string GetLocalFilePath(const std::string& filename) {
  if (gLocalDir.empty()) {
    return filename;
  }
  return gLocalDir + "/" + filename;
}

FileHandle* OpenFile(const std::string& path, FileMode mode) {
  if (!(mode & (FileMode::Read | FileMode::Write))) {
    return nullptr;
  }
  const bool fileExists = exists(path);
  if ((mode & FileMode::NoCreate) && !fileExists) {
    return nullptr;
  }
  FILE* file = fopen(path.c_str(), modeString(mode, fileExists).c_str());
  return reinterpret_cast<FileHandle*>(file);
}

FileHandle* OpenLocalFile(const std::string& path, FileMode mode) {
  return OpenFile(GetLocalFilePath(path), mode);
}

bool FileExists(const std::string& name) {
  return exists(name);
}

bool LocalFileExists(const std::string& name) {
  return exists(GetLocalFilePath(name));
}

bool CheckFileWritable(const std::string& filepath) {
  FileHandle* file = OpenFile(filepath, FileMode::Append);
  if (!file) {
    return false;
  }
  CloseFile(file);
  return true;
}

bool CheckLocalFileWritable(const std::string& filepath) {
  return CheckFileWritable(GetLocalFilePath(filepath));
}

bool CloseFile(FileHandle* file) {
  return file ? fclose(asFile(file)) == 0 : false;
}

bool IsEndOfFile(FileHandle* file) {
  return file ? feof(asFile(file)) != 0 : true;
}

bool FileReadLine(char* str, int count, FileHandle* file) {
  return file && fgets(str, count, asFile(file)) != nullptr;
}

u64 FilePosition(FileHandle* file) {
  if (!file) {
    return 0;
  }
  const long pos = ftell(asFile(file));
  return pos < 0 ? 0 : static_cast<u64>(pos);
}

bool FileSeek(FileHandle* file, s64 offset, FileSeekOrigin origin) {
  if (!file) {
    return false;
  }
  int whence = SEEK_SET;
  switch (origin) {
    case FileSeekOrigin::Start:
      whence = SEEK_SET;
      break;
    case FileSeekOrigin::Current:
      whence = SEEK_CUR;
      break;
    case FileSeekOrigin::End:
      whence = SEEK_END;
      break;
  }
  return fseek(asFile(file), static_cast<long>(offset), whence) == 0;
}

void FileRewind(FileHandle* file) {
  if (file) {
    rewind(asFile(file));
  }
}

u64 FileRead(void* data, u64 size, u64 count, FileHandle* file) {
  return file ? fread(data, size, count, asFile(file)) : 0;
}

bool FileFlush(FileHandle* file) {
  return file ? fflush(asFile(file)) == 0 : false;
}

u64 FileWrite(const void* data, u64 size, u64 count, FileHandle* file) {
  return file ? fwrite(data, size, count, asFile(file)) : 0;
}

u64 FileWriteFormatted(FileHandle* file, const char* fmt, ...) {
  if (!file || !fmt) {
    return 0;
  }
  va_list args;
  va_start(args, fmt);
  const int written = vfprintf(asFile(file), fmt, args);
  va_end(args);
  return written < 0 ? 0 : static_cast<u64>(written);
}

u64 FileLength(FileHandle* file) {
  if (!file) {
    return 0;
  }
  FILE* f = asFile(file);
  // Documented contract: leave the stream position as it was found.
  const long pos = ftell(f);
  if (pos < 0 || fseek(f, 0, SEEK_END) != 0) {
    return 0;
  }
  const long length = ftell(f);
  fseek(f, pos, SEEK_SET);
  return length < 0 ? 0 : static_cast<u64>(length);
}

// -------------------------------------------------------------- save writing

void WriteNDSSave(const u8* savedata, u32 savelen, u32 writeoffset, u32 writelen, void* userdata) {
  if (auto* engine = static_cast<EmulatorEngine*>(userdata)) {
    engine->onNDSSaveWritten(savedata, savelen, writeoffset, writelen);
  }
}

// No GBA slot-2 cart is ever inserted, and the firmware is generated in memory
// rather than loaded from a dump, so neither write-back has anywhere to go.
void WriteGBASave(const u8*, u32, u32, u32, void*) {}

void WriteFirmware(const Firmware&, u32, u32, void*) {}

void WriteDateTime(int, int, int, int, int, int, void*) {}

// ------------------------------------------------------------------ no-op set
// Everything below is unreachable in a retail, single-player, DS-only build,
// but libcore.a references it, so it has to exist.

void MP_Begin(void*) {}
void MP_End(void*) {}
int MP_SendPacket(u8*, int, u64, void*) { return 0; }
int MP_RecvPacket(u8*, u64*, void*) { return 0; }
int MP_SendCmd(u8*, int, u64, void*) { return 0; }
int MP_SendReply(u8*, int, u64, u16, void*) { return 0; }
int MP_SendAck(u8*, int, u64, void*) { return 0; }
int MP_RecvHostPacket(u8*, u64*, void*) { return 0; }
u16 MP_RecvReplies(u8*, u64, u16, void*) { return 0; }

int Net_SendPacket(u8*, int, void*) { return 0; }
int Net_RecvPacket(u8*, void*) { return 0; }

void Camera_Start(int, void*) {}
void Camera_Stop(int, void*) {}
void Camera_CaptureFrame(int, u32*, int, int, bool, void*) {}

void Mic_Start(void*) {}
void Mic_Stop(void*) {}
// Zero samples read means the emulated mic hears silence.
int Mic_ReadInput(s16*, int, void*) { return 0; }

AACDecoder* AAC_Init() { return nullptr; }
void AAC_DeInit(AACDecoder*) {}
bool AAC_Configure(AACDecoder*, int, int) { return false; }
bool AAC_DecodeFrame(AACDecoder*, const void*, int, void*, int) { return false; }

bool Addon_KeyDown(KeyType, void*) { return false; }
void Addon_RumbleStart(u32, void*) {}
void Addon_RumbleStop(void*) {}
float Addon_MotionQuery(MotionQueryType, void*) { return 0.0f; }

DynamicLibrary* DynamicLibrary_Load(const char*) { return nullptr; }
void DynamicLibrary_Unload(DynamicLibrary*) {}
void* DynamicLibrary_LoadFunction(DynamicLibrary*, const char*) { return nullptr; }

}  // namespace melonDS::Platform
