import {
  ArrowRight,
  AudioLines,
  Check,
  LoaderCircle,
  Mic2,
  Plus,
  Settings2,
  Trash2,
  Volume2,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { Clip, Voice } from "../api";
import { api, useJob } from "../api";
import { ClipSelect, IconButton, JobProgress, Modal, Notice } from "../ui";
import { AudioPreview } from "./AudioPreview";
export function VoicePage({
  clips,
  selected,
  onSelect,
  onSettings,
}: {
  clips: Clip[];
  selected: string;
  onSelect: (id: string) => void;
  onSettings: () => void;
}) {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [providers, setProviders] = useState<
    { id: string; name: string; available: boolean; note: string }[]
  >([]);
  const [voice, setVoice] = useState("");
  const [text, setText] = useState("");
  const [original, setOriginal] = useState("");
  const [generating, setGenerating] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [pitch, setPitch] = useState(0);
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState("");
  const [audio, setAudio] = useState("");
  const load = () =>
    api<{ voices: Voice[]; providers: typeof providers }>("/voices")
      .then((d) => {
        setVoices(d.voices);
        setProviders(d.providers);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (selected)
      api<Clip>(`/clips/${selected}`)
        .then((c) => {
          setOriginal(c.script?.original_text || c.transcript?.text || "");
          setText(
            c.script?.rewritten_text ||
              c.script?.original_text ||
              c.transcript?.text ||
              "",
          );
          const asset = c.assets?.filter((a) => a.kind === "voiceover").at(-1);
          setAudio(asset?.url || "");
        })
        .catch((e) => setError(e.message));
  }, [selected]);
  const job = useJob(() => {
    if (selected)
      api<Clip>(`/clips/${selected}`)
        .then((c) =>
          setAudio(
            c.assets?.filter((a) => a.kind === "voiceover").at(-1)?.url || "",
          ),
        )
        .catch((e) => setError(e.message));
    load();
  }, selected);
  const current = voices.find((v) => v.id === voice);
  const generate = async () => {
    if (!current) return;
    setGenerating(true);
    setError("");
    try {
      await api(`/scripts/${selected}`, {
        method: "PUT",
        body: JSON.stringify({ original_text: original, rewritten_text: text }),
      });
      await job.start("/tts", {
        clip_id: selected,
        text,
        provider: current.provider,
        voice_id: voice,
        speed,
        pitch: current.provider === "edge" ? pitch : 0,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Give your stories a voice.</h1>
          <p>Find your sound. Save a voice. Make every word feel like you.</p>
        </div>
        <button className="button primary" onClick={() => setCloning(true)}>
          <Plus size={18} /> Add your voice
        </button>
      </div>
      <div className="voice-intro">
        <div className="voice-art" aria-hidden="true">
          {[
            12, 22, 35, 52, 30, 65, 45, 78, 55, 35, 65, 90, 60, 38, 70, 48, 26,
            50, 30, 15, 25,
          ].map((h, i) => (
            <span style={{ height: h }} key={i} />
          ))}
        </div>
        <div>
          <h2>A familiar voice. A fresh story.</h2>
          <p>
            Save a short reference recording and reuse it for future voiceovers
            with a local Chatterbox model. Use your own voice or one you have
            permission to clone.
          </p>
          <button className="button secondary" onClick={() => setCloning(true)}>
            <Mic2 size={17} /> Create a voice profile <ArrowRight size={16} />
          </button>
        </div>
      </div>
      {(error || job.error) && <Notice>{error || job.error}</Notice>}
      <div className="voice-layout">
        <section>
          <div className="section-heading">
            <h2>Your voices</h2>
            <button className="text-button" onClick={onSettings}>
              Manage providers <Settings2 size={15} />
            </button>
          </div>
          <div className="voice-list">
            {voices.map((v) => (
              <div
                className={`voice-option ${voice === v.id ? "selected" : ""}`}
                key={v.id}
              >
                <button onClick={() => setVoice(v.id)}>
                  <span className="voice-avatar">
                    <AudioLines size={23} />
                  </span>
                  <span>
                    <strong>{v.name}</strong>
                    <small>{v.description}</small>
                    <span
                      className={`badge ${v.available ? "good" : "neutral"}`}
                    >
                      {v.available
                        ? "Ready"
                        : v.cloned
                          ? "Reference saved · model needed"
                          : "Setup needed"}
                    </span>
                  </span>
                  <span className="radio-mark">
                    {voice === v.id && <Check size={13} />}
                  </span>
                </button>
                {v.cloned && (
                  <IconButton
                    label={`Delete ${v.name} profile`}
                    onClick={async () => {
                      try {
                        await api(`/voices/${v.id}`, { method: "DELETE" });
                        if (voice === v.id) setVoice("");
                        load();
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    <Trash2 size={16} />
                  </IconButton>
                )}
              </div>
            ))}
            {!voices.length && (
              <div className="compact-empty">
                <Mic2 size={28} />
                <h3>Your sound starts here.</h3>
                <p>
                  Add a reference recording or configure a local voice in
                  Settings.
                </p>
              </div>
            )}
          </div>
          <details className="provider-notes">
            <summary>Provider availability and licenses</summary>
            {providers.map((p) => (
              <div key={p.id}>
                <strong>
                  {p.name} · {p.available ? "Available" : "Setup needed"}
                </strong>
                <p>{p.note}</p>
              </div>
            ))}
          </details>
        </section>
        <section className="section-card voice-generator">
          <h2>Let’s hear it.</h2>
          <ClipSelect clips={clips} value={selected} onChange={onSelect} />
          <label className="field">
            Voiceover script
            <textarea
              rows={7}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Choose a project or paste your script…"
            />
          </label>
          <label className="field range-label">
            Speed <output>{speed.toFixed(2)}×</output>
            <input
              type="range"
              min="0.9"
              max="1.1"
              step="0.01"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            />
          </label>
          {current?.provider === "edge" && (
            <label className="field range-label">
              Pitch{" "}
              <output>
                {pitch > 0 ? "+" : ""}
                {pitch} Hz
              </output>
              <input
                type="range"
                min="-10"
                max="10"
                value={pitch}
                onChange={(e) => setPitch(Number(e.target.value))}
              />
            </label>
          )}
          <button
            className="button primary full"
            disabled={
              !selected ||
              !text.trim() ||
              !current?.available ||
              job.busy ||
              generating
            }
            onClick={generate}
          >
            {job.busy ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <Volume2 size={17} />
            )}{" "}
            Generate voiceover
          </button>
          {!current?.available && (
            <p className="help-text">
              Choose a ready voice above, or finish provider setup in Settings.
            </p>
          )}
          <JobProgress job={job.job} />
          {audio && (
            <div className="audio-result">
              <strong>Your voiceover</strong>
              <AudioPreview src={audio} />
              <a href={audio} download className="inline-link">
                Download audio
              </a>
            </div>
          )}
        </section>
      </div>
      {cloning && (
        <CloneDialog
          onClose={() => setCloning(false)}
          onCreated={() => {
            load();
            setCloning(false);
          }}
        />
      )}
    </>
  );
}
function CloneDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [original, setOriginal] = useState("");
  const [generating, setGenerating] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("name", name);
      body.append("reference_text", text);
      body.append("consent", String(consent));
      await api("/voices/clone", { method: "POST", body });
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="A voice to call your own" onClose={onClose}>
      <p className="modal-description">
        Save a clean recording, 6–30 seconds and under 20 MB, without music. A
        profile saves your reference; synthesis needs the optional local model.
      </p>
      <label className="field">
        Voice name
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My storytelling voice"
        />
      </label>
      <label className="field">
        Reference recording
        <input
          type="file"
          accept="audio/wav,audio/mpeg,audio/mp4,audio/flac,audio/ogg,audio/webm"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
      </label>
      <label className="field">
        What is said in the recording? <span className="muted">(optional)</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
        />
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        This is my voice, or I have the speaker’s permission to clone and use
        it.
      </label>
      {error && <Notice>{error}</Notice>}
      <div className="modal-actions">
        <button className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          onClick={submit}
          disabled={busy || !name.trim() || !file || !consent}
        >
          {busy ? (
            <LoaderCircle size={17} className="spin" />
          ) : (
            <Mic2 size={17} />
          )}
          Save voice profile
        </button>
      </div>
    </Modal>
  );
}
