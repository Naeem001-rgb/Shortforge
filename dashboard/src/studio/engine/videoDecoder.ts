import { createFile } from "mp4box";
import type { MP4BoxBuffer, Sample, Track, VisualSampleEntry } from "mp4box";

export type FrameDecoder = {
  /** Source time in seconds. The caller owns and must close the returned frame. */
  frameAt(time: number): Promise<VideoFrame>;
  close(): void;
};

type VideoSample = {
  data: Uint8Array;
  timestamp: number;
  duration: number;
  key: boolean;
  keyIndex: number;
  decodeIndex: number;
};

function demux(buffer: ArrayBuffer) {
  // Keep a single compressed file buffer. MP4Box builds sample tables; the
  // decoder reads their byte ranges without copying every compressed sample.
  const file = createFile(false);
  let parseError: Error | undefined;
  file.onError = (_module, message) => { parseError = new Error(message); };
  const input = buffer as MP4BoxBuffer;
  input.fileStart = 0;
  file.appendBuffer(input);
  file.flush();
  if (parseError) throw parseError;
  if (!file.moov) throw new Error("This file is not a supported MP4 video.");
  const track = file.getInfo().videoTracks[0];
  if (!track?.video || !/^avc[13]\./.test(track.codec)) {
    throw new Error("Direct frame decoding requires an H.264 MP4 video.");
  }

  // HTML video applies track transforms and arbitrary edit lists. Leave those
  // files to the compatibility path instead of returning incorrectly timed or
  // rotated frames. A single normal-rate edit is how common encoders compensate
  // for B-frame composition delay, and is essential for A/V alignment.
  const identity = [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824];
  if (identity.some((value, index) => track.matrix[index] !== value)) {
    throw new Error("This MP4 track transform requires browser video playback.");
  }
  const edit = track.edits?.[0];
  if ((track.edits?.length ?? 0) > 1 || (edit && (
    edit.media_time < 0 || edit.media_rate_integer !== 1 || edit.media_rate_fraction !== 0
  ))) throw new Error("This MP4 edit list requires browser video playback.");

  const entries = file.getTrackById(track.id).mdia.minf.stbl.stsd.entries;
  const entry = entries[0];
  const avcC = (entry as VisualSampleEntry | undefined)?.avcC;
  if (!avcC) {
    throw new Error("The MP4 is missing its H.264 decoder configuration.");
  }
  const config: VideoDecoderConfig = {
    codec: track.codec,
    codedWidth: track.video.width,
    codedHeight: track.video.height,
    displayAspectWidth: track.track_width || track.video.width,
    displayAspectHeight: track.track_height || track.video.height,
    description: buffer.slice(avcC.start + avcC.hdr_size, avcC.start + avcC.size),
    optimizeForLatency: true,
  };
  const rawSamples = file.getTrackSamplesInfo(track.id);
  if (!rawSamples.length || !rawSamples[0].is_sync) {
    throw new Error("The MP4 is missing a starting keyframe.");
  }
  let keyIndex = 0;
  const samples = rawSamples.map((sample: Sample, decodeIndex): VideoSample => {
    if (sample.description !== entry || sample.timescale <= 0 || sample.duration <= 0 ||
      sample.offset < 0 || sample.offset + sample.size > buffer.byteLength) {
      throw new Error("The MP4 contains unsupported or incomplete video samples.");
    }
    if (sample.is_sync) keyIndex = decodeIndex;
    const start = (sample.cts - (edit?.media_time ?? 0)) / sample.timescale;
    const timestamp = Math.round(start * 1_000_000);
    return {
      data: new Uint8Array(buffer, sample.offset, sample.size),
      timestamp,
      duration: Math.max(1, Math.round((start + sample.duration / sample.timescale) * 1_000_000) - timestamp),
      key: sample.is_sync,
      keyIndex,
      decodeIndex,
    };
  });
  return { samples, config, track };
}

/**
 * Decode MP4 video in decode order, select frames in presentation order, and
 * retain a bounded window for repeat frames, freeze, slow motion, and reverse.
 * Unsupported files throw so the exporter can use HTMLVideoElement instead.
 */
