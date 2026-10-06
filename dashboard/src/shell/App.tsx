import {
  ArrowUpRight,
  ChevronsUpDown,
  ChevronRight,
  Clapperboard,
  Compass,
  FolderOpen,
  HardDrive,
  Library,
  Menu,
  Monitor,
  Moon,
  Plus,
  Search,
  Settings2,
  Sun,
  WandSparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Clip, Health } from "../api";
import { api, post } from "../api";
import { ImportDialog, LibraryPage } from "../library/Library";
import { ScoutPage } from "../library/Scout";
import { SEOPage } from "../studio/SEO";
import { Studio } from "../studio/Studio";
import { IconButton, Modal, Notice } from "../ui";
import { SettingsPage } from "./Settings";
import "../theme/shell.css";
export type Page = "library" | "scout" | "studio" | "seo" | "settings";
const pages = [
  { id: "library", label: "Library", icon: Library },
  { id: "scout", label: "Scout", icon: Compass },
  { id: "studio", label: "Studio", icon: Clapperboard },
  { id: "seo", label: "Publish kit", icon: WandSparkles },
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
    return ["library", "scout", "seo", "settings"].includes(saved || "")
      ? (saved as Page)
      : "library";
  });
  const [clips, setClips] = useState<Clip[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthChecked, setHealthChecked] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState(
    () =>
      new URLSearchParams(location.search).get("studio") ||
      localStorage.getItem("shortforge-project") ||
      "",
  );
  const creating = useRef(false);
  const [projectError, setProjectError] = useState("");
  const [palette, setPalette] = useState(false);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("shortforge-theme") || "system",
  );
  useEffect(() => {
    localStorage.setItem("shortforge-page", page);
    localStorage.setItem("shortforge-project", selected);
  }, [page, selected]);
  const refresh = useCallback(async () => {
    try {
      const data = await api<{ clips: Clip[] }>("/clips");
      setClips(data.clips);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    const check = () =>
      api<Health>("/health")
        .then(setHealth)
        .catch(() => setHealth(null))
        .finally(() => setHealthChecked(true));
    check();
    const h = setInterval(check, 12000);
    return () => {
      clearInterval(timer);
      clearInterval(h);
    };
  }, [refresh]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
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
  const selectProject = useCallback((id: string) => {
    setSelected(id);
    const url = new URL(location.href);
    url.searchParams.set("studio", id);
    history.replaceState(null, "", url);
  }, []);
  const createProject = useCallback(async () => {
    if (creating.current) return;
    creating.current = true;
    setProjectError("");
    try {
      const clip = await post<Clip>("/projects");
      setClips((current) => [clip, ...current]);
      selectProject(clip.id);
      setPage("studio");
    } catch (cause) {
      setProjectError((cause as Error).message);
    } finally {
      creating.current = false;
    }
  }, [selectProject]);
  useEffect(() => {
    if (page === "studio" && selected === "new") void createProject();
  }, [page, selected, createProject]);
  const open = (id: string) => {
    const url = new URL(location.href);
    url.searchParams.set("studio", id || "new");
    url.hash = "";
    window.open(url.href, "_blank", "noopener,noreferrer");
  };
  const navigate = (next: Page) => {
    if (next === "studio") open(selected || "new");
    else {
      const url = new URL(location.href);
      url.searchParams.delete("studio");
      history.replaceState(null, "", url);
      setPage(next);
    }
    setMenu(false);
  };
  if (page === "studio") {
    return (
      <main id="main-content" className="studio-tab">
        {projectError && (
          <Notice>
            {projectError}{" "}
            <button className="text-button" onClick={createProject}>
              Try again
            </button>
          </Notice>
        )}
        <Studio
          key={selected}
          clips={clips}
          selected={selected === "new" ? "" : selected}
          onSelect={selectProject}
          refresh={refresh}
          onImport={createProject}
          {...{ onBack: () => navigate("library") }}
          onPublish={() => navigate("seo")}
        />
      </main>
    );
  }
  const label =
    page === "settings" ? "Settings" : pages.find((p) => p.id === page)?.label;
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
          <a
            className="brand"
            aria-label="ShortForge"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              navigate("library");
            }}
          >
            <span className="brand-icon">
              <Clapperboard size={20} strokeWidth={1.9} />
            </span>
            <span>ShortForge</span>
          </a>
          <IconButton
            label="Close navigation"
            className="sidebar-close"
            onClick={() => setMenu(false)}
          >
            <X size={19} />
          </IconButton>
        </div>
        <button
          className="sidebar-workspace"
          aria-label="Personal workspace"
          onClick={() => navigate("settings")}
        >
          <span className="workspace-avatar" aria-hidden="true">
            <FolderOpen size={17} />
          </span>
          <span>
            My workspace<small>On this device</small>
          </span>
          <ChevronsUpDown size={14} aria-hidden="true" />
        </button>
        <button
          className="sidebar-create"
          aria-label="Create a Short"
          title="Create a Short"
          onClick={() => {
            setMenu(false);
            open("");
          }}
        >
          <Plus size={17} />
          <span>Create a Short</span>
        </button>
        <nav aria-label="Main navigation">
          <div className="nav-label">Workspace</div>
          {pages.map(({ id, label, icon: Icon }, index) => (
            <div className="nav-entry" key={id}>
              {index === 2 && (
                <div className="nav-label production-label">Production</div>
              )}
              <button
                className={`nav-item ${page === id ? "active" : ""}`}
                aria-label={label}
                title={label}
                onClick={() => navigate(id)}
                aria-current={page === id ? "page" : undefined}
              >
                <Icon size={16} />
                <span>{label}</span>
                {id === "library" && clips.length > 0 && (
                  <span className="nav-count">
                    {
                      clips.filter((c) => c.workflow_status !== "archived")
                        .length
                    }
                  </span>
                )}
                {id === "studio" && (
                  <ArrowUpRight
                    className="nav-external"
                    size={14}
                    aria-hidden="true"
                  />
                )}
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="nav-label">Preferences</div>
          <button
            className={`nav-item ${page === "settings" ? "active" : ""}`}
            aria-label="Settings"
            title="Settings"
            onClick={() => navigate("settings")}
            aria-current={page === "settings" ? "page" : undefined}
          >
            <Settings2 size={16} />
            <span>Settings</span>
          </button>
          <div className="sidebar-device">
            <HardDrive size={22} aria-hidden="true" />
            <strong>A space of your own.</strong>
            <p>Your videos and projects are saved on this device.</p>
            <button onClick={() => navigate("settings")}>
              Workspace settings <ArrowUpRight size={14} />
            </button>
          </div>
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
              <kbd>{navigator.platform.includes("Mac") ? "⌘" : "Ctrl"} K</kbd>
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
              onOpen={open}
              onScout={() => navigate("scout")}
            />
          )}
          {page === "scout" && (
            <ScoutPage
              onImport={() => setImporting(true)}
            />
          )}
          {page === "seo" && (
            <SEOPage
              key={selected}
              clips={clips}
              selected={selected}
              onSelect={setSelected}
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
            {[
              ...pages,
              { id: "settings" as const, label: "Settings", icon: Settings2 },
            ]
              .filter((p) =>
                p.label.toLowerCase().includes(query.toLowerCase()),
              )
              .map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => {
                    navigate(id);
                    setPalette(false);
                    setQuery("");
                  }}
                >
                  <Icon size={19} />
                  {label}
                  <ArrowUpRight size={15} />
                </button>
              ))}
            {clips
              .filter(
                (c) =>
                  query && c.title.toLowerCase().includes(query.toLowerCase()),
              )
              .slice(0, 5)
              .map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    open(c.id);
                    setPalette(false);
                  }}
                >
                  <FolderOpen size={18} />
                  {c.title}
                </button>
              ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
