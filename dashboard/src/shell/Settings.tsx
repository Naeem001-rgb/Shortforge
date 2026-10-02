import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  Save,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { Health, Settings } from "../api";
import { api } from "../api";
import { Notice } from "../ui";
export function SettingsPage({ health }: { health: Health | null }) {
  const [settings, setSettings] = useState<Settings>({
    gemini_model: "gemini-3.8-flash",
    niche: "Narrated facts and stories",
    language: "English",
  });
  const [keys, setKeys] = useState({
    gemini_api_key: "",
    youtube_api_key: "",
    elevenlabs_api_key: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    api<Settings>("/settings")
      .then(setSettings)
      .catch((e) => setError(e.message));
  }, []);
  const change = (name: string, value: string) => {
    setSettings((s) => ({ ...s, [name]: value }));
    setSaved(false);
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const payload = Object.fromEntries(
        Object.entries(settings).filter(([k]) => !k.endsWith("_set")),
      );
      for (const [k, v] of Object.entries(keys))
        if (v.trim()) payload[k] = v.trim();
      const data = await api<Settings>("/settings", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setSettings(data);
      setKeys({
        gemini_api_key: "",
        youtube_api_key: "",
        elevenlabs_api_key: "",
      });
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Make yourself at home.</h1>
          <p>Your tools, your preferences. Everything saved on this machine.</p>
        </div>
        <button className="button primary" disabled={busy} onClick={save}>
          {busy ? (
            <LoaderCircle size={17} className="spin" />
          ) : saved ? (
            <Check size={17} />
          ) : (
            <Save size={17} />
          )}{" "}
          {saved ? "Saved" : "Save changes"}
        </button>
      </div>
      {error && <Notice>{error}</Notice>}
      {saved && (
        <Notice kind="success">
          Your settings are saved. API keys stay in the local engine.
        </Notice>
      )}
      <div className="settings-layout">
        <div className="settings-main">
          <section className="settings-section">
            <div className="section-title">
              <KeyRound size={21} />
              <div>
                <h2>Optional connections</h2>
                <p>
                  Connect discovery, writing, and voice tools. Video editing
                  runs locally.
                </p>
              </div>
            </div>
            <div className="provider-heading">
              <strong>Google Gemini</strong>
              <span
                className={`badge ${settings.gemini_api_key_set ? "good" : "neutral"}`}
              >
                {settings.gemini_api_key_set
                  ? "Key saved"
                  : "Optional connection"}
              </span>
            </div>
            <label className="field">
              Gemini API key
              <input
                type="password"
                autoComplete="new-password"
                value={keys.gemini_api_key}
                onChange={(e) =>
                  setKeys({ ...keys, gemini_api_key: e.target.value })
                }
                placeholder={
                  settings.gemini_api_key_set
                    ? "A key is saved. Paste to replace."
                    : "Paste your API key"
                }
              />
            </label>
            <label className="field">
              Model
              <input
                value={String(settings.gemini_model || "")}
                onChange={(e) => change("gemini_model", e.target.value)}
                placeholder="gemini-3.8-flash"
              />
              <small>
                Used when you request script writing or a publish kit.
              </small>
            </label>
            <div className="settings-link-row">
              <a
                className="inline-link"
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
              >
                Get a Gemini API key <ArrowUpRight size={15} />
              </a>
              <a
                className="inline-link"
                href="https://aistudio.google.com/usage?timeRange=last-28-days&tab=rate-limit"
                target="_blank"
                rel="noreferrer"
              >
                Check your free quota <ArrowUpRight size={15} />
              </a>
            </div>
            <p className="help-text">
              Free limits vary by model and account. ShortForge cannot guarantee
              1,500 requests or prevent billing if you enable a paid Google
              project. Use a project without billing for a free-only setup.
            </p>
            <hr />
            <div className="provider-heading">
              <strong>ElevenLabs voice generation</strong>
              <span
                className={`badge ${settings.elevenlabs_api_key_set ? "good" : "neutral"}`}
              >
                {settings.elevenlabs_api_key_set ? "Key saved" : "Optional"}
              </span>
            </div>
            <label className="field">
              ElevenLabs API key
              <input
                type="password"
                autoComplete="new-password"
                value={keys.elevenlabs_api_key}
                aria-label="ElevenLabs API key"
                aria-describedby="elevenlabs-key-storage"
                onChange={(event) => {
                  setKeys({ ...keys, elevenlabs_api_key: event.target.value });
                  setSaved(false);
                }}
                placeholder={
                  settings.elevenlabs_api_key_set
                    ? "A key is saved. Paste to replace."
                    : "Paste your ElevenLabs API key"
                }
              />
              <small id="elevenlabs-key-storage">
                Saved only in your local engine. The key is never included in a
                project or export.
              </small>
            </label>
            <p className="help-text">
              Choose one of your account’s voices in Studio. Generating speech
              sends the selected script to ElevenLabs and uses your account
              credits. Commercial use requires an eligible plan.
            </p>
            <a
              className="inline-link"
              href="https://elevenlabs.io/app/settings/api-keys"
              target="_blank"
              hrefLang="en"
              rel="noreferrer"
            >
              Manage ElevenLabs API keys <ArrowUpRight size={15} />
            </a>
            <hr />
            <div className="provider-heading">
              <strong>YouTube Data API</strong>
              <span
                className={`badge ${settings.youtube_api_key_set ? "good" : "neutral"}`}
              >
                {settings.youtube_api_key_set ? "Key saved" : "Optional"}
              </span>
            </div>
            <label className="field">
              YouTube API key
              <input
                type="password"
                autoComplete="new-password"
                value={keys.youtube_api_key}
                onChange={(e) =>
                  setKeys({ ...keys, youtube_api_key: e.target.value })
                }
                placeholder={
                  settings.youtube_api_key_set
                    ? "A key is saved. Paste to replace."
                    : "Add a key to verify stats and licenses"
                }
              />
            </label>
            <details>
              <summary>How to get a free YouTube key</summary>
              <ol>
                <li>
                  Open{" "}
                  <a
                    href="https://console.cloud.google.com/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Google Cloud Console
                  </a>{" "}
                  and create a project.
                </li>
                <li>
                  Open APIs & Services → Library. Enable YouTube Data API v3.
                </li>
                <li>Open Credentials → Create credentials → API key.</li>
                <li>
                  Restrict this key to YouTube Data API v3. Paste it above and
                  save.
                </li>
              </ol>
            </details>
          </section>
          <section className="settings-section">
            <div className="section-title">
              <SlidersHorizontal size={21} />
              <div>
                <h2>Your creative defaults</h2>
                <p>Give your tools a little context.</p>
              </div>
            </div>
            <div className="field-grid">
              <label className="field">
                Channel topic
                <input
                  value={String(settings.niche || "")}
                  onChange={(e) => change("niche", e.target.value)}
                />
              </label>
              <label className="field">
                Main language
                <input
                  value={String(settings.language || "English")}
                  onChange={(e) => change("language", e.target.value)}
                />
              </label>
            </div>
          </section>
        </div>
        <aside className="settings-aside">
          <section className="section-card">
            <div className="section-title">
              <ShieldCheck size={20} />
              <h3>A small footprint.</h3>
            </div>
            <p>
              Your library, editing timelines, footage, music, and voiceovers
              are stored locally. Saved keys are never returned to the dashboard
              or stored in project files.
            </p>
            <p>
              Gemini receives text when you request writing or a publish kit.
              ElevenLabs receives text when you generate a voice. Local editing
              and imported audio work without either connection.
            </p>
          </section>
          <section className="section-card">
            <h3>On this machine</h3>
            <div className="capabilities">
              {["ffmpeg", "yt_dlp"].map((tool) => (
                <div key={tool}>
                  <span>
                    {
                      {
                        ffmpeg: "Video rendering",
                        yt_dlp: "Video downloads",
                      }[tool]
                    }
                  </span>
                  {health?.tools[tool] ? (
                    <CheckCircle2 size={17} className="success-text" />
                  ) : (
                    <span className="badge neutral">Setup needed</span>
                  )}
                </div>
              ))}
            </div>
            <p className="help-text">
              Import voiceovers and music made with your own tools directly in
              Studio.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
