import {
  Archive,
  ArrowRight,
  ArrowUpRight,
  Clapperboard,
  Clock3,
  Compass,
  CircleCheck,
  CloudOff,
  Download,
  Film,
  Grid2X2,
  Heart,
  Link2,
  List,
  LoaderCircle,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Clip } from "../api";
import { api, count, editable, post, useJob } from "../api";
import {
  Badge,
  CopyButton,
  IconButton,
  JobProgress,
  Modal,
  Notice,
} from "../ui";
import "../theme/library.css";

const sourceLabel = (clip: Clip) =>
  clip.discovery_mode === "project"
    ? "Project"
    : clip.discovery_mode === "upload"
      ? "Your footage"
      : "YouTube";

function ClipArtwork({ clip, eager = false }: { clip: Clip; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [clip.thumbnail_url]);
  return (
    <span className="media-artwork">
      <span className="thumbnail-fallback" aria-hidden="true">
        {clip.discovery_mode === "project" ? (
          <Clapperboard size={30} strokeWidth={1.25} />
        ) : (
          <Film size={30} strokeWidth={1.25} />
        )}
        <span>{sourceLabel(clip)}</span>
      </span>
      {clip.thumbnail_url && !failed && (
        <img
          src={clip.thumbnail_url}
          alt=""
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

function savedDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Saved locally"
    : date.toLocaleDateString("en", { month: "short", day: "numeric" });
}

export function LibraryPage({
  clips,
  loading,
  unavailable = false,
  refresh,
  onImport,
  onOpen,
  onScout,
}: {
  clips: Clip[];
  loading: boolean;
  unavailable?: boolean;
  refresh: () => void;
  onImport: () => void;
  onOpen: (id: string) => void;
  onScout: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [license, setLicense] = useState("all");
  const [sort, setSort] = useState("recent");
  const [view, setView] = useState(() =>
    localStorage.getItem("shortforge-library-view") === "table"
      ? "table"
      : "grid",
  );
  useEffect(() => {
    localStorage.setItem("shortforge-library-view", view);
  }, [view]);
  const [detail, setDetail] = useState<Clip | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const active = clips.filter((c) => c.workflow_status !== "archived");
  const visible = (
    filter === "archived"
      ? clips.filter((c) => c.workflow_status === "archived")
      : active
  )
    .filter(
      (c) =>
        (filter === "all" ||
          filter === "archived" ||
          (filter === "ready"
            ? editable(c)
            : c.workflow_status === "exported")) &&
        (license === "all" || c.license_status === license) &&
        `${c.title} ${c.channel_name}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "views"
        ? (b.views || 0) - (a.views || 0)
        : sort === "likes"
          ? (b.likes || 0) - (a.likes || 0)
          : b.created_at.localeCompare(a.created_at),
    );
  const visibleIds = useMemo(() => visible.map((c) => c.id), [visible]);
  const knownIds = useMemo(() => new Set(clips.map((c) => c.id)), [clips]);
  // Only clips that truly left the library are dropped, never ones a filter is
  // hiding, so the count in the bulk bar stays honest.
  useEffect(() => {
    setSelected((current) => {
      const kept = current.filter((id) => knownIds.has(id));
      return kept.length === current.length ? current : kept;
    });
  }, [knownIds]);
  // Selections survive filtering and searching, so a stray keystroke never
  // silently shrinks a delete. Select all only touches what is on screen.
  const allSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current)
      selectAllRef.current.indeterminate =
        !allSelected && visibleIds.some((id) => selected.includes(id));
  }, [selected, allSelected, visibleIds]);
  const toggle = (id: string) =>
    setSelected((v) =>
      v.includes(id) ? v.filter((x) => x !== id) : [...v, id],
    );
  const toggleAll = () =>
    setSelected((current) =>
      allSelected
        ? current.filter((id) => !visibleIds.includes(id))
        : [...new Set([...current, ...visibleIds])],
    );
  const archive = async () => {
    try {
      await Promise.all(
        selected.map((id) =>
          api(`/clips/${id}`, {
            method: "PATCH",
            body: JSON.stringify({ workflow_status: "archived" }),
          }),
        ),
      );
      setSelected([]);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async () => {
    setDeleting(true);
    setError("");
    try {
      const result = await post<{ deleted: string[]; missing: string[] }>(
        "/clips/delete-bulk",
        { ids: selected },
      );
      setSelected([]);
      setConfirming(false);
      refresh();
      if (result.deleted.length === 0)
        setError("Those videos were already gone. The library is up to date.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const csv = () => {
    const rows = clips.filter((c) => selected.includes(c.id));
    const safe = (s: string) =>
      '"' + (/^[=+@\-\t\r]/.test(s) ? "'" : "") + s.replaceAll('"', '""') + '"';
    const blob = new Blob(
      [
        "Title,URL,Creator,License\n" +
          rows
            .map((c) =>
              [c.title, c.url, c.channel_name, c.license_status]
                .map(safe)
                .join(","),
            )
            .join("\n"),
      ],
      { type: "text/csv" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "shortforge-links.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const readyCount = active.filter(editable).length;
  const exportedCount = active.filter(
    (c) => c.workflow_status === "exported",
  ).length;
  const inspirationCount = active.filter(
    (c) => c.license_status === "unknown",
  ).length;
  const emptyLibrary = clips.length === 0;
  const countsUnavailable = loading || (unavailable && emptyLibrary);
  const resetFilters = () => {
    setQuery("");
    setFilter("all");
    setLicense("all");
  };
  const tabs = [
    { id: "all", label: "All videos", n: active.length },
    { id: "ready", label: "Ready to edit", n: readyCount },
    { id: "exported", label: "Exported", n: exportedCount },
    { id: "archived", label: "Archived", n: clips.length - active.length },
  ];
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (index + tabs.length - 1) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    setFilter(tabs[next].id);
    document.getElementById(`library-tab-${tabs[next].id}`)?.focus();
  };
  return (
    <section className="library-page" aria-label="Video library">
      <div className="page-heading library-heading">
        <div>
          <h1>Your library</h1>
          <p>Your footage, inspiration, and finished Shorts in one place.</p>
        </div>
        <div className="library-heading-actions">
          <button className="button secondary" onClick={() => onOpen("")}>
            <Clapperboard size={16} /> Open Studio <ArrowUpRight size={14} />
          </button>
          <button className="button primary" onClick={onImport}>
            <Plus size={17} /> Add a video
          </button>
        </div>
      </div>
      <div
        className="library-overview"
        role="group"
        aria-label="Library overview"
      >
        {[
          {
            id: "all",
            label: "All videos",
            n: active.length,
            note: "In your library",
            icon: Film,
          },
          {
            id: "ready",
            label: "Ready to edit",
            n: readyCount,
            note: "Open a project in Studio",
            icon: Clapperboard,
          },
          {
            id: "exported",
            label: "Exported",
            n: exportedCount,
            note: "Finished in Studio",
            icon: CircleCheck,
          },
          {
            id: "inspiration",
            label: "Inspiration",
            n: inspirationCount,
            note: "Saved for reference",
            icon: Compass,
          },
        ].map(({ id, label, n, note, icon: Icon }) => (
          <button
            key={id}
            className={`overview-card ${id === "all" ? "overview-featured" : ""}`}
            aria-label={`Show ${label.toLowerCase()}, ${countsUnavailable ? "count unavailable" : `${n} videos`}`}
            onClick={() => {
              setQuery("");
              setFilter(id === "inspiration" ? "all" : id);
              setLicense(id === "inspiration" ? "unknown" : "all");
            }}
          >
            <span className="overview-label">
              {label}
              <ArrowUpRight size={15} aria-hidden="true" />
            </span>
            <strong>{countsUnavailable ? "—" : n}</strong>
            <span className="overview-note">
              <Icon size={13} aria-hidden="true" />
              {note}
            </span>
          </button>
        ))}
      </div>
      <div className="library-workspace">
        <div className="library-toolbar">
          <div className="tab-list" role="tablist" aria-label="Library filter">
            {tabs.map((t, index) => (
              <button
                id={`library-tab-${t.id}`}
                role="tab"
                aria-selected={filter === t.id}
                aria-controls="library-results"
                tabIndex={filter === t.id ? 0 : -1}
                className={filter === t.id ? "active" : ""}
                key={t.id}
                onClick={() => setFilter(t.id)}
                onKeyDown={(event) => onTabKey(event, index)}
              >
                {t.label}
                <span>{countsUnavailable ? "—" : t.n}</span>
              </button>
            ))}
          </div>
          <div className="segmented" aria-label="Library view">
            <IconButton
              label="Grid view"
              pressed={view === "grid"}
              className={view === "grid" ? "selected" : ""}
              onClick={() => setView("grid")}
            >
              <Grid2X2 size={17} />
            </IconButton>
            <IconButton
              label="Table view"
              pressed={view === "table"}
              className={view === "table" ? "selected" : ""}
              onClick={() => setView("table")}
            >
              <List size={19} />
            </IconButton>
          </div>
        </div>
        <div className="filter-row">
          <div className="filter-row-start">
            <label className="select-all">
              <input
                ref={selectAllRef}
                type="checkbox"
                aria-label="Select all videos in this view"
                checked={allSelected}
                disabled={visible.length === 0}
                onChange={toggleAll}
              />
              <span>Select all</span>
            </label>
            <div className="search-input">
              <Search size={17} />
              <input
                aria-label="Search videos"
                placeholder="Search your videos…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="filter-selects">
            <select
              aria-label="Filter by rights"
              value={license}
              onChange={(e) => setLicense(e.target.value)}
            >
              <option value="all">All permissions</option>
              <option value="owned">Your footage</option>
              <option value="permission">Permission saved</option>
              <option value="cc_by">Creative Commons</option>
              <option value="unknown">Inspiration only</option>
            </select>
            <select
              aria-label="Sort videos"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="recent">Recently added</option>
              <option value="views">Most viewed</option>
              <option value="likes">Most liked</option>
            </select>
          </div>
        </div>
        {error && <Notice>{error}</Notice>}
        {selected.length > 0 && (
          <div className="bulk-bar">
            <span>{selected.length} selected</span>
            <button className="button secondary small" onClick={csv}>
              <Download size={15} /> Export links
            </button>
            <button className="button secondary small" onClick={archive}>
              <Archive size={15} /> Archive
            </button>
            <button
              className="button danger small"
              onClick={() => {
                setError("");
                setConfirming(true);
              }}
            >
              <Trash2 size={15} /> Delete
            </button>
            <IconButton label="Clear selection" onClick={() => setSelected([])}>
              <X size={16} />
            </IconButton>
          </div>
        )}
        <div
          id="library-results"
          role="tabpanel"
          aria-labelledby={`library-tab-${filter}`}
        >
          {loading ? (
            <div className="skeleton-grid" aria-label="Loading library">
              {[1, 2, 3, 4, 5].map((n) => (
                <div className="skeleton" key={n} />
              ))}
            </div>
          ) : unavailable && emptyLibrary ? (
            <div className="library-no-results">
              <CloudOff size={30} strokeWidth={1.4} aria-hidden="true" />
              <h2>Your library is unavailable.</h2>
              <p>Reconnect the local engine to load your saved videos.</p>
              <button className="button secondary" onClick={refresh}>
                Try again <ArrowRight size={16} />
              </button>
            </div>
          ) : visible.length === 0 ? (
            emptyLibrary ? (
              <div className="library-start">
                <div className="empty-library-icon" aria-hidden="true">
                  <Clapperboard size={32} strokeWidth={1.3} />
                </div>
                <h2>Your next story starts here.</h2>
                <p>
                  Import your footage or save a Short for inspiration.
                  Everything you collect will appear here.
                </p>
                <div className="library-start-actions">
                  <button className="button primary" onClick={onImport}>
                    <Upload size={16} /> Import footage
                  </button>
                  <button className="button secondary" onClick={onScout}>
                    <Compass size={16} /> Explore Scout
                  </button>
                </div>
                <span className="library-local-note">
                  <ShieldCheck size={13} /> Saved on your device
                </span>
              </div>
            ) : (
              <div className="library-no-results">
                <Search size={28} strokeWidth={1.4} />
                <h2>No videos in this view.</h2>
                <p>Try a different search or filter to find your Short.</p>
                <button className="button secondary" onClick={resetFilters}>
                  Clear filters <ArrowRight size={16} />
                </button>
              </div>
            )
          ) : view === "grid" ? (
            <div className="clip-grid">
              {visible.map((clip, index) => (
                <article className="clip-card" key={clip.id}>
                  <div className="clip-thumbnail">
                    <button
                      className="thumbnail-button"
                      onClick={() => setDetail(clip)}
                      aria-label={`Details for ${clip.title}`}
                    >
                      <ClipArtwork clip={clip} eager={index < 5} />
                      <span className="thumbnail-play">
                        <Play size={22} fill="currentColor" />
                      </span>
                    </button>
                    <input
                      className="clip-checkbox"
                      type="checkbox"
                      aria-label={`Select ${clip.title}`}
                      checked={selected.includes(clip.id)}
                      onChange={() => toggle(clip.id)}
                    />
                    <IconButton
                      className="clip-more"
                      label={`More about ${clip.title}`}
                      onClick={() => setDetail(clip)}
                    >
                      <MoreHorizontal size={16} />
                    </IconButton>
                    <span className="source-pill">{sourceLabel(clip)}</span>
                  </div>
                  <div className="clip-meta">
                    <Badge clip={clip} />
                    <h3>
                      <button onClick={() => setDetail(clip)}>
                        {clip.title}
                      </button>
                    </h3>
                    <p>{clip.channel_name || "Your workspace"}</p>
                    <div className="clip-card-footer">
                      <div className="clip-stats">
                        {clip.views == null && clip.likes == null ? (
                          <span title={`Added ${savedDate(clip.created_at)}`}>
                            <Clock3 size={12} />
                            {savedDate(clip.created_at)}
                          </span>
                        ) : (
                          <>
                            <span title={`${count(clip.views)} views`}>
                              <Play size={11} />
                              {count(clip.views)}
                            </span>
                            <span title={`${count(clip.likes)} likes`}>
                              <Heart size={11} />
                              {count(clip.likes)}
                            </span>
                          </>
                        )}
                      </div>
                      <button
                        className="clip-open"
                        aria-label={`Edit ${clip.title} in a new tab`}
                        title="Edit in Studio · new tab"
                        onClick={() => onOpen(clip.id)}
                      >
                        Edit
                        <ArrowUpRight size={13} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Select</th>
                    <th>Video</th>
                    <th>Views</th>
                    <th>Likes</th>
                    <th>Permission</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${c.title}`}
                          checked={selected.includes(c.id)}
                          onChange={() => toggle(c.id)}
                        />
                      </td>
                      <td>
                        <div className="table-video">
                          <span className="table-thumbnail">
                            <ClipArtwork clip={c} />
                          </span>
                          <span>
                            <strong>{c.title}</strong>
                            <small>{c.channel_name || "Your footage"}</small>
                          </span>
                        </div>
                      </td>
                      <td>{count(c.views)}</td>
                      <td>{count(c.likes)}</td>
                      <td>
                        <Badge clip={c} />
                      </td>
                      <td>
                        <button
                          className="button primary small"
                          aria-label={`Edit ${c.title} in a new tab`}
                          onClick={() => onOpen(c.id)}
                        >
                          Edit <ArrowUpRight size={14} />
                        </button>
                        <button
                          className="button secondary small"
                          onClick={() => setDetail(c)}
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="library-workspace-footer">
          <span>
            {unavailable
              ? emptyLibrary
                ? "Waiting for your library"
                : "Showing last loaded videos"
              : `${visible.length} ${visible.length === 1 ? "video" : "videos"}${filter === "archived" ? " archived" : " in your library"}`}
          </span>
          {!unavailable && (
            <span>
              <ShieldCheck size={13} /> Saved locally
            </span>
          )}
        </div>
      </div>
      {confirming && (
        <Modal
          title="Delete videos"
          onClose={() => !deleting && setConfirming(false)}
        >
          <p className="confirm-copy">
            You are about to permanently delete{" "}
            <strong>
              {selected.length} {selected.length === 1 ? "video" : "videos"}
            </strong>
            . This also removes the saved script, transcript, and any downloaded
            footage, voiceover, or exported MP4 on this computer. It cannot be
            undone.
          </p>
          <ul className="confirm-list">
            {selected
              .slice(0, 5)
              .map((id) => clips.find((c) => c.id === id)?.title || "A video")
              .map((title) => (
                <li key={title}>{title}</li>
              ))}
            {selected.length > 5 && <li>and {selected.length - 5} more…</li>}
          </ul>
          <Notice kind="info">
            Archive keeps the entry and hides it from your library. Delete
            removes it for good.
          </Notice>
          <div className="detail-actions">
            <button
              className="button secondary"
              onClick={() => setConfirming(false)}
              disabled={deleting}
            >
              Cancel
            </button>
            <button
              className="button danger"
              onClick={remove}
              disabled={deleting}
            >
              {deleting ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Trash2 size={16} />
              )}{" "}
              {deleting ? "Deleting…" : "Delete permanently"}
            </button>
          </div>
        </Modal>
      )}
      {detail && (
        <ClipDetail
          clip={clips.find((c) => c.id === detail.id) || detail}
          onClose={() => setDetail(null)}
          refresh={refresh}
          onOpen={() => {
            onOpen(detail.id);
            setDetail(null);
          }}
        />
      )}
    </section>
  );
}
export function ImportDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [tab, setTab] = useState("link");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const submit = async () => {
    setError("");
    setBusy(true);
    try {
      if (tab === "link") {
        if (!url.trim())
          throw new Error("Paste a YouTube Shorts link to continue.");
        await post("/clips", {
          clips: [
            {
              url: url.trim(),
              title: title.trim() || "YouTube Short",
              discovery_mode: "manual",
            },
          ],
        });
      } else {
        if (!file) throw new Error("Choose a video file first.");
        if (file.size > 500 * 1024 * 1024)
          throw new Error("Please use a video smaller than 500 MB.");
        const body = new FormData();
        body.append("file", file);
        if (title) body.append("title", title);
        await api("/upload", { method: "POST", body });
      }
      onImported();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Bring your next idea in" onClose={onClose}>
      <p className="modal-description">
        Add your own footage or save a Short to your library.
      </p>
      <div className="segmented import-tabs">
        <button
          className={tab === "link" ? "selected" : ""}
          onClick={() => setTab("link")}
        >
          <Link2 size={17} /> Paste a link
        </button>
        <button
          className={tab === "file" ? "selected" : ""}
          onClick={() => setTab("file")}
        >
          <Upload size={17} /> Upload footage
        </button>
      </div>
      {tab === "link" ? (
        <label className="field">
          YouTube URL
          <input
            autoFocus
            placeholder="https://youtube.com/shorts/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <small>
            Edit in Studio to fetch the source. Its rights status stays unknown
            until you record permission or verify its license.
          </small>
        </label>
      ) : (
        <>
          <input
            ref={input}
            type="file"
            accept="video/*"
            hidden
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <button
            className="upload-zone"
            onClick={() => input.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              setFile(e.dataTransfer.files[0] || null);
            }}
          >
            <Upload size={28} />
            <strong>{file ? file.name : "Drop a video here, or browse"}</strong>
            <span>Your own or authorized footage · up to 500 MB</span>
          </button>
        </>
      )}
      <label className="field">
        Project title <span className="muted">(optional)</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Give your idea a name"
        />
      </label>
      {error && <Notice>{error}</Notice>}
      <div className="modal-actions">
        <button className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="button primary" onClick={submit} disabled={busy}>
          {busy ? (
            <LoaderCircle size={17} className="spin" />
          ) : (
            <Plus size={17} />
          )}{" "}
          {busy ? "Adding…" : "Add to library"}
        </button>
      </div>
    </Modal>
  );
}
function ClipDetail({
  clip,
  onClose,
  refresh,
  onOpen,
}: {
  clip: Clip;
  onClose: () => void;
  refresh: () => void;
  onOpen: () => void;
}) {
  const [note, setNote] = useState(clip.permission_note || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const task = useJob(refresh, clip.id);
  const permission = async () => {
    setBusy(true);
    try {
      await api(`/clips/${clip.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          license_status: "permission",
          permission_note: note,
        }),
      });
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Video details" onClose={onClose} wide>
      <div className="detail-title">
        <h3>{clip.title}</h3>
        <Badge clip={clip} />
      </div>
      <p>
        {clip.channel_name || "Your workspace"}{" "}
        <span className="muted">
          · {count(clip.views)} views · {count(clip.likes)} likes
        </span>
      </p>
      {clip.url && (
        <a
          className="inline-link"
          href={clip.url}
          target="_blank"
          rel="noreferrer"
        >
          Watch original <ArrowUpRight size={15} />
        </a>
      )}
      <div className="detail-description">
        {clip.description ||
          "No description yet. If you have a YouTube API key, fetch the latest details below."}
      </div>
      {clip.credit_snippet && <blockquote>{clip.credit_snippet}</blockquote>}
      {clip.license_status === "unknown" && (
        <div className="permission-box">
          <h3>Source rights are unknown</h3>
          <p>
            Local editing is available. Record the creator’s permission or
            verify a Creative Commons license before publishing reused footage.
          </p>
          <CopyButton
            label="Copy permission request"
            text={`Hi ${clip.channel_name || "there"}! I enjoyed your video (${clip.url}). May I use and edit it for a narrated Short on my channel, including monetized uploads? I’ll credit you and link the original. Please let me know if you agree. Thank you!`}
          />
          <label className="field">
            Permission note or proof link
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Paste the creator’s permission or a link to it."
              rows={3}
            />
          </label>
          <button
            className="button secondary"
            onClick={permission}
            disabled={!note.trim() || busy}
          >
            <ShieldCheck size={16} /> Save permission
          </button>
        </div>
      )}
      {clip.license_status === "cc_by" && (
        <Notice kind="info">
          The uploader’s CC label may not cover third-party footage or music
          included in the video.
        </Notice>
      )}
      {error && <Notice>{error}</Notice>}
      {task.error && <Notice>{task.error}</Notice>}
      <JobProgress job={task.job} />
      <div className="detail-actions">
        {clip.video_id && (
          <button
            className="button secondary"
            onClick={async () => {
              setError("");
              try {
                await post(`/clips/${clip.id}/enrich`);
                refresh();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Fetch YouTube details
          </button>
        )}
        <button
          className="button ghost"
          onClick={async () => {
            try {
              await api(`/clips/${clip.id}`, {
                method: "PATCH",
                body: JSON.stringify({
                  workflow_status:
                    clip.workflow_status === "archived"
                      ? "collected"
                      : "archived",
                }),
              });
              refresh();
              onClose();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <Archive size={16} />
          {clip.workflow_status === "archived" ? "Restore" : "Archive"}
        </button>
        <button
          className="button primary"
          onClick={onOpen}
          title="Open Studio in a new tab"
        >
          Edit in Studio
          <ArrowUpRight size={16} />
        </button>
      </div>
    </Modal>
  );
}
