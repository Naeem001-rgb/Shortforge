import {
  ArrowUpRight,
  FileText,
  LoaderCircle,
  WandSparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { Clip } from "../api";
import { api, post } from "../api";
import { ClipSelect, CopyButton, Notice } from "../ui";
type Pack = {
  titles: { title: string; reason: string; characters: number }[];
  description: string;
  tags: string[];
};
export function SEOPage({
  clips,
  selected,
  onSelect,
}: {
  clips: Clip[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [text, setText] = useState("");
  const [pack, setPack] = useState<Pack | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [exportUrl, setExportUrl] = useState("");
  useEffect(() => {
    setPack(null);
    setExportUrl("");
    if (selected)
      api<Clip>(`/clips/${selected}`)
        .then((c) => {
          setText(
            c.script?.rewritten_text ||
              c.script?.original_text ||
              c.transcript?.text ||
              "",
          );
          setExportUrl(
            c.assets?.filter((a) => a.kind === "export").at(-1)?.url || "",
          );
        })
        .catch((e) => setError(e.message));
  }, [selected]);
  const generate = async () => {
    setBusy(true);
    setError("");
    try {
      setPack(await post<Pack>("/seo", { clip_id: selected, text }));
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
          <h1>A great first impression.</h1>
          <p>
            The right words for the story you’ve made. Your publish kit, in one
            place.
          </p>
        </div>
        {exportUrl && (
          <a className="button secondary" href={exportUrl} download>
            Download your Short
          </a>
        )}
      </div>
      <div className="publish-layout">
        <section className="section-card">
          <h2>Start with your story</h2>
          <ClipSelect clips={clips} value={selected} onChange={onSelect} />
          <label className="field">
            Final script
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              placeholder="Choose a project with a saved script, or paste your final script."
            />
          </label>
          <button
            className="button primary full"
            onClick={generate}
            disabled={busy || !selected || !text.trim()}
          >
            {busy ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <WandSparkles size={17} />
            )}{" "}
            {busy ? "Finding the right words…" : "Generate publish kit"}
          </button>
          <p className="help-text">
            Uses your Gemini key. You review everything before uploading.
          </p>
          {error && <Notice>{error}</Notice>}
        </section>
        <section className="publish-output">
          {!pack ? (
            <div className="publish-empty">
              <div className="empty-tool-icon">
                <FileText size={36} strokeWidth={1.2} />
              </div>
              <h2>Give your story a good introduction.</h2>
              <p>
                Three title ideas, a ready-to-edit description, and relevant
                tags. Written from your final script.
              </p>
            </div>
          ) : (
            <>
              <h2>Find your opening line.</h2>
              {pack.titles.map((t, i) => (
                <article className="title-option" key={i}>
                  <div>
                    <span className="title-rank">TOP PICK {i + 1}</span>
                    <span className="muted">{t.characters} characters</span>
                  </div>
                  <h3>{t.title}</h3>
                  <p>{t.reason}</p>
                  <CopyButton text={t.title} label="Copy title" />
                </article>
              ))}
              <div className="section-card">
                <div className="section-heading">
                  <h3>Your description</h3>
                  <CopyButton text={pack.description} />
                </div>
                <textarea
                  aria-label="Video description"
                  value={pack.description}
                  onChange={(e) =>
                    setPack({ ...pack, description: e.target.value })
                  }
                  rows={7}
                />
              </div>
              <div className="section-card">
                <div className="section-heading">
                  <h3>Suggested tags</h3>
                  <CopyButton text={pack.tags.join(", ")} />
                </div>
                <div className="tags">
                  {pack.tags.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
              </div>
              <div className="publish-handoff">
                <div>
                  <strong>Ready when you are.</strong>
                  <p>
                    Download the MP4, copy your text, and upload it yourself.
                  </p>
                </div>
                <a
                  className="button primary"
                  href="https://studio.youtube.com/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open YouTube Studio <ArrowUpRight size={17} />
                </a>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
