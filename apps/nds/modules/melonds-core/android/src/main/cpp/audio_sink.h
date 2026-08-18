#pragma once

#include <oboe/Oboe.h>

#include <atomic>
#include <cstdint>
#include <memory>
#include <vector>

// Oboe output stream fed by a single-producer single-consumer ring buffer of
// interleaved stereo int16 frames. The emulation thread produces; the audio
// callback consumes. Underrun plays silence; overrun (fast-forward) drops the
// incoming samples.
class AudioSink : public oboe::AudioStreamDataCallback {
public:
  AudioSink();
  ~AudioSink() override;

  bool open();
  void close();
  void start();
  void pause();

  int32_t sampleRate() const { return mSampleRate; }

  void setVolume(float volume) { mVolume.store(volume, std::memory_order_relaxed); }

  // Interleaved stereo frames; volume is applied here on the way into the ring.
  void push(const int16_t* frames, int frameCount);

  void clear();

  oboe::DataCallbackResult onAudioReady(oboe::AudioStream* stream, void* audioData,
                                        int32_t numFrames) override;

private:
  std::shared_ptr<oboe::AudioStream> mStream;
  int32_t mSampleRate = 48000;

  // Ring of interleaved int16 pairs; capacity in frames, power of two.
  static constexpr size_t kCapacityFrames = 16384;
  std::vector<int16_t> mRing;
  std::atomic<size_t> mWriteFrame{0};
  std::atomic<size_t> mReadFrame{0};

  std::atomic<float> mVolume{1.0f};
};
