import { all, first, INSTAGRAM, joined, visible } from "./selectors";
import { countFromLabeledValue, detectCredit, parseCount } from "./parsers";
import { candidateIdFromUrl, canonicalSourceUrl } from "./sources";
import type { Candidate } from "./types";

const text = (node: Element | null): string =>
  (node as HTMLElement | null)?.innerText?.trim() || "";
function onScreen(node: HTMLElement): boolean {
  if (!visible(node)) return false;
  const rect = node.getBoundingClientRect();
  return (
    rect.bottom > 0 &&
    rect.top < innerHeight &&
    rect.right > 0 &&
    rect.left < innerWidth
  );
}
/** How much of this element the viewer can actually see. */
function visibleArea(node: HTMLElement): number {
  const rect = node.getBoundingClientRect();
  return (
    Math.max(0, Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top)) *
    Math.max(0, Math.min(innerWidth, rect.right) - Math.max(0, rect.left))
  );
}
/** Read only the visible player, never an adjacent preloaded Reel. */
export function activeInstagramReel(): HTMLElement | null {
  // Measure each video once. getBoundingClientRect() makes the browser lay the
  // page out, so measuring inside the sort comparator repeats that work on every
  // comparison instead of once per video.
  const video = all(document, INSTAGRAM.video)
    .filter(onScreen)
    .map((node) => ({ node, area: visibleArea(node) }))
    .sort((a, b) => b.area - a.area)[0]?.node;
  if (!video) return null;
  const article = video.closest<HTMLElement>(joined(INSTAGRAM.reelRoot));
  if (article) return article;
  // The scrolling viewer also renders without <article>. Stop at the first
  // player container with its author and action rail instead of reading the feed.
  const main = joined(INSTAGRAM.main);
  let node = video.parentElement;
  while (node && node !== document.body && !node.matches(main)) {
    if (all(node, INSTAGRAM.video).filter(onScreen).length > 1) break;
    if (
      first(node, INSTAGRAM.channel) &&
      (first(node, INSTAGRAM.likeIcon) || first(node, INSTAGRAM.likeControl))
    )
      return node;
    node = node.parentElement;
  }
  return null;
}
/** Built once per kind. labeledStat runs against every candidate label and span on
 * the page, so compiling these from a template string each time is wasted work.
 * This only decides *whether* a string is purely a statistic; parsing the number is
 * countFromLabeledValue's job, so the two can never disagree about a count. */
const STAT_SHAPE = {
  likes: /^(?:[\d., KMB]+\s*likes?|likes?\s*[:：]?\s*[\d., KMB]+)$/i,
  views:
    /^(?:[\d., KMB]+\s*(?:views?|plays?)|(?:views?|plays?)\s*[:：]?\s*[\d., KMB]+)$/i,
} as const;
function labeledStat(value: string, kind: "likes" | "views"): number | null {
  if (/hidden|unavailable/i.test(value)) return null;
  const clean = value.trim().replace(/\s+/g, " ");
  // Do not extract a count from a caption sentence, date or comment.
  if (!STAT_SHAPE[kind].test(clean)) return null;
  // Instagram calls a Reel's views "plays".
  return countFromLabeledValue(clean.replace(/plays?/i, "views"), kind);
}
/** A bare number carrying no label at all. Like STAT_SHAPE above, both of these
 * only decide *whether* a string is nothing but a number; parseCount does the
 * actual reading, so neither can disagree with the shared parser about a value.
 *
 * They differ in one deliberate way. The action rail prints a compact value like
 * "6.2K" with nothing around it, so the rail pattern allows no ordinary space: a
 * rail span that merged two statistics ("12,400 1,204") would otherwise be handed
 * to parseCount as if it were one number. A profile tile can split its number
 * across whitespace, so only the tile pattern tolerates that.
 *
 * Both accept U+00A0, U+202F and U+2009 - the no-break, narrow no-break and thin
 * spaces that localized pages use as thousands separators. Those always sit inside
 * one number and never between two, which is why even the strict rail pattern can
 * allow them, and why "12<U+00A0>400" has to read as 12400 rather than 12. */
