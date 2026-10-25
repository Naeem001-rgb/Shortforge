import { videoIdFromUrl } from "./parsers";

// KEEP IN LOCKSTEP WITH `engine/core/source_urls.py`.
//
// `candidateIdFromUrl` and `canonicalCandidateUrl` below decide a clip's identity
// and its canonical URL. The engine then decides those same two things again in
// Python, in `canonical_clip_url` (which calls `canonical_youtube_url` for YouTube
// links), and it rejects any clip whose URL and video_id disagree. A Chrome
// extension cannot call Python, so this one rule genuinely has to exist twice.
//
// What both sides must keep agreeing on:
//   - A YouTube identity is the bare 11-character video ID, and its canonical URL
//     is `https://www.youtube.com/shorts/{id}`.
//   - An Instagram identity is `ig:{shortcode}`. The `ig:` prefix is what keeps a
//     Reel shortcode from colliding with an identical YouTube ID, and its canonical
//     URL is `https://www.instagram.com/reel/{shortcode}/`.
//   - A query string, a fragment and a trailing slash are all ignored, so the same
//     video linked four different ways produces one identity.
// If you change which hosts, Reel shortcodes or video IDs are accepted here, make
// the matching change there (and the reverse), or Scout will collect videos the
// engine then refuses to save. The two sides have separate tests and share no
// fixture, so neither test suite will warn you.
//
// `canonicalSourceUrl` has no Python counterpart. An account's video grid is
// Scout's own idea: the engine only ever receives individual clips and has no
// source_url field at all, so there is nothing on the Python side to mirror.
//
// Four differences between the two files are deliberate, not drift:
//   - The engine also accepts `youtube.com/embed/{id}`, `youtube.com/live/{id}`,
//     `youtube.com/watch/` with a trailing slash, and `m.instagram.com`. Scout only
//     ever reads a `/shorts/` or `/reel/` page, and its manifest does not run on
//     `m.instagram.com`, so recognizing those here would be dead code.
//   - The engine allows a 1-64 character Reel shortcode; we require at least five,
//     so a short path segment cannot be mistaken for a Reel. Real ones are 11.
//   - We accept an account-prefixed Reel link (`instagram.com/creator/reel/CODE/`)
//     because that is the form a profile grid links to, while the engine does not.
//     That is safe because every clip we send is rebuilt from its identity into the
//     canonical URL above, so the engine never sees the prefixed form.
//   - Python keeps `youtu.be` in its YouTube host set; we leave it out of
//     YOUTUBE_HOSTS and handle it as its own case below, because a `youtu.be` link
//     is only ever a single video and can never be an account grid. The accepted
//     links and resulting IDs are the same either way.

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
]);
export const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com"]);
const RESERVED_ACCOUNTS = new Set([
  "accounts",
  "about",
  "api",
  "challenge",
  "developer",
  "direct",
  "directory",
  "emails",
  "explore",
  "legal",
  "oauth",
  "p",
  "privacy",
  "reel",
  "reels",
  "stories",
  "terms",
  "web",
]);
function parsed(value: string): URL | null {
  try {
    const url = new URL(
      value.includes("://") ? value.trim() : `https://${value.trim()}`,
    );
    return /^(https?:)$/.test(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.port
      ? url
      : null;
  } catch {
    return null;
  }
}
function instagramCode(url: URL): string | null {
  if (!INSTAGRAM_HOSTS.has(url.hostname)) return null;
  const match = url.pathname.match(
    /^\/(?:[A-Za-z0-9._]+\/)?reels?\/([A-Za-z0-9_-]{5,64})\/?$/,
  );
  return match?.[1] || null;
}
/** The source is always an account's video grid, never a feed or a single video. */
export function canonicalSourceUrl(value: string): string {
  if (!value.trim()) return "";
  const url = parsed(value);
  if (url && YOUTUBE_HOSTS.has(url.hostname)) {
    const path = url.pathname.replace(/\/$/, "");
    const match = path.match(
      /^(\/@[A-Za-z0-9_.-]+|\/channel\/UC[A-Za-z0-9_-]{22}|\/(?:c|user)\/[A-Za-z0-9_.-]+)(?:\/(?:shorts|videos|featured))?$/,
    );
    if (match) return `https://www.youtube.com${match[1]}/shorts`;
  }
  if (url && INSTAGRAM_HOSTS.has(url.hostname)) {
    const match = url.pathname.match(
      /^\/([A-Za-z0-9._]{1,30})(?:\/reels)?\/?$/,
    );
    if (match && !RESERVED_ACCOUNTS.has(match[1].toLowerCase()))
      return `https://www.instagram.com/${match[1].toLowerCase()}/reels/`;
  }
  throw new Error(
    "Paste a YouTube channel or Instagram account URL, such as youtube.com/@creator or instagram.com/creator.",
  );
}
export function candidateIdFromUrl(value: string): string | null {
  const url = parsed(value);
  if (!url) return null;
  const code = instagramCode(url);
  if (code) return `ig:${code}`;
  if (
    (YOUTUBE_HOSTS.has(url.hostname) &&
      /^(?:\/shorts\/[A-Za-z0-9_-]{11}\/?|\/watch)$/.test(url.pathname)) ||
    (url.hostname === "youtu.be" &&
      /^\/[A-Za-z0-9_-]{11}\/?$/.test(url.pathname))
  )
    return videoIdFromUrl(url.href);
  return null;
}
/** Routes the content script can read or use as an account grid. */
export function isScoutUrl(value: string): boolean {
  const url = parsed(value);
  if (!url) return false;
  if (
    INSTAGRAM_HOSTS.has(url.hostname) &&
    (instagramCode(url) || /^\/reels\/?$/.test(url.pathname))
  )
    return true;
  if (
    YOUTUBE_HOSTS.has(url.hostname) &&
    /^\/shorts\/[A-Za-z0-9_-]{11}\/?$/.test(url.pathname)
  )
    return true;
  try {
    return Boolean(canonicalSourceUrl(url.href));
  } catch {
    return false;
  }
}
export function canonicalCandidateUrl(value: string): string | null {
  const id = candidateIdFromUrl(value);
  return !id
    ? null
    : id.startsWith("ig:")
      ? `https://www.instagram.com/reel/${id.slice(3)}/`
      : `https://www.youtube.com/shorts/${id}`;
}
export interface AccountQueue {
  sourceUrl: string;
  sessionId: string;
  urls: string[];
  completed: string[];
  currentUrl: string | null;
  scrollY: number;
  exhausted: boolean;
  resolvedSourceUrl: string;
  landingChecked: boolean;
  // Instagram sometimes exposes views on the profile tile, but not in the player.
  views: Record<string, number>;
  thumbnails?: Record<string, string>;
}
export function createAccountQueue(
  sourceUrl: string,
  sessionId: string,
): AccountQueue {
  return {
    sourceUrl,
    sessionId,
    urls: [],
    completed: [],
    currentUrl: null,
    scrollY: 0,
    exhausted: false,
    views: {},
    thumbnails: {},
    resolvedSourceUrl: sourceUrl,
    landingChecked: false,
  };
}
/** A bounded queue is also the account session's allowlist. */
export function addAccountVideos(queue: AccountQueue, urls: string[]): void {
  const platform = new URL(queue.sourceUrl).hostname;
  for (const value of urls) {
    const url = canonicalCandidateUrl(value);
    if (!url || new URL(url).hostname !== platform || queue.urls.includes(url))
      continue;
    if (queue.urls.length >= 500) break;
    queue.urls.push(url);
  }
}
export function nextAccountVideo(queue: AccountQueue): string | null {
  return queue.urls.find((url) => !queue.completed.includes(url)) || null;
}
