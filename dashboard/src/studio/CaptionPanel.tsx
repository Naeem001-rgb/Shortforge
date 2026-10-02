import {
  Check,
  Combine,
  LoaderCircle,
  Search,
  Scissors,
  Subtitles,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, useJob } from "../api";
import type { Word } from "../api";
import { clamp, formatTime, trimItem, uid } from "./editorModel";
import type { EditorMedia, EditorProject, TimelineItem } from "./editorModel";
import { captionItems, tracksOf } from "./timelineOps";
import "./audio-captions.css";

export type CaptionPanelProps = {
  clipId: string;
  project: EditorProject;
  media: EditorMedia[];
  selectedIds: string[];
  playhead?: number;
  onChange: (next: EditorProject) => void;
  onSelect: (id: string) => void;
  onSeek: (time: number) => void;
  notify: (message: string) => void;
};
type Capability = {
  available: boolean;
  runtime_ready?: boolean;
  model_ready: boolean;
  message: string;
};
type CaptionRequest = {
  itemId: string;
  assetId: string;
  wordsPerLine: number;
  replace: boolean;
  applied?: boolean;
};

/** Convert real source timestamps to the selected clip's local playback time. */
export function wordsForTimelineItem(
  words: Word[],
  item: TimelineItem,
): Word[] {
  const sourceEnd = item.source_in + item.duration * item.speed;
  return words
    .flatMap((word) => {
      const start = Math.max(item.source_in, word.start),
        end = Math.min(sourceEnd, word.end);
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end <= start ||
        !word.word.trim()
      )
        return [];
      return [
        {
          word: word.word.trim(),
          start:
            (item.reverse ? sourceEnd - end : start - item.source_in) /
            item.speed,
          end:
            (item.reverse ? sourceEnd - start : end - item.source_in) /
            item.speed,
        },
      ];
    })
    .sort((a, b) => a.start - b.start);
}