const BARE_COUNT = /^[\d.,\u00a0\u202f\u2009]+[KMB]?$/i;
const BARE_COUNT_WRAPPED = /^[\d.,\s]+[KMB]?$/i;
/** Instagram ships this Reel's own Relay payload as an inline JSON script. It holds
 * the exact like_count and, for a signed-in viewer, play_count -- the two numbers
 * the DOM refuses to show. Reading it is the only source that yields views. */
interface InstagramMediaPayload {
  like_count?: number;
  like_and_view_counts_disabled?: boolean;
  play_count?: number;
  video_view_count?: number;
  view_count?: number;
  display_url?: string;
  thumbnail_src?: string;
  image_versions2?: {
    candidates?: { url?: string; width?: number; height?: number }[];
  };
}
function* mediaInPayload(
  node: unknown,
  shortcode: string,
  depth = 0,
): Generator<InstagramMediaPayload> {
  if (depth > 40 || !node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const value of node)
      yield* mediaInPayload(value, shortcode, depth + 1);
    return;
  }
  const record = node as Record<string, unknown>;
  if (record.code === shortcode || record.shortcode === shortcode)
    yield record as InstagramMediaPayload;
  for (const value of Object.values(record))
    yield* mediaInPayload(value, shortcode, depth + 1);
}
function* instagramPayloadMedia(
  shortcode: string,
  cache = new Map<HTMLElement, unknown>(),
): Generator<InstagramMediaPayload> {
  if (!shortcode) return;
  for (const script of all(document, INSTAGRAM.payload)) {
    const raw = script.textContent || "";
    if (!raw.includes(shortcode)) continue;
    if (!cache.has(script)) {
      try {
        cache.set(script, JSON.parse(raw));
      } catch {
        continue;
      }
    }
    yield* mediaInPayload(cache.get(script), shortcode);
  }
}
export function instagramPayloadCounts(
  shortcode: string,
  payload: Iterable<InstagramMediaPayload> = instagramPayloadMedia(shortcode),
): {
  likes: number | null;
  views: number | null;
} {
  for (const media of payload) {
    // A creator can switch counts off; that is unknown, never zero.
    if (media.like_and_view_counts_disabled === true)
      return { likes: null, views: null };
    const views = [
      media.play_count,
      media.video_view_count,
      media.view_count,
    ].find((value) => typeof value === "number");
    if (typeof media.like_count === "number" || typeof views === "number") {
      return {
        likes: media.like_count ?? null,
        views: typeof views === "number" ? views : null,
      };
    }
  }
  return { likes: null, views: null };
}

/** Read the matching Reel's cover, even when Instagram omits video.poster. */
export function instagramThumbnail(
  root: HTMLElement,
  shortcode = "",
  payload: Iterable<InstagramMediaPayload> = instagramPayloadMedia(shortcode),
): string {
  const video = first(root, INSTAGRAM.video) as HTMLVideoElement | null;
  if (video?.poster) return video.poster;
  for (const media of payload) {
    const candidates = media.image_versions2?.candidates;
    const cover = (Array.isArray(candidates) ? [...candidates] : [])
      .filter((image) => image && typeof image.url === "string")
      .sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url;
    if (cover || media.display_url || media.thumbnail_src)
      return cover || media.display_url || media.thumbnail_src || "";
  }
  // Profile tiles and player covers use real img elements. Exclude tiny avatars.
  const images = all(root, INSTAGRAM.coverImage) as HTMLImageElement[];
  const cover = images
    .filter((image) => image.width >= 100 && image.height >= 100)
    .sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (cover?.currentSrc || cover?.src) return cover.currentSrc || cover.src;
  // Document metadata can be stale when the scrolling viewer changes Reels.
  const canonical = document.querySelector<HTMLLinkElement>(
    INSTAGRAM.canonical[0],
  );
  if (
    shortcode &&
    canonical &&
    candidateIdFromUrl(canonical.href) === `ig:${shortcode}`
  ) {
    return (
      document.querySelector<HTMLMetaElement>(INSTAGRAM.openGraphImage[0])
        ?.content || ""
    );
  }
  return "";
}
/** The caption is the longest dir=auto block that has element children: Instagram
 * wraps the caption together with its "more" expander. Comment bodies are bare text
 * and author names sit inside a link, so neither can win this comparison. */
