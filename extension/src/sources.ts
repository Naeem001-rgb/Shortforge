import { videoIdFromUrl } from './parsers';

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com']);
const RESERVED_ACCOUNTS = new Set(['accounts', 'about', 'api', 'challenge', 'developer', 'direct', 'directory', 'emails', 'explore', 'legal', 'oauth', 'p', 'privacy', 'reel', 'reels', 'stories', 'terms', 'web']);
function parsed(value: string): URL | null {
  try {
    const url = new URL(value.includes('://') ? value.trim() : `https://${value.trim()}`);
    return /^(https?:)$/.test(url.protocol) && !url.username && !url.password && !url.port ? url : null;
  } catch { return null; }
}
function instagramCode(url: URL): string | null {
  if (!INSTAGRAM_HOSTS.has(url.hostname)) return null;
  const match = url.pathname.match(/^\/(?:[A-Za-z0-9._]+\/)?reels?\/([A-Za-z0-9_-]{5,64})\/?$/);
  return match?.[1] || null;
}
/** The source is always an account's video grid, never a feed or a single video. */
export function canonicalSourceUrl(value: string): string {
  if (!value.trim()) return '';
  const url = parsed(value);
  if (url && YOUTUBE_HOSTS.has(url.hostname)) {
    const path = url.pathname.replace(/\/$/, '');
    const match = path.match(/^(\/@[A-Za-z0-9_.-]+|\/channel\/UC[A-Za-z0-9_-]{22}|\/(?:c|user)\/[A-Za-z0-9_.-]+)(?:\/(?:shorts|videos|featured))?$/);
    if (match) return `https://www.youtube.com${match[1]}/shorts`;
  }
  if (url && INSTAGRAM_HOSTS.has(url.hostname)) {
    const match = url.pathname.match(/^\/([A-Za-z0-9._]{1,30})(?:\/reels)?\/?$/);
    if (match && !RESERVED_ACCOUNTS.has(match[1].toLowerCase())) return `https://www.instagram.com/${match[1].toLowerCase()}/reels/`;
  }
  throw new Error('Paste a YouTube channel or Instagram account URL, such as youtube.com/@creator or instagram.com/creator.');
}
export function candidateIdFromUrl(value: string): string | null {
  const url = parsed(value);
  if (!url) return null;
  const code = instagramCode(url);
  if (code) return `ig:${code}`;
  if ((YOUTUBE_HOSTS.has(url.hostname) && /^(?:\/shorts\/[A-Za-z0-9_-]{11}\/?|\/watch)$/.test(url.pathname))
    || (url.hostname === 'youtu.be' && /^\/[A-Za-z0-9_-]{11}\/?$/.test(url.pathname))) return videoIdFromUrl(url.href);
  return null;
}
/** Routes the content script can read or use as an account grid. */
export function isScoutUrl(value: string): boolean {
  const url = parsed(value);
  if (!url) return false;
  if (INSTAGRAM_HOSTS.has(url.hostname) && (instagramCode(url) || /^\/reels\/?$/.test(url.pathname))) return true;
  if (YOUTUBE_HOSTS.has(url.hostname) && /^\/shorts\/[A-Za-z0-9_-]{11}\/?$/.test(url.pathname)) return true;
  try { return Boolean(canonicalSourceUrl(url.href)); } catch { return false; }
}
export function canonicalCandidateUrl(value: string): string | null {
  const id = candidateIdFromUrl(value);
  return !id ? null : id.startsWith('ig:') ? `https://www.instagram.com/reel/${id.slice(3)}/` : `https://www.youtube.com/shorts/${id}`;
}
export interface AccountQueue {
  sourceUrl: string; sessionId: string; urls: string[]; completed: string[];
  currentUrl: string | null; scrollY: number; exhausted: boolean;
  resolvedSourceUrl: string; landingChecked: boolean;
  // Instagram sometimes exposes views on the profile tile, but not in the player.
  views: Record<string, number>;
}
export function createAccountQueue(sourceUrl: string, sessionId: string): AccountQueue {
  return { sourceUrl, sessionId, urls: [], completed: [], currentUrl: null, scrollY: 0, exhausted: false, views: {}, resolvedSourceUrl: sourceUrl, landingChecked: false };
}
/** A bounded queue is also the account session's allowlist. */
export function addAccountVideos(queue: AccountQueue, urls: string[]): number {
  const before = queue.urls.length;
  const platform = new URL(queue.sourceUrl).hostname;
  for (const value of urls) {
    const url = canonicalCandidateUrl(value);
    if (!url || new URL(url).hostname !== platform || queue.urls.includes(url)) continue;
    if (queue.urls.length >= 500) break;
    queue.urls.push(url);
  }
  return queue.urls.length - before;
}
export function nextAccountVideo(queue: AccountQueue): string | null {
  return queue.urls.find(url => !queue.completed.includes(url)) || null;
}
