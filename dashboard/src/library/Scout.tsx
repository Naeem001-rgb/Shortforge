import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Compass,
  Link2,
  ScanLine,
  Settings2,
} from "lucide-react";
import { CopyButton } from "../ui";
export function ScoutPage({
  onImport,
  onSettings,
}: {
  onImport: () => void;
  onSettings: () => void;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>A little curiosity goes a long way.</h1>
          <p>
            Find promising Shorts while you browse. Bring the good ones home.
          </p>
        </div>
        <a
          className="button primary"
          href="https://www.youtube.com/shorts/"
          target="_blank"
          rel="noreferrer"
        >
          Open YouTube <ArrowUpRight size={17} />
        </a>
      </div>
      <div className="scout-feature">
        <div className="scout-mark">
          <Compass size={70} strokeWidth={1} />
        </div>
        <div>
          <h2>Your next story is a scroll away.</h2>
          <p>
            Scout lives in your browser. It reads a Short’s public details,
            checks your limits, and adds matches to this library.
          </p>
          <div className="scout-chips">
            <span>
              <Check size={14} /> Credits optional
            </span>
            <span>
              <Check size={14} /> Read-only browsing
            </span>
            <span>
              <Check size={14} /> No API key needed
            </span>
          </div>
        </div>
      </div>
      <div className="scout-columns">
        <section className="section-card">
          <h2>Connect Scout</h2>
          <ol className="setup-steps">
            <li>
              <span>1</span>
              <div>
                <strong>Start ShortForge</strong>
                <p>The startup script builds the extension for you.</p>
                <CopyButton text="./start.sh" label="Copy start command" />
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Open Chrome’s extensions page</strong>
                <p>
                  Type <code>chrome://extensions</code> in Chrome. Turn on
                  Developer mode.
                </p>
                <CopyButton text="chrome://extensions" label="Copy address" />
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Load the extension</strong>
                <p>
                  Click Load unpacked, then choose the{" "}
                  <code>extension/dist</code> folder inside ShortForge.
                </p>
              </div>
            </li>
            <li>
              <span>4</span>
              <div>
                <strong>Find your starting point</strong>
                <p>
                  Open any YouTube Short, click Scout’s extension icon, choose a
                  mode, and press Start.
                </p>
              </div>
            </li>
          </ol>
        </section>
        <section className="section-card">
          <h2>Choose how you discover</h2>
          <div className="feature-row">
            <ScanLine size={22} />
            <div>
              <h3>Narrated Shorts</h3>
              <p>
                Look for story, voiceover, and caption signals in the title and
                description. These are leads to review, not proof of an AI
                voice.
              </p>
            </div>
          </div>
          <div className="feature-row">
            <Link2 size={22} />
            <div>
              <h3>Credit-first, with a fallback</h3>
              <p>
                Auto mode looks for creator credits first. After 30 misses, it
                switches to narrated Shorts.
              </p>
            </div>
          </div>
          <div className="feature-row">
            <Settings2 size={22} />
            <div>
              <h3>Your pace. Your criteria.</h3>
              <p>
                Start with 5,000 likes, 10,000 views, and 30 matches. Adjust
                these in the extension popup.
              </p>
            </div>
          </div>
          <p className="muted">
            YouTube changes its layout. Run Scout’s Self-test if it stops
            finding videos.
          </p>
          <button className="button secondary" onClick={onImport}>
            Already have a link? Add it <ArrowRight size={16} />
          </button>
        </section>
      </div>
    </>
  );
}
