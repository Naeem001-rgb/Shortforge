import {
  Archive,
  ArrowRight,
  ArrowUpRight,
  Clapperboard,
  Compass,
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
  Upload,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
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
export function LibraryPage({
  clips,
  loading,
  refresh,
  onImport,
  onOpen,
  onScout,
}: {
  clips: Clip[];
  loading: boolean;
  refresh: () => void;
  onImport: () => void;
  onOpen: (id: string) => void;
  onScout: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [license, setLicense] = useState("all");
  const [sort, setSort] = useState("recent");
  const [view, setView] = useState("grid");
  const [detail, setDetail] = useState<Clip | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
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
  const toggle = (id: string) =>
    setSelected((v) =>
      v.includes(id) ? v.filter((x) => x !== id) : [...v, id],
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
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            Your library<span className="heading-dot">.</span>
          </h1>
          <p>Find a spark. Make it your own. Create your next Short.</p>
        </div>
        <button className="button primary" onClick={onImport}>
          <Plus size={18} /> Add a video
        </button>
      </div>
      <div className="library-banner">
        <div className="banner-symbol">
          <Compass size={24} strokeWidth={1.5} />
        </div>
        <div>
          <strong>Good stories are everywhere.</strong>
          <span>
            Scout for narrated Shorts, with or without creator credits.
          </span>
        </div>
        <button className="button secondary" onClick={onScout}>
          Explore Scout <ArrowUpRight size={16} />
        </button>
      </div>
      <div className="library-toolbar">
        <div className="tab-list" role="tablist" aria-label="Library filter">
          {[
            { id: "all", label: "All videos", n: active.length },
            {
              id: "ready",
              label: "Ready to edit",
              n: active.filter(editable).length,
            },
            {
              id: "exported",
              label: "Exported",
              n: active.filter((c) => c.workflow_status === "exported").length,
            },
            {
              id: "archived",
              label: "Archived",
              n: clips.length - active.length,
            },
          ].map((t) => (
            <button
              role="tab"
              aria-selected={filter === t.id}
              className={filter === t.id ? "active" : ""}
              key={t.id}
              onClick={() => setFilter(t.id)}
            >
              {t.label}
              <span>{t.n}</span>
            </button>
          ))}
        </div>
        <div className="segmented" aria-label="Library view">
          <IconButton
            label="Grid view"
            className={view === "grid" ? "selected" : ""}
            onClick={() => setView("grid")}
          >
            <Grid2X2 size={17} />
          </IconButton>
          <IconButton
            label="Table view"
            className={view === "table" ? "selected" : ""}
            onClick={() => setView("table")}
          >
            <List size={19} />
          </IconButton>
        </div>
      </div>
      <div className="filter-row">
        <div className="search-input">
          <Search size={17} />
          <input
            aria-label="Search videos"
            placeholder="Search your videos…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
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
          <IconButton label="Clear selection" onClick={() => setSelected([])}>
            <X size={16} />
          </IconButton>
        </div>
      )}
      {loading ? (
        <div className="skeleton-grid" aria-label="Loading library">
          {[1, 2, 3, 4].map((n) => (
            <div className="skeleton" key={n} />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="library-empty">
          <div className="empty-reels" aria-hidden="true">
            <div className="reel rear-left">
              <Film size={25} />
              <span />
              <span />
            </div>
            <div className="reel rear-right">
              <MicSymbol />
            </div>
            <div className="reel front">
              <div className="reel-top">
                <span />
                <MoreHorizontal size={17} />
              </div>
              <div className="reel-play">
                <Play size={25} fill="currentColor" />
              </div>
              <div className="reel-captions">
                <span />
                <span />
              </div>
              <div className="reel-bottom">
                <span />
                <Heart size={14} />
              </div>
            </div>
            <div className="reel-plus">
              <Plus size={21} />
            </div>
          </div>
          <h2>
            {active.length === 0
              ? "Make room for your next big idea."
              : "No videos in this view."}
          </h2>
          <p>
            {active.length === 0
              ? "Your creative starting point. Add a video you own, save a link for inspiration, or let Scout find your next story."
              : "Try a different search or filter to find your Short."}
          </p>
          <div className="empty-actions">
            <button className="button primary" onClick={onImport}>
              <Plus size={17} /> Add your first video
            </button>
            <button className="button ghost" onClick={onScout}>
              Meet Scout <ArrowRight size={17} />
            </button>
          </div>
          <span className="empty-footnote">
            <ShieldCheck size={14} /> Saved on your machine. No subscription
            needed.
          </span>
        </div>
      ) : view === "grid" ? (
        <div className="clip-grid">
          {visible.map((clip) => (
            <article className="clip-card" key={clip.id}>
              <div className="clip-thumbnail">
                <button
                  className="thumbnail-button"
                  onClick={() => setDetail(clip)}
                  aria-label={`Details for ${clip.title}`}
                >
                  {clip.thumbnail_url ? (
                    <img
                      src={clip.thumbnail_url}
                      alt=""
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  ) : (
                    <Film size={40} strokeWidth={1} />
                  )}
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
                <span className="source-pill">
                  {clip.discovery_mode === "upload"
                    ? "LOCAL FILE"
                    : "YOUTUBE SHORT"}
                </span>
              </div>
              <div className="clip-meta">
                <Badge clip={clip} />
                <h3>
                  <button onClick={() => setDetail(clip)}>{clip.title}</button>
                </h3>
                <p>{clip.channel_name || "Your workspace"}</p>
                <div className="clip-stats">
                  <span>
                    <Play size={13} />
                    {count(clip.views)}
                  </span>
                  <span>
                    <Heart size={13} />
                    {count(clip.likes)}
                  </span>
                  <IconButton
                    label={`More about ${clip.title}`}
                    onClick={() => setDetail(clip)}
                  >
                    <MoreHorizontal size={18} />
                  </IconButton>
                </div>
                <button
                  className="button secondary full"
                  onClick={() =>
                    editable(clip) ? onOpen(clip.id) : setDetail(clip)
                  }
                >
                  {editable(clip) ? "Open in Studio" : "View inspiration"}
                  <ArrowUpRight size={15} />
                </button>
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
                    <strong>{c.title}</strong>
                    <small>{c.channel_name || "Your footage"}</small>
                  </td>
                  <td>{count(c.views)}</td>
                  <td>{count(c.likes)}</td>
                  <td>
                    <Badge clip={c} />
                  </td>
                  <td>
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
      <div className="workflow-guide">
        <div className="workflow-guide-heading">
          <span>A little inspiration. A lot of possibility.</span>
          <span>YOUR CREATIVE FLOW</span>
        </div>
        <div className="workflow-steps">
          <button onClick={onScout}>
            <span className="step-number">01</span>
            <div>
              <strong>Find your story</strong>
              <p>Collect narrated Shorts with Scout.</p>
            </div>
            <Compass size={21} />
          </button>
          <button
            onClick={() => (clips.length ? onOpen(clips[0].id) : onImport())}
          >
            <span className="step-number">02</span>
            <div>
              <strong>Make it yours</strong>
              <p>Rewrite, revoice, and add captions.</p>
            </div>
            <Clapperboard size={21} />
          </button>
          <button
            onClick={() => (clips.length ? onOpen(clips[0].id) : onImport())}
          >
            <span className="step-number">03</span>
            <div>
              <strong>Ready for the world</strong>
              <p>Export a vertical video you’re proud of.</p>
            </div>
            <ArrowUpRight size={21} />
          </button>
        </div>
      </div>
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
    </>
  );
}
function MicSymbol() {
  return (
    <div className="mini-wave">
      {[10, 22, 36, 19, 43, 29, 15].map((h, i) => (
        <i key={i} style={{ height: h }} />
      ))}
    </div>
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
            Saved as inspiration. Add permission before editing its footage.
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
          <h3>Keep the inspiration. Check the permission.</h3>
          <p>
            Creator credits are optional for discovery. To use this footage,
            save the creator’s permission or verify a Creative Commons license.
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
        <button className="button primary" onClick={onOpen}>
          {editable(clip) ? "Open in Studio" : "Open script"}
          <ArrowRight size={16} />
        </button>
      </div>
    </Modal>
  );
}
