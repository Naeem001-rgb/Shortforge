import { Check, Save } from "lucide-react";
import { useEffect, useState } from "react";
import type { Clip, Word } from "../api";
import { api } from "../api";
import { Notice } from "../ui";

export function TranscriptEditor({
  clip,
  onSaved,
}: {
  clip: Clip;
  onSaved: (text: string) => void;
}) {
  const [words, setWords] = useState<Word[]>(clip.transcript?.words || []);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setWords(clip.transcript?.words || []);
    setSaved(false);
  }, [clip.id, clip.transcript]);
  const change = (index: number, key: keyof Word, value: string) => {
    setSaved(false);
    setWords((items) =>
      items.map((word, i) =>
        i === index
          ? { ...word, [key]: key === "word" ? value : Number(value) }
          : word,
      ),
    );
  };
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const text = words.map((w) => w.word).join(" ");
      await api(`/clips/${clip.id}/transcript`, {
        method: "PUT",
        body: JSON.stringify({ text, words }),
      });
      onSaved(text);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  if (!words.length) return null;
  return (
    <details className="transcript-editor">
      <summary>Word timestamps · {words.length} words</summary>
      <p className="help-text">
        Times are in seconds in the source video. Edited captions use these
        timings when their text matches the transcript.
      </p>
      <div className="table-wrap" style={{ maxHeight: 300, marginTop: 14 }}>
        <table>
          <thead>
            <tr>
              <th>Word</th>
              <th>Start</th>
              <th>End</th>
            </tr>
          </thead>
          <tbody>
            {words.map((word, i) => (
              <tr key={i}>
                <td>
                  <input
                    style={{ width: "100%", minWidth: 80 }}
                    aria-label={`Word ${i + 1}`}
                    value={word.word}
                    onChange={(e) => change(i, "word", e.target.value)}
                  />
                </td>
                <td>
                  <input
                    style={{ width: 80 }}
                    aria-label={`Start time for word ${i + 1}`}
                    type="number"
                    min="0"
                    step=".01"
                    value={word.start}
                    onChange={(e) => change(i, "start", e.target.value)}
                  />
                </td>
                <td>
                  <input
                    style={{ width: 80 }}
                    aria-label={`End time for word ${i + 1}`}
                    type="number"
                    min="0"
                    step=".01"
                    value={word.end}
                    onChange={(e) => change(i, "end", e.target.value)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <Notice>{error}</Notice>}
      <button
        className="button secondary"
        style={{ marginTop: 14 }}
        onClick={save}
        disabled={saving}
      >
        {saved ? <Check size={16} /> : <Save size={16} />}{" "}
        {saved ? "Timestamps saved" : "Save timestamps"}
      </button>
    </details>
  );
}
