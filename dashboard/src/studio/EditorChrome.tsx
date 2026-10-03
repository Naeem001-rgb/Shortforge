import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronDown,
  Download,
  Copy,
  RotateCcw,
  Trash2,
  Film,
  FileJson,
  FolderOpen,
  Keyboard,
  LoaderCircle,
  PanelLeftClose,
  PanelRightClose,
  Plus,
  Redo2,
  Save,
  Scissors,
  Undo2,
  X,
} from "lucide-react";
import type { Clip } from "../api";
import { IconButton } from "../ui";
import { clamp } from "./editorModel";

export function EditorTopbar({
  clips,
  selected,
  name,
  saveState,
  saveError,
  onRetrySave,
  canUndo,
  canRedo,
  onName,
  onSelect,
  onBack,
  onNew,
  onUndo,
  onRedo,
  onSave,
  onExport,
  onDownload,
  onImport,
  onDuplicate,
  onDelete,
  onShortcuts,
  assetCollapsed,
  inspectorCollapsed,
  onAssetToggle,
  onInspectorToggle,
}: {
  clips: Clip[];
  selected: string;
  name: string;
  saveState: string;
  saveError?: string;
  onRetrySave?: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onName: (name: string) => void;
  onSelect: (id: string) => void;
  onBack?: () => void;
  onNew: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onExport: () => void;
  onDownload: () => void;
  onImport: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onShortcuts: () => void;
  assetCollapsed: boolean;
  inspectorCollapsed: boolean;
  onAssetToggle: () => void;
  onInspectorToggle: () => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node))
        menu.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.current) menu.current.open = false;
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", escape);
    };
  }, []);
  const action = (callback: () => void) => {
    if (menu.current) menu.current.open = false;
    callback();
  };
  return (
    <header className="editor-topbar">
      <div className="editor-brand-group">
        {onBack && (
          <IconButton label="Back to library" onClick={onBack}>
            <ArrowLeft size={17} />
          </IconButton>
        )}
        <span className="editor-brand-mark" aria-hidden="true">
          <Scissors size={19} />
        </span>
        <span className="editor-brand-name">
          ShortForge<span>Studio</span>
        </span>
      </div>
      <span className="editor-topbar-rule" />
      <div className="editor-project-identity">
        <input
          aria-label="Project name"
          value={name}
          maxLength={140}
          onChange={(event) => onName(event.target.value)}
          onBlur={(event) => {
            if (!event.target.value.trim()) onName("Untitled project");
          }}
        />
        {saveState === "Save failed" ? (
          <button
            type="button"
            className="editor-save-state error"
            aria-live="polite"
            onClick={onRetrySave}
            title={
              saveError
                ? `${saveError} — click to try saving again`
                : "Click to try saving again"
            }
          >
            <AlertCircle size={11} />
            Save failed
            <RotateCcw size={11} className="editor-save-retry" />
          </button>
        ) : (
          <span className="editor-save-state" role="status">
            {saveState === "Saving…" ? (
              <LoaderCircle size={11} className="spin" />
            ) : (
              <Check size={11} />
            )}{" "}
            {saveState}
          </span>
        )}
      </div>
      <details className="editor-project-menu" ref={menu}>
        <summary aria-label="Project menu">
          <ChevronDown size={15} />
        </summary>
        <div>
          <button onClick={() => action(onNew)}>
            <Plus size={16} />
            New project
          </button>
          <label>
            <FolderOpen size={16} />
            <select
              aria-label="Studio project"
              value={selected}
              onChange={(event) => {
                if (menu.current) menu.current.open = false;
                onSelect(event.target.value);
              }}
            >
              <option value="" disabled>
                Open a project
              </option>
              {clips
                .filter((clip) => clip.workflow_status !== "archived")
                .map((clip) => (
                  <option key={clip.id} value={clip.id}>
                    {clip.title}
                  </option>
                ))}
            </select>
          </label>
          <div className="editor-recent-projects" aria-label="Recent projects">{clips.filter(clip=>clip.workflow_status!=="archived").slice(0,6).map(clip=><button key={clip.id} aria-current={clip.id===selected?"true":undefined} onClick={()=>action(()=>onSelect(clip.id))}>{clip.thumbnail_url?<img src={clip.thumbnail_url} crossOrigin="anonymous" alt=""/>:<span className="recent-project-poster"><Film size={16}/></span>}<span>{clip.title||"Untitled project"}</span></button>)}</div>
          {onDuplicate&&<button onClick={()=>action(onDuplicate)}><Copy size={16}/>Duplicate project</button>}
          {onDelete&&<button onClick={()=>action(onDelete)}><Trash2 size={16}/>Delete project</button>}
          <hr />
          <button onClick={() => action(onSave)}>
            <Save size={16} />
            Save project<span>⌘ S</span>
          </button>
          <button onClick={() => action(onDownload)}>
            <FileJson size={16} />
            Download project JSON
          </button>
          <button onClick={() => action(onImport)}>
            <FolderOpen size={16} />
            Open project JSON
          </button>
          <hr />
          <button onClick={() => action(onShortcuts)}>
            <Keyboard size={16} />
            Keyboard shortcuts<span>?</span>
          </button>
        </div>
      </details>
      <div className="editor-topbar-history">
        <IconButton label="Undo" disabled={!canUndo} onClick={onUndo}>
          <Undo2 size={17} />
        </IconButton>
        <IconButton label="Redo" disabled={!canRedo} onClick={onRedo}>
          <Redo2 size={17} />
        </IconButton>
      </div>
      <div className="editor-topbar-spacer" />
      <div className="editor-layout-buttons">
        <IconButton
          label={assetCollapsed ? "Show asset panel" : "Hide asset panel"}
          pressed={!assetCollapsed}
          onClick={onAssetToggle}
        >
          <PanelLeftClose size={17} />
        </IconButton>
        <IconButton
          label={inspectorCollapsed ? "Show inspector" : "Hide inspector"}
          pressed={!inspectorCollapsed}
          onClick={onInspectorToggle}
        >
          <PanelRightClose size={17} />
        </IconButton>
      </div>
      <button
        className="button primary editor-export-trigger"
        onClick={onExport}
      >
        <Download size={16} />
        Export
      </button>
    </header>
  );
}

