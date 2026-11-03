import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Clapperboard, LoaderCircle, RefreshCw } from "lucide-react";
import {
  accessToken,
  connectCode,
  connectScout,
  ENGINE_ORIGIN,
  engineFetch,
  inExtension,
  watchAccess,
} from "../../../shared/engine-client";
import { Notice } from "../ui";
import "./connection.css";

export function Connection({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const opening = useRef<Promise<void> | null>(null);
  const alive = useRef(true);

  async function check() {
    setBusy(true);
    try {
      const token = await accessToken();
      if (!token) {
        if (alive.current) setReady(false);
        return;
      }
      const response = await engineFetch("/api/security/session", {
        signal: AbortSignal.timeout(8000),
      });
      if (alive.current) {
        setReady(response.ok);
        if (response.ok) setError("");
      }
    } catch {
      if (alive.current) {
        setReady(false);
        setError("The engine is offline. Start ShortForge, then try again.");
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  useEffect(() => {
    alive.current = true;
    const connectFromLink = async () => {
      const fragment = new URLSearchParams(location.hash.slice(1));
      const link = fragment.get("connect");
      if (link) {
        fragment.delete("connect");
        const url = new URL(location.href);
        url.hash = fragment.toString();
        history.replaceState(null, "", url);
        try {
          await connectCode(link);
          if (!inExtension()) void connectScout().catch(() => {});
        } catch (cause) {
          if (alive.current) setError((cause as Error).message);
        }
      }
    };
    if (!opening.current) opening.current = connectFromLink();
    void opening.current.then(check);
    const newLink = () => {
      if (!new URLSearchParams(location.hash.slice(1)).has("connect")) return;
      opening.current = connectFromLink();
      void opening.current.then(check);
    };
    window.addEventListener("hashchange", newLink);
    const unwatch = watchAccess(() => {
      void check();
    });
    return () => {
      alive.current = false;
      window.removeEventListener("hashchange", newLink);
      unwatch();
    };
  }, []);

  if (ready) return children;
  return (
    <main className="connection-page">
      <div className="connection-content">
        <Clapperboard size={32} aria-hidden="true" />
        <h1>{busy ? "Opening your workspace…" : "Open your workspace."}</h1>
        <p>
          {inExtension()
            ? "Start ShortForge, then choose Connect Scout in Settings. Your collected clips stay saved while you reconnect."
            : "Start ShortForge with its usual launcher. It opens a connected window automatically, keeping your Library private."}
        </p>
        {error && <Notice>{error}</Notice>}
        <div className="connection-actions">
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void check()}
          >
            {busy ? (
              <LoaderCircle size={17} className="spin" aria-hidden="true" />
            ) : (
              <RefreshCw size={17} aria-hidden="true" />
            )}
            {busy ? "Connecting…" : "Try again"}
          </button>
          {inExtension() && (
            <a
              className="button secondary"
              href={ENGINE_ORIGIN}
              target="_blank"
              rel="noreferrer"
            >
              Open ShortForge
            </a>
          )}
        </div>
        {!inExtension() && (
          <details className="connection-manual">
            <summary>Use a connection link</summary>
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setError("");
                try {
                  await connectCode(code);
                  setCode("");
                  await check();
                  void connectScout().catch(() => {});
                } catch (cause) {
                  setError((cause as Error).message);
                  setBusy(false);
                }
              }}
            >
              <label className="field">
                Connection link or code
                <input
                  type="password"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
                <small>
                  Use the fresh link shown by the ShortForge launcher.
                </small>
              </label>
              <button
                className="button secondary"
                disabled={busy || !code.trim()}
              >
                Connect this browser
              </button>
            </form>
          </details>
        )}
      </div>
    </main>
  );
}

export function ScoutConnection() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  if (inExtension()) return null;
  return (
    <section className="settings-section">
      <div className="section-title">
        <div>
          <h2>Scout connection</h2>
          <p>Connect your Chrome extension to this private workspace.</p>
        </div>
      </div>
      <button
        className="button secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage("");
          setFailed(false);
          try {
            await connectScout();
            setMessage(
              "Scout is connected. You can continue collecting videos.",
            );
          } catch (cause) {
            setFailed(true);
            setMessage((cause as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Connecting Scout…" : "Connect Scout"}
      </button>
      {message && (
        <Notice kind={failed ? "error" : "success"}>{message}</Notice>
      )}
    </section>
  );
}
