import { useRef, useState } from "react";
import { Download, FolderOpen, Plus, Trash2 } from "lucide-react";
import { IconButton } from "../ui";
import { newItem, uid } from "./editorModel";
import type { EditorMedia, EditorProject, TimelineItem } from "./editorModel";

type SavedTemplate = { id: string; name: string; project: EditorProject };
const storageKey = "shortforge-custom-templates-v1";
function validProject(value: unknown): value is EditorProject {
  if (!value || typeof value !== "object") return false;
  const project = value as EditorProject;
  return (
    project.version === 1 &&
    Number.isFinite(project.width) &&
    project.width >= 16 &&
    project.width <= 8192 &&
    Number.isFinite(project.height) &&
    project.height >= 16 &&
    project.height <= 8192 &&
    Number.isFinite(project.fps) &&
    project.fps > 0 &&
    project.fps <= 120 &&
    Array.isArray(project.items) &&
    project.items.length < 2000 &&
    project.items.every(
      (item) =>
        ["video", "audio", "text"].includes(item.kind) &&
        Number.isFinite(item.start) &&
        item.start >= 0 &&
        Number.isFinite(item.duration) &&
        item.duration > 0 &&
        item.start + item.duration <= 600 &&
        Number.isInteger(item.track) &&
        item.track >= 0 &&
        typeof item.name === "string",
    )
  );
}
function fillTemplate(
  saved: EditorProject,
  project: EditorProject,
  media: EditorMedia[],
): EditorProject {
  const footage = media.filter((asset) => asset.media_type !== "audio");
  let slot = 0;
  const items = saved.items.flatMap((raw): TimelineItem[] => {
    let asset = media.find((candidate) => candidate.id === raw.asset_id);
    if (raw.kind === "video" && !asset)
      asset = footage[slot++ % footage.length];
    if (raw.kind !== "text" && !asset) return [];
    const defaults = newItem(raw.kind, asset, raw.start, raw.track);
    const item = {
      ...defaults,
      ...structuredClone(raw),
      id: uid(),
      asset_id: asset?.id || null,
      transform: { ...defaults.transform, ...raw.transform },
      keyframes: Array.isArray(raw.keyframes) ? raw.keyframes : [],
    };
    if (asset?.media_type === "video" || asset?.media_type === "audio") {
      item.source_in = Math.min(
        item.source_in,
        Math.max(0, asset.duration - 0.1),
      );
      item.duration = Math.min(
        item.duration,
        (asset.duration - item.source_in) / Math.max(0.1, item.speed),
      );
    }
    return [item];
  });
  return {
    ...structuredClone(saved),
    name: project.name,
    source_seeded: project.source_seeded,
    items,
  };
}
export function CustomTemplates({
  project,
  media,
  onApply,
}: {
  project: EditorProject;
  media: EditorMedia[];
  onApply: (project: EditorProject) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [templates, setTemplates] = useState<SavedTemplate[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
      return Array.isArray(saved)
        ? saved.filter(
            (item) =>
              typeof item.name === "string" && validProject(item.project),
          )
        : [];
    } catch {
      return [];
    }
  });
  const store = (next: SavedTemplate[]) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setTemplates(next);
      return true;
    } catch {
      setMessage(
        "Template storage is full. Download a project JSON to keep a copy of this layout.",
      );
      return false;
    }
  };
  const importTemplate = async (file?: File) => {
    if (!file) return;
    try {
      const value = JSON.parse(await file.text());
      const incoming = value.project || value;
      if (!validProject(incoming))
        throw new Error(
          "Choose a ShortForge template or project JSON with valid clip timing.",
        );
      const template = {
        id: uid(),
        name: String(
          value.name || incoming.name || file.name.replace(/\.json$/, ""),
        ).slice(0, 100),
        project: incoming,
      };
      if (store([template, ...templates].slice(0, 50)))
        setMessage(`${template.name} added to your templates.`);
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  return (
    <section className="editor-custom-templates" aria-label="Your templates">
      <div className="editor-custom-template-actions">
        <button
          className="button secondary full"
          disabled={!project.items.length}
          onClick={() => {
            const name = project.name?.trim() || "My template";
            if (
              store(
                [
                  { id: uid(), name, project: structuredClone(project) },
                  ...templates,
                ].slice(0, 50),
              )
            )
              setMessage(
                `${name} saved. Apply it to reuse the layout with your media.`,
              );
          }}
        >
          <Plus size={14} />
          Save current as template
        </button>
        <IconButton
          label="Import template JSON"
          onClick={() => input.current?.click()}
        >
          <FolderOpen size={16} />
        </IconButton>
      </div>
      <input
        hidden
        ref={input}
        type="file"
        accept=".json"
        aria-label="Import template JSON file"
        onChange={(event) => {
          void importTemplate(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {message && (
        <p className="editor-panel-note" role="status">
          {message}
        </p>
      )}
      {templates.length > 0 && (
        <>
          <h3>
            Your templates <span>{templates.length}</span>
          </h3>
          <div className="editor-saved-template-list">
            {templates.map((template) => (
              <div key={template.id}>
                <button
                  className="editor-saved-template-apply"
                  disabled={
                    template.project.items.some(
                      (item) => item.kind === "video",
                    ) && !media.some((asset) => asset.media_type !== "audio")
                  }
                  onClick={() => {
                    onApply(fillTemplate(template.project, project, media));
                    setMessage(
                      `${template.name} applied. Use Undo to restore your edit.`,
                    );
                  }}
                >
                  <strong>{template.name}</strong>
                  <span>
                    {template.project.items.length} clips ·{" "}
                    {template.project.width} × {template.project.height}
                  </span>
                </button>
                <IconButton
                  label={`Download ${template.name} template`}
                  onClick={() => {
                    const url = URL.createObjectURL(
                      new Blob(
                        [
                          JSON.stringify(
                            {
                              format: "shortforge-template",
                              version: 1,
                              name: template.name,
                              project: template.project,
                            },
                            null,
                            2,
                          ),
                        ],
                        { type: "application/json" },
                      ),
                    );
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = `${template.name.replace(/[^\p{L}\p{N} _-]/gu, "")}.template.json`;
                    link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  <Download size={14} />
                </IconButton>
                <IconButton
                  label={`Delete ${template.name} template`}
                  onClick={() =>
                    store(templates.filter((item) => item.id !== template.id))
                  }
                >
                  <Trash2 size={14} />
                </IconButton>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
