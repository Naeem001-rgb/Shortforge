import {
  ArrowUpRight,
  CalendarClock,
  Check,
  LoaderCircle,
  RefreshCw,
  Upload,
  Youtube,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { api, post } from "../api";
import { Notice } from "../ui";
import "./publishing.css";

type Channel = { id: string; title: string; thumbnail_url: string };
type Connection = { configured: boolean; channels: Channel[] };
export type Publication = {
  id: string;
  clip_id: string;
  channel_id: string;
  channel_title: string;
  title: string;
  status: string;
  progress: number;
  privacy_status: "private" | "unlisted" | "public";
  publish_at: string | null;
  error: string | null;
  retryable: boolean;
  can_cancel: boolean;
  video_url: string | null;
  created_at: string;
};
type PublishingState = {
  project: {
    ready: boolean;
    revision: string | null;
    saved_at: string | null;
    error: string | null;
  };
  defaults: { title: string; description: string; tags: string[] };
  publications: Publication[];
};
type Draft = {
  title: string;
  description: string;
  tags: string;
  channel_id: string;
  mode: "now" | "schedule";
  privacy_status: "private" | "unlisted" | "public";
  local_time: string;
  audience: "" | "yes" | "no";
  synthetic: boolean;
};
const activeStates = new Set([
  "queued",
  "rendering",
  "uploading",
  "processing",
  "scheduled",
]);
const localDateTime = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});
const formatTime = (value: string) => dateTimeFormat.format(new Date(value));
const storageKey = (clipId: string) => `shortforge-publishing-draft:${clipId}`;
function savedDraft(clipId: string): Draft | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(storageKey(clipId)) || "null",
    );
    if (!value || typeof value !== "object") return null;
    if (
      ["title", "description", "tags", "channel_id", "local_time"].some(
        (key) => typeof value[key] !== "string",
      )
    )
      return null;
    if (
      !["now", "schedule"].includes(value.mode) ||
      !["private", "unlisted", "public"].includes(value.privacy_status) ||
      !["", "yes", "no"].includes(value.audience) ||
      typeof value.synthetic !== "boolean"
    )
      return null;
    return value as Draft;
  } catch {
    return null;
  }
}
function freshDraft(): Draft {
  return {
    title: "",
    description: "",
    tags: "",
    channel_id: "",
    mode: "now",
    privacy_status: "private",
    local_time: localDateTime(new Date(Date.now() + 86400000)),
    audience: "",
    synthetic: false,
  };
}
function statusLabel(job: Publication) {
  switch (job.status) {
    case "queued":
      return "Waiting to create the video";
    case "rendering":
      return "Creating your video";
    case "uploading":
      return "Uploading to YouTube";
    case "processing":
      return "YouTube is processing the video";
    case "scheduled":
      return "Scheduled on YouTube";
    case "completed":
      return job.privacy_status === "public"
        ? "Public on YouTube"
        : `Uploaded · ${job.privacy_status === "private" ? "Private" : "Unlisted"}`;
    case "cancelled":
      return "Cancelled";
    case "needs_attention":
      return "Check this video in YouTube Studio";
    default:
      return "Publishing stopped";
  }
}

