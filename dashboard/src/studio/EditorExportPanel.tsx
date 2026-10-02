import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Download,
  FileText,
  Image,
  LoaderCircle,
  X,
} from "lucide-react";
import { api, assetUrl } from "../api";
import type { Asset, Job } from "../api";
import { IconButton, JobProgress } from "../ui";
import { durationOf, formatTime } from "./editorModel";
import type { EditorMedia, EditorProject } from "./editorModel";
import { exportProject } from "./engine/exportProject";
import type { ExportProgress, ExportResult } from "./engine/exportProject";

function filename(project: EditorProject, extension: string) {
  return `${(project.name || "ShortForge edit").replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 100)}.${extension}`;
}
function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function srtTime(time: number) {
  const ms = Math.max(0, Math.round(time * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}
export function EditorExportPanel({
  open,
  clipId,
  project,
  media,
  previousExports,
  onClose,
  onPublish,
  onSaved,
  saveProject,
  compatibility,
}: {
  open: boolean;
  clipId: string;
  project: EditorProject;
  media: EditorMedia[];
  previousExports: Asset[];
  onClose: () => void;
  onPublish: () => void;
  onSaved: (asset: Asset) => void;
  saveProject: () => Promise<void>;
  compatibility: {
    busy: boolean;
    job: Job | null;
    start: (resolution: 720 | 1080) => Promise<unknown>;
  };
}) {
  const [resolution, setResolution] = useState<720 | 1080>(1080);
  const [fps, setFps] = useState<24 | 30 | 60>(
    project.fps === 24 || project.fps === 60 ? project.fps : 30,
  );
  const [quality, setQuality] = useState<"standard" | "high" | "maximum">(
    "high",
  );
  const [method, setMethod] = useState<"browser" | "compatibility">("browser");
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setWarning] = useState("");
  const [result, setResult] = useState<
    (ExportResult & { url: string; name: string }) | null
  >(null);
  const [history, setHistory] = useState<Asset[]>([]);
  const controller = useRef<AbortController | null>(null),
    downloadUrl = useRef(""),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
    };
  }, []);
  const run = async () => {
    setWarning("");
    if (method === "compatibility") {
      await saveProject();
      await compatibility.start(resolution);
      return;
    }
    const snapshot = structuredClone(project);
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setProgress({
      progress: 0,
      phase: "Preparing your edit",
      eta: 0,
      frame: 0,
      totalFrames: 0,
    });
    try {
      await saveProject();
      const exported = await exportProject(snapshot, media, {
        resolution,
        fps,
        quality,
        signal: abort.signal,
        onProgress: (next) => {
          if (mounted.current) setProgress(next);
        },
      });
      if (!mounted.current) return;
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
      const url = URL.createObjectURL(exported.blob);
      downloadUrl.current = url;
      const name = filename(snapshot, exported.extension);
      setResult({ ...exported, url, name });
      const form = new FormData();
      form.set(
        "file",
        new File([exported.blob], name, { type: exported.blob.type }),
      );
      try {
        const saved = await api<Asset>(`/projects/${clipId}/exports`, {
          method: "POST",
          body: form,
        });
        if (mounted.current) {
          setHistory((items) => [saved, ...items]);
          onSaved(saved);
        }
      } catch {
        if (mounted.current)
          setWarning(
            "Your export is ready to download. It could not be added to project history; keep this tab open until you download it.",
          );
      }
    } catch (error) {
      if (mounted.current)
        setWarning(
          (error as Error).name === "AbortError"
            ? "Export cancelled. Your edit is unchanged."
            : (error as Error).message,
        );
    } finally {
      if (mounted.current) setBusy(false);
      controller.current = null;
    }
  };
  if (!open) return null;
  const duration = durationOf(project),
    working = busy || compatibility.busy;
  const exports = [...history, ...previousExports].filter(
    (asset, index, items) =>
      items.findIndex((candidate) => candidate.id === asset.id) === index,
  );
  return (
    <section className="editor-export-panel" aria-label="Export video">
      <header>
        <div>
          <h2>Export your video</h2>
          <p>
            {formatTime(duration)} ·{" "}
            {project.width <= project.height ? "Portrait" : "Landscape"}
          </p>
        </div>
        <IconButton label="Close export panel" onClick={onClose}>
          <X size={17} />
        </IconButton>
      </header>
      {duration > 180 && (
        <p className="editor-export-warning">
          This edit is longer than 3 minutes. Trim it to 3 minutes or less for
          YouTube Shorts.
        </p>
      )}
      <div className="editor-field-pair">
        <label className="editor-field">
          <span>Resolution</span>
          <select
            aria-label="Export resolution"
            value={resolution}
            disabled={working}
            onChange={(event) =>
              setResolution(Number(event.target.value) as 720 | 1080)
            }
          >
            <option value={720}>720p</option>
            <option value={1080}>1080p</option>
          </select>
        </label>
        <label className="editor-field">
          <span>Frame rate</span>
          <select
            aria-label="Export frame rate"
            value={fps}
            disabled={working || method === "compatibility"}
            onChange={(event) =>
              setFps(Number(event.target.value) as 24 | 30 | 60)
            }
          >
            <option value={24}>24 fps</option>
            <option value={30}>30 fps</option>
            <option value={60}>60 fps</option>
          </select>
        </label>
      </div>
      <label className="editor-field">
        <span>Quality</span>
        <select
          aria-label="Export quality"
          value={quality}
          disabled={working || method === "compatibility"}
          onChange={(event) => setQuality(event.target.value as typeof quality)}
        >
          <option value="standard">Standard · smaller file</option>
          <option value="high">High · recommended</option>
          <option value="maximum">Maximum · larger file</option>
        </select>
      </label>
      <details className="editor-export-advanced">
        <summary>Export method</summary>
        <label className="editor-field">
          <select
            aria-label="Export method"
            value={method}
            disabled={working}
            onChange={(event) => setMethod(event.target.value as typeof method)}
          >
            <option value="browser">On this device</option>
            <option value="compatibility">Local compatibility export</option>
          </select>
        </label>
        <p>
          {method === "browser"
            ? "Uses the same renderer as your preview. MP4 when supported; WebM otherwise."
            : "Uses the local engine. Some effects require the default export. Frame rate follows the project."}
        </p>
      </details>
      {error && (
        <p className="editor-export-warning" role="status">
          {error}
        </p>
      )}
      <button
        className="button primary full"
        disabled={!project.items.length || working}
        onClick={() => void run()}
      >
        {working ? (
          <LoaderCircle size={16} className="spin" />
        ) : (
          <Download size={16} />
        )}
        {working ? "Exporting…" : "Export video"}
      </button>
      {busy && progress && (
        <div className="editor-export-progress" role="status">
          <div>
            <span>{progress.phase}</span>
            <strong>{Math.round(progress.progress)}%</strong>
          </div>
          <progress max="100" value={progress.progress} />
          <div>
            <span>
              {progress.eta > 0
                ? `About ${formatTime(progress.eta)} remaining`
                : "Calculating time…"}
            </span>
            <button onClick={() => controller.current?.abort()}>Cancel</button>
          </div>
        </div>
      )}
      {method === "compatibility" && <JobProgress job={compatibility.job} />}
      {result && !busy && (
        <div className="editor-export-complete">
          <p>
            <Check size={15} />
            Ready · {result.width} × {result.height} ·{" "}
            {result.extension.toUpperCase()} ·{" "}
            {(result.blob.size / 1024 / 1024).toFixed(1)} MB
          </p>
          <a
            className="button secondary full"
            href={result.url}
            download={result.name}
          >
            <Download size={16} />
            Download {result.extension.toUpperCase()}
          </a>
          <button className="editor-text-action" onClick={onPublish}>
            Open publish kit <ArrowUpRight size={13} />
          </button>
        </div>
      )}
      <div className="editor-export-extras">
        <button
          disabled={!project.items.some((item) => item.kind === "text")}
          onClick={() => {
            const captions = project.items
              .filter((item) => item.kind === "text" && item.text.trim())
              .sort((a, b) => a.start - b.start);
            downloadBlob(
              new Blob(
                [
                  captions
                    .map(
                      (item, index) =>
                        `${index + 1}\n${srtTime(item.start)} --> ${srtTime(item.start + item.duration)}\n${item.text}\n`,
                    )
                    .join("\n"),
                ],
                { type: "application/x-subrip" },
              ),
              filename(project, "srt"),
            );
          }}
        >
          <FileText size={14} />
          Captions (.srt)
        </button>
        <button
          disabled={!project.items.length}
          onClick={() => {
            const canvas = document.querySelector<HTMLCanvasElement>(
              ".editor-canvas > canvas",
            );
            canvas?.toBlob((blob) => {
              if (blob) downloadBlob(blob, filename(project, "png"));
            }, "image/png");
          }}
        >
          <Image size={14} />
          Current frame
        </button>
      </div>
      {exports.length > 0 && (
        <details className="editor-export-history">
          <summary>
            Previous exports <span>{exports.length}</span>
          </summary>
          {exports.slice(0, 8).map((asset, index) => (
            <a key={asset.id} href={assetUrl(asset)} download>
              <Download size={13} />
              <span>Export {exports.length - index}</span>
              <span>
                {asset.path.split(".").at(-1)?.toUpperCase() || "Video"}
              </span>
            </a>
          ))}
        </details>
      )}
    </section>
  );
}
