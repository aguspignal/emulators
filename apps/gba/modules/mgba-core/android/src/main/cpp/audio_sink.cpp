#include "audio_sink.h"

#include <android/log.h>

#include <algorithm>
#include <cstring>

#define LOG_TAG "MgbaAudio"
#define ALOGW(...) __android_log_print(ANDROID_LOG_WARN, LOG_TAG, __VA_ARGS__)

AudioSink::AudioSink() : mRing(kCapacityFrames * 2) {}

AudioSink::~AudioSink() {
  close();
}

bool AudioSink::open() {
  oboe::AudioStreamBuilder builder;
  builder.setDirection(oboe::Direction::Output)
      ->setPerformanceMode(oboe::PerformanceMode::LowLatency)
      ->setSharingMode(oboe::SharingMode::Shared)
      ->setFormat(oboe::AudioFormat::I16)
      ->setChannelCount(2)
      ->setUsage(oboe::Usage::Game)
      ->setDataCallback(this);

  oboe::Result result = builder.openStream(mStream);
  if (result != oboe::Result::OK) {
    ALOGW("Failed to open Oboe stream: %s", oboe::convertToText(result));
    mStream = nullptr;
    return false;
  }
  mSampleRate = mStream->getSampleRate();
  return true;
}

void AudioSink::close() {
  if (mStream) {
    mStream->stop();
    mStream->close();
    mStream = nullptr;
  }
  clear();
}

void AudioSink::start() {
  if (mStream) {
    mStream->requestStart();
  }
}

void AudioSink::pause() {
  if (mStream) {
    mStream->requestPause();
  }
}

void AudioSink::clear() {
  mReadFrame.store(mWriteFrame.load(std::memory_order_acquire), std::memory_order_release);
}

void AudioSink::push(const int16_t* frames, int frameCount) {
  const float volume = mVolume.load(std::memory_order_relaxed);
  size_t write = mWriteFrame.load(std::memory_order_relaxed);
  const size_t read = mReadFrame.load(std::memory_order_acquire);
  const size_t free = kCapacityFrames - (write - read);
  // Ring full (fast-forward outruns the DAC): drop the incoming tail.
  const int toWrite = std::min<int>(frameCount, static_cast<int>(free));
  for (int i = 0; i < toWrite; i++) {
    const size_t slot = (write & (kCapacityFrames - 1)) * 2;
    mRing[slot] = static_cast<int16_t>(frames[i * 2] * volume);
    mRing[slot + 1] = static_cast<int16_t>(frames[i * 2 + 1] * volume);
    write++;
  }
  mWriteFrame.store(write, std::memory_order_release);
}

oboe::DataCallbackResult AudioSink::onAudioReady(oboe::AudioStream*, void* audioData,
                                                 int32_t numFrames) {
  auto* out = static_cast<int16_t*>(audioData);
  size_t read = mReadFrame.load(std::memory_order_relaxed);
  const size_t write = mWriteFrame.load(std::memory_order_acquire);
  const size_t available = write - read;
  const int32_t toRead = std::min<int32_t>(numFrames, static_cast<int32_t>(available));
  for (int32_t i = 0; i < toRead; i++) {
    const size_t slot = (read & (kCapacityFrames - 1)) * 2;
    out[i * 2] = mRing[slot];
    out[i * 2 + 1] = mRing[slot + 1];
    read++;
  }
  mReadFrame.store(read, std::memory_order_release);
  if (toRead < numFrames) {
    memset(out + toRead * 2, 0, (numFrames - toRead) * 2 * sizeof(int16_t));
  }
  return oboe::DataCallbackResult::Continue;
}
