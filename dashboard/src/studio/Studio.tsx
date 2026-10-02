import {
  AudioLines,
  Check,
  ChevronDown,
  Download,
  Film,
  FolderOpen,
  LoaderCircle,
  Mic2,
  Music2,
  Plus,
  Save,
  Scissors,
  Sparkles,
  Subtitles,
  Type,
  Upload,
  VolumeX,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Asset, Clip } from "../api";
import { api, assetUrl, editable, useJob } from "../api";
import { Badge, IconButton, JobProgress, Notice } from "../ui";
import { EditorInspector } from "./EditorInspector";
import { EditorPreview } from "./EditorPreview";
import { EditorTimeline } from "./EditorTimeline";
import { AnimationTemplates, TextTemplates } from "./EditorTemplates";
import { applyTextPreset } from "./textPresets";
import type { TextPreset } from "./textPresets";
import {
  clamp,
  durationOf,
  formatTime,
  newItem,
  parseSrt,
  trimItem,
  uid,
} from "./editorModel";
import type {
  EditorMedia,
  EditorProject,
  EditorResponse,
  TimelineItem,
} from "./editorModel";

type Props = {
  clips: Clip[];
  selected: string;
  onSelect: (id: string) => void;
  refresh: () => void;
  onImport: () => void;
  onPublish: () => void;
};
export function Studio(props: Props) {
  return (
    <div className="timeline-studio">
      <div className="editor-project-heading">
        <div>
          <Film size={19} />
          <h1>Studio</h1>
          <span className="editor-heading-rule" />
          <select
            aria-label="Studio project"
            value={props.selected}
            onChange={(e) => props.onSelect(e.target.value)}
          >
            <option value="">Choose a project</option>
            {props.clips
              .filter((c) => c.workflow_status !== "archived")
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
          </select>
        </div>
        <button className="button secondary small" onClick={props.onImport}>
          <Plus size={15} />
          New project
        </button>
      </div>
      {props.selected ? (
        <ProjectEditor key={props.selected} {...props} />
      ) : (
        <div className="editor-welcome">
          <div className="editor-welcome-icon">
            <Scissors size={30} />
          </div>
          <h2>Your next edit starts here.</h2>
          <p>
            Choose a Short from your library, or import footage to start a
            project. Arrange clips, replace audio and add motion on the
            timeline.
          </p>
          <button className="button primary" onClick={props.onImport}>
            <Upload size={16} />
            Import footage
          </button>
        </div>
      )}
    </div>
  );
}
function ProjectEditor({ selected, clips, refresh }: Props) {
  const [clip, setClip] = useState<Clip | undefined>(
    clips.find((c) => c.id === selected),
  );
  const [project, setProject] = useState<EditorProject | null>(null),
    [media, setMedia] = useState<EditorMedia[]>([]);
  const [selection, setSelection] = useState(""),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false);
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [loading, setLoading] = useState(true),
    [uploading, setUploading] = useState(false);
  const [saveState, setSaveState] = useState("Saved"),
    [historyVersion, setHistoryVersion] = useState(0);
  const [binTab, setBinTab] = useState<"media" | "audio" | "text" | "motion">(
      "media",
    ),
    [exportOpen, setExportOpen] = useState(false),
    [resolution, setResolution] = useState<480 | 720 | 1080>(1080),
    [exported, setExported] = useState<Asset | null>(null);
  const [capability, setCapability] = useState<{
    available: boolean;
    model_ready: boolean;
    message: string;
  } | null>(null);
  const [permissionOpen, setPermissionOpen] = useState(false),
    [permissionNote, setPermissionNote] = useState(""),
    [rights, setRights] = useState<"permission" | "owned">("permission");
  const projectRef = useRef<EditorProject | null>(null),
    mounted = useRef(true),
    history = useRef<{ past: EditorProject[]; future: EditorProject[] }>({
      past: [],
      future: [],
    });
  const saved = useRef(""),
    saveQueue = useRef<EditorProject | null>(null),
    saving = useRef<Promise<void> | null>(null),
    saveController = useRef<AbortController | null>(null);
  const importInput = useRef<HTMLInputElement>(null),
    voiceInput = useRef<HTMLInputElement>(null),
    musicInput = useRef<HTMLInputElement>(null),
    srtInput = useRef<HTMLInputElement>(null);
  const completed = useRef(new Set<string>());
  const exportJob = useJob(undefined, `editor-export:${selected}`),
    audioJob = useJob(undefined, `editor-audio:${selected}`),
    downloadJob = useJob(undefined, `editor-download:${selected}`);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const commit = useCallback((next: EditorProject, remember = true) => {
    if (next.items.length > 100) {
      setError(
        "A project supports up to 100 timeline clips. Remove a clip before adding more.",
      );
      return;
    }
    const previous = projectRef.current;
    if (previous && JSON.stringify(previous) === JSON.stringify(next)) return;
    if (previous && remember) {
      history.current.past = [...history.current.past.slice(-79), previous];
      history.current.future = [];
    }
    projectRef.current = next;
    setProject(next);
    setSaveState("Unsaved changes");
    setHistoryVersion((v) => v + 1);
  }, []);
  const saveProject = useCallback(
    async (snapshot?: EditorProject) => {
      const next = snapshot || projectRef.current;
      if (!next) return;
      saveQueue.current = next;
      if (saving.current) return saving.current;
      const run = async () => {
        while (saveQueue.current) {
          const current = saveQueue.current;
          saveQueue.current = null;
          const serialized = JSON.stringify(current);
          if (serialized === saved.current) continue;
          if (mounted.current) setSaveState("Saving…");
          const controller = new AbortController();
          saveController.current = controller;
          try {
            await api<EditorResponse>(`/editor/${selected}`, {
              method: "PUT",
              body: serialized,
              signal: controller.signal,
              keepalive: serialized.length < 50000,
            });
            saved.current = serialized;
            if (mounted.current)
              setSaveState(
                JSON.stringify(projectRef.current) === serialized
                  ? "Saved"
                  : "Unsaved changes",
              );
          } catch (e) {
            if (!mounted.current) return;
            setSaveState("Save failed");
            setError(`Could not save this edit. ${(e as Error).message}`);
            break;
          }
        }
      };
      saving.current = run();
      try {
        await saving.current;
      } finally {
        saving.current = null;
      }
    },
    [selected],
  );
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    Promise.all([
      api<EditorResponse>(`/editor/${selected}`, { signal: controller.signal }),
      api<Clip>(`/clips/${selected}`, { signal: controller.signal }),
    ])
      .then(([data, c]) => {
        if (!mounted.current) return;
        projectRef.current = data.project;
        setProject(data.project);
        setSelection(data.project.items[0]?.id || "");
        setMedia(data.media);
        setClip(c);
        saved.current = JSON.stringify(data.project);
        setSaveState(data.saved_at ? "Saved" : "Ready to edit");
        setExported(
          c.assets?.filter((a) => a.kind === "export").at(-1) || null,
        );
        setLoading(false);
      })
      .catch((e) => {
        if (mounted.current && !controller.signal.aborted) {
          setError(e.message);
          setLoading(false);
        }
      });
    api<{
      separation: { available: boolean; model_ready: boolean; message: string };
    }>("/editor-capabilities", { signal: controller.signal })
      .then((data) => {
        if (mounted.current) setCapability(data.separation);
      })
      .catch(() => {});
    return () => {
      mounted.current = false;
      controller.abort();
      if (
        projectRef.current &&
        JSON.stringify(projectRef.current) !== saved.current
      )
        void saveProject(projectRef.current);
    };
  }, [selected, saveProject]);
  useEffect(() => {
    if (!project || loading || JSON.stringify(project) === saved.current)
      return;
    const timer = setTimeout(() => void saveProject(project), 900);
    return () => clearTimeout(timer);
  }, [project, loading, saveProject]);
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (
        projectRef.current &&
        JSON.stringify(projectRef.current) !== saved.current
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);
  const updateItem = useCallback(
    (item: TimelineItem) => {
      if (projectRef.current)
        commit({
          ...projectRef.current,
          items: projectRef.current.items.map((i) =>
            i.id === item.id ? item : i,
          ),
        });
    },
    [commit],
  );
  const undo = useCallback(() => {
    const previous = history.current.past.pop();
    if (!previous || !projectRef.current) return;
    history.current.future.push(projectRef.current);
    commit(previous, false);
  }, [commit]);
  const redo = useCallback(() => {
    const next = history.current.future.pop();
    if (!next || !projectRef.current) return;
    history.current.past.push(projectRef.current);
    commit(next, false);
  }, [commit]);
  const remove = useCallback(() => {
    const current = projectRef.current;
    if (!current || !selection) return;
    commit({
      ...current,
      items: current.items.filter((i) => i.id !== selection),
    });
    setSelection("");
  }, [commit, selection]);
  const split = useCallback(() => {
    const current = projectRef.current,
      item = current?.items.find((i) => i.id === selection);
    if (!current || !item) return;
    const local = time - item.start;
    if (local < 0.1 || local > item.duration - 0.1) {
      setMessage("Move the playhead inside the selected clip to split it.");
      return;
    }
    const left = {
        ...trimItem(item, 0, local),
        animation_out: "none" as const,
      },
      right = {
        ...trimItem(item, local, item.duration),
        animation_in: "none" as const,
        id: uid(),
      };
    commit({
      ...current,
      items: current.items.flatMap((i) =>
        i.id === item.id ? [left, right] : [i],
      ),
    });
    setSelection(right.id);
  }, [selection, time, commit]);
  const duplicate = useCallback(() => {
    const current = projectRef.current,
      item = current?.items.find((i) => i.id === selection);
    if (!current || !item) return;
    const start = item.start + item.duration;
    if (start + item.duration > 600) {
      setError("This copy would exceed the 10-minute project limit.");
      return;
    }
    const copy = { ...structuredClone(item), id: uid(), start };
    commit({ ...current, items: [...current.items, copy] });
    setSelection(copy.id);
  }, [selection, commit]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input,textarea,select,[contenteditable=true]"))
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveProject();
      } else if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove();
      } else if (e.key.toLowerCase() === "s" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        split();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [undo, redo, remove, split, saveProject]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0,
      last = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - last) / 1000;
      last = now;
      setTime((t) => {
        const duration = projectRef.current
          ? durationOf(projectRef.current)
          : 0;
        if (t + elapsed >= duration) {
          setPlaying(false);
          return duration;
        }
        return t + elapsed;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  const seek = (n: number) => {
    setPlaying(false);
    setTime(n);
  };
  const freeTrack = (
    current: EditorProject,
    start: number,
    duration: number,
    preferred: number,
  ) => {
    for (let n = preferred; n < 8; n++) {
      if (
        !current.items.some(
          (i) =>
            i.track === n &&
            i.start < start + duration &&
            i.start + i.duration > start,
        )
      )
        return n;
    }
    return preferred;
  };
  const addMedia = (asset: EditorMedia) => {
    const current = projectRef.current;
    if (!current) return;
    const start = clamp(time, 0, 599.9),
      duration = Math.min(asset.duration || 5, 600 - start);
    const item = newItem(
      asset.media_type === "audio" ? "audio" : "video",
      asset,
      start,
      freeTrack(current, start, duration, asset.media_type === "audio" ? 1 : 0),
    );
    commit({ ...current, items: [...current.items, item] });
    setSelection(item.id);
    setMessage("");
  };
  const upload = async (
    file: File | undefined,
    role: "video" | "voiceover" | "music",
  ) => {
    if (!file) return;
    setUploading(true);
    setError("");
    const form = new FormData();
    form.set("file", file);
    form.set("role", role);
    try {
      const asset = await api<EditorMedia>(`/editor/${selected}/media`, {
        method: "POST",
        body: form,
      });
      if (!mounted.current) return;
      setMedia((m) => [...m.filter((a) => a.id !== asset.id), asset]);
      addMedia(asset);
      setMessage(`${asset.name} added to the timeline.`);
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setUploading(false);
    }
  };
  const addText = () => {
    const current = projectRef.current;
    if (!current) return;
    const item = newItem(
      "text",
      undefined,
      Math.min(time, 595),
      freeTrack(current, time, 5, 2),
    );
    commit({ ...current, items: [...current.items, item] });
    setSelection(item.id);
  };
  const applyTemplate = (preset: TextPreset, all: boolean) => {
    const current = projectRef.current;
    if (!current) return;
    const selectedText = current.items.find(
      (i) => i.id === selection && i.kind === "text",
    );
    if (all || selectedText) {
      commit({
        ...current,
        items: current.items.map((i) =>
          i.kind === "text" && (all || i.id === selection)
            ? applyTextPreset(i, preset)
            : i,
        ),
      });
    } else {
      const text = newItem(
        "text",
        undefined,
        Math.min(time, 595),
        freeTrack(current, time, 5, 2),
      );
      text.text = preset.sample;
      text.name = preset.sample;
      const item = applyTextPreset(text, preset);
      commit({ ...current, items: [...current.items, item] });
      setSelection(item.id);
    }
  };
  const importSrt = async (file: File | undefined) => {
    if (!file) return;
    try {
      const items = parseSrt(await file.text());
      if (!items.length)
        throw new Error(
          "No timed captions found. Choose an SRT subtitle file.",
        );
      if (!mounted.current || !projectRef.current) return;
      commit({
        ...projectRef.current,
        items: [...projectRef.current.items, ...items],
      });
      setSelection(items[0].id);
      setMessage(`${items.length} captions imported.`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const runAudio = async (mode: "extract" | "voice" | "remove") => {
    const item = projectRef.current?.items.find((i) => i.id === selection);
    if (!item?.asset_id) return;
    setError("");
    setMessage("");
    sessionStorage.setItem(
      `editor-audio-context:${selected}`,
      JSON.stringify({ mode, item }),
    );
    await audioJob.start(
      `/editor/${selected}/${mode === "extract" ? "extract-audio" : "separate-audio"}`,
      { asset_id: item.asset_id },
    );
  };
  useEffect(() => {
    const job = audioJob.job;
    if (
      !project ||
      job?.status !== "completed" ||
      completed.current.has(job.id)
    )
      return;
    completed.current.add(job.id);
    if (sessionStorage.getItem(`editor-applied:${job.id}`)) return;
    let context: { mode: string; item: TimelineItem } | null = null;
    try {
      context = JSON.parse(
        sessionStorage.getItem(`editor-audio-context:${selected}`) || "null",
      );
    } catch {
      /* An unavailable context still leaves the generated assets in the media bin. */
    }
    const assets = [
      job.result?.asset,
      job.result?.vocals,
      job.result?.instrumental,
    ].filter(Boolean) as EditorMedia[];
    setMedia((m) => [
      ...m.filter((a) => !assets.some((b) => b.id === a.id)),
      ...assets,
    ]);
    const asset = (
      context?.mode === "voice"
        ? job.result?.vocals
        : context?.mode === "remove"
          ? job.result?.instrumental
          : job.result?.asset
    ) as EditorMedia | undefined;
    const current = projectRef.current,
      source = current?.items.find((i) => i.id === context?.item.id);
    if (
      current &&
      source &&
      asset &&
      !current.items.some((i) => i.id === `audio-${job.id}`)
    ) {
      const audio = {
        ...newItem(
          "audio",
          asset,
          source.start,
          freeTrack(current, source.start, source.duration, 1),
        ),
        id: `audio-${job.id}`,
        source_in: source.source_in,
        duration: source.duration,
        speed: source.speed,
        volume: source.volume,
        fade_in: source.fade_in,
        fade_out: source.fade_out,
        keyframes: source.keyframes.map((k) => ({
          ...k,
          x: 0,
          y: 0,
          scale: 1,
          rotation: 0,
          opacity: 1,
        })),
      };
      commit({
        ...current,
        items: [
          ...current.items.map((i) =>
            i.id === source.id ? { ...i, muted: true } : i,
          ),
          audio,
        ],
      });
      setSelection(audio.id);
      setMessage(
        context?.mode === "remove"
          ? "Voice removed. The separated music track is aligned below your video."
          : context?.mode === "voice"
            ? "Voice isolated and added to the timeline. The original soundtrack is muted."
            : "Audio extracted to its own track. The original video is muted to avoid doubling.",
      );
    } else setMessage("Audio is ready in your media bin.");
    sessionStorage.setItem(`editor-applied:${job.id}`, "1");
  }, [audioJob.job, project, selected, commit]);
  useEffect(() => {
    const job = exportJob.job;
    if (job?.status !== "completed" || completed.current.has(job.id)) return;
    completed.current.add(job.id);
    if (job.result?.asset) setExported(job.result.asset as Asset);
    setMessage("Export complete. Your MP4 is ready to download.");
    refreshRef.current();
  }, [exportJob.job]);
  useEffect(() => {
    const job = downloadJob.job;
    if (job?.status !== "completed" || completed.current.has(job.id)) return;
    completed.current.add(job.id);
    if (sessionStorage.getItem(`editor-applied:${job.id}`)) return;
    api<EditorResponse>(`/editor/${selected}`)
      .then((data) => {
        if (!mounted.current) return;
        setMedia(data.media);
        const current = projectRef.current;
        if (current && !current.items.length) {
          const asset = data.media.find((a) => a.kind === "source");
          if (asset) {
            const item = newItem("video", asset);
            commit({ ...current, items: [item] });
            setSelection(item.id);
          }
        }
        setMessage("Footage is ready to edit.");
        sessionStorage.setItem(`editor-applied:${job.id}`, "1");
        refreshRef.current();
      })
      .catch((e) => {
        if (mounted.current) setError(e.message);
      });
  }, [downloadJob.job, selected, commit]);
  const recordPermission = async () => {
    if (!permissionNote.trim()) return;
    setError("");
    try {
      const updated = await api<Clip>(`/clips/${selected}`, {
        method: "PATCH",
        body: JSON.stringify({
          license_status: rights,
          permission_note: permissionNote.trim(),
        }),
      });
      if (!mounted.current) return;
      setClip(updated);
      setPermissionOpen(false);
      refreshRef.current();
      setMessage(
        "Footage permission recorded. You can now prepare the source video.",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (loading)
    return (
      <div className="editor-loading" aria-label="Loading editor">
        <div />
        <div />
        <div />
        <div />
      </div>
    );
  if (!project)
    return (
      <Notice>
        {error || "The editor could not load. Refresh the page to try again."}
      </Notice>
    );
  const selectedItem = project.items.find((i) => i.id === selection),
    selectedAsset = media.find((a) => a.id === selectedItem?.asset_id),
    permitted = clip ? editable(clip) : false;
  const audioAvailable =
    selectedItem && selectedItem.kind !== "text" && selectedAsset?.has_audio;
  const busy = audioJob.busy || uploading,
    jobError = audioJob.error || downloadJob.error || exportJob.error;
  const visibleMedia = media.filter((a) =>
    binTab === "audio" ? a.media_type === "audio" : a.media_type !== "audio",
  );
  return (
    <>
      <div className="editor-action-bar">
        <div>
          {clip && <Badge clip={clip} />}
          <span
            className={`editor-save-state ${saveState === "Save failed" ? "error" : ""}`}
          >
            {saveState === "Saving…" ? (
              <LoaderCircle size={13} className="spin" />
            ) : (
              <Check size={13} />
            )}
            <span role="status">{saveState}</span>
          </span>
        </div>
        <div>
          <button
            className="button secondary small"
            onClick={() => setSelection("")}
            aria-pressed={!selection}
          >
            Canvas
          </button>
          <button
            className="button secondary small"
            onClick={() => void saveProject()}
          >
            <Save size={14} />
            Save project
          </button>
          <button
            className="button primary small"
            onClick={() => setExportOpen(!exportOpen)}
            aria-expanded={exportOpen}
          >
            <Download size={14} />
            Export
            <ChevronDown size={13} />
          </button>
        </div>
      </div>
      {(error || jobError) && (
        <Notice>
          {error || jobError}
          <button
            className="editor-dismiss"
            aria-label="Dismiss error"
            onClick={() => {
              setError("");
              audioJob.setError("");
              downloadJob.setError("");
              exportJob.setError("");
            }}
          >
            <X size={14} />
          </button>
        </Notice>
      )}
      {message && (
        <div className="editor-message" role="status">
          <Check size={14} />
          <span>{message}</span>
          <IconButton label="Dismiss message" onClick={() => setMessage("")}>
            <X size={14} />
          </IconButton>
        </div>
      )}
      {exportOpen && (
        <div className="editor-export-panel">
          <div>
            <strong>Export video</strong>
            <span>MP4 · H.264 / AAC · {formatTime(durationOf(project))}</span>
          </div>
          <label className="editor-export-resolution">
            Resolution
            <select
              aria-label="Export resolution"
              value={resolution}
              onChange={(e) =>
                setResolution(Number(e.target.value) as 480 | 720 | 1080)
              }
            >
              <option value={480}>480p</option>
              <option value={720}>720p</option>
              <option value={1080}>1080p</option>
            </select>
          </label>
          <button
            className="button primary small"
            disabled={!permitted || !project.items.length || exportJob.busy}
            onClick={async () => {
              setPlaying(false);
              await saveProject();
              if (!mounted.current) return;
              void exportJob.start(`/editor/${selected}/export`, {
                project: projectRef.current,
                resolution,
              });
            }}
          >
            {exportJob.busy ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <Download size={14} />
            )}
            Export MP4
          </button>
          {exported && (
            <a
              className="button secondary small"
              href={assetUrl(exported)}
              download
            >
              Download MP4
            </a>
          )}
          <IconButton
            label="Close export panel"
            onClick={() => setExportOpen(false)}
          >
            <X size={16} />
          </IconButton>
          {!permitted && (
            <p>
              Record footage permission in the Media panel before exporting.
            </p>
          )}
          <JobProgress job={exportJob.job} />
        </div>
      )}
      <div className="editor-workspace">
        <aside className="editor-media-panel" aria-label="Media bin">
          <nav className="editor-bin-tabs" aria-label="Editor tools">
            {(
              [
                { id: "media", label: "Media", icon: FolderOpen },
                { id: "audio", label: "Audio", icon: Music2 },
                { id: "text", label: "Text", icon: Type },
                { id: "motion", label: "Motion", icon: Sparkles },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                aria-pressed={binTab === id}
                className={binTab === id ? "active" : ""}
                onClick={() => setBinTab(id)}
              >
                <Icon size={17} />
                {label}
              </button>
            ))}
          </nav>
          <div className="editor-bin-scroll">
            <input
              hidden
              ref={importInput}
              aria-label="Import media"
              type="file"
              accept="video/*"
              onChange={(e) => {
                void upload(e.target.files?.[0], "video");
                e.target.value = "";
              }}
            />
            <input
              hidden
              ref={voiceInput}
              aria-label="Import voiceover"
              type="file"
              accept="audio/*"
              onChange={(e) => {
                void upload(e.target.files?.[0], "voiceover");
                e.target.value = "";
              }}
            />
            <input
              hidden
              ref={musicInput}
              aria-label="Import music"
              type="file"
              accept="audio/*"
              onChange={(e) => {
                void upload(e.target.files?.[0], "music");
                e.target.value = "";
              }}
            />
            <input
              hidden
              ref={srtInput}
              aria-label="Import captions"
              type="file"
              accept=".srt"
              onChange={(e) => {
                void importSrt(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {binTab === "media" && (
              <>
                <button
                  className="button secondary small full editor-import-button"
                  disabled={uploading || !permitted}
                  onClick={() => importInput.current?.click()}
                >
                  {uploading ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <Upload size={15} />
                  )}
                  Import media
                </button>
                {!media.some((a) => a.media_type !== "audio") && (
                  <div className="editor-source-empty">
                    <Film size={25} />
                    <h3>Bring in your footage</h3>
                    <p>
                      {permitted
                        ? "Import a video. Your files stay on this device."
                        : "Record permission to edit this project, or use New project for your own footage."}
                    </p>
                    {clip?.video_id && (
                      <>
                        {permitted ? (
                          <button
                            className="button secondary small full"
                            disabled={downloadJob.busy}
                            onClick={() =>
                              void downloadJob.start(
                                `/clips/${selected}/download`,
                              )
                            }
                          >
                            <Download size={14} />
                            Prepare source video
                          </button>
                        ) : (
                          <>
                            <p>
                              This saved Short is marked as inspiration. Record
                              your permission to use its footage.
                            </p>
                            <button
                              className="button secondary small full"
                              onClick={() => setPermissionOpen(!permissionOpen)}
                            >
                              Record permission
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}
                {permissionOpen && (
                  <div className="editor-permission">
                    <label className="editor-field">
                      <span>Permission</span>
                      <select
                        aria-label="Footage permission"
                        value={rights}
                        onChange={(e) =>
                          setRights(e.target.value as "permission" | "owned")
                        }
                      >
                        <option value="permission">I have permission</option>
                        <option value="owned">I own this footage</option>
                      </select>
                    </label>
                    <label className="editor-field">
                      <span>Permission details</span>
                      <textarea
                        aria-label="Permission details"
                        rows={3}
                        value={permissionNote}
                        onChange={(e) => setPermissionNote(e.target.value)}
                        placeholder="Record who granted permission or how you own the footage."
                      />
                    </label>
                    <button
                      className="button primary small full"
                      disabled={!permissionNote.trim()}
                      onClick={() => void recordPermission()}
                    >
                      Save permission
                    </button>
                  </div>
                )}
                <JobProgress job={downloadJob.job} />
              </>
            )}
            {binTab === "audio" && (
              <>
                <div className="editor-import-audio">
                  <button
                    className="button secondary small full"
                    disabled={uploading || !permitted}
                    onClick={() => voiceInput.current?.click()}
                  >
                    <Mic2 size={15} />
                    Import voiceover
                  </button>
                  <button
                    className="button secondary small full"
                    disabled={uploading || !permitted}
                    onClick={() => musicInput.current?.click()}
                  >
                    <Music2 size={15} />
                    Import music
                  </button>
                </div>
                <section className="editor-audio-actions">
                  <h3>Selected clip</h3>
                  <p>
                    {audioAvailable
                      ? selectedItem?.name
                      : "Select a video or audio clip with a soundtrack."}
                  </p>
                  <button
                    className="button secondary small full"
                    disabled={!audioAvailable || busy}
                    onClick={() => void runAudio("extract")}
                  >
                    <AudioLines size={14} />
                    Extract audio
                  </button>
                  <button
                    className="button secondary small full"
                    disabled={!audioAvailable || busy}
                    onClick={() =>
                      selectedItem &&
                      updateItem({
                        ...selectedItem,
                        muted: !selectedItem.muted,
                      })
                    }
                  >
                    <VolumeX size={14} />
                    {selectedItem?.muted
                      ? "Restore original audio"
                      : "Remove all original audio"}
                  </button>
                  <div className="editor-audio-separation">
                    <h3>Voice isolation</h3>
                    <button
                      className="button secondary small full"
                      disabled={
                        !audioAvailable || busy || !capability?.available
                      }
                      onClick={() => void runAudio("voice")}
                    >
                      <Mic2 size={14} />
                      Isolate voice
                    </button>
                    <button
                      className="button secondary small full"
                      disabled={
                        !audioAvailable || busy || !capability?.available
                      }
                      onClick={() => void runAudio("remove")}
                    >
                      <Music2 size={14} />
                      Remove voice, keep music
                    </button>
                    <p>
                      {capability?.available
                        ? "Separates voice and music locally. Results depend on the original mix."
                        : capability?.message ||
                          "Checking local voice separation…"}
                    </p>
                  </div>
                  <JobProgress job={audioJob.job} />
                </section>
              </>
            )}
            {binTab === "text" ? (
              <div className="editor-text-tools">
                <h3>Text & captions</h3>
                <p>Add your own text or import timed subtitles.</p>
                <button
                  className="button secondary small full"
                  onClick={addText}
                >
                  <Type size={15} />
                  Add text
                </button>
                <button
                  className="button secondary small full"
                  onClick={() => srtInput.current?.click()}
                >
                  <Subtitles size={15} />
                  Import SRT captions
                </button>
                <p>Every caption becomes an editable timeline clip.</p>
                <TextTemplates
                  onApply={applyTemplate}
                  hasCaptions={project.items.some((i) => i.kind === "text")}
                  selectedText={selectedItem?.kind === "text"}
                />
              </div>
            ) : binTab === "motion" ? (
              <AnimationTemplates
                item={selectedItem}
                onApply={(side, value) =>
                  selectedItem && updateItem({ ...selectedItem, [side]: value })
                }
              />
            ) : (
              <div className="editor-media-list">
                {visibleMedia.length > 0 && (
                  <div className="editor-bin-list-heading">
                    <h3>Project files</h3>
                    <span>{visibleMedia.length}</span>
                  </div>
                )}
                {visibleMedia.map((asset) => (
                  <button
                    className="editor-media-asset"
                    key={asset.id}
                    onClick={() => addMedia(asset)}
                    title={`Add ${asset.name} to timeline`}
                  >
                    <span
                      className={`editor-asset-preview ${asset.media_type}`}
                    >
                      {asset.media_type === "audio" ? (
                        <AudioLines size={24} />
                      ) : asset.media_type === "image" ? (
                        <img src={assetUrl(asset)} alt="" />
                      ) : (
                        <video
                          src={`${assetUrl(asset)}#t=0.1`}
                          preload="metadata"
                          muted
                        />
                      )}
                      <span>{formatTime(asset.duration)}</span>
                    </span>
                    <strong>{asset.name}</strong>
                    <span className="editor-asset-add">
                      <Plus size={12} />
                      Add to timeline
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
        <EditorPreview
          project={project}
          media={media}
          time={time}
          playing={playing}
          selected={selection}
          onTime={seek}
          onPlaying={setPlaying}
          onSelect={setSelection}
        />
        <EditorInspector
          project={project}
          item={selectedItem}
          asset={selectedAsset}
          time={time}
          onChange={updateItem}
          onProject={(patch) => commit({ ...project, ...patch })}
          onTime={seek}
        />
      </div>
      <EditorTimeline
        project={project}
        media={media}
        selected={selection}
        time={time}
        onTime={seek}
        onSelect={setSelection}
        onChange={updateItem}
        onSplit={split}
        onDelete={remove}
        onDuplicate={duplicate}
        onUndo={undo}
        onRedo={redo}
        canUndo={historyVersion >= 0 && history.current.past.length > 0}
        canRedo={history.current.future.length > 0}
      />
    </>
  );
}
