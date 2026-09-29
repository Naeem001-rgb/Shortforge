import {
  AlertCircle,
  Check,
  CheckCheck,
  Copy,
  LoaderCircle,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { Clip, Job } from "./api";
export function IconButton({
  label,
  children,
  onClick,
  className = "",
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function Badge({ clip }: { clip: Clip }) {
  const labels = {
    unknown: "Inspiration",
    cc_by: "Creative Commons",
    permission: "Permission saved",
    owned: "Your footage",
  };
  return (
    <span
      className={`badge ${clip.license_status === "unknown" ? "neutral" : "good"}`}
    >
      {clip.license_status !== "unknown" && <Check size={12} />}{" "}
      {labels[clip.license_status]}
    </span>
  );
}
export function Notice({
  children,
  kind = "error",
}: {
  children: ReactNode;
  kind?: "error" | "info" | "success";
}) {
  return (
    <div
      className={`notice ${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      <AlertCircle size={17} />
      <span>{children}</span>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`modal ${wide ? "wide" : ""}`}
      aria-label={title}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <IconButton label="Close dialog" onClick={onClose}>
          <X size={20} />
        </IconButton>
      </div>
      {children}
    </dialog>
  );
}
export function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <button
        className="button secondary small"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            setError("Copy was blocked. Select and copy the text manually.");
          }
        }}
      >
        {copied ? <CheckCheck size={16} /> : <Copy size={16} />}{" "}
        {copied ? "Copied" : label}
      </button>
      {error && <span className="muted">{error}</span>}
    </>
  );
}
export function JobProgress({ job }: { job: Job | null }) {
  if (!job) return null;
  return (
    <div className={`job-progress ${job.status}`} role="status">
      <div>
        {job.status === "completed" ? (
          <Check size={17} />
        ) : job.status === "failed" ? (
          <AlertCircle size={17} />
        ) : (
          <LoaderCircle size={17} className="spin" />
        )}
        <strong>
          {job.status === "completed"
            ? "Ready"
            : job.status === "failed"
              ? "Job stopped"
              : `${job.type.replaceAll("_", " ")} in progress`}
        </strong>
        <span>{Math.round(job.progress)}%</span>
      </div>
      <progress max="100" value={job.progress} />
      {job.result &&
        ["timing_note", "audio_note", "caption_note", "trim_note"].map((key) =>
          job.result?.[key] ? (
            <p className="help-text" key={key}>
              {String(job.result[key])}
            </p>
          ) : null,
        )}
    </div>
  );
}
export function ClipSelect({
  clips,
  value,
  onChange,
  label = "Project",
}: {
  clips: Clip[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  return (
    <label className="field">
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Choose a Short…</option>
        {clips.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </select>
    </label>
  );
}
