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
export function instagramCounts(root: HTMLElement): { likes: number | null; views: number | null } {
  const descriptions = all(root, INSTAGRAM.description);
  const isStat = (node: HTMLElement) => visible(node)
    && !descriptions.some(description => description.contains(node))
    && !node.closest(INSTAGRAM.comments.join(','));
  const stats = all(root, INSTAGRAM.stats).filter(isStat);
  // Visible standalone stat labels also occur as ordinary spans. Exclude the
  // caption and social comments; a sentence with a number is not a video count.
  const spans = all(root, INSTAGRAM.statText).filter(isStat);
  const read = (kind: 'likes' | 'views') => {
    for (const node of [...stats, ...spans]) {
      for (const value of [node.getAttribute('aria-label') || '', text(node)]) {
        const valueCount = labeledStat(value, kind);
        if (valueCount !== null) return valueCount;
      }
    }
    return null;
  };
  let likes = read('likes');
  if (likes === null) {
    for (const icon of all(root, INSTAGRAM.likeIcon).filter(visible)) {
      const control = icon.closest<HTMLElement>(INSTAGRAM.controls.join(','));
      const rail = control?.parentElement;
      if (!rail || all(rail, INSTAGRAM.controls).length > 1) continue;
      for (const node of all(rail, INSTAGRAM.statText).filter(visible)) {
        const value = text(node);
        if (/^[\d.,\s]+[KMB]?$/i.test(value)) likes = parseCount(value);
        if (likes !== null) break;
      }
      if (likes !== null) break;
    }
  }
  return { likes, views: read('views') };
}
/** Profile tiles may be the only place Instagram exposes a Reel's views. */
export function instagramTileViews(tile: HTMLElement): number | null {
  const labeled = instagramCounts(tile).views;
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
  const description = text(first(root, INSTAGRAM.description));
  const title = text(first(root, INSTAGRAM.title)) || description.split('\n')[0].slice(0, 200);
  const credit = detectCredit(description, account.handle);
  const counts = instagramCounts(root);
  const video = first(root, INSTAGRAM.video) as HTMLVideoElement | null;
  return {
    video_id: id, url: `https://www.instagram.com/reel/${id.slice(3)}/`, title,
    channel_name: account.name, channel_handle: account.handle, description,
    likes: counts.likes, views: counts.views ?? gridViews ?? null,
    credit_target: credit?.target || '', credit_snippet: credit?.snippet || '',
    thumbnail_url: video?.poster || '',
  };
}