type Layout = {
  assetWidth: number;
  inspectorWidth: number;
  timelineHeight: number;
  assetCollapsed: boolean;
  inspectorCollapsed: boolean;
};
const layoutKey = "shortforge-studio-layout-v2";
export function useEditorLayout() {
  const [layout, setLayout] = useState<Layout>(() => {
    const initial = {
      assetWidth: 268,
      inspectorWidth: 290,
      timelineHeight: 240,
      assetCollapsed: window.innerWidth < 950,
      inspectorCollapsed: window.innerWidth < 1100,
    };
    try {
      const saved = JSON.parse(localStorage.getItem(layoutKey) || "null");
      return saved
        ? {
            ...initial,
            ...saved,
            assetCollapsed: window.innerWidth < 950 || !!saved.assetCollapsed,
            inspectorCollapsed:
              window.innerWidth < 1100 || !!saved.inspectorCollapsed,
            assetWidth: clamp(Number(saved.assetWidth) || 268, 220, 420),
            inspectorWidth: clamp(
              Number(saved.inspectorWidth) || 290,
              250,
              420,
            ),
            timelineHeight: clamp(
              Number(saved.timelineHeight) || 240,
              170,
              480,
            ),
          }
        : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    const query = matchMedia("(max-width: 950px)");
    const collapse = () => {
      if (query.matches)
        setLayout((old) => ({
          ...old,
          assetCollapsed: true,
          inspectorCollapsed: true,
        }));
    };
    query.addEventListener("change", collapse);
    return () => query.removeEventListener("change", collapse);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(layoutKey, JSON.stringify(layout));
    } catch {
      /* Layout can remain session-only when storage is unavailable. */
    }
  }, [layout]);
  return {
    layout,
    setLayout,
    style: {
      "--asset-width": `${layout.assetCollapsed ? 0 : layout.assetWidth}px`,
      "--inspector-width": `${layout.inspectorCollapsed ? 0 : layout.inspectorWidth}px`,
      "--timeline-height": `${layout.timelineHeight}px`,
    } as CSSProperties,
  };
}
export function PaneSplitter({
  axis,
  value,
  min,
  max,
  onChange,
  label,
  reverse = false,
}: {
  axis: "x" | "y";
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  label: string;
  reverse?: boolean;
}) {
  const drag = useRef<{ position: number; value: number } | null>(null);
  return (
    <div
      className={`editor-pane-splitter ${axis === "y" ? "horizontal" : "vertical"}`}
      role="separator"
      aria-label={label}
      aria-orientation={axis === "y" ? "horizontal" : "vertical"}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          position: axis === "x" ? event.clientX : event.clientY,
          value,
        };
      }}
      onPointerMove={(event) => {
        if (drag.current)
          onChange(
            clamp(
              drag.current.value +
                ((axis === "x" ? event.clientX : event.clientY) -
                  drag.current.position) *
                  (reverse ? -1 : 1),
              min,
              max,
            ),
          );
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        const increase = axis === "x" ? "ArrowRight" : "ArrowDown",
          decrease = axis === "x" ? "ArrowLeft" : "ArrowUp";
        if (event.key === increase || event.key === decrease) {
          event.preventDefault();
          onChange(
            clamp(
              value + (event.key === increase ? 20 : -20) * (reverse ? -1 : 1),
              min,
              max,
            ),
          );
        }
      }}
    >
      <span />
    </div>
  );
}
export function ShortcutsPanel({ onClose }: { onClose: () => void }) {
  return (
    <section className="editor-shortcuts-panel" aria-label="Keyboard shortcuts">
      <header>
        <h2>Keyboard shortcuts</h2>
        <IconButton label="Close shortcuts" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </header>
      <dl>
        {[
          ["Play / pause", "Space"],
          ["Previous / next frame", "← / →"],
          ["Split at playhead", "S"],
          ["Delete selected clip", "Delete"],
          ["Undo", "Ctrl / ⌘ Z"],
          ["Redo", "Ctrl / ⌘ Shift Z"],
          ["Duplicate", "Ctrl / ⌘ D"],
          ["Save project", "Ctrl / ⌘ S"],
          ["Export", "Ctrl / ⌘ E"],
          ["Add marker", "M"],
          ["Add keyframe", "K"],
          ["Copy / paste in timeline", "Ctrl / ⌘ C / V"],
          ["Ripple delete in timeline", "Shift Delete"],
          ["Show shortcuts", "?"],
        ].map(([label, key]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <kbd>{key}</kbd>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
