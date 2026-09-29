import { useCallback, useEffect, useRef, useState } from "react";
export type Clip = {
  id: string;
  video_id: string | null;
  url: string;
  channel_name: string;
  channel_handle: string;
  title: string;
  description: string;
  likes: number | null;
  views: number | null;
  credit_target: string;
  credit_snippet: string;
  license_status: "unknown" | "cc_by" | "permission" | "owned";
  permission_note: string;
  thumbnail_url: string;
  workflow_status: string;
  discovery_mode: string;
  created_at: string;
  assets?: Asset[];
  script?: Script | null;
  transcript?: { text: string; words: Word[] } | null;
};
export type Asset = {
  id: string;
  clip_id: string;
  kind: string;
  url: string;
  path: string;
};
export type Word = { word: string; start: number; end: number };
export type Script = {
  original_text: string;
  rewritten_text: string;
  words_original: number;
  words_rewritten: number;
};
export type Health = {
  status: string;
  tools: Record<string, boolean>;
  version: string;
};
export type Job = {
  id: string;
  status: string;
  progress: number;
  type: string;
  error?: string;
  result?: Record<string, unknown>;
};
export type Settings = Record<string, string | number | boolean>;
export type Voice = {
  id: string;
  name: string;
  provider: string;
  language: string;
  description: string;
  available: boolean;
  cloned: boolean;
};
export type Preset = {
  id: string;
  name: string;
  font: string;
  size: number;
  fill: string;
  stroke: string;
  highlight: string;
  position: number;
  animation: string;
  description: string;
};
export const editable = (clip: Clip) => clip.license_status !== "unknown";
export const count = (value: number | null) =>
  value == null
    ? "—"
    : Intl.NumberFormat("en", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value);
export const wordCount = (text: string) =>
  text.trim() ? text.trim().split(/\s+/u).length : 0;
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers:
      options.body instanceof FormData
        ? options.headers
        : { "Content-Type": "application/json", ...options.headers },
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      message =
        typeof data.detail === "string"
          ? data.detail
          : JSON.stringify(data.detail || data);
    } catch {
      /* Keep the HTTP error when a server returns no JSON. */
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}
export const post = <T>(path: string, body: unknown = {}) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
export const assetUrl = (asset: Asset) =>
  asset.url.startsWith("/api/") ? asset.url : `/api/assets/${asset.id}`;
// Keep a job attached to its project when a page unmounts or reloads.
function storedJob(scope: string): Job | null {
  try {
    const value = sessionStorage.getItem(`shortforge-job:${scope}`);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}
export function useJob(onComplete?: () => void, scope = "workspace") {
  const [job, setJob] = useState<Job | null>(() => storedJob(scope));
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const callback = useRef(onComplete);
  callback.current = onComplete;
  const remember = useCallback(
    (next: Job) => {
      try {
        sessionStorage.setItem(`shortforge-job:${scope}`, JSON.stringify(next));
      } catch {
        /* Private browsing may restrict storage. */
      }
      setJob(next);
    },
    [scope],
  );
  useEffect(() => {
    if (!job || ["completed", "failed"].includes(job.status)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api<Job>(`/jobs/${job.id}`);
        if (stopped) return;
        remember(next);
        if (next.status === "completed") callback.current?.();
        else if (next.status === "failed")
          setError(next.error || "The job stopped. Please try again.");
        else timer = setTimeout(poll, 1000);
      } catch (e) {
        if (!stopped) {
          const message = (e as Error).message;
          setError(message);
          if (/not found/i.test(message))
            remember({ ...job, status: "failed", error: message });
          else timer = setTimeout(poll, 3000);
        }
      }
    };
    timer = setTimeout(poll, 400);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [job?.id, job?.status, remember]);
  const start = useCallback(
    async (path: string, body: unknown = {}) => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setSubmitting(true);
      setError("");
      try {
        const next = await post<Job>(path, body);
        remember(next);
        if (next.status === "completed") callback.current?.();
        return next;
      } catch (e) {
        setError((e as Error).message);
        return null;
      } finally {
        inFlight.current = false;
        setSubmitting(false);
      }
    },
    [remember],
  );
  return {
    job,
    error,
    setError,
    start,
    busy:
      submitting || (!!job && !["completed", "failed"].includes(job.status)),
  };
}
