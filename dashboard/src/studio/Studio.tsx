import { compileAnimation } from "./animationEngine";
import { BundledAudioPanel } from "./BundledAudioPanel";
import { MediaRecoveryPanel } from "./MediaRecoveryPanel";
import { readRecovery, saveRecovery } from "./mediaStorage";
import {
  AudioLines,
  Captions,
  Check,
  ChevronDown,
  Download,
  Film,
  FolderOpen,
  LayoutTemplate,
  LoaderCircle,
  Mic2,
  Music2,
  PanelLeftClose,
  Plus,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Sticker,
  Subtitles,
  Type,
  Upload,
  VolumeX,
  WandSparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Asset, Clip } from "../api";
import { api, assetUrl, useJob } from "../api";
import { IconButton, JobProgress, Notice } from "../ui";
import { EditorInspector } from "./EditorInspector";
import { EditorPreview } from "./EditorPreview";
import { EditorTimeline } from "./EditorTimeline";
import { AnimationTemplates, TextTemplates } from "./EditorTemplates";
import { CustomTemplates } from "./CustomTemplates";
import { addKeyframe } from "./timelineOps";
import { ScriptVoicePanel } from "./ScriptVoicePanel";
import { CaptionPanel } from "./CaptionPanel";
import { EditorExportPanel } from "./EditorExportPanel";
import { applyTextPreset } from "./textPresets";
import {
  buildProjectTemplate,
  FilterPresets,
  MediaAssetGrid,
  ProjectTemplates,
  StickerPresets,
  TransitionPresets,
} from "./EditorAssetPanels";
import type { ProjectTemplate, StickerPreset } from "./EditorAssetPanels";
import {
  EditorTopbar,
  PaneSplitter,
  ShortcutsPanel,
  useEditorLayout,
} from "./EditorChrome";
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
  TransitionId,
} from "./editorModel";