export function Publishing({
  clipId,
  onSettings,
}: {
  clipId: string;
  onSettings: () => void;
}) {
  const [initialDraft] = useState(() => savedDraft(clipId));
  const [draft, setDraft] = useState<Draft>(() => initialDraft || freshDraft());
  const seeded = useRef(Boolean(initialDraft));
  const [state, setState] = useState<PublishingState | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionId, setActionId] = useState("");
  const mounted = useRef(false);
  const loading = useRef(false);
  const sending = useRef(false);
  const mutations = useRef(0);
  const requestIdentity = useRef({ body: "", id: "" });
  const refreshController = useRef<AbortController | null>(null);
  const history = useRef<HTMLDivElement>(null);
  const timeZone = dateTimeFormat.resolvedOptions().timeZone;

  const refresh = useCallback(
    async function refreshPublishing() {
      if (loading.current) return;
      loading.current = true;
      setRefreshing(true);
      const controller = new AbortController();
      const generation = mutations.current;
      refreshController.current = controller;
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(25000),
      ]);
      try {
        const [next, channels] = await Promise.all([
          api<PublishingState>(
            `/studio/publishing?clip_id=${encodeURIComponent(clipId)}`,
            { signal },
          ),
          api<Connection>("/youtube/channels", { signal }),
        ]);
        // YouTube status checks are throttled by the engine. Ordinary history
        // reads never contact Google, and hidden tabs do not keep polling.
        const pending = next.publications.filter((job) =>
          activeStates.has(job.status),
        );
        const checked = await Promise.allSettled(
          pending.map((job) =>
            api<Publication>(`/studio/publications/${job.id}`, { signal }),
          ),
        );
        if (!mounted.current || controller.signal.aborted) return;
        const updates = new Map(
          checked.flatMap((result) =>
            result.status === "fulfilled"
              ? [[result.value.id, result.value] as const]
              : [],
          ),
        );
        next.publications = next.publications.map(
          (job) => updates.get(job.id) || job,
        );
        setState((current) =>
          generation === mutations.current || !current
            ? next
            : {
                ...next,
                publications: current.publications,
              },
        );
        setConnection(channels);
        setLoadError(
          checked.some((result) => result.status === "rejected")
            ? "Some publishing updates are unavailable. Your jobs are still saved; refresh to check again."
            : "",
        );
        if (!seeded.current) {
          seeded.current = true;
          setDraft((current) => ({
            ...current,
            ...next.defaults,
            tags: next.defaults.tags.join(", "),
            channel_id:
              channels.channels.length === 1 ? channels.channels[0].id : "",
          }));
        }
      } catch (cause) {
        if (mounted.current && !controller.signal.aborted)
          setLoadError((cause as Error).message);
      } finally {
        loading.current = false;
        if (mounted.current) setRefreshing(false);
        // React may remount an effect while its cancelled request is settling.
        // Resume immediately instead of leaving the form empty until the poll.
        if (mounted.current && controller.signal.aborted)
          void refreshPublishing();
      }
    },
    [clipId],
  );

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const resume = () => {
      if (!document.hidden) void refresh();
    };
    const timer = window.setInterval(resume, 5000);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    return () => {
      mounted.current = false;
      refreshController.current?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
    };
  }, [refresh]);

  useEffect(() => {
    if (!seeded.current) return;
    try {
      localStorage.setItem(storageKey(clipId), JSON.stringify(draft));
    } catch {
      /* The form also works when browser storage is unavailable. */
    }
  }, [draft, clipId]);

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const mergeJob = (job: Publication) => {
    mutations.current += 1;
    setState(
      (current) =>
        current && {
          ...current,
          publications: [
            job,
            ...current.publications.filter((item) => item.id !== job.id),
          ],
        },
    );
  };
  const channel = connection?.channels.find(
    (item) => item.id === draft.channel_id,
  );
  const scheduled = draft.mode === "schedule";
  const busyJob = state?.publications.some((job) =>
    ["queued", "rendering", "uploading"].includes(job.status),
  );
  const submitLabel = scheduled
    ? "Schedule video"
    : draft.privacy_status === "private"
      ? "Upload privately"
      : draft.privacy_status === "unlisted"
        ? "Upload unlisted"
        : "Publish now";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending.current || !state?.project.ready || !channel) return;
    setError("");
    setMessage("");
    const selectedTime = new Date(draft.local_time);
    if (
      scheduled &&
      (!Number.isFinite(selectedTime.getTime()) ||
        selectedTime.getTime() <= Date.now() ||
        localDateTime(selectedTime) !== draft.local_time)
    ) {
      setError(
        "Choose a valid future date and time in your laptop’s time zone.",
      );
      return;
    }
    if (!draft.audience) {
      setError("Choose whether this video is made for kids.");
      return;
    }
    const payload = {
      clip_id: clipId,
      project_revision: state.project.revision,
      channel_id: channel.id,
      title: draft.title.trim(),
      description: draft.description,
      tags: draft.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      privacy_status: scheduled ? "private" : draft.privacy_status,
      publish_at: scheduled ? selectedTime.toISOString() : null,
      self_declared_made_for_kids: draft.audience === "yes",
      contains_synthetic_media: draft.synthetic,
    };
    const body = JSON.stringify(payload);
    if (requestIdentity.current.body !== body)
      requestIdentity.current = { body, id: crypto.randomUUID() };
    sending.current = true;
    setSubmitting(true);
    try {
      const job = await post<Publication>("/studio/publish", {
        ...payload,
        request_id: requestIdentity.current.id,
      });
      if (!mounted.current) return;
      mergeJob(job);
      setMessage("Your publishing job is saved. Follow its progress below.");
      history.current?.focus();
    } catch (cause) {
      if (mounted.current) setError((cause as Error).message);
    } finally {
      sending.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  async function jobAction(job: Publication, action: "retry" | "cancel") {
    setActionId(job.id);
    setError("");
    try {
      const next = await post<Publication>(
        `/studio/publications/${job.id}/${action}`,
      );
      if (mounted.current) mergeJob(next);
    } catch (cause) {
      if (mounted.current) setError((cause as Error).message);
    } finally {
      if (mounted.current) setActionId("");
    }
  }

  return (
    <section className="studio-publishing" aria-labelledby="publishing-title">
      <div className="publishing-heading">
        <h2 id="publishing-title">
          <Youtube size={21} aria-hidden="true" /> Publish to YouTube
        </h2>
        <button
          type="button"
          className="button ghost small"
          onClick={() => void refresh()}
          disabled={refreshing}
        >
          <RefreshCw size={15} aria-hidden="true" />{" "}
          {refreshing ? "Refreshing…" : "Refresh saved edit"}
        </button>
      </div>
      <p className="publishing-intro">
        Save your changes in Concat, then publish here. ShortForge creates the
        finished video on your laptop and uploads it for you.
      </p>
      {loadError && <Notice>{loadError}</Notice>}
      {!state && !loadError && (
        <p role="status" className="help-text">
          Loading your saved edit and YouTube channels…
        </p>
      )}
      {state && connection && (
        <>
          {!state.project.ready && (
            <Notice kind="info">
              {state.project.error ||
                "Open this video in Concat and save your edit first."}
            </Notice>
          )}
          {!connection.channels.length && (
            <div className="publishing-setup">
              <p>
                {connection.configured
                  ? "Connect your YouTube channel to publish or schedule videos."
                  : "Set up your YouTube connection once, then publish from here."}
              </p>
              <button
                type="button"
                className="button secondary"
                onClick={onSettings}
              >
                Connect YouTube in Settings{" "}
                <ArrowUpRight size={16} aria-hidden="true" />
              </button>
            </div>
          )}
          <form onSubmit={submit} aria-label="YouTube publishing details">
            <fieldset className="publishing-timing" disabled={submitting}>
              <legend>When to publish</legend>
              <div className="publishing-modes">
                <button
                  type="button"
                  className={`button secondary ${!scheduled ? "selected" : ""}`}
                  aria-pressed={!scheduled}
                  onClick={() => update("mode", "now")}
                >
                  <Upload size={16} aria-hidden="true" /> Publish now
                </button>
                <button
                  type="button"
                  className={`button secondary ${scheduled ? "selected" : ""}`}
                  aria-pressed={scheduled}
                  onClick={() => update("mode", "schedule")}
                >
                  <CalendarClock size={17} aria-hidden="true" /> Schedule
                </button>
              </div>
            </fieldset>
            <div className="publishing-layout">
              <div className="publishing-fields">
                <label className="field">
                  Title
                  <input
                    value={draft.title}
                    onChange={(event) => update("title", event.target.value)}
                    maxLength={100}
                    required
                    disabled={submitting}
                  />
                </label>
                <label className="field">
                  Description
                  <textarea
                    value={draft.description}
                    onChange={(event) =>
                      update("description", event.target.value)
                    }
                    maxLength={5000}
                    rows={5}
                    disabled={submitting}
                  />
                </label>
                <label className="field">
                  Tags
                  <input
                    value={draft.tags}
                    onChange={(event) => update("tags", event.target.value)}
                    aria-describedby="publishing-tags-help"
                    disabled={submitting}
                  />
                </label>
                <p id="publishing-tags-help" className="help-text">
                  Separate tags with commas. The starting details come from your
                  Library; check that they fit your finished edit.
                </p>
              </div>
              <div className="publishing-fields">
                <label className="field">
                  YouTube channel
                  <select
                    value={draft.channel_id}
                    onChange={(event) =>
                      update("channel_id", event.target.value)
                    }
                    required
                    disabled={submitting || !connection.channels.length}
                  >
                    <option value="">Choose a channel</option>
                    {draft.channel_id && !channel && (
                      <option value={draft.channel_id}>
                        Previously selected channel · disconnected
                      </option>
                    )}
                    {connection.channels.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </label>
                {scheduled ? (
                  <div className="publishing-schedule">
                    <label className="field">
                      Date and time
                      <input
                        type="datetime-local"
                        value={draft.local_time}
                        onChange={(event) =>
                          update("local_time", event.target.value)
                        }
                        min={localDateTime(new Date(Date.now() + 60000))}
                        required
                        disabled={submitting}
                        aria-describedby="publishing-time-zone publishing-schedule-help"
                      />
                    </label>
                    <p id="publishing-time-zone" className="help-text">
                      Time zone: <strong>{timeZone}</strong> (your laptop’s
                      time).
                    </p>
                    <p id="publishing-schedule-help" className="help-text">
                      Uploads privately now. YouTube makes it public at this
                      time. Allow enough time for creating, uploading and
                      processing the video.
                    </p>
                  </div>
                ) : (
                  <label className="field">
                    Visibility
                    <select
                      value={draft.privacy_status}
                      onChange={(event) =>
                        update(
                          "privacy_status",
                          event.target.value as Draft["privacy_status"],
                        )
                      }
                      disabled={submitting}
                    >
                      <option value="private">Private · only you</option>
                      <option value="unlisted">
                        Unlisted · anyone with the link
                      </option>
                      <option value="public">Public · everyone</option>
                    </select>
                  </label>
                )}
                <label className="field">
                  Is this video made for kids?
                  <select
                    value={draft.audience}
                    onChange={(event) =>
                      update(
                        "audience",
                        event.target.value as Draft["audience"],
                      )
                    }
                    required
                    disabled={submitting}
                  >
                    <option value="">Choose an audience</option>
                    <option value="no">No, it is not made for kids</option>
                    <option value="yes">Yes, it is made for kids</option>
                  </select>
                </label>
                <label className="publishing-checkbox">
                  <input
                    type="checkbox"
                    checked={draft.synthetic}
                    onChange={(event) =>
                      update("synthetic", event.target.checked)
                    }
                    disabled={submitting}
                  />
                  <span>
                    Contains realistic altered or AI-generated content
                  </span>
                </label>
              </div>
            </div>
            {error && <Notice>{error}</Notice>}
            {message && <Notice kind="success">{message}</Notice>}
            <div className="publishing-submit">
              <div>
                {state.project.saved_at && (
                  <p className="help-text">
                    Using the edit saved {formatTime(state.project.saved_at)}.
                  </p>
                )}
                <p className="help-text">
                  Keep ShortForge running and your laptop awake until the upload
                  finishes. After YouTube confirms the schedule, your laptop can
                  be off.
                </p>
              </div>
              <button
                className="button primary"
                type="submit"
                disabled={
                  submitting || !state.project.ready || !channel || busyJob
                }
              >
                {submitting ? (
                  <LoaderCircle size={17} className="spin" aria-hidden="true" />
                ) : scheduled ? (
                  <CalendarClock size={17} aria-hidden="true" />
                ) : (
                  <Upload size={17} aria-hidden="true" />
                )}
                {submitting ? "Adding to queue…" : submitLabel}
              </button>
            </div>
            {busyJob && (
              <p role="status" className="help-text">
                This video already has a job in progress. You can follow it
                below.
              </p>
            )}
          </form>
        </>
      )}
      <div
        className="publishing-history"
        ref={history}
        tabIndex={-1}
        aria-label="Publishing activity"
      >
        {!!state?.publications.length && (
          <>
            <h3>Publishing activity</h3>
            <ol>
              {state.publications.map((job) => (
                <li key={job.id}>
                  <div className="publishing-job-heading">
                    <strong>{job.title}</strong>
                    <span>{job.channel_title}</span>
                  </div>
                  <p
                    className={`publishing-job-state ${["completed", "scheduled"].includes(job.status) ? "success-text" : ""}`}
                    role="status"
                  >
                    {["completed", "scheduled"].includes(job.status) ? (
                      <Check size={17} aria-hidden="true" />
                    ) : ["rendering", "uploading", "processing"].includes(
                        job.status,
                      ) ? (
                      <LoaderCircle
                        size={17}
                        className="spin"
                        aria-hidden="true"
                      />
                    ) : null}
                    {statusLabel(job)}
                    {["rendering", "uploading"].includes(job.status) &&
                      ` · ${Math.round(job.progress)}%`}
                  </p>
                  {job.publish_at && (
                    <p className="help-text">
                      {job.status === "scheduled"
                        ? "Goes public"
                        : "Requested time:"}{" "}
                      {formatTime(job.publish_at)} · {timeZone}
                    </p>
                  )}
                  {["rendering", "uploading"].includes(job.status) && (
                    <progress
                      max={100}
                      value={job.progress}
                      aria-label={statusLabel(job)}
                    />
                  )}
                  {job.error && <Notice>{job.error}</Notice>}
                  <div className="publishing-job-actions">
                    {job.retryable && (
                      <button
                        type="button"
                        className="button secondary small"
                        disabled={!!actionId}
                        onClick={() => void jobAction(job, "retry")}
                      >
                        {actionId === job.id
                          ? "Please wait…"
                          : "Retry publishing"}
                      </button>
                    )}
                    {job.can_cancel && (
                      <button
                        type="button"
                        className="button ghost small"
                        disabled={!!actionId}
                        onClick={() => void jobAction(job, "cancel")}
                      >
                        {actionId === job.id ? "Please wait…" : "Cancel job"}
                      </button>
                    )}
                    {job.video_url && (
                      <a
                        className="button secondary small"
                        href={job.video_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open video <ArrowUpRight size={15} aria-hidden="true" />
                      </a>
                    )}
                    {(job.video_url || job.status === "needs_attention") && (
                      <a
                        className="inline-link"
                        href="https://studio.youtube.com/"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Manage in YouTube Studio{" "}
                        <ArrowUpRight size={15} aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}