export function CaptionPanel(props: CaptionPanelProps) {
  const current = useRef(props);
  current.current = props;
  const [sourceId, setSourceId] = useState(""),
    [wordsPerLine, setWordsPerLine] = useState(3),
    [replace, setReplace] = useState(true);
  const [capability, setCapability] = useState<Capability | null>(null),
    [error, setError] = useState("");
  const [find, setFind] = useState(""),
    [replacement, setReplacement] = useState(""),
    [textDraft, setTextDraft] = useState("");
  const [splitWord, setSplitWord] = useState(1);
  const job = useJob(undefined, `studio-captions:${props.clipId}`),
    applied = useRef(new Set<string>());
  const request = useRef<CaptionRequest | null>(null);
  const captions = useMemo(
    () =>
      props.project.items
        .filter((item) => item.kind === "text")
        .sort((a, b) => a.start - b.start || a.track - b.track),
    [props.project.items],
  );
  const selected = captions.find((item) => props.selectedIds.includes(item.id));
  const selectedSource = props.project.items.find(
    (item) => props.selectedIds.includes(item.id) && item.kind !== "text",
  );
  const sources = props.project.items.filter(
    (item) =>
      item.kind !== "text" &&
      item.freeze_at == null &&
      props.media.find((media) => media.id === item.asset_id)?.has_audio,
  );
  const source =
    sources.find((item) => item.id === sourceId) ||
    sources.find((item) => item.id === selectedSource?.id) ||
    sources[0];
  const locked =
    selected &&
    props.project.tracks?.some(
      (track) => track.id === selected.track && track.locked,
    );
  const nextCaption =
    selected &&
    captions.find(
      (item) =>
        item.track === selected.track &&
        item.start >= selected.start + selected.duration - 0.001 &&
        item.id !== selected.id,
    );

  useEffect(() => {
    const controller = new AbortController();
    api<{ transcription: Capability }>("/editor-capabilities", {
      signal: controller.signal,
    })
      .then((response) => setCapability(response.transcription))
      .catch((e) => {
        if (!controller.signal.aborted) setError((e as Error).message);
      });
    try {
      request.current = JSON.parse(
        sessionStorage.getItem(`studio-caption-request:${props.clipId}`) ||
          "null",
      );
    } catch {
      /* The selected clip remains available. */
    }
    return () => controller.abort();
  }, [props.clipId]);
  useEffect(() => {
    if (selectedSource) setSourceId(selectedSource.id);
  }, [selectedSource?.id]);
  useEffect(() => {
    setTextDraft(selected?.text || "");
    setSplitWord(1);
  }, [selected?.id, selected?.text]);

  function updateCaption(item: TimelineItem) {
    const project = current.current.project;
    if (project.tracks?.find((track) => track.id === item.track)?.locked)
      return;
    current.current.onChange({
      ...project,
      items: project.items.map((original) =>
        original.id === item.id ? item : original,
      ),
    });
  }
  async function generateCaptions() {
    if (!source?.asset_id) return;
    setError("");
    const pending: CaptionRequest = {
      itemId: source.id,
      assetId: source.asset_id,
      wordsPerLine,
      replace,
    };
    request.current = pending;
    try {
      sessionStorage.setItem(
        `studio-caption-request:${props.clipId}`,
        JSON.stringify(pending),
      );
    } catch {
      /* In-memory placement still works. */
    }
    await job.start(`/editor/${props.clipId}/transcribe`, {
      asset_id: source.asset_id,
    });
  }
  useEffect(() => {
    const completed = job.job,
      pending = request.current;
    if (
      completed?.status !== "completed" ||
      !pending ||
      pending.applied ||
      applied.current.has(completed.id)
    )
      return;
    applied.current.add(completed.id);
    const words = completed.result?.words as Word[] | undefined;
    const project = current.current.project;
    const original = project.items.find(
      (item) => item.id === pending.itemId && item.asset_id === pending.assetId,
    );
    if (!original) {
      setError(
        "The transcribed clip was removed or relinked. Select its current media and transcribe again.",
      );
      return;
    }
    const mapped = wordsForTimelineItem(words || [], original);
    if (!mapped.length) {
      setError(
        "No words were recognized inside this clip's trim. Try a clearer recording or a wider trim.",
      );
      return;
    }
    const tracks = tracksOf(project);
    let track = tracks.find((t) => t.kind === "text" && !t.locked);
    if (!track) {
      track = {
        id: Math.max(-1, ...tracks.map((t) => t.id)) + 1,
        name: "Captions",
        kind: "text",
        hidden: false,
        muted: false,
        locked: false,
      };
      tracks.push(track);
    }
    const group = `captions-${original.id}`;
    const generated = captionItems(
      mapped,
      original.start,
      pending.wordsPerLine,
      track.id,
    ).map((item) => ({
      ...item,
      group_id: group,
      id: `caption-${completed.id}-${item.id}`,
    }));
    const retained = project.items.filter(
      (item) =>
        !pending.replace ||
        item.group_id !== group ||
        project.tracks?.some((t) => t.id === item.track && t.locked),
    );
    if (retained.length + generated.length > 5000) {
      setError(
        "This would exceed 5,000 timeline items. Use more words per caption or remove unused clips.",
      );
      return;
    }
    current.current.onChange({
      ...project,
      tracks,
      items: [...retained, ...generated],
    });
    current.current.onSelect(generated[0].id);
    current.current.onSeek(generated[0].start);
    current.current.notify(
      `${generated.length} captions added from real word timings.`,
    );
    request.current = { ...pending, applied: true };
    try {
      sessionStorage.setItem(
        `studio-caption-request:${props.clipId}`,
        JSON.stringify(request.current),
      );
    } catch {
      /* Stable IDs still survive project save. */
    }
  }, [job.job]);

  function applyText() {
    if (!selected || locked || textDraft === selected.text) return;
    const tokens = textDraft.trim().split(/\s+/).filter(Boolean),
      timed = selected.caption_words || [];
    const retained =
      tokens.length === timed.length
        ? timed.map((word, index) => ({ ...word, word: tokens[index] }))
        : [];
    updateCaption({
      ...selected,
      text: textDraft,
      name: textDraft.slice(0, 60),
      caption_words: retained,
      ...(timed.length && !retained.length && selected.text_style
        ? { text_style: { ...selected.text_style, reveal: "none" as const } }
        : {}),
    });
    if (timed.length && !retained.length)
      props.notify(
        "Caption updated. Word count changed, so its word highlighting was cleared; the caption's clip timing is preserved.",
      );
  }
  function replaceAll() {
    if (!find) return;
    let changed = 0;
    const items = props.project.items.map((item) => {
      if (
        item.kind !== "text" ||
        !item.text.includes(find) ||
        props.project.tracks?.some((t) => t.id === item.track && t.locked)
      )
        return item;
      changed++;
      const text = item.text.replaceAll(find, replacement),
        tokens = text.trim().split(/\s+/).filter(Boolean),
        timed = item.caption_words || [];
      const words =
        tokens.length === timed.length
          ? timed.map((word, index) => ({ ...word, word: tokens[index] }))
          : [];
      return {
        ...item,
        text,
        name: text.slice(0, 60),
        caption_words: words,
        ...(timed.length && !words.length && item.text_style
          ? { text_style: { ...item.text_style, reveal: "none" as const } }
          : {}),
      };
    });
    if (changed) props.onChange({ ...props.project, items });
    props.notify(`${changed} caption${changed === 1 ? "" : "s"} updated.`);
  }
  function mergeNext() {
    if (
      !selected ||
      !nextCaption ||
      locked ||
      nextCaption.start + nextCaption.duration > 600
    )
      return;
    const words =
      selected.caption_words?.length && nextCaption.caption_words?.length
        ? [
            ...selected.caption_words,
            ...nextCaption.caption_words.map((word) => ({
              ...word,
              start: word.start + nextCaption.start - selected.start,
              end: word.end + nextCaption.start - selected.start,
            })),
          ]
        : [];
    const merged = {
      ...selected,
      duration: nextCaption.start + nextCaption.duration - selected.start,
      text: `${selected.text.trim()} ${nextCaption.text.trim()}`,
      caption_words: words,
    };
    props.onChange({
      ...props.project,
      items: props.project.items
        .filter((item) => item.id !== nextCaption.id)
        .map((item) => (item.id === selected.id ? merged : item)),
    });
  }
  function splitCaption() {
    if (!selected || locked) return;
    const words = selected.caption_words || [],
      tokens = selected.text.trim().split(/\s+/).filter(Boolean);
    const index = Math.min(Math.max(1, splitWord), tokens.length - 1);
    const local =
      words.length === tokens.length
        ? words[index]?.start
        : (props.playhead ?? selected.start) - selected.start;
    if (
      tokens.length < 2 ||
      local == null ||
      local <= 0.01 ||
      local >= selected.duration - 0.01
    ) {
      setError(
        "Place the playhead inside this caption to split untimed text, or choose a timed word.",
      );
      return;
    }
    const left = {
      ...trimItem(selected, 0, local),
      text: tokens.slice(0, index).join(" "),
      animation_out: "none" as const,
    };
    const right = {
      ...trimItem(selected, local, selected.duration),
      id: uid(),
      text: tokens.slice(index).join(" "),
      animation_in: "none" as const,
      transition_in: "none" as const,
    };
    props.onChange({
      ...props.project,
      items: props.project.items.flatMap((item) =>
        item.id === selected.id ? [left, right] : [item],
      ),
    });
    props.onSelect(right.id);
    props.onSeek(right.start);
  }
  function changeWord(
    index: number,
    field: "word" | "start" | "end",
    value: string,
  ) {
    if (!selected || locked) return;
    const words = [...(selected.caption_words || [])],
      original = words[index];
    if (!original) return;
    if (field === "word")
      words[index] = { ...original, word: value.trim() || original.word };
    else {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return;
      const previousStart = words[index - 1]?.start || 0,
        nextStart = words[index + 1]?.start ?? selected.duration;
      words[index] = {
        ...original,
        [field]:
          field === "start"
            ? clamp(
                parsed,
                previousStart,
                Math.min(nextStart, original.end - 0.001),
              )
            : clamp(parsed, original.start + 0.001, selected.duration),
      };
    }
    updateCaption({
      ...selected,
      caption_words: words,
      text: words.map((word) => word.word).join(" "),
    });
  }

  return (
    <section className="audio-caption-panel" aria-label="Caption editing">
      <header className="ac-heading">
        <h3>
          <Subtitles size={16} /> Auto captions
        </h3>
        <span>Word timing</span>
      </header>
      <label className="ac-field">
        Transcribe clip
        <select
          aria-label="Clip to transcribe"
          value={source?.id || ""}
          disabled={job.busy}
          onChange={(e) => setSourceId(e.target.value)}
        >
          <option value="">Choose video or audio</option>
          {sources.map((item) => (
            <option value={item.id} key={item.id}>
              {item.name || item.kind} · {formatTime(item.start)}
            </option>
          ))}
        </select>
      </label>
      {!sources.length && (
        <p className="ac-help">
          Add video with sound, import audio, or record a voice take first.
        </p>
      )}
      <label className="ac-range">
        Words per caption <output>{wordsPerLine}</output>
        <input
          aria-label="Words per caption"
          type="range"
          min={1}
          max={8}
          step={1}
          value={wordsPerLine}
          onChange={(e) => setWordsPerLine(Number(e.target.value))}
        />
      </label>
      <label className="ac-check">
        <input
          type="checkbox"
          checked={replace}
          onChange={(e) => setReplace(e.target.checked)}
        />{" "}
        Replace this clip's generated captions
      </label>
      {capability && !capability.available && (
        <p className="ac-help">{capability.message}</p>
      )}
      {(error || job.error) && (
        <p className="ac-feedback ac-error" role="alert">
          {error || job.error}
        </p>
      )}
      {job.busy && (
        <progress
          aria-label="Caption transcription progress"
          max={100}
          value={job.job?.progress || 0}
        />
      )}
      <button
        className="button primary small ac-full"
        type="button"
        disabled={!source || job.busy || capability?.available === false}
        onClick={() => void generateCaptions()}
      >
        {job.busy ? (
          <LoaderCircle size={14} className="spin" />
        ) : (
          <Subtitles size={14} />
        )}
        {job.busy ? "Transcribing locally…" : "Generate captions"}
      </button>
      <p className="ac-help">
        Local speech recognition follows this clip's trim and speed. Review
        names and punctuation before export.
      </p>
      <header className="ac-heading ac-section-heading">
        <h3>Edit captions</h3>
        <span>{captions.length}</span>
      </header>
      {!!captions.length && (
        <div className="ac-find">
          <label className="ac-field">
            <span>
              <Search size={12} /> Find
            </span>
            <input
              aria-label="Find caption text"
              value={find}
              onChange={(e) => setFind(e.target.value)}
            />
          </label>
          <label className="ac-field">
            Replace with
            <input
              aria-label="Replacement caption text"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
            />
          </label>
          <button
            className="button secondary small ac-full"
            type="button"
            disabled={!find}
            onClick={replaceAll}
          >
            Replace all
          </button>
        </div>
      )}
      <div className="ac-caption-list" aria-label="Captions">
        {captions
          .filter((item) => !find || item.text.includes(find))
          .map((item) => (
            <button
              className={`ac-caption-row ${selected?.id === item.id ? "selected" : ""}`}
              type="button"
              key={item.id}
              aria-pressed={selected?.id === item.id}
              onClick={() => {
                props.onSelect(item.id);
                props.onSeek(item.start);
              }}
            >
              <span className="ac-time">{formatTime(item.start, true)}</span>
              <span>{item.text || "Empty caption"}</span>
            </button>
          ))}
        {!captions.length && (
          <p className="ac-help">
            Generated captions and text clips appear here. Select a caption to
            edit its text and timing.
          </p>
        )}
      </div>
      {selected && (
        <div className="ac-caption-editor">
          <div className="ac-field-pair">
            <label className="ac-field">
              Start (s)
              <input
                key={`${selected.id}-${selected.start}`}
                aria-label="Caption start seconds"
                type="number"
                min={0}
                max={600 - selected.duration}
                step={0.01}
                defaultValue={selected.start.toFixed(2)}
                disabled={locked}
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n))
                    updateCaption({
                      ...selected,
                      start: clamp(n, 0, 600 - selected.duration),
                    });
                }}
              />
            </label>
            <label className="ac-field">
              Duration (s)
              <input
                key={`${selected.id}-${selected.duration}`}
                aria-label="Caption duration seconds"
                type="number"
                min={0.01}
                max={600 - selected.start}
                step={0.01}
                defaultValue={selected.duration.toFixed(2)}
                disabled={locked}
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n))
                    updateCaption(
                      trimItem(
                        selected,
                        0,
                        clamp(n, 0.1, 600 - selected.start),
                      ),
                    );
                }}
              />
            </label>
          </div>
          <textarea
            aria-label="Selected caption text"
            rows={3}
            value={textDraft}
            disabled={locked}
            onChange={(e) => setTextDraft(e.target.value)}
            onBlur={applyText}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") applyText();
            }}
          />
          <div className="ac-actions">
            <button
              className="button secondary small"
              type="button"
              disabled={locked || textDraft === selected.text}
              onClick={applyText}
            >
              <Check size={13} /> Apply text
            </button>
            <button
              className="button secondary small ac-icon"
              type="button"
              aria-label="Delete selected caption"
              disabled={locked}
              onClick={() =>
                props.onChange({
                  ...props.project,
                  items: props.project.items.filter(
                    (item) => item.id !== selected.id,
                  ),
                })
              }
            >
              <Trash2 size={14} />
            </button>
          </div>
          {!!selected.caption_words?.length && (
            <details className="ac-word-timings">
              <summary>Word timings · clip seconds</summary>
              <div className="ac-word-heading">
                <span>Word</span>
                <span>Start</span>
                <span>End</span>
              </div>
              {selected.caption_words.map((word, index) => (
                <div
                  className="ac-word-row"
                  key={`${selected.id}:${index}:${word.word}:${word.start}:${word.end}`}
                >
                  <input
                    aria-label={`Word ${index + 1}`}
                    defaultValue={word.word}
                    disabled={locked}
                    onBlur={(e) => changeWord(index, "word", e.target.value)}
                  />
                  <input
                    aria-label={`${word.word} start seconds`}
                    type="number"
                    step={0.01}
                    min={0}
                    max={word.end}
                    defaultValue={word.start.toFixed(2)}
                    disabled={locked}
                    onBlur={(e) => changeWord(index, "start", e.target.value)}
                  />
                  <input
                    aria-label={`${word.word} end seconds`}
                    type="number"
                    step={0.01}
                    min={word.start}
                    max={selected.duration}
                    defaultValue={word.end.toFixed(2)}
                    disabled={locked}
                    onBlur={(e) => changeWord(index, "end", e.target.value)}
                  />
                </div>
              ))}
            </details>
          )}
          <label className="ac-field">
            Split before word
            <select
              value={Math.min(
                splitWord,
                Math.max(1, selected.text.trim().split(/\s+/).length - 1),
              )}
              onChange={(e) => setSplitWord(Number(e.target.value))}
            >
              {selected.text
                .trim()
                .split(/\s+/)
                .slice(1)
                .map((word, index) => (
                  <option key={index} value={index + 1}>
                    {index + 2}. {word}
                  </option>
                ))}
            </select>
          </label>
          <div className="ac-actions">
            <button
              className="button secondary small"
              type="button"
              disabled={locked || selected.text.trim().split(/\s+/).length < 2}
              onClick={splitCaption}
            >
              <Scissors size={13} /> Split
            </button>
            <button
              className="button secondary small"
              type="button"
              disabled={locked || !nextCaption}
              onClick={mergeNext}
            >
              <Combine size={13} /> Merge next
            </button>
          </div>
          {locked && (
            <p className="ac-help">Unlock this caption's track to edit it.</p>
          )}
        </div>
      )}
    </section>
  );
}
