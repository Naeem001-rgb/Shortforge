import {
  ArrowUpRight,
  Clapperboard,
  Compass,
  FolderOpen,
  Library,
  Menu,
  Mic2,
  Monitor,
  Moon,
  Search,
  Settings2,
  Sun,
  WandSparkles,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Clip, Health } from "../api";
import { api } from "../api";
import { ImportDialog, LibraryPage } from "../library/Library";
import { ScoutPage } from "../library/Scout";
import { SEOPage } from "../studio/SEO";
import { Studio } from "../studio/Studio";
import { VoicePage } from "../studio/Voice";
import { IconButton, Modal, Notice } from "../ui";
import { SettingsPage } from "./Settings";
export type Page =
  "library" | "scout" | "studio" | "voice" | "seo" | "settings";
const pages = [
  { id: "library", label: "Library", icon: Library },
  { id: "scout", label: "Scout", icon: Compass },
  { id: "studio", label: "Studio", icon: Clapperboard },
  { id: "voice", label: "Voice lab", icon: Mic2 },
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
  const [page, setPage] = useState<Page>("library");
  const [clips, setClips] = useState<Clip[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState("");
  const [palette, setPalette] = useState(false);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState(false);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("shortforge-theme") || "system",
  );
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
        .catch(() => setHealth(null));
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
    setPage(next);
    setMenu(false);
  };
  const open = (id: string) => {
    setSelected(id);
    navigate("studio");
  };
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
        className={`sidebar ${menu ? "open" : ""}`}
        inert={mobile && !menu}
      >
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("library");
          }}
        >
          <span className="brand-icon">
            <Clapperboard size={23} strokeWidth={1.8} />
          </span>
          <span>
            ShortForge<span className="brand-period">.</span>
          </span>
        </a>
        <button
          className="workspace-switch"
          onClick={() => navigate("settings")}
        >
          <span className="workspace-avatar">S</span>
          <span>
            My workspace<small>Personal · local</small>
          </span>
          <Settings2 size={15} />
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {pages.map(({ id, label, icon: Icon }) => (
            <button
              className={`nav-item ${page === id ? "active" : ""}`}
              key={id}
              onClick={() => navigate(id)}
              aria-current={page === id ? "page" : undefined}
            >
              <Icon size={20} />
              <span>{label}</span>
              {id === "library" && clips.length > 0 && (
                <span className="nav-count">
                  {clips.filter((c) => c.workflow_status !== "archived").length}
                </span>
              )}
              {id === "voice" && <span className="nav-tag">CLONE</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <span className="local-dot" />
            <span>
              Your ideas. Your machine.
              <small>Made for creating, on a budget.</small>
            </span>
          </div>
          <button
            className={`nav-item ${page === "settings" ? "active" : ""}`}
            onClick={() => navigate("settings")}
          >
            <Settings2 size={20} />
            <span>Settings</span>
          </button>
          <button className="profile-row" onClick={() => navigate("settings")}>
            <span className="profile-avatar">Y</span>
            <span>
              Your workspace<small>Let’s make something good.</small>
            </span>
            <ArrowUpRight size={16} />
          </button>
        </div>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <div className="breadcrumb">
            <IconButton
              label="Open navigation"
              className="mobile-menu"
              onClick={() => setMenu(true)}
            >
              <Menu size={20} />
            </IconButton>
            <span>Workspace</span>
            <span className="slash">/</span>
            <strong>{label}</strong>
          </div>
          <div className="topbar-actions">
            <button
              className="command-trigger"
              onClick={() => setPalette(true)}
              aria-label="Search workspace"
            >
              <Search size={16} />
              <span>Quick search</span>
              <kbd>⌘ K</kbd>
            </button>
            <span
              className={`engine-state ${health ? "online" : ""}`}
              title={
                health
                  ? "Local engine is connected"
                  : "Start the engine using ./start.sh"
              }
            >
              <span />
              {health ? "Engine connected" : "Engine offline"}
            </span>
            <div className="theme-toggle" role="group" aria-label="Color theme">
              {[
                { id: "light", icon: Sun },
                { id: "dark", icon: Moon },
                { id: "system", icon: Monitor },
              ].map(({ id, icon: Icon }) => (
                <IconButton
                  key={id}
                  label={`${id[0].toUpperCase() + id.slice(1)} theme`}
                  className={theme === id ? "selected" : ""}
                  onClick={() => setTheme(id)}
                >
                  <Icon size={16} />
                </IconButton>
              ))}
            </div>
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
              refresh={refresh}
              onImport={() => setImporting(true)}
              onOpen={open}
              onScout={() => navigate("scout")}
            />
          )}
          {page === "scout" && (
            <ScoutPage
              onImport={() => setImporting(true)}
              onSettings={() => navigate("settings")}
            />
          )}
          {page === "studio" && (
            <Studio
              key={selected}
              clips={clips}
              selected={selected}
              onSelect={setSelected}
              refresh={refresh}
              onImport={() => setImporting(true)}
              onPublish={() => navigate("seo")}
            />
          )}
          {page === "voice" && (
            <VoicePage
              key={selected}
              clips={clips}
              selected={selected}
              onSelect={setSelected}
              onSettings={() => navigate("settings")}
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
        <footer className="workspace-footer">
          <span>Built for your next idea.</span>
          <span>
            Local workspace <span>·</span> ShortForge v0.1
          </span>
        </footer>
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