export async function createVideoDecoder(
  source: string | URL | Blob,
  { signal }: { signal?: AbortSignal } = {},
): Promise<FrameDecoder> {
  signal?.throwIfAborted();
  if (typeof VideoDecoder === "undefined") throw new Error("WebCodecs video decoding is unavailable.");
  let buffer: ArrayBuffer;
  if (source instanceof Blob) buffer = await source.arrayBuffer();
  else {
    const response = await fetch(source, { signal });
    if (!response.ok) throw new Error(`Could not load video (${response.status}).`);
    buffer = await response.arrayBuffer();
  }
  signal?.throwIfAborted();
  const demuxed = demux(buffer);
  let samples = demuxed.samples;
  const { config, track } = demuxed;
  if (!(await VideoDecoder.isConfigSupported(config)).supported) {
    throw new Error(`Video decoding is unavailable for ${config.codec}.`);
  }
  signal?.throwIfAborted();
  const end = presentationEnd(track);
  let presentation = samples.filter(sample => sample.timestamp + sample.duration > 0 && sample.timestamp < end)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (!presentation.length) throw new Error("The MP4 contains no visible video frames.");
  const indices = new Map(presentation.map((sample, index) => [sample.timestamp, index]));
  if (indices.size !== presentation.length) throw new Error("The MP4 contains duplicate video timestamps.");

  // About 48 MiB of YUV frames, at most 48 frames, plus the codec's own bounded
  // input/reordering queue. Compressed sample storage is released by close().
  const maxFrames = Math.max(2, Math.min(48, Math.floor(48 * 1024 * 1024 / (track.video!.width * track.video!.height * 1.5))));
  const maxQueue = Math.min(8, maxFrames);
  const cache = new Map<number, VideoFrame>();
  let targetIndex = 0;
  let nextSample = 0;
  let decodeStart = 0;
  let emittedThrough = -1;
  let drained = false;
  let closed = false;
  let decoderError: Error | undefined;
  let wake: (() => void) | undefined;
  const notify = () => { wake?.(); };
  const decoder = new VideoDecoder({
    output(frame) {
      const index = indices.get(frame.timestamp);
      // Frames before an edit's visible start are needed for prediction only.
      if (closed || index === undefined) { frame.close(); notify(); return; }
      emittedThrough = Math.max(emittedThrough, index);
      cache.get(index)?.close();
      cache.set(index, frame);
      if (cache.size > maxFrames) {
        let farthest = -1, distance = -1;
        for (const cached of cache.keys()) {
          if (Math.abs(cached - targetIndex) > distance) {
            distance = Math.abs(cached - targetIndex);
            farthest = cached;
          }
        }
        cache.get(farthest)!.close();
        cache.delete(farthest);
      }
      notify();
    },
    error(error) { decoderError = error; notify(); },
  });
  decoder.addEventListener("dequeue", notify);
  decoder.configure(config);

  const assertOpen = () => {
    signal?.throwIfAborted();
    if (closed) throw new Error("The video decoder is closed.");
    if (decoderError) throw decoderError;
  };
  const close = () => {
    if (closed) return;
    closed = true;
    signal?.removeEventListener("abort", close);
    decoder.removeEventListener("dequeue", notify);
    if (decoder.state !== "closed") decoder.close();
    cache.forEach(frame => frame.close());
    cache.clear();
    samples = [];
    presentation = [];
    indices.clear();
    notify();
  };
  signal?.addEventListener("abort", close, { once: true });

  const waitForOutput = () => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      wake = undefined;
      reject(new Error("Video decoding timed out."));
    }, 15_000);
    wake = () => { clearTimeout(timer); wake = undefined; resolve(); };
  });

  const readFrame = async (time: number): Promise<VideoFrame> => {
    assertOpen();
    if (!Number.isFinite(time)) throw new RangeError("Video frame time must be finite.");
    const timestamp = Math.round(Math.max(0, time) * 1_000_000);
    let low = 0, high = presentation.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (presentation[middle].timestamp <= timestamp) low = middle + 1;
      else high = middle;
    }
    targetIndex = Math.max(0, low - 1);
    const available = cache.get(targetIndex);
    if (available) return available.clone();
    const target = presentation[targetIndex];
    // Missing past frames (including reverse) and large forward jumps restart
    // at the closest preceding decoding keyframe. Normal playback keeps the
    // decoder alive; flushing per frame would require a new keyframe each time.
    if (target.decodeIndex < decodeStart || targetIndex <= emittedThrough || target.keyIndex > nextSample + maxQueue || drained) {
      decoder.reset();
      decoder.configure(config);
      nextSample = target.keyIndex;
      decodeStart = nextSample;
      emittedThrough = -1;
      drained = false;
    }
    while (!cache.has(targetIndex)) {
      assertOpen();
      if (nextSample === samples.length) {
        // Only drain at EOF, to release trailing reordered B-frames. The next
        // uncached request restarts from a keyframe because flush resets that
        // WebCodecs requirement.
        if (drained) throw new Error("The decoder did not produce the requested video frame.");
        await decoder.flush();
        drained = true;
        continue;
      }
      while (decoder.decodeQueueSize < maxQueue && nextSample < samples.length) {
        const sample = samples[nextSample++];
        decoder.decode(new EncodedVideoChunk({
          type: sample.key ? "key" : "delta",
          timestamp: sample.timestamp,
          duration: sample.duration,
          data: sample.data,
        }));
      }
      // Both output and dequeue wake the pump. It may need to submit future
      // reference pictures before the requested B-frame can be displayed.
      await waitForOutput();
    }
    assertOpen();
    return cache.get(targetIndex)!.clone();
  };
  // Serialize requests so consumers can safely ask concurrently without
  // resetting a decoder while another request is waiting for its frame.
  let pending = Promise.resolve();
  return {
    frameAt(time) {
      const result = pending.then(() => readFrame(time));
      pending = result.then(() => {}, () => {});
      return result;
    },
    close,
  };
}

function presentationEnd(track: Track): number {
  const edit = track.edits?.[0];
  return edit ? Math.round(edit.segment_duration / track.movie_timescale * 1_000_000) : Infinity;
}
