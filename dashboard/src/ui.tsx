import {
  AlertCircle,
  Check,
  CheckCheck,
  Copy,
  LoaderCircle,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import type { Clip, Job } from "./api";
export function IconButton({
  label,
  children,
  onClick,
  className = "",
  disabled = false,
  pressed,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      aria-label={label}
      aria-pressed={pressed}
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
  const titleId = useId();
  useEffect(() => {
    const d = dialog.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`modal ${wide ? "wide" : ""}`}
      aria-labelledby={titleId}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
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
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <>
      <button
        className="button secondary small"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setError("");
            setCopied(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 2000);
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
        <LoaderCircle size={17} className="spin" />
        <strong>{job.type.replaceAll("_", " ")} in progress</strong>
        <span>{Math.round(job.progress)}%</span>
      </div>
      <progress max="100" value={job.progress} />
    </div>
  );
}
