import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  LoaderCircle,
  Plus,
  Unplug,
  Youtube,
} from "lucide-react";
import { api, post } from "../api";
import { Notice } from "../ui";
import "./youtube-settings.css";

type Channel = { id: string; title: string; thumbnail_url: string };
type Connection = {
  configured: boolean;
  redirect_uri: string;
  channels: Channel[];
};

export function YouTubeSettings() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [authorizationUrl, setAuthorizationUrl] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [replaceSetup, setReplaceSetup] = useState(false);
  const mounted = useRef(true);
  const popup = useRef<Window | null>(null);
  const previousChannels = useRef("");

  const refresh = useCallback(async () => {
    try {
      const next = await api<Connection>("/youtube/channels");
      if (mounted.current) {
        setConnection(next);
        setError("");
      }
      return next;
    } catch (cause) {
      if (mounted.current) setError((cause as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => {
      mounted.current = false;
      window.removeEventListener("focus", focus);
    };
  }, [refresh]);

  useEffect(() => {
    if (!connecting) return;
    const started = Date.now();
    let stopped = false;
    let timer: number;
    // Poll again only after the previous refresh settles so slow requests
    // never overlap, and stop after ten minutes or when the popup closes.
    const poll = async () => {
      const next = await refresh();
      if (stopped || !mounted.current) return;
      const changed =
        next && JSON.stringify(next.channels) !== previousChannels.current;
      if (changed || popup.current?.closed || Date.now() - started > 600_000) {
        setConnecting(false);
        if (changed) {
          setMessage("YouTube channel connected. Choose it when you publish.");
          setAuthorizationUrl("");
        } else {
          setMessage("Connection window closed before finishing — try again.");
        }
        return;
      }
      timer = window.setTimeout(poll, 3000);
    };
    timer = window.setTimeout(poll, 3000);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [connecting, refresh]);

  const importClient = async (file: File) => {
    setError("");
    try {
      if (file.size > 64 * 1024)
        throw new Error(
          "Choose the small client JSON file downloaded from Google Cloud.",
        );
      const data: unknown = JSON.parse(await file.text());
      if (!data || typeof data !== "object" || !("installed" in data)) {
        throw new Error(
          "Create a Desktop app OAuth client in Google Cloud, then choose its downloaded JSON file.",
        );
      }
      const installed = (data as { installed: Record<string, unknown> })
        .installed;
      if (
        !installed ||
        typeof installed.client_id !== "string" ||
        typeof installed.client_secret !== "string"
      ) {
        throw new Error(
          "This file does not contain a Desktop app client ID and secret.",
        );
      }
      setClientId(installed.client_id);
      setClientSecret(installed.client_secret);
      setMessage(
        "Client file read. Save YouTube setup to keep it on this machine.",
      );
    } catch (cause) {
      setError(
        cause instanceof SyntaxError
          ? "This file is not valid JSON. Choose the downloaded Google client file."
          : (cause as Error).message,
      );
    }
  };

  const save = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api("/youtube/config", {
        method: "PUT",
        body: JSON.stringify({
          client_id: clientId.trim(),
          client_secret: clientSecret.trim(),
        }),
      });
      setClientId("");
      setClientSecret("");
      setReplaceSetup(false);
      setAuthorizationUrl("");
      setConnecting(false);
      await refresh();
      setMessage("YouTube setup saved. Connect your channel next.");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    // Open synchronously from the click so browser popup blocking is avoided.
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    popup.current = tab;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await post<{ authorization_url: string }>(
        "/youtube/oauth/start",
        {},
      );
      const url = new URL(result.authorization_url);
      if (url.origin !== "https://accounts.google.com")
        throw new Error(
          "The sign-in address was not recognized. Try connecting again.",
        );
      setAuthorizationUrl(url.href);
      previousChannels.current = JSON.stringify(connection?.channels || []);
      if (tab) tab.location.href = url.href;
      setConnecting(true);
    } catch (cause) {
      tab?.close();
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (channel: Channel) => {
    setBusy(true);
    setError("");
    try {
      await api(`/youtube/channels/${encodeURIComponent(channel.id)}`, {
        method: "DELETE",
      });
      await refresh();
      setMessage(
        `${channel.title} disconnected from ShortForge. Its YouTube videos are unchanged.`,
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="settings-section youtube-settings"
      aria-labelledby="youtube-settings-title"
    >
      <div className="section-title">
        <Youtube size={22} />
        <div>
          <h2 id="youtube-settings-title">YouTube publishing</h2>
          <p>Send your finished edits to a channel you connect.</p>
        </div>
      </div>
      {error && (
        <Notice>
          {error}{" "}
          <button className="text-button" onClick={() => void refresh()}>
            Refresh connection
          </button>
        </Notice>
      )}
      {message && <Notice kind="success">{message}</Notice>}
      {!connection && !error && (
        <p role="status">Loading YouTube connections…</p>
      )}
      {connection && (
        <>
          {connection.channels.length > 0 && (
            <ul
              className="youtube-connected-channels"
              aria-label="Connected YouTube channels"
              role="list"
            >
              {connection.channels.map((channel) => (
                <li key={channel.id}>
                  {channel.thumbnail_url ? (
                    <img
                      src={channel.thumbnail_url}
                      alt=""
                      width="40"
                      height="40"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <Youtube size={28} />
                  )}
                  <div>
                    <strong>{channel.title}</strong>
                    <span>{channel.id}</span>
                  </div>
                  <button
                    className="button secondary small"
                    disabled={busy || connecting}
                    onClick={() => void disconnect(channel)}
                    aria-label={`Disconnect ${channel.title}`}
                  >
                    <Unplug size={16} aria-hidden="true" /> Disconnect
                  </button>
                </li>
              ))}
            </ul>
          )}
          {connection.configured && (
            <div className="youtube-settings-actions">
              <button
                className="button primary"
                disabled={busy || connecting}
                onClick={() => void connect()}
              >
                {busy || connecting ? (
                  <LoaderCircle className="spin" size={17} aria-hidden="true" />
                ) : (
                  <Plus size={17} aria-hidden="true" />
                )}
                {connecting
                  ? "Waiting for Google…"
                  : connection.channels.length
                    ? "Connect another channel"
                    : "Connect YouTube channel"}
              </button>
              <button
                className="text-button"
                disabled={busy || connecting}
                onClick={() => setReplaceSetup((value) => !value)}
              >
                {replaceSetup ? "Keep current setup" : "Change Google client"}
              </button>
            </div>
          )}
          {authorizationUrl && (
            <p className="help-text">
              Finish sign-in in the Google tab, then return here. If it did not
              open,{" "}
              <a
                href={authorizationUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                continue to Google <ArrowUpRight size={14} />
              </a>
              .{" "}
              <button
                className="text-button"
                onClick={() => {
                  setConnecting(false);
                  void refresh();
                }}
              >
                I’m back, refresh
              </button>
            </p>
          )}
          {(!connection.configured || replaceSetup) && (
            <div className="youtube-client-setup">
              <p>
                One-time setup: create a Google OAuth client for this local app.
                Your existing YouTube API key is only for discovery; posting
                needs your channel’s permission.
              </p>
              <details open={!connection.configured}>
                <summary>Get your Google client file</summary>
                <ol>
                  <li>
                    Open{" "}
                    <a
                      href="https://console.cloud.google.com/apis/library/youtube.googleapis.com"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Google Cloud Console
                    </a>
                    , choose or create a project, and enable{" "}
                    <strong>YouTube Data API v3</strong>.
                  </li>
                  <li>
                    Open <strong>Google Auth Platform</strong>. Complete
                    Branding and Audience. For personal testing, add your Google
                    email under Test users.
                  </li>
                  <li>
                    In Data Access, add the <code>youtube.upload</code> and{" "}
                    <code>youtube.readonly</code> scopes.
                  </li>
                  <li>
                    In Clients, create an OAuth client with application type{" "}
                    <strong>Desktop app</strong>. Download its JSON file.
                  </li>
                  <li>
                    Choose that file below, save setup, then connect your
                    channel. Choose the intended channel on Google’s
                    account/channel screen.
                  </li>
                </ol>
              </details>
              <label className="field">
                Google Desktop client JSON
                <input
                  type="file"
                  accept=".json,application/json"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void importClient(file);
                    event.target.value = "";
                  }}
                />
              </label>
              <details>
                <summary>Or enter client details manually</summary>
                <label className="field">
                  Google client ID
                  <input
                    value={clientId}
                    autoComplete="off"
                    onChange={(event) => setClientId(event.target.value)}
                  />
                </label>
                <label className="field">
                  Google client secret
                  <input
                    type="password"
                    value={clientSecret}
                    autoComplete="new-password"
                    onChange={(event) => setClientSecret(event.target.value)}
                  />
                </label>
              </details>
              {clientId && (
                <p className="help-text">Client details are ready to save.</p>
              )}
              {replaceSetup && connection.channels.length > 0 && (
                <Notice kind="info">
                  Saving different client details disconnects the channels
                  above. Connect them again with the new client.
                </Notice>
              )}
              <button
                className="button primary"
                disabled={busy || !clientId.trim() || !clientSecret.trim()}
                onClick={() => void save()}
              >
                {busy && (
                  <LoaderCircle className="spin" size={16} aria-hidden="true" />
                )}{" "}
                Save YouTube setup
              </button>
            </div>
          )}
          <p className="help-text">
            Credentials stay on this machine. Uploading starts only after you
            review a post and choose Publish. Disconnect removes the local
            connection; you can also revoke access in{" "}
            <a
              href="https://myaccount.google.com/connections"
              target="_blank"
              rel="noreferrer"
            >
              your Google account
            </a>
            .
          </p>
        </>
      )}
    </section>
  );
}