function caption(root: HTMLElement): HTMLElement | null {
  const heading = first(root, INSTAGRAM.captionHeading);
  if (heading && text(heading)) return heading;
  const controls = joined(INSTAGRAM.controls);
  const links = joined(INSTAGRAM.link);
  let best: HTMLElement | null = null;
  let bestLength = 0;
  for (const node of all(root, INSTAGRAM.caption)) {
    if (!visible(node) || !node.children.length) continue;
    if (node.closest(controls) || node.closest(links)) continue;
    // innerText makes the browser lay the page out, so read each candidate once
    // instead of re-reading the current best on every comparison.
    const length = text(node).length;
    if (!best || length > bestLength) {
      best = node;
      bestLength = length;
    }
  }
  return best;
}
/** Instagram leads the caption block with the account name and a relative date.
 * Drop those lines so the title is the caption rather than the author. */
function captionTitle(description: string, handle: string): string {
  const bare = handle.replace(/^@/, "").toLowerCase();
  for (const line of description.split("\n")) {
    const value = line.trim();
    if (!value) continue;
    if (bare && value.toLowerCase().replace(/^@/, "") === bare) continue;
    if (/^\d+\s*(?:s|m|h|d|w|mo|y)\.?$/i.test(value)) continue;
    return value.slice(0, 200);
  }
  return "";
}
/** A video statistic is never inside a comment row or the action rail: both carry
 * their own "N likes" text, and Instagram no longer wraps comments in a <ul>. A
 * profile tile has no comments, so only the rail is excluded there. */
function statNodes(root: HTMLElement, { comments = true } = {}): HTMLElement[] {
  const captionNode = caption(root);
  const commentRow = joined(INSTAGRAM.commentRow);
  const rail = joined(INSTAGRAM.rail);
  return [
    ...all(root, INSTAGRAM.stats),
    ...all(root, INSTAGRAM.statText),
  ].filter(
    (node) =>
      visible(node) &&
      !captionNode?.contains(node) &&
      !(comments && node.closest(commentRow)) &&
      !node.closest(rail),
  );
}
/** Instagram renders each rail action as [icon control][count span] inside one
 * <section> and gives the count no label at all. Read the number that sits
 * immediately beside the icon, and stay unknown rather than sliding onto the
 * comment count that follows it. */
function countBeside(icon: Element): number | null {
  const rail = icon.closest<HTMLElement>(joined(INSTAGRAM.rail));
  if (!rail) return null;
  const counts = joined(INSTAGRAM.railCount);
  for (
    let node = icon.parentElement;
    node && node !== rail;
    node = node.parentElement
  ) {
    const next = node.nextElementSibling;
    if (!next?.matches(counts)) continue;
    const value = text(next);
    if (/hidden|unavailable/i.test(value)) return null;
    return BARE_COUNT.test(value) ? parseCount(value) : null;
  }
  return null;
}
/** Only an explicit "N likes"/"N views" label is trusted; a bare number elsewhere
 * could be a comment, a timestamp or a caption. */