type Props = {
  clips: Clip[];
  selected: string;
  onSelect: (id: string) => void;
  refresh: () => void;
  onImport: () => void;
  onPublish: () => void;
  onBack?: () => void;
};
const editorTools = [
  { id: "media", label: "Media", icon: FolderOpen },
  { id: "audio", label: "Audio", icon: Music2 },
  { id: "text", label: "Text", icon: Type },
  { id: "captions", label: "Captions", icon: Captions },
  { id: "stickers", label: "Stickers", icon: Sticker },
  { id: "effects", label: "Effects", icon: WandSparkles },
  { id: "transitions", label: "Transitions", icon: Scissors },
  { id: "filters", label: "Filters", icon: SlidersHorizontal },
  { id: "templates", label: "Templates", icon: LayoutTemplate },
] as const;
type Tool = (typeof editorTools)[number]["id"];
export function Studio(props: Props) {
  if (props.selected)
    return (
      <div className="timeline-studio">
        <ProjectEditor key={props.selected} {...props} />
      </div>
    );
  return (
    <div className="timeline-studio editor-start-screen">
      <header className="editor-topbar">
        <span className="editor-brand-mark">
          <Scissors size={19} />
        </span>
        <span className="editor-brand-name">
          ShortForge<span>Studio</span>
        </span>
        <div className="editor-topbar-spacer" />
        {props.onBack && (
          <button className="button secondary" onClick={props.onBack}>
            Back to library
          </button>
        )}
      </header>
      <div className="editor-welcome">
        <div className="editor-welcome-icon">
          <Film size={30} />
        </div>
        <h1>Make room for your next story.</h1>
        <p>Start with your footage. Find your rhythm. Make it yours.</p>
        <button className="button primary" onClick={props.onImport}>
          <Plus size={17} />
          New project
        </button>
        {props.clips.some((clip) => clip.workflow_status !== "archived") && (
          <label className="editor-open-recent">
            <span>Or open a recent project</span>
            <select
              aria-label="Studio project"
              defaultValue=""
              onChange={(event) => props.onSelect(event.target.value)}
            >
              <option value="" disabled>
                Choose a project
              </option>
              {props.clips
                .filter((clip) => clip.workflow_status !== "archived")
                .map((clip) => (
                  <option key={clip.id} value={clip.id}>
                    {clip.title}
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}
function ProjectEditor({
  selected,
  clips,
  refresh,
  onSelect,
  onImport,
  onBack,
  onPublish,
}: Props) {
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
  const [binTab, setBinTab] = useState<Tool>("media"),
    [exportOpen, setExportOpen] = useState(false),
    [exported, setExported] = useState<Asset | null>(null);
  const [capability, setCapability] = useState<{
    available: boolean;
    model_ready: boolean;
    message: string;
  } | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { layout, setLayout, style: layoutStyle } = useEditorLayout();
  const sourceAttempted = useRef(false);
  const projectInput = useRef<HTMLInputElement>(null);
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
    const previous = projectRef.current;
    if (previous && JSON.stringify(previous) === JSON.stringify(next)) return;
    if (previous && remember) {
      history.current.past = [...history.current.past.slice(-119), previous];
      history.current.future = [];
    }
    projectRef.current = next;
    try {
      localStorage.setItem(
        `shortforge-recovery:${selected}`,
        JSON.stringify({ updatedAt: Date.now(), project: next }),
      );
    } catch {
      /* Server autosave still runs if local storage is full. */
    }
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
            if(current.name?.trim() && current.name !== (saved.current ? JSON.parse(saved.current).name : ""))await api(`/projects/${selected}`,{method:"PATCH",body:JSON.stringify({title:current.name.trim()})});
            saved.current = serialized;
            try {
              const recovery = JSON.parse(
                localStorage.getItem(`shortforge-recovery:${selected}`) ||
                  "null",
              );
              if (recovery && JSON.stringify(recovery.project) === serialized)
                localStorage.removeItem(`shortforge-recovery:${selected}`);
            } catch {
              /* Recovery storage is optional. */
            }
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
      .then(async ([data, c]) => {
        if (!mounted.current) return;
        let opened = data.project;
        try {
          const diskRecovery = await readRecovery(selected).catch(()=>undefined);
          if (!mounted.current || controller.signal.aborted) return;
          const recovery = JSON.parse(localStorage.getItem(`shortforge-recovery:${selected}`) || "null") || (diskRecovery ? {project:diskRecovery.project,updatedAt:diskRecovery.updated}:null);
          if (
            recovery?.project?.version === 1 &&
            Array.isArray(recovery.project.items) &&
            recovery.updatedAt > Date.parse(data.saved_at || "1970-01-01") &&
            JSON.stringify(recovery.project) !== JSON.stringify(data.project)
          ) {
            opened = recovery.project;
            history.current.past = [data.project];
            setMessage(
              "Recovered your unsaved edit. Changes are being saved to this project.",
            );
          }
        } catch {
          /* An invalid recovery snapshot does not block the saved project. */
        }
        projectRef.current = opened;
        setProject(opened);
        setSelection(opened.items[0]?.id || "");
        setMedia(data.media);
        setClip(c);
        saved.current = JSON.stringify(data.project);
        setSaveState(
          opened !== data.project
            ? "Unsaved changes"
            : data.saved_at
              ? "Saved"
              : "Ready to edit",
        );
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
    const timer = setTimeout(() => { void saveRecovery(selected,project).catch(()=>setMessage("Browser recovery storage is full. The project is still being saved to your local library.")); void saveProject(project); }, 900);
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
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement;
      if (target.closest("input,textarea,select,[contenteditable=true]"))
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveProject();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setExportOpen(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicate();
      } else if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen((open) => !open);
      } else if (e.key === "Escape") {
        setShortcutsOpen(false);
        setExportOpen(false);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        setPlaying(false);
        setTime((current) =>
          clamp(
            current +
              (e.key === "ArrowRight" ? 1 : -1) *
                (e.shiftKey ? 1 : 1 / (projectRef.current?.fps || 30)),
            0,
            projectRef.current ? durationOf(projectRef.current) : 0,
          ),
        );
      } else if (e.key.toLowerCase() === "m" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const current = projectRef.current;
        if (current)
          commit({
            ...current,
            markers: [
              ...(current.markers || []),
              {
                id: uid(),
                time,
                label: `Marker ${(current.markers?.length || 0) + 1}`,
              },
            ],
          });
      } else if (e.key.toLowerCase() === "k" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const current = projectRef.current;
        const item = current?.items.find(
          (candidate) => candidate.id === selection,
        );
        if (item && current)
          commit({
            ...current,
            items: current.items.map((candidate) =>
              candidate.id === item.id ? addKeyframe(item, time) : candidate,
            ),
          });
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
  }, [undo, redo, remove, split, saveProject, duplicate, commit, time]);
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
    for (let n = preferred; ; n++) {
      if (current.tracks?.some((track) => track.id === n && track.locked))
        continue;
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
  };
  const addMedia = (
    asset: EditorMedia,
    at = time,
    track?: number,
    patch: Partial<TimelineItem> = {},
  ) => {
    const current = projectRef.current;
    if (!current) return;
    const start = clamp(at, 0, 599.9),
      duration = Math.min(asset.duration || 5, 600 - start);
    const item = newItem(
      asset.media_type === "audio" ? "audio" : "video",
      asset,
      start,
      track ??
        freeTrack(
          current,
          start,
          duration,
          asset.media_type === "audio" ? 1 : 0,
        ),
    );
    Object.assign(item, patch);
    commit({ ...current, items: [...current.items, item] });
    setSelection(item.id);
    setMessage("");
  };
  const upload = async (
    file: File | undefined,
    role: "video" | "voiceover" | "music",
    patch: Partial<TimelineItem> = {},
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
      addMedia(asset, time, undefined, {
        ...(role === "video" ? {} : { audio_role: role }),
        ...patch,
      });
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
        reverse: source.reverse,
        audio_role: "original" as const,
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
    if (
      !project ||
      loading ||
      job?.status !== "completed" ||
      completed.current.has(job.id)
    )
      return;
    completed.current.add(job.id);
    if (sessionStorage.getItem(`editor-applied:${job.id}`)) return;
    api<EditorResponse>(`/editor/${selected}`)
      .then((data) => {
        if (!mounted.current) return;
        setMedia(data.media);
        const current = projectRef.current;
        if (current && !current.source_seeded) {
          const asset = data.media.find((a) => a.kind === "source");
          if (asset) {
            const existing = current.items.find((item) => item.kind === "video" && item.asset_id === asset.id);
            const item = existing || data.project.items.find((candidate) => candidate.kind === "video" && candidate.asset_id === asset.id) || newItem("video", asset);
            commit({
              ...current,
              source_seeded: true,
              items: existing ? current.items : [...current.items, item],
            });
            setSelection(item.id);
          }
        }
        setMessage("Footage is ready to edit.");
        sessionStorage.setItem(`editor-applied:${job.id}`, "1");
        refreshRef.current();
      })
      .catch((e) => {
        completed.current.delete(job.id);
        if (mounted.current) setError(e.message);
      });
  }, [downloadJob.job, selected, commit, project, loading]);
  useEffect(() => {
    if (
      loading ||
      !project ||
      !(clip?.video_id || clip?.url) ||
      media.some((asset) => asset.kind === "source") ||
      sourceAttempted.current
    )
      return;
    sourceAttempted.current = true;
    if (downloadJob.busy || downloadJob.job?.status === "failed") return;
    void downloadJob.start(`/clips/${selected}/download`);
  }, [
    loading,
    project,
    clip?.video_id,
    clip?.url,
    media,
    downloadJob.busy,
    downloadJob.job?.status,
    downloadJob.start,
    selected,
  ]);
  const downloadProject = () => {
    const current = projectRef.current;
    if (!current) return;
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            { format: "shortforge-project", project: current, media },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(current.name || clip?.title || "ShortForge project").replace(/[^a-z0-9 _-]/gi, "").slice(0, 100)}.shortforge.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importProject = async (file?: File) => {
    if (!file || !projectRef.current) return;
    try {
      const parsed = JSON.parse(await file.text());
      const next = (parsed.project || parsed) as EditorProject;
      if (
        next.version !== 1 ||
        !Array.isArray(next.items) ||
        !Number.isFinite(next.width) ||
        !Number.isFinite(next.height) ||
        next.width < 16 ||
        next.height < 16 ||
        !Number.isFinite(next.fps) ||
        next.fps <= 0
      )
        throw new Error("Choose a valid ShortForge project JSON file.");
      if (
        next.items.some(
          (item) =>
            !["video", "audio", "text"].includes(item.kind) ||
            !Number.isFinite(item.start) ||
            item.start < 0 ||
            !Number.isFinite(item.duration) ||
            item.duration <= 0 ||
            item.start + item.duration > 600 ||
            !item.transform ||
            !Array.isArray(item.keyframes),
        )
      )
        throw new Error(
          "This project contains invalid clip timing or properties.",
        );
      const ids = new Set(media.map((asset) => asset.id));
      const missing = next.items.filter(
        (item) => item.asset_id && !ids.has(item.asset_id),
      ).length;
      // Validate with the same server contract used by autosave before applying.
      const validated = await api<EditorResponse>(`/editor/${selected}`, {
        method: "PUT",
        body: JSON.stringify(next),
      });
      if (!mounted.current) return;
      commit(validated.project);
      setSelection("");
      setTime(0);
      setMessage(
        missing
          ? `Project opened. ${missing} clip${missing === 1 ? " needs" : "s need"} the original media to be reimported.`
          : "Project opened. Use Undo to restore your previous edit.",
      );
    } catch (error) {
      setError(`Could not open project. ${(error as Error).message}`);
    }
  };
  const applyTransition = (
    id: TransitionId,
    requested: number,
    all: boolean,
  ) => {
    const current = projectRef.current;
    if (!current) return;
    const items = structuredClone(current.items);
    const targets = items
      .filter((item) => item.kind === "video" && (all || item.id === selection))
      .sort((a, b) => a.start - b.start);
    let applied = 0;
    for (const item of targets) {
      if (id === "none") {
        item.transition_in = "none";
        applied++;
        continue;
      }
      const previous = items
        .filter(
          (other) =>
            other.kind === "video" &&
            other.track === item.track &&
            other.start < item.start,
        )
        .sort((a, b) => b.start - a.start)[0];
      if (!previous) continue;
      const duration = Math.min(
        requested,
        previous.duration / 2,
        item.duration / 2,
      );
      item.start = Math.max(
        previous.start + 0.1,
        previous.start + previous.duration - duration,
      );
      item.transition_in = id;
      item.transition_duration = duration;
      applied++;
    }
    if (!applied) {
      setMessage(
        "Add a second video on the same track, then select it to create a transition.",
      );
      return;
    }
    commit({ ...current, items });
    setMessage(
      `${applied === 1 ? "Transition" : `${applied} transitions`} ${id === "none" ? "removed" : "applied"}.`,
    );
  };
  const addSticker = async (preset: StickerPreset) => {
    const current = projectRef.current;
    if (!current) return;
    if (!preset.shape) {
      const item = newItem(
        "text",
        undefined,
        Math.min(time, 595),
        freeTrack(current, time, 5, 2),
      );
      item.text = preset.text;
      item.name = preset.label;
      item.font_size = 82;
      item.color = preset.color;
      item.text_background = preset.background;
      item.transform.rotation = preset.rotation;
      item.text_style = {
        bold: true,
        italic: false,
        uppercase: true,
        align: "center",
        stroke: 0,
        stroke_color: "#000000",
        shadow: 0,
        letter_spacing: 2,
        reveal: "none",
        highlight: preset.color,
      };
      item.animation_in = "pop";
      commit({ ...current, items: [...current.items, item] });
      setSelection(item.id);
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.strokeStyle = preset.color;
    context.fillStyle = preset.color;
    context.lineWidth = 32;
    context.lineCap = "round";
    context.lineJoin = "round";
    if (preset.shape === "circle") {
      context.beginPath();
      context.arc(256, 256, 166, 0, Math.PI * 2);
      context.stroke();
    } else if (preset.shape === "arrow") {
      context.beginPath();
      context.moveTo(90, 405);
      context.lineTo(398, 118);
      context.moveTo(195, 118);
      context.lineTo(398, 118);
      context.lineTo(398, 323);
      context.stroke();
    } else if (preset.shape === "frame") {
      for (const [x, y, sx, sy] of [
        [72, 72, 1, 1],
        [440, 72, -1, 1],
        [72, 440, 1, -1],
        [440, 440, -1, -1],
      ]) {
        context.beginPath();
        context.moveTo(x, y + 115 * sy);
        context.lineTo(x, y);
        context.lineTo(x + 115 * sx, y);
        context.stroke();
      }
    } else {
      context.beginPath();
      [
        [256, 20],
        [310, 202],
        [492, 256],
        [310, 310],
        [256, 492],
        [202, 310],
        [20, 256],
        [202, 202],
      ].forEach(([x, y], index) =>
        index ? context.lineTo(x, y) : context.moveTo(x, y),
      );
      context.closePath();
      context.fill();
    }
    canvas.toBlob((blob) => {
      if (blob)
        void upload(
          new File([blob], `ShortForge ${preset.label}.png`, {
            type: "image/png",
          }),
          "video",
          {
            name: preset.label,
            transform: {
              x: 0,
              y: 0,
              scale: 0.28,
              rotation: preset.rotation,
              opacity: 1,
            },
          },
        );
    }, "image/png");
  };
  const applyProjectTemplate = (preset: ProjectTemplate) => {
    if (!projectRef.current) return;
    const next = buildProjectTemplate(projectRef.current, media, preset);
    commit(next);
    setTime(0);
    setSelection(next.items.find((item) => item.kind === "text")?.id || "");
    setMessage(
      `${preset.name} applied. Edit the titles on the canvas; Undo restores your previous edit.`,
    );
  };
  if (loading)
    return (
      <div className="editor-loading" role="status">
        <LoaderCircle size={24} className="spin" />
        <span>Opening your edit…</span>
      </div>
    );
  if (!project)
    return (
      <div className="editor-load-error">
        <Notice>{error || "The editor could not load."}</Notice>
        <button
          className="button secondary"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      </div>
    );
  const selectedItem = project.items.find((item) => item.id === selection);
  const selectedAsset = media.find(
    (asset) => asset.id === selectedItem?.asset_id,
  );
  const audioAvailable =
    !!selectedItem &&
    selectedItem.kind !== "text" &&
    !!selectedAsset?.has_audio;
  const busy = audioJob.busy || uploading;
  const jobError = audioJob.error || downloadJob.error || exportJob.error;
  const hasSource = media.some((asset) => asset.kind === "source");
  const sourceLoading = !hasSource && downloadJob.busy;
  const visibleMedia = media.filter((asset) =>
    binTab === "audio"
      ? asset.media_type === "audio"
      : asset.media_type !== "audio",
  );
  const canUndo = historyVersion >= 0 && history.current.past.length > 0;
  const canRedo = history.current.future.length > 0;
  return (
    <>
      <EditorTopbar
        clips={clips}
        selected={selected}
        name={project.name ?? clip?.title ?? "Untitled project"}
        saveState={saveState}
        canUndo={canUndo}
        canRedo={canRedo}
        onName={(name) => commit({ ...project, name })}
        onSelect={onSelect}
        onDuplicate={async()=>{try{await saveProject();const copy=await api<Clip>(`/projects/${selected}/duplicate`,{method:"POST",body:JSON.stringify({title:`${project.name||clip?.title||"Untitled project"} copy`})});refreshRef.current();onSelect(copy.id);}catch(e){setError((e as Error).message);}}}
        onDelete={async()=>{if(!window.confirm("Delete this project and its imported media? This cannot be undone."))return;try{await api(`/projects/${selected}`,{method:"DELETE"});refreshRef.current();onSelect("");}catch(e){setError((e as Error).message);}}}
        onBack={onBack}
        onNew={onImport}
        onUndo={undo}
        onRedo={redo}
        onSave={() => void saveProject()}
        onExport={() => setExportOpen((open) => !open)}
        onDownload={downloadProject}
        onImport={() => projectInput.current?.click()}
        onShortcuts={() => setShortcutsOpen((open) => !open)}
        assetCollapsed={layout.assetCollapsed}
        inspectorCollapsed={layout.inspectorCollapsed}
        onAssetToggle={() =>
          setLayout((old) => ({ ...old, assetCollapsed: !old.assetCollapsed }))
        }
        onInspectorToggle={() =>
          setLayout((old) => ({
            ...old,
            inspectorCollapsed: !old.inspectorCollapsed,
            ...(window.innerWidth <= 950 && old.inspectorCollapsed
              ? { assetCollapsed: true }
              : {}),
          }))
        }
      />
      <input
        hidden
        ref={importInput}
        aria-label="Import media"
        type="file"
        accept="video/*,image/*,audio/*"
        multiple
        onChange={(event) => {
          for (const file of Array.from(event.target.files || []))
            void upload(
              file,
              file.type.startsWith("audio/") ? "music" : "video",
            );
          event.target.value = "";
        }}
      />
      <input
        hidden
        ref={voiceInput}
        aria-label="Import voiceover"
        type="file"
        accept="audio/*"
        onChange={(event) => {
          void upload(event.target.files?.[0], "voiceover");
          event.target.value = "";
        }}
      />
      <input
        hidden
        ref={musicInput}
        aria-label="Import music"
        type="file"
        accept="audio/*"
        onChange={(event) => {
          void upload(event.target.files?.[0], "music");
          event.target.value = "";
        }}
      />
      <input
        hidden
        ref={srtInput}
        aria-label="Import captions"
        type="file"
        accept=".srt"
        onChange={(event) => {
          void importSrt(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <input
        hidden
        ref={projectInput}
        aria-label="Open project JSON"
        type="file"
        accept=".json"
        onChange={(event) => {
          void importProject(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {(error || jobError || message) && (
        <div
          className={`editor-status-toast ${error || jobError ? "is-error" : ""}`}
          role={error || jobError ? "alert" : "status"}
        >
          <span>{error || jobError || message}</span>
          <IconButton
            label="Dismiss message"
            onClick={() => {
              setError("");
              setMessage("");
              audioJob.setError("");
              downloadJob.setError("");
              exportJob.setError("");
            }}
          >
            <X size={15} />
          </IconButton>
        </div>
      )}
      <EditorExportPanel
        open={exportOpen}
        clipId={selected}
        project={project}
        media={media}
        previousExports={[
          ...(clip?.assets?.filter((asset) => asset.kind === "export") || []),
          ...(exported ? [exported] : []),
        ]}
        onClose={() => setExportOpen(false)}
        onPublish={onPublish}
        onSaved={(asset) => {
          setExported(asset);
          refreshRef.current();
        }}
        saveProject={saveProject}
        compatibility={{
          busy: exportJob.busy,
          job: exportJob.job,
          start: (exportResolution) =>
            exportJob.start(`/editor/${selected}/export`, {
              project: projectRef.current,
              resolution: exportResolution,
            }),
        }}
      />
      {shortcutsOpen && (
        <ShortcutsPanel onClose={() => setShortcutsOpen(false)} />
      )}
      <div
        className={`editor-editing-area ${layout.assetCollapsed ? "asset-collapsed" : ""} ${layout.inspectorCollapsed ? "inspector-collapsed" : ""}`}
        style={layoutStyle}
      >
        <div className="editor-workspace">
          <nav className="editor-tool-rail" aria-label="Editor tools">
            {editorTools.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                aria-pressed={binTab === id && !layout.assetCollapsed}
                className={
                  binTab === id && !layout.assetCollapsed ? "active" : ""
                }
                onClick={() => {
                  setBinTab(id);
                  setLayout((old) => ({
                    ...old,
                    assetCollapsed: false,
                    ...(window.innerWidth <= 950
                      ? { inspectorCollapsed: true }
                      : {}),
                  }));
                }}
              >
                <Icon size={20} strokeWidth={1.7} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <>
            <aside
              hidden={layout.assetCollapsed}
              className="editor-media-panel"
              aria-label={`${editorTools.find((tool) => tool.id === binTab)?.label} panel`}
            >
              <header className="editor-panel-heading">
                <h2>{editorTools.find((tool) => tool.id === binTab)?.label}</h2>
                <IconButton
                  label="Collapse asset panel"
                  onClick={() =>
                    setLayout((old) => ({ ...old, assetCollapsed: true }))
                  }
                >
                  <PanelLeftClose size={16} />
                </IconButton>
              </header>
              <div className="editor-bin-scroll">
                <div hidden={binTab !== "audio"}>
                  <ScriptVoicePanel
                    clipId={selected}
                    project={project}
                    media={media}
                    playhead={time}
                    playing={playing}
                    onChange={commit}
                    onMedia={(asset) =>
                      setMedia((assets) => [
                        ...assets.filter((item) => item.id !== asset.id),
                        asset,
                      ])
                    }
                    onPlayback={setPlaying}
                    onSeek={seek}
                    notify={setMessage}
                  />
                </div>
                <div hidden={binTab !== "captions"}>
                  <CaptionPanel
                    clipId={selected}
                    project={project}
                    media={media}
                    selectedIds={selection ? [selection] : []}
                    playhead={time}
                    onChange={commit}
                    onSelect={setSelection}
                    onSeek={seek}
                    notify={setMessage}
                  />
                </div>
                {binTab === "media" && (
                  <>
                    <button
                      className="button primary full editor-import-button"
                      disabled={uploading}
                      onClick={() => importInput.current?.click()}
                    >
                      {uploading ? (
                        <LoaderCircle size={16} className="spin" />
                      ) : (
                        <Plus size={17} />
                      )}
                      {uploading ? "Importing…" : "Import media"}
                    </button>
                    {!visibleMedia.length && (
                      <div className="editor-source-empty">
                        <div className="editor-media-drop-symbol">
                          <FolderOpen size={25} strokeWidth={1.4} />
                        </div>
                        <h3>
                          {sourceLoading
                            ? "Getting your footage ready"
                            : "Your media belongs here"}
                        </h3>
                        <p>
                          {sourceLoading
                            ? "You can keep editing while the source downloads."
                            : "Drop video, photos or audio into the editor, or choose files from your device."}
                        </p>
                        <span className="editor-media-formats">
                          MP4 · MOV · JPG · PNG · MP3
                        </span>
                        {!sourceLoading &&
                          (clip?.video_id || clip?.url) &&
                          !hasSource && (
                            <button
                              className="button secondary full"
                              onClick={() =>
                                void downloadJob.start(
                                  `/clips/${selected}/download`,
                                )
                              }
                            >
                              <Download size={15} />
                              Retry source download
                            </button>
                          )}
                      </div>
                    )}
                    <JobProgress job={downloadJob.job} />
                    <MediaAssetGrid media={visibleMedia} onAdd={addMedia} />
                    <MediaRecoveryPanel clipId={selected} project={project} media={media} onChange={commit} onMedia={asset=>setMedia(current=>[...current.filter(a=>a.id!==asset.id),asset])} notify={setMessage}/>

                  </>
                )}
                {binTab === "audio" && (
                  <>
                    <div className="editor-import-audio">
                      <button
                        className="button secondary full"
                        disabled={uploading}
                        onClick={() => voiceInput.current?.click()}
                      >
                        <Mic2 size={16} />
                        Import voiceover
                      </button>
                      <button
                        className="button secondary full"
                        disabled={uploading}
                        onClick={() => musicInput.current?.click()}
                      >
                        <Music2 size={16} />
                        Import music
                      </button>
                    </div>
                    <section className="editor-audio-actions">
                      <h3>Clip audio</h3>
                      <p>
                        {audioAvailable
                          ? selectedItem?.name
                          : "Select a clip with audio to detach or mute its soundtrack."}
                      </p>
                      <button
                        className="button secondary full"
                        disabled={!audioAvailable || busy}
                        onClick={() => void runAudio("extract")}
                      >
                        <AudioLines size={15} />
                        Detach audio
                      </button>
                      <button
                        className="button secondary full"
                        disabled={!audioAvailable || busy}
                        onClick={() =>
                          selectedItem &&
                          updateItem({
                            ...selectedItem,
                            muted: !selectedItem.muted,
                          })
                        }
                      >
                        <VolumeX size={15} />
                        {selectedItem?.muted
                          ? "Restore original audio"
                          : "Mute original audio"}
                      </button>
                      <details className="editor-audio-separation">
                        <summary>Voice isolation</summary>
                        <p>
                          {capability?.available
                            ? "Separate voice and music locally. Results depend on the original mix."
                            : capability?.message ||
                              "Checking local voice separation…"}
                        </p>
                        <button
                          className="button secondary full"
                          disabled={
                            !audioAvailable || busy || !capability?.available
                          }
                          onClick={() => void runAudio("voice")}
                        >
                          <Mic2 size={15} />
                          Isolate voice
                        </button>
                        <button
                          className="button secondary full"
                          disabled={
                            !audioAvailable || busy || !capability?.available
                          }
                          onClick={() => void runAudio("remove")}
                        >
                          <Music2 size={15} />
                          Reduce voice, keep music
                        </button>
                      </details>
                      <JobProgress job={audioJob.job} />
                    </section>
                    <MediaAssetGrid media={visibleMedia} onAdd={addMedia} />
                    <BundledAudioPanel clipId={selected} project={project} playhead={time} onChange={commit} onMedia={asset=>setMedia(current=>[...current.filter(a=>a.id!==asset.id),asset])} notify={setMessage}/>

                  </>
                )}
                {binTab === "text" && (
                  <div className="editor-text-tools">
                    <button className="button primary full" onClick={addText}>
                      <Type size={16} />
                      Add text
                    </button>
                    <TextTemplates
                      onApply={applyTemplate}
                      hasCaptions={project.items.some(
                        (item) => item.kind === "text",
                      )}
                      selectedText={selectedItem?.kind === "text"}
                    />
                  </div>
                )}
                {binTab === "captions" && (
                  <div className="editor-text-tools">
                    <button
                      className="button primary full"
                      onClick={() => srtInput.current?.click()}
                    >
                      <Subtitles size={16} />
                      Import SRT captions
                    </button>
                    <p>Every caption becomes editable text on your timeline.</p>
                    <button className="button secondary full" onClick={addText}>
                      <Plus size={16} />
                      Add a caption
                    </button>
                    <TextTemplates
                      onApply={applyTemplate}
                      hasCaptions={project.items.some(
                        (item) => item.kind === "text",
                      )}
                      selectedText={selectedItem?.kind === "text"}
                    />
                  </div>
                )}
                {binTab === "stickers" && (
                  <StickerPresets
                    onAdd={(preset) => void addSticker(preset)}
                    busy={uploading}
                  />
                )}
                {binTab === "effects" && (
                  <AnimationTemplates
                    item={selectedItem}
                    onApply={(side, value) =>
                      selectedItem &&
                      updateItem(compileAnimation(selectedItem,value,side === "animation_in" ? "in" : side === "animation_out" ? "out" : "loop"))
                    }
                  />
                )}
                {binTab === "transitions" && (
                  <TransitionPresets
                    item={selectedItem}
                    onApply={applyTransition}
                  />
                )}
                {binTab === "filters" && (
                  <FilterPresets
                    item={selectedItem}
                    asset={selectedAsset}
                    onChange={updateItem}
                  />
                )}
                {binTab === "templates" && (
                  <CustomTemplates
                    project={project}
                    media={media}
                    onApply={(next) => {
                      commit(next);
                      setSelection("");
                      setTime(0);
                    }}
                  />
                )}
                {binTab === "templates" && (
                  <ProjectTemplates
                    media={media}
                    onApply={applyProjectTemplate}
                  />
                )}
              </div>
            </aside>
            {!layout.assetCollapsed && (
              <PaneSplitter
                axis="x"
                label="Resize asset panel"
                value={layout.assetWidth}
                min={220}
                max={420}
                onChange={(assetWidth) =>
                  setLayout((old) => ({ ...old, assetWidth }))
                }
              />
            )}
          </>
          <div
            className={`editor-stage-pane ${!project.items.length ? "is-empty" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(event) => {
              event.preventDefault();
              const id = event.dataTransfer.getData(
                "application/x-shortforge-media",
              );
              const asset = media.find((candidate) => candidate.id === id);
              if (asset) addMedia(asset);
              else
                for (const file of Array.from(event.dataTransfer.files))
                  void upload(
                    file,
                    file.type.startsWith("audio/") ? "music" : "video",
                  );
            }}
          >
            <EditorPreview
              project={project}
              media={media}
              time={time}
              playing={playing}
              selected={selection}
              onTime={seek}
              onPlaying={setPlaying}
              onSelect={setSelection}
              onChange={updateItem}
            />
            {!project.items.length && (
              <div className="editor-stage-empty">
                <div className="editor-empty-frame">
                  <Film size={28} strokeWidth={1.3} />
                </div>
                <h2>
                  {sourceLoading
                    ? "Your footage is on its way"
                    : "A blank canvas. Your story."}
                </h2>
                <p>
                  {sourceLoading
                    ? "The source is downloading. It will appear here when ready."
                    : "Drop your media here to start editing."}
                </p>
                {sourceLoading ? (
                  <LoaderCircle size={21} className="spin" />
                ) : (
                  <button
                    className="button secondary"
                    onClick={() => importInput.current?.click()}
                  >
                    <Upload size={16} />
                    Import media
                  </button>
                )}
              </div>
            )}
          </div>
          {!layout.inspectorCollapsed && (
            <>
              <PaneSplitter
                axis="x"
                label="Resize inspector"
                value={layout.inspectorWidth}
                min={250}
                max={420}
                reverse
                onChange={(inspectorWidth) =>
                  setLayout((old) => ({ ...old, inspectorWidth }))
                }
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
            </>
          )}
        </div>
        <PaneSplitter
          axis="y"
          label="Resize timeline"
          value={layout.timelineHeight}
          min={170}
          max={Math.max(200, Math.min(480, window.innerHeight * 0.55))}
          reverse
          onChange={(timelineHeight) =>
            setLayout((old) => ({ ...old, timelineHeight }))
          }
        />
        <div className="editor-timeline-pane">
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
            canUndo={canUndo}
            canRedo={canRedo}
            onProjectChange={commit}
            playing={playing}
            onDropMedia={(assetId, start, track) => {
              const asset = media.find((candidate) => candidate.id === assetId);
              if (asset) addMedia(asset, start, track);
            }}
          />
        </div>
      </div>
    </>
  );
}
