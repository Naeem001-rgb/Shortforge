import {
  ArrowLeft,
  CheckCircle2,
  Clapperboard,
  LoaderCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Clip } from "../api";
import { useJob } from "../api";
import { JobProgress, Notice } from "../ui";
import "./studio.css";

export function StudioPage({
  clip,
  clipId,
  onComplete,
  onBack,
}: {
  clip?: Clip;
  clipId: string;
  onComplete: () => void;
  onBack: () => void;
}) {
  const {
    job,
    error: requestError,
    busy,
    start,
  } = useJob(onComplete, `concat-desktop:${clipId || "new"}`);
  const requested = useRef(false);
  const [requestedJob, setRequestedJob] = useState<string | null>(null);
  const opening = useCallback(async () => {
    setRequestedJob(null);
    const next = await start("/studio/open", { clip_id: clipId || null });
    setRequestedJob(next?.id ?? null);
  }, [clipId, start]);
  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    void opening();
  }, [opening]);
  const current = job?.id === requestedJob ? job : null;
  const opened =
    current?.status === "completed" &&
    current.result?.opened === true &&
    current.result.clip_id === (clipId || null);
  let error = requestError;
  if (current?.status === "failed")
    error ||= current.error || "Studio could not open. Please try again.";
  if (current?.status === "completed" && !opened)
    error = "Studio could not confirm that Concat opened. Please try again.";
  return (
    <section className="studio-page" aria-label="Studio">
      <div className="page-heading">
        <div>
          <h1>Studio</h1>
          <p>Your editor opens in the Concat desktop app.</p>
        </div>
      </div>
      <div className="studio-session">
        <div className="studio-session-title">
          <Clapperboard size={24} aria-hidden="true" />
          <h2>{clip?.title || "Concat Studio"}</h2>
        </div>
        <p className="studio-session-copy">
          {opened
            ? "Continue editing in the Concat desktop window. Save there to keep your changes."
            : clipId
              ? "Preparing your saved video and reopening its edit."
              : "Starting Concat so you can create a project or import a video."}
        </p>
        {error && <Notice>{error}</Notice>}
        {!error && (
          <div
            className={`studio-launch-status ${opened ? "studio-opened" : ""}`}
            role="status"
          >
            {opened ? (
              <CheckCircle2 size={18} aria-hidden="true" />
            ) : (
              <LoaderCircle size={18} className="spin" aria-hidden="true" />
            )}
            {opened ? "Opened in Concat" : "Opening Concat…"}
          </div>
        )}
        {busy && job && ["queued", "running"].includes(job.status) && (
          <JobProgress job={{ ...job, type: "Opening Concat" }} />
        )}
        <div className="studio-session-actions">
          <button className="button primary" onClick={opening} disabled={busy}>
            {busy
              ? "Opening Concat…"
              : error
                ? "Try again"
                : "Open Concat again"}
          </button>
          <button className="button secondary" onClick={onBack}>
            <ArrowLeft size={16} />
            Back to Library
          </button>
        </div>
      </div>
    </section>
  );
}