function readLabeled(
  nodes: HTMLElement[],
  kind: "likes" | "views",
): number | null {
  for (const node of nodes) {
    for (const value of [node.getAttribute("aria-label") || "", text(node)]) {
      const count = labeledStat(value, kind);
      if (count !== null) return count;
    }
  }
  return null;
}
export function instagramCounts(root: HTMLElement): {
  likes: number | null;
  views: number | null;
} {
  let likes: number | null = null;
  for (const icon of all(root, INSTAGRAM.likeIcon).filter(visible)) {
    likes = countBeside(icon);
    if (likes !== null) break;
  }
  // Collect the candidate nodes once; both numbers come from the same shortlist.
  const stats = statNodes(root);
  return {
    likes: likes ?? readLabeled(stats, "likes"),
    views: readLabeled(stats, "views"),
  };
}
/** Profile tiles may be the only place Instagram exposes a Reel's views: it renders
 * no view count on the Reel page itself. Fail closed when the tile shows none. */
export function instagramTileViews(tile: HTMLElement): number | null {
  const labeled = readLabeled(statNodes(tile, { comments: false }), "views");
  if (labeled !== null) return labeled;
  for (const icon of all(tile, INSTAGRAM.viewIcon).filter(visible)) {
    const region = icon.parentElement;
    if (!region) continue;
    for (const node of all(region, INSTAGRAM.statText).filter(visible)) {
      const value = text(node);
      if (BARE_COUNT_WRAPPED.test(value)) return parseCount(value);
    }
  }
  return null;
}
function author(root: HTMLElement): { name: string; handle: string } {
  for (const selector of INSTAGRAM.channel) {
    for (const link of all(root, [selector]).filter(visible)) {
      const value = new URL(link.getAttribute("href") || "", location.origin);
      try {
        const source = canonicalSourceUrl(value.href);
        if (!source.startsWith("https://www.instagram.com/")) continue;
        const handle = new URL(source).pathname.split("/")[1];
        const label = text(link).replace(/^@/, "");
        if (
          label &&
          (label.toLowerCase() === handle || selector.startsWith("header"))
        )
          return { name: label, handle: `@${handle}` };
      } catch {
        /* A hashtag, audio or post link is not an author account. */
      }
    }
  }
  return { name: "", handle: "" };
}
export function instagramReelId(root: HTMLElement | null): string | null {
  const routeId = candidateIdFromUrl(location.href);
  if (routeId?.startsWith("ig:")) return routeId;
  if (!root) return null;
  const ids = new Set(
    all(root, INSTAGRAM.permalink)
      .filter(visible)
      .map((link) =>
        candidateIdFromUrl(
          new URL(link.getAttribute("href") || "", location.origin).href,
        ),
      )
      .filter((id): id is string => Boolean(id?.startsWith("ig:"))),
  );
  // Multiple permalinks are ambiguous: never take an adjacent recommendation.
  return ids.size === 1 ? [...ids][0] : null;
}
export function readInstagramClip(
  root = activeInstagramReel(),
  gridViews?: number,
  gridThumbnail?: string,
): Candidate {
  const id = instagramReelId(root);
  if (!root || !id?.startsWith("ig:"))
    throw new Error(
      "Could not read the active Instagram Reel. Open a Reel, let it load, and run Self-test.",
    );
  const account = author(root);
  const description = text(caption(root));
  const title = captionTitle(description, account.handle);
  const credit = detectCredit(description, account.handle);
  // Exact counts from the page's own payload first; the rail only fills the gap.
  const payloadCache = new Map<HTMLElement, unknown>();
  const payload = instagramPayloadCounts(
    id.slice(3),
    instagramPayloadMedia(id.slice(3), payloadCache),
  );
  const dom =
    payload.likes == null || payload.views == null
      ? instagramCounts(root)
      : { likes: null, views: null };
  return {
    video_id: id,
    url: `https://www.instagram.com/reel/${id.slice(3)}/`,
    title,
    channel_name: account.name,
    channel_handle: account.handle,
    description,
    likes: payload.likes ?? dom.likes,
    views: payload.views ?? dom.views ?? gridViews ?? null,
    credit_target: credit?.target || "",
    credit_snippet: credit?.snippet || "",
    thumbnail_url:
      instagramThumbnail(
        root,
        id.slice(3),
        instagramPayloadMedia(id.slice(3), payloadCache),
      ) ||
      gridThumbnail ||
      "",
  };
}
