import { all, first, INSTAGRAM, visible } from './selectors';
import { countFromLabel, detectCredit, parseCount } from './parsers';
import { candidateIdFromUrl, canonicalSourceUrl } from './sources';
import type { Candidate } from './types';

const text = (node: Element | null): string => (node as HTMLElement | null)?.innerText?.trim() || '';
function onScreen(node: HTMLElement): boolean {
  if (!visible(node)) return false;
  const rect = node.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
}
/** Read only the visible player, never an adjacent preloaded Reel. */
export function activeInstagramReel(): HTMLElement | null {
  const videos = all(document, INSTAGRAM.video).filter(onScreen).sort((a, b) => {
    const area = (node: HTMLElement) => {
      const rect = node.getBoundingClientRect();
      return Math.max(0, Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top))
        * Math.max(0, Math.min(innerWidth, rect.right) - Math.max(0, rect.left));
    };
    return area(b) - area(a);
  });
  const video = videos[0];
  if (!video) return null;
  const article = video.closest<HTMLElement>(INSTAGRAM.reelRoot.join(','));
  if (article) return article;
  // The scrolling viewer also renders without <article>. Stop at the first
  // player container with its author and action rail instead of reading the feed.
  let node = video.parentElement;
  while (node && node !== document.body && !node.matches(INSTAGRAM.main.join(','))) {
    if (all(node, INSTAGRAM.video).filter(onScreen).length > 1) break;
    if (first(node, INSTAGRAM.channel) && (first(node, INSTAGRAM.likeIcon) || first(node, INSTAGRAM.likeControl))) return node;
    node = node.parentElement;
  }
  return null;
}
function labeledStat(value: string, kind: 'likes' | 'views'): number | null {
  if (/hidden|unavailable/i.test(value)) return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  const label = kind === 'likes' ? 'likes?' : '(?:views?|plays?)';
  // Do not extract a count from a caption sentence, date or comment.
  if (!new RegExp(`^(?:[\\d., KMB]+\\s*${label}|${label}\\s*[:：]?\\s*[\\d., KMB]+)$`, 'i').test(clean)) return null;
  const normalized = clean.replace(/plays?/i, 'views');
  return countFromLabel(normalized, kind) ?? parseCount(normalized.replace(new RegExp(`^${label}\\s*[:：]?\\s*`, 'i'), ''));
}
/** Instagram ships this Reel's own Relay payload as an inline JSON script. It holds
 * the exact like_count and, for a signed-in viewer, play_count -- the two numbers
 * the DOM refuses to show. Reading it is the only source that yields views. */
