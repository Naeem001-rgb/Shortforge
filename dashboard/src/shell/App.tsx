import {
  ArrowUpRight,
  ChevronRight,
  Clapperboard,
  Compass,
  FolderOpen,
  Library,
  Menu,
  Monitor,
  Moon,
  Search,
  Settings2,
  Sun,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Clip, Health } from "../api";
import { api } from "../api";
import { ImportDialog, LibraryPage } from "../library/Library";
import { ScoutPage } from "../library/Scout";
import { StudioPage } from "../studio/Studio";
import { IconButton, Modal, Notice } from "../ui";
import { SettingsPage } from "./Settings";
import "../theme/shell.css";
export type Page = "library" | "scout" | "studio" | "settings";
const PLATFORM: string =
  (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData?.platform ?? navigator.platform;
const pages = [
  { id: "library", label: "Library", icon: Library },
  { id: "scout", label: "Scout", icon: Compass },
  { id: "studio", label: "Studio", icon: Clapperboard },
] as const;
export function App() {
  const [mobile, setMobile] = useState(
    () => matchMedia("(max-width: 820px)").matches,
  );
  useEffect(() => {
    const query = matchMedia("(max-width: 820px)");
    const change = () => setMobile(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  const [page, setPage] = useState<Page>(() => {
    if (new URLSearchParams(location.search).has("studio")) return "studio";
    const saved = localStorage.getItem("shortforge-page");
    return ["library", "scout", "settings"].includes(saved || "")
      ? (saved as Page)
      : "library";
  });
  const [clips, setClips] = useState<Clip[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthChecked, setHealthChecked] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const refreshing = useRef(false);
  const refreshAgain = useRef(false);
  const clipSnapshot = useRef("");
  const active = useRef(false);
  const refreshController = useRef<AbortController | null>(null);
  const [importing, setImporting] = useState(false);
  const [detail, setDetail] = useState<Clip | null>(null);
  const [studioClip, setStudioClip] = useState(() => {
    const id = new URLSearchParams(location.search).get("studio");
    return id && id !== "new" ? id : "";
  });
  const [studioAttempt, setStudioAttempt] = useState(0);
  const [palette, setPalette] = useState(false);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("shortforge-theme") || "system",
  );
  useEffect(() => {
    if (page !== "studio") localStorage.setItem("shortforge-page", page);
  }, [page]);
  const refresh = useCallback(async function refreshClips() {
    if (refreshing.current) {
      refreshAgain.current = true;
      return;
    }
    refreshing.current = true;
    const controller = new AbortController();
    refreshController.current = controller;
    try {
      const data = await api<{ clips: Clip[] }>("/clips", {
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(15000),
        ]),
      });
      if (!active.current || controller.signal.aborted) return;
      const snapshot = JSON.stringify(data.clips);
      if (snapshot !== clipSnapshot.current) {
        clipSnapshot.current = snapshot;
        setClips(data.clips);
      }
      setError("");
    } catch (e) {
      if (active.current && !controller.signal.aborted)
        setError((e as Error).message);
    } finally {
      refreshing.current = false;
      if (active.current && !controller.signal.aborted) setLoading(false);
      if (refreshAgain.current) {
        refreshAgain.current = false;
        if (active.current) void refreshClips();
      }
    }
  }, []);
  const openStudio = useCallback((id = "") => {
    setDetail(null);
    setMenu(false);
    const url = new URL(location.href);
    url.searchParams.set("studio", id || "new");
    url.hash = "";
    history.replaceState(null, "", url);
    setStudioClip(id);
    setStudioAttempt((attempt) => attempt + 1);
    setPage("studio");
  }, []);
  useEffect(() => {
    active.current = true;
    refresh();
    const poll = () => {
      if (!document.hidden && !refreshing.current) void refresh();
    };
    const timer = setInterval(poll, 5000);
    let checking = false;
    let stopped = false;
    const check = async () => {
      if (checking || document.hidden) return;
      checking = true;
      try {
        const next = await api<Health>("/health", {
          signal: AbortSignal.timeout(10000),
        });
        if (!stopped)
          setHealth((current) =>
            JSON.stringify(current) === JSON.stringify(next) ? current : next,
          );
      } catch {
        if (!stopped) setHealth(null);
      } finally {
        checking = false;
        if (!stopped) setHealthChecked(true);
      }
    };
    check();
    const h = setInterval(check, 12000);
    const resume = () => {
      poll();
      void check();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    return () => {
      active.current = false;
      stopped = true;
      refreshController.current?.abort();
      clearInterval(timer);
      clearInterval(h);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
    };
  }, [refresh]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = resolved;
      document
        .querySelector('meta[name="theme-color"]:not([media])')
        ?.setAttribute("content", resolved === "dark" ? "#1a1a17" : "#faf7ee");
    };
    apply();
    localStorage.setItem("shortforge-theme", theme);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    if (!mobile || !menu) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sidebar.current
      ?.querySelector<HTMLButtonElement>(".nav-item.active")
      ?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
      if (event.key !== "Tab") return;
      const controls = Array.from(
        sidebar.current?.querySelectorAll<HTMLElement>(
          "a[href], button:not(:disabled)",
        ) ?? [],
      );
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", close);
      menuButton.current?.focus();
    };
  }, [mobile, menu]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  const navigate = (next: Page) => {
    if (next === "studio") {
      openStudio();
      return;
    }
    const url = new URL(location.href);
    url.searchParams.delete("studio");
    history.replaceState(null, "", url);
    setDetail(null);
    setPage(next);
    setMenu(false);
  };
  const label =
    page === "settings" ? "Settings" : pages.find((p) => p.id === page)?.label;
  const palettePages = [
    ...pages,
    { id: "settings" as const, label: "Settings", icon: Settings2 },
  ].filter((p) => p.label.toLowerCase().includes(query.toLowerCase()));
  const paletteClips = clips
    .filter((c) => query && c.title.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 5);
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      {menu && (
        <button
          className="mobile-scrim"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <aside
        ref={sidebar}
        id="workspace-navigation"
        className={`sidebar ${menu ? "open" : ""}`}
        inert={mobile && !menu}
        role={mobile && menu ? "dialog" : undefined}
        aria-modal={mobile && menu ? true : undefined}
        aria-label="Workspace navigation"
      >
        <div className="sidebar-brand-row">
          <button
            type="button"
            className="brand"
            onClick={() => navigate("library")}
          >
            <span className="brand-icon">
              <Clapperboard size={20} strokeWidth={1.9} aria-hidden="true" />
            </span>
            <span>ShortForge</span>
          </button>
          <IconButton
            label="Close navigation"
            className="sidebar-close"
            onClick={() => setMenu(false)}
          >
            <X size={19} />
          </IconButton>
        </div>
        <nav aria-label="Main navigation">
          {pages.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? "active" : ""}`}
              title={label}
              onClick={() => navigate(id)}
              aria-current={page === id ? "page" : undefined}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{label}</span>
              {id === "library" && clips.length > 0 && (
                <span className="nav-count">
                  {clips.filter((c) => c.workflow_status !== "archived").length}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="nav-label">Preferences</div>
          <button
            className={`nav-item ${page === "settings" ? "active" : ""}`}
            title="Settings"
            onClick={() => navigate("settings")}
            aria-current={page === "settings" ? "page" : undefined}
          >
            <Settings2 size={16} aria-hidden="true" />
            <span>Settings</span>
          </button>
        </div>
      </aside>
      <div className="app-body" inert={mobile && menu}>
        <header className="topbar">
          <div className="topbar-start">
            <button
              ref={menuButton}
              aria-label="Open navigation"
              aria-expanded={menu}
              aria-controls="workspace-navigation"
              className="icon-button mobile-menu"
              onClick={() => setMenu(true)}
            >
              <Menu size={20} />
            </button>
            <strong className="mobile-page-label">{label}</strong>
            <button
              className="command-trigger"
              onClick={() => setPalette(true)}
              aria-label="Search workspace"
            >
              <Search size={17} />
              <span>Search your workspace…</span>
              <kbd>{PLATFORM.includes("Mac") ? "⌘" : "Ctrl"} K</kbd>
            </button>
          </div>
          <div className="topbar-actions">
            <span
              className={`engine-state ${health ? "online" : ""}`}
              role="status"
              title={
                health
                  ? "Local engine is connected"
                  : "Start the engine using ./start.sh"
              }
            >
              <span />
              {health
                ? "Engine connected"
                : healthChecked
                  ? "Engine offline"
                  : "Connecting…"}
            </span>
            <div className="theme-toggle" role="group" aria-label="Color theme">
              {[
                { id: "light", icon: Sun },
                { id: "dark", icon: Moon },
                { id: "system", icon: Monitor },
              ].map(({ id, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  title={`${id[0].toUpperCase() + id.slice(1)} theme`}
                  aria-label={`${id[0].toUpperCase() + id.slice(1)} theme`}
                  aria-pressed={theme === id}
                  className={`icon-button ${theme === id ? "selected" : ""}`}
                  onClick={() => setTheme(id)}
                >
                  <Icon size={15} />
                </button>
              ))}
            </div>
            <button
              className="topbar-profile"
              onClick={() => navigate("settings")}
              aria-label="Personal workspace settings"
              title="Personal workspace settings"
            >
              <span className="profile-avatar" aria-hidden="true">
                S
              </span>
              <span className="topbar-profile-label">
                Your workspace<small>Local creator</small>
              </span>
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
        </header>
        <main id="main-content" className={`main-content page-${page}`}>
          {error && (
            <Notice>
              The engine isn’t responding. Start ShortForge with{" "}
              <code>./start.sh</code>, then{" "}
              <button className="text-button" onClick={refresh}>
                try again
              </button>
              .
            </Notice>
          )}
          {page === "library" && (
            <LibraryPage
              clips={clips}
              loading={loading}
              unavailable={Boolean(error)}
              refresh={refresh}
              onImport={() => setImporting(true)}
              detail={detail}
              onDetailChange={setDetail}
              onScout={() => navigate("scout")}
              onOpen={openStudio}
            />
          )}
          {page === "scout" && (
            <ScoutPage onImport={() => setImporting(true)} />
          )}
          {page === "studio" && (
            <StudioPage
              key={`${studioClip}:${studioAttempt}`}
              clip={clips.find((clip) => clip.id === studioClip)}
              clipId={studioClip}
              onComplete={() => void refresh()}
              onBack={() => navigate("library")}
            />
          )}
          {page === "settings" && <SettingsPage health={health} />}
        </main>
      </div>
      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onImported={() => {
            refresh();
            setImporting(false);
          }}
        />
      )}
      {palette && (
        <Modal title="Go anywhere" onClose={() => setPalette(false)}>
          <div className="search-input">
            <Search size={18} />
            <input
              aria-label="Search pages and clips"
              autoFocus
              placeholder="Search pages and your Shorts…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="command-results">
            {palettePages.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => {
                  navigate(id);
                  setPalette(false);
                  setQuery("");
                }}
              >
                <Icon size={19} aria-hidden="true" />
                {label}
                <ArrowUpRight size={15} aria-hidden="true" />
              </button>
            ))}
            {paletteClips.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  navigate("library");
                  setDetail(c);
                  setPalette(false);
                  setQuery("");
                }}
              >
                <FolderOpen size={18} aria-hidden="true" />
                {c.title}
              </button>
            ))}
            {palettePages.length === 0 && paletteClips.length === 0 && (
              <div className="command-empty muted">
                No matches for “{query}”
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
