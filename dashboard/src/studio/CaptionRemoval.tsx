import { useEffect, useRef, useState } from "react";
import { Eraser, LoaderCircle } from "lucide-react";
import { api, post, useJob } from "../api";
import { Modal } from "../ui";
import type { EditorMedia, TimelineItem } from "./editorModel";
import "./caption-removal.css";

type Region = { x: number; y: number; width: number; height: number };
export type RemovalRequest = {
  asset_id: string;
  item_id: string;
  start: number;
  duration: number;
  preview: boolean;
  mask_mode: "text" | "area";
  processing_mode?: "fast" | "frame";
  region: Region;
};
type RemovalResult = {
  request?: RemovalRequest;
  asset?: EditorMedia;
  seconds?: number;
  frames?: number;
  total_frames?: number;
  seconds_remaining?: number;
};
const initialRegion: Region = { x: 0.05, y: 0.6, width: 0.9, height: 0.14 };

export function CaptionRemoval({
  projectId,
  item,
  asset,
  open,
  onClose,
  onAsset,
  onApply,
}: {
  projectId: string;
  item?: TimelineItem;
  asset?: EditorMedia;
  open: boolean;
  onClose: () => void;
  onAsset: (asset: EditorMedia) => void;
  onApply: (request: RemovalRequest, asset: EditorMedia) => boolean;
}) {
  const job = useJob(undefined, `editor-removal:${projectId}`);
  const [capability, setCapability] = useState<{
    available: boolean;
    message: string;
  } | null>(null);
  const [region, setRegion] = useState<Region>(initialRegion);
  const [maskMode, setMaskMode] = useState<"text" | "area">("text");
  const [offset, setOffset] = useState(0);
  const [cancelRequested, setCancelRequested] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const registered = useRef("");
  const result = job.job?.result as RemovalResult | undefined;
  const currentResult =
    result?.request?.item_id === item?.id &&
    result?.request?.asset_id === asset?.id
      ? result
      : undefined;
  const cleanAsset =
    job.job?.status === "completed" ? currentResult?.asset : undefined;
  const sourceDuration = item
    ? Math.min(
        item.duration * item.speed,
        (asset?.duration || 0) - item.source_in,
      )
    : 0;
  const settingsMatch =
    currentResult?.request?.mask_mode === maskMode &&
    currentResult?.request?.processing_mode !== "fast" &&
    JSON.stringify(currentResult?.request?.region) === JSON.stringify(region);
  const previewOffset = Math.min(offset, Math.max(0, sourceDuration - 0.1));
  const shownStart =
    currentResult?.request && item
      ? Math.max(0, currentResult.request.start - item.source_in)
      : 0;
  const shownEnd = shownStart + (currentResult?.request?.duration || 0);
  const previewTimeChanged =
    !!cleanAsset &&
    currentResult?.request?.preview &&
    Math.abs(shownStart - previewOffset) > 0.02;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    api<{ inpainting?: { available: boolean; message: string } }>(
      "/editor-capabilities",
      { signal: controller.signal },
    )
      .then((data) =>
        setCapability(
          data.inpainting || {
            available: false,
            message: "Restart ShortForge to load AI caption removal.",
          },
        ),
      )
      .catch((error) => {
        if (!controller.signal.aborted)
          setCapability({ available: false, message: error.message });
      });
    return () => controller.abort();
  }, [open]);
  useEffect(() => {
    setRegion(currentResult?.request?.region || initialRegion);
    setMaskMode(currentResult?.request?.mask_mode || "text");
    setOffset(
      currentResult?.request?.preview && item
        ? Math.max(0, currentResult.request.start - item.source_in)
        : 0,
    );
  }, [item?.id, asset?.id]);
  useEffect(() => {
    if (
      job.job?.status === "completed" &&
      result?.asset &&
      registered.current !== job.job.id
    ) {
      registered.current = job.job.id;
      onAsset(result.asset);
    }
  }, [job.job, onAsset]);
  useEffect(() => {
    if (video.current && item)
      video.current.currentTime = item.source_in + previewOffset;
  }, [previewOffset, item?.source_in, open]);

  if (!open) return null;
  const usable =
    item?.kind === "video" &&
    asset &&
    item.freeze_at == null &&
    sourceDuration > 0;
  const busyElsewhere = job.busy && !currentResult;
  const canRun = usable && capability?.available && !job.busy;
  const run = async (preview: boolean) => {
    if (!canRun || !item || !asset) return;
    setCancelRequested(false);
    await job.start(`/editor/${projectId}/remove-captions`, {
      asset_id: asset.id,
      item_id: item.id,
      start: item.source_in + (preview ? previewOffset : 0),
      duration: preview
        ? Math.min(1, sourceDuration - previewOffset)
        : sourceDuration,
      preview,
      mask_mode: maskMode,
      region,
    } satisfies RemovalRequest);
  };
  const setCoordinate = (key: keyof Region, value: number) => {
    if (!Number.isFinite(value)) return;
    setRegion((previous) => {
      const next = {
        ...previous,
        [key]: Math.max(
          key === "width" || key === "height" ? 0.01 : 0,
          Math.min(1, value / 100),
        ),
      };
      if (key === "x") next.x = Math.min(next.x, 1 - next.width);
      if (key === "y") next.y = Math.min(next.y, 1 - next.height);
      next.width = Math.min(next.width, 1 - next.x);
      next.height = Math.min(next.height, 1 - next.y);
      return next;
    });
  };
  return (
    <Modal title="Remove burned-in captions" wide onClose={onClose}>
      <div className="caption-removal">
        <p>
          Mark the caption area, then try a one-second preview. AI rebuilds the
          picture in that area. The original stays in Media.
        </p>
        {!usable ? (
          <p role="alert">
            Select a video clip with available media. For a frozen frame, turn
            off Freeze first.
          </p>
        ) : (
          <>
            <div className="removal-comparison">
              <figure>
                <figcaption>Original · drag to mark captions</figcaption>
                <div
                  className="removal-picture"
                  style={{ aspectRatio: `${asset.width} / ${asset.height}` }}
                >
                  <video
                    ref={video}
                    src={asset.url}
                    muted
                    playsInline
                    preload="auto"
                    onLoadedMetadata={() => {
                      if (video.current)
                        video.current.currentTime =
                          item.source_in + previewOffset;
                    }}
                  />
                  <div
                    className="removal-selection"
                    aria-hidden="true"
                    onPointerDown={(event) => {
                      if (job.busy) return;
                      const rect = event.currentTarget.getBoundingClientRect();
                      dragStart.current = {
                        x: (event.clientX - rect.left) / rect.width,
                        y: (event.clientY - rect.top) / rect.height,
                      };
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={(event) => {
                      if (!dragStart.current || job.busy) return;
                      const rect = event.currentTarget.getBoundingClientRect();
                      const x = Math.max(
                        0,
                        Math.min(1, (event.clientX - rect.left) / rect.width),
                      );
                      const y = Math.max(
                        0,
                        Math.min(1, (event.clientY - rect.top) / rect.height),
                      );
                      const left = Math.min(x, dragStart.current.x),
                        top = Math.min(y, dragStart.current.y);
                      setRegion({
                        x: Math.min(0.99, left),
                        y: Math.min(0.99, top),
                        width: Math.max(
                          0.01,
                          Math.abs(x - dragStart.current.x),
                        ),
                        height: Math.max(
                          0.01,
                          Math.abs(y - dragStart.current.y),
                        ),
                      });
                    }}
                    onPointerUp={() => {
                      dragStart.current = null;
                    }}
                    onPointerCancel={() => {
                      dragStart.current = null;
                    }}
                  >
                    <div
                      className="removal-box"
                      style={{
                        left: `${region.x * 100}%`,
                        top: `${region.y * 100}%`,
                        width: `${region.width * 100}%`,
                        height: `${region.height * 100}%`,
                      }}
                    />
                  </div>
                </div>
              </figure>
              <figure>
                <figcaption>
                  {cleanAsset
                    ? currentResult?.request?.preview
                      ? `Cleaned preview · ${shownStart.toFixed(1)}–${shownEnd.toFixed(1)}s`
                      : "Cleaned clip"
                    : "Cleaned preview"}
                </figcaption>
                {cleanAsset ? (
                  <video
                    className="removal-result"
                    key={cleanAsset.id}
                    src={cleanAsset.url}
                    controls
                    playsInline
                    preload="metadata"
                  />
                ) : (
                  <div className="removal-empty">
                    <Eraser size={24} />
                    <p>
                      {job.busy
                        ? "Rebuilding the picture…"
                        : "Your result will appear here."}
                    </p>
                  </div>
                )}
              </figure>
            </div>
            <div className="removal-controls">
              <label className="editor-field">
                <span>
                  Preview starts at {previewOffset.toFixed(1)}s into the
                  selected clip
                </span>
                <input
                  type="range"
                  aria-label="Preview start"
                  min={0}
                  max={Math.max(0, sourceDuration - 0.1)}
                  step="0.1"
                  value={previewOffset}
                  disabled={job.busy}
                  onChange={(event) => setOffset(+event.target.value)}
                />
              </label>
              <div className="removal-coordinates">
                {(
                  [
                    ["x", "Left"],
                    ["y", "Top"],
                    ["width", "Width"],
                    ["height", "Height"],
                  ] as const
                ).map(([key, label]) => (
                  <label className="editor-field" key={key}>
                    <span>{label} %</span>
                    <input
                      type="number"
                      aria-label={`Caption area ${label.toLowerCase()}`}
                      min={key === "x" || key === "y" ? 0 : 1}
                      max={100}
                      step={1}
                      value={Math.round(region[key] * 100)}
                      disabled={job.busy}
                      onChange={(event) =>
                        setCoordinate(key, +event.target.value)
                      }
                    />
                  </label>
                ))}
              </div>
              <label className="editor-field">
                <span>What to erase inside the box</span>
                <select
                  value={maskMode}
                  disabled={job.busy}
                  onChange={(event) =>
                    setMaskMode(event.target.value as "text" | "area")
                  }
                >
                  <option value="text">Detected text only</option>
                  <option value="area">Erase the whole area</option>
                </select>
              </label>
            </div>
          </>
        )}
        <p className="removal-note">
          AI rebuilds each frame separately and can take hours on this computer.
          Moving backgrounds may flicker or look smudged. Keep the box close to
          the captions. Your video stays on this computer.
        </p>
        {!capability ? (
          <p role="status">Checking AI removal…</p>
        ) : (
          !capability.available && <p role="alert">{capability.message}</p>
        )}
        {job.error && (
          <p className="removal-error" role="alert">
            {job.error}
          </p>
        )}
        {job.busy && (
          <div className="removal-progress" role="status" aria-live="polite">
            <p>
              <LoaderCircle size={15} className="spin" />{" "}
              {busyElsewhere ? "Processing another clip" : "Removing captions"}{" "}
              · {Math.round(job.job?.progress || 0)}%
            </p>
            <progress
              aria-label="Caption removal progress"
              max={100}
              value={job.job?.progress || 0}
            />
            {!!result?.seconds_remaining && (
              <p>
                About {Math.max(1, Math.ceil(result.seconds_remaining / 60))}{" "}
                min remaining
              </p>
            )}
            <button
              className="button secondary"
              disabled={cancelRequested}
              onClick={async () => {
                try {
                  await post(
                    `/editor/${projectId}/remove-captions/${job.job?.id}/cancel`,
                  );
                  setCancelRequested(true);
                } catch (error) {
                  job.setError((error as Error).message);
                }
              }}
            >
              {cancelRequested
                ? "Stopping after this frame…"
                : "Cancel removal"}
            </button>
          </div>
        )}
        {cleanAsset && !settingsMatch && (
          <p role="status">
            {currentResult?.request?.processing_mode === "fast"
              ? "This result used the removed Fast mode. Run removal again to use frame-by-frame processing."
              : "The area settings changed. Preview again to see those changes."}
          </p>
        )}
        {previewTimeChanged && (
          <p role="status">
            The cleaned preview shows {shownStart.toFixed(1)}–
            {shownEnd.toFixed(1)}s into this clip. Preview again to see the
            newly selected time.
          </p>
        )}
        <div className="removal-actions">
          <button
            className="button secondary"
            disabled={!canRun}
            onClick={() => void run(true)}
          >
            Preview 1 second
          </button>
          <button
            className="button primary"
            disabled={!canRun}
            onClick={() => void run(false)}
          >
            <Eraser size={15} />
            Remove from selected clip
          </button>
          {cleanAsset &&
            currentResult?.request &&
            !currentResult.request.preview && (
              <button
                className="button primary"
                disabled={job.busy || !settingsMatch}
                onClick={() => {
                  if (onApply(currentResult.request!, cleanAsset)) onClose();
                }}
              >
                Use cleaned clip
              </button>
            )}
        </div>
      </div>
    </Modal>
  );
}