interface InstagramMediaPayload {
  like_count: number;
  like_and_view_counts_disabled?: boolean;
  play_count?: number;
  video_view_count?: number;
  view_count?: number;
}
function mediaInPayload(node: unknown, shortcode: string, depth = 0): InstagramMediaPayload | null {
  if (depth > 40 || !node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const value of node) {
      const hit = mediaInPayload(value, shortcode, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  const record = node as Record<string, unknown>;
  if (record.code === shortcode && typeof record.like_count === 'number') return record as unknown as InstagramMediaPayload;
  for (const value of Object.values(record)) {
    const hit = mediaInPayload(value, shortcode, depth + 1);
    if (hit) return hit;
  }
  return null;
}
export function instagramPayloadCounts(shortcode: string): { likes: number | null; views: number | null } {
  if (!shortcode) return { likes: null, views: null };
  for (const script of all(document, INSTAGRAM.payload)) {
    const raw = script.textContent || '';
    if (!raw.includes('like_count')) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { continue; }
    const media = mediaInPayload(parsed, shortcode);
    if (!media) continue;
    // A creator can switch counts off; that is unknown, never zero.
    if (media.like_and_view_counts_disabled === true) return { likes: null, views: null };
    const views = [media.play_count, media.video_view_count, media.view_count].find(value => typeof value === 'number');
    return { likes: media.like_count, views: typeof views === 'number' ? views : null };
  }
  return { likes: null, views: null };
}
/** The caption is the longest dir=auto block that has element children: Instagram
 * wraps the caption together with its "more" expander. Comment bodies are bare text
 * and author names sit inside a link, so neither can win this comparison. */
function caption(root: HTMLElement): HTMLElement | null {
  const heading = first(root, INSTAGRAM.captionHeading);
  if (heading && text(heading)) return heading;
  let best: HTMLElement | null = null;
  for (const node of all(root, INSTAGRAM.caption)) {
    if (!visible(node) || !node.children.length) continue;
    if (node.closest(INSTAGRAM.controls.join(',')) || node.closest('a[href]')) continue;
    if (!best || text(node).length > text(best).length) best = node;
  }
  return best;
}
/** Instagram leads the caption block with the account name and a relative date.
 * Drop those lines so the title is the caption rather than the author. */
function captionTitle(description: string, handle: string): string {
  const bare = handle.replace(/^@/, '').toLowerCase();
  for (const line of description.split('\n')) {
    const value = line.trim();
    if (!value) continue;
    if (bare && value.toLowerCase().replace(/^@/, '') === bare) continue;
    if (/^\d+\s*(?:s|m|h|d|w|mo|y)\.?$/i.test(value)) continue;
    return value.slice(0, 200);
  }
  return '';
}
/** A video statistic is never inside a comment row or the action rail: both carry
 * their own "N likes" text, and Instagram no longer wraps comments in a <ul>. A
 * profile tile has no comments, so only the rail is excluded there. */
function statFilter(root: HTMLElement, { comments = true } = {}) {
  const captionNode = caption(root);
  return (node: HTMLElement) => visible(node)
    && !captionNode?.contains(node)
    && !(comments && node.closest(INSTAGRAM.commentRow.join(',')))
    && !node.closest(INSTAGRAM.rail.join(','));
}
/** Instagram renders each rail action as [icon control][count span] inside one
 * <section> and gives the count no label at all. Read the number that sits
 * immediately beside the icon, and stay unknown rather than sliding onto the
 * comment count that follows it. */
function countBeside(icon: Element): number | null {
  const rail = icon.closest<HTMLElement>(INSTAGRAM.rail.join(','));
  if (!rail) return null;
  for (let node = icon.parentElement; node && node !== rail; node = node.parentElement) {
    const next = node.nextElementSibling;
    if (!next?.matches(INSTAGRAM.railCount.join(','))) continue;
    const value = text(next);
    if (/hidden|unavailable/i.test(value)) return null;
    return /^[\d.,]+[KMB]?$/i.test(value) ? parseCount(value) : null;
  }
  return null;
}
/** Only an explicit "N likes"/"N views" label is trusted; a bare number elsewhere
 * could be a comment, a timestamp or a caption. */
function readLabeled(root: HTMLElement, kind: 'likes' | 'views', options?: { comments?: boolean }): number | null {
  const isStat = statFilter(root, options);
  for (const node of [...all(root, INSTAGRAM.stats), ...all(root, INSTAGRAM.statText)]) {
    if (!isStat(node)) continue;
    for (const value of [node.getAttribute('aria-label') || '', text(node)]) {
      const count = labeledStat(value, kind);
      if (count !== null) return count;
    }
  }
  return null;
}
export function instagramCounts(root: HTMLElement): { likes: number | null; views: number | null } {
  let likes: number | null = null;
  for (const icon of all(root, INSTAGRAM.likeIcon).filter(visible)) {
    likes = countBeside(icon);
    if (likes !== null) break;
  }
  return { likes: likes ?? readLabeled(root, 'likes'), views: readLabeled(root, 'views') };
}
/** Profile tiles may be the only place Instagram exposes a Reel's views: it renders
 * no view count on the Reel page itself. Fail closed when the tile shows none. */
export function instagramTileViews(tile: HTMLElement): number | null {
  const labeled = readLabeled(tile, 'views', { comments: false });
  if (labeled !== null) return labeled;
  for (const icon of all(tile, INSTAGRAM.viewIcon).filter(visible)) {
    const region = icon.parentElement;
    if (!region) continue;
    for (const node of all(region, INSTAGRAM.statText).filter(visible)) {
      const value = text(node);
      if (/^[\d.,\s]+[KMB]?$/i.test(value)) return parseCount(value);
    }
  }
  return null;
}
function author(root: HTMLElement): { name: string; handle: string } {
  for (const selector of INSTAGRAM.channel) {
    for (const link of all(root, [selector]).filter(visible)) {
      const value = new URL(link.getAttribute('href') || '', location.origin);
      try {
        const source = canonicalSourceUrl(value.href);
        if (!source.startsWith('https://www.instagram.com/')) continue;
        const handle = new URL(source).pathname.split('/')[1];
        const label = text(link).replace(/^@/, '');
        if (label && (label.toLowerCase() === handle || selector.startsWith('header'))) return { name: label, handle: `@${handle}` };
      } catch { /* A hashtag, audio or post link is not an author account. */ }
    }
  }
  return { name: '', handle: '' };
}
export function instagramReelId(root: HTMLElement | null): string | null {
  const routeId = candidateIdFromUrl(location.href);
  if (routeId?.startsWith('ig:')) return routeId;
  if (!root) return null;
  const ids = new Set(all(root, INSTAGRAM.permalink).filter(visible).map(link =>
    candidateIdFromUrl(new URL(link.getAttribute('href') || '', location.origin).href))
    .filter((id): id is string => Boolean(id?.startsWith('ig:'))));
  // Multiple permalinks are ambiguous: never take an adjacent recommendation.
  return ids.size === 1 ? [...ids][0] : null;
}
export function readInstagramClip(root = activeInstagramReel(), gridViews?: number): Candidate {
  const id = instagramReelId(root);
  if (!root || !id?.startsWith('ig:')) throw new Error('Could not read the active Instagram Reel. Open a Reel, let it load, and run Self-test.');
  const account = author(root);
  const description = text(caption(root));
  const title = captionTitle(description, account.handle);
  const credit = detectCredit(description, account.handle);
  // Exact counts from the page's own payload first; the rail only fills the gap.
  const payload = instagramPayloadCounts(id.slice(3));
  const dom = instagramCounts(root);
  const video = first(root, INSTAGRAM.video) as HTMLVideoElement | null;
  return {
    video_id: id, url: `https://www.instagram.com/reel/${id.slice(3)}/`, title,
    channel_name: account.name, channel_handle: account.handle, description,
    likes: payload.likes ?? dom.likes,
    views: payload.views ?? dom.views ?? gridViews ?? null,
    credit_target: credit?.target || '', credit_snippet: credit?.snippet || '',
    thumbnail_url: video?.poster || '',
  };
}
