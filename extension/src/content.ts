import { activeShort, all, first, INSTAGRAM, SELECTORS, visible } from './selectors';
import { activeInstagramReel, instagramCounts, instagramReelId, instagramTileViews, readInstagramClip } from './instagram';
import { addAccountVideos, candidateIdFromUrl, canonicalCandidateUrl, canonicalSourceUrl, createAccountQueue, nextAccountVideo, type AccountQueue } from './sources';
import { countFromLabel, detectCredit, parseCount, videoIdFromUrl } from './parsers';
import type { Candidate, SelectorCheck } from './types';

let running = false;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let unchanged = 0;
let previousId = '';
let advancedAt = 0;
let sourceUrl = '';
let sessionId = '';
let accountQueue: AccountQueue | null = null;
const QUEUE_KEY = 'shortforge.account-scout.v1';
const instagram = () => ['instagram.com', 'www.instagram.com'].includes(location.hostname);
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const send = (message: { type: string; [key: string]: unknown }) => chrome.runtime.sendMessage(
  message.type === 'hello' ? message : { sessionId, ...message });
const text = (node: HTMLElement | null) => node?.innerText?.trim() || '';
function labeledCount(value: string, kind: 'likes' | 'views'): number | null {
  const forward = countFromLabel(value, kind);
  if (forward !== null) return forward;
  // A stat card can render its label above the number, without a colon.
  const label = kind === 'likes' ? 'likes?' : 'views?';
  const reverse = value.trim().match(new RegExp(`^${label}\\s*[:：]?\\s*(\\d[\\d.,\\u00a0\\u202f\\u2009 ]*\\s*[KMB]?)$`, 'i'));
  return reverse ? parseCount(reverse[1]) : null;
}
function countInNodes(nodes: HTMLElement[], kind: 'likes' | 'views', allowBare = false): number | null {
  for (const node of nodes.filter(visible)) {
    const labels = [node, ...all(node, SELECTORS.accessibleLabels)]
      .filter(visible).map(item => item.getAttribute('aria-label') || '');
    const values = [...labels, text(node)];
    for (const value of values) {
      const count = labeledCount(value, kind);
      if (count !== null) return count;
    }
    if (allowBare) for (const value of values) {
      const count = parseCount(value);
      if (count !== null) return count;
    }
  }
  return null;
}
function readCounts(root: HTMLElement, panel: HTMLElement | null): { likes: number | null; views: number | null } {
  const scopes = panel ? [panel, root] : [root];
  const stats = scopes.flatMap(scope => all(scope, SELECTORS.stats));
  return {
    likes: countInNodes(all(root, SELECTORS.like), 'likes', true) ?? countInNodes(stats, 'likes'),
    views: countInNodes(scopes.flatMap(scope => all(scope, SELECTORS.viewCount)), 'views', true)
      ?? countInNodes(stats, 'views')
      ?? countInNodes(scopes.flatMap(scope => all(scope, SELECTORS.views)), 'views'),
  };
}
async function waitForDescriptionPanel(): Promise<HTMLElement | null> {
  const started = Date.now();
  const deadline = started + 1800;
  do {
    const panel = first(document, SELECTORS.descriptionPanel);
    if (panel) {
      // Preserve the description's initial rendering grace period as well as waiting for the panel.
      const remaining = 450 - (Date.now() - started);
      if (remaining > 0) await wait(remaining);
      return panel;
    }
    await wait(100);
  } while (Date.now() < deadline);
  // A background timer can wake after the deadline even though the panel is ready.
  return first(document, SELECTORS.descriptionPanel);
}
function descriptionMenuItem(): HTMLElement | null {
  const item = all(document, SELECTORS.menuItems).find(node => visible(node)
    && /^description$/i.test(text(node).replace(/\s+/g, ' ')));
  if (!item) return null;
  // Modern list-item hosts do not necessarily handle clicks themselves.
  return item.matches(SELECTORS.menuAction.join(',')) ? item : first(item, SELECTORS.menuAction) || item;
}
async function waitForDescriptionMenuItem(): Promise<HTMLElement | null> {
  const deadline = Date.now() + 1800;
  do {
    const item = descriptionMenuItem();
    if (item) return item;
    await wait(100);
  } while (Date.now() < deadline);
  return descriptionMenuItem();
}
function challenge(): string | null {
  if (instagram() && /^\/(?:accounts|challenge)\//.test(location.pathname)) return 'Instagram needs your attention. Sign in or complete its verification yourself, then resume.';
  for (const node of all(document, instagram() ? INSTAGRAM.challenges : SELECTORS.challenges).filter(visible)) {
    if (node instanceof HTMLIFrameElement) return 'A verification check appeared. Complete it yourself, then resume.';
    if (node instanceof HTMLInputElement || /sign in|log in|confirm your age|not a bot|unusual traffic|captcha|before you continue|accept all|verify/i.test(text(node))) return `${instagram() ? 'Instagram' : 'YouTube'} needs your attention. Handle the sign-in, consent, or verification prompt, then resume.`;
  }
  return null;
}
async function descriptionPanel(root: HTMLElement): Promise<{ panel: HTMLElement; opened: boolean }> {
  let panel = first(document, SELECTORS.descriptionPanel);
  if (panel) return { panel, opened: false };
  const direct = first(root, SELECTORS.descriptionOpen);
  if (direct) {
    direct.click(); panel = await waitForDescriptionPanel();
    if (panel) return { panel, opened: true };
  }
  // A direct control may be present but inert. Retry through the same menu
  // a viewer uses, and allow that menu to render asynchronously.
  let description = descriptionMenuItem();
  if (!description) {
    const more = first(root, SELECTORS.moreOpen);
    if (!more) {
      throw new Error(direct
        ? 'Clicked Description, but its panel did not open. Open Description manually, then resume.'
        : 'Could not find this Short’s menu button. Reload the YouTube tab, then resume.');
    }
    more.click();
    description = await waitForDescriptionMenuItem();
  }
  if (!description) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    throw new Error('Opened the Short’s menu, but could not find Description. Open Description manually, then resume.');
  }
  // Description is the only menu action Scout takes.
  description.click();
  panel = await waitForDescriptionPanel();
  if (!panel) throw new Error('Clicked Description, but its panel did not open. Open Description manually, then resume.');
  return { panel, opened: true };
}
async function readYouTubeClip(): Promise<Candidate> {
  const id = videoIdFromUrl(location.href);
  const root = activeShort();
  if (!id || !root) throw new Error('Could not find the active Short. Reload this page and use Self-test.');
  const title = text(first(root, SELECTORS.title));
  const channel = first(root, SELECTORS.channel);
  const channelHref = channel?.getAttribute('href') || '';
  const channelHandle = channelHref.match(/\/@([^/?]+)/)?.[1] || text(channel).match(/@([^\s]+)/)?.[1] || '';
  const { panel, opened } = await descriptionPanel(root);
  try {
    // YouTube often opens an empty panel before its counts arrive from the network.
    const deadline = Date.now() + 1800;
    let counts = readCounts(root, panel);
    while ((counts.likes === null || counts.views === null) && Date.now() < deadline) {
      if (videoIdFromUrl(location.href) !== id) break;
      await wait(100);
      counts = readCounts(root, panel);
    }
    if (videoIdFromUrl(location.href) !== id) throw new Error('The Short changed while reading. Resume once the video has loaded.');
    const description = text(first(panel || root, SELECTORS.description));
    const credit = detectCredit(description, channelHandle);
    return { video_id: id, url: `https://www.youtube.com/shorts/${id}`, title, channel_name: text(channel), channel_handle: channelHandle ? `@${channelHandle}` : '', description,
      ...counts, credit_target: credit?.target || '', credit_snippet: credit?.snippet || '', thumbnail_url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
  } finally {
    if (opened && panel) first(panel, SELECTORS.descriptionClose)?.click();
  }
}
function advance(): void {
  if (instagram()) {
    const next = first(document, INSTAGRAM.next);
    const icon = first(document, INSTAGRAM.nextIcon);
    const button = next || icon?.closest<HTMLElement>(INSTAGRAM.controls.join(','));
    if (button) { button.click(); return; }
    // A normal viewer scroll is read-only. Never use a generic action button.
    const root = activeInstagramReel();
    const video = root && first(root, INSTAGRAM.video);
    let container = video?.parentElement || null;
    while (container && container !== document.body) {
      if (/(auto|scroll)/.test(getComputedStyle(container).overflowY) && container.scrollHeight > container.clientHeight) {
        container.scrollBy({ top: container.clientHeight, behavior: 'smooth' }); return;
      }
      container = container.parentElement;
    }
    window.scrollBy({ top: innerHeight, behavior: 'smooth' });
    return;
  }
  const next = first(document, SELECTORS.next);
  if (next) { next.click(); return; }
  const root = activeShort();
  root?.focus({ preventScroll: true });
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true }));
}
function persistQueue() {
  if (accountQueue) sessionStorage.setItem(QUEUE_KEY, JSON.stringify(accountQueue));
}
function restoreQueue(source: string, session: string): AccountQueue {
  try {
    const saved = JSON.parse(sessionStorage.getItem(QUEUE_KEY) || 'null') as AccountQueue | null;
    if (saved?.sourceUrl === source && saved.sessionId === session && Array.isArray(saved.urls) && Array.isArray(saved.completed)) {
      const queue = createAccountQueue(source, session);
      addAccountVideos(queue, saved.urls.filter(value => typeof value === 'string'));
      queue.completed = saved.completed.filter(value => queue.urls.includes(value));
      queue.currentUrl = saved.currentUrl && queue.urls.includes(saved.currentUrl) ? saved.currentUrl : null;
      queue.scrollY = Number.isFinite(saved.scrollY) && saved.scrollY >= 0 ? saved.scrollY : 0;
      queue.exhausted = saved.exhausted === true;
      // A restored tab can never adopt a new account as its initial landing.
      queue.landingChecked = true;
      try {
        const resolved = canonicalSourceUrl(saved.resolvedSourceUrl || source);
        if (new URL(resolved).origin === new URL(source).origin) queue.resolvedSourceUrl = resolved;
      } catch { /* Keep the originally requested grid if an old value is invalid. */ }
      for (const url of queue.urls) {
        const id = candidateIdFromUrl(url)!;
        const count = saved.views?.[id];
        if (Number.isSafeInteger(count) && count >= 0) queue.views[id] = count;
      }
      return queue;
    }
  } catch { /* A new or old tab simply starts a fresh account queue. */ }
  return createAccountQueue(source, session);
}
function atSourceGrid(): boolean {
  if (!sourceUrl) return false;
  const source = new URL(accountQueue?.resolvedSourceUrl || sourceUrl);
  return location.hostname.replace(/^www\./, '') === source.hostname.replace(/^www\./, '')
    && location.pathname.replace(/\/$/, '').toLowerCase() === source.pathname.replace(/\/$/, '').toLowerCase();
}
function resolveInitialAccountRedirect() {
  if (!accountQueue || accountQueue.landingChecked) return;
  accountQueue.landingChecked = true;
  if (atSourceGrid() || accountQueue.urls.length || accountQueue.currentUrl) return;
  const source = new URL(sourceUrl);
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  // YouTube legacy account URLs can redirect to the channel's modern handle.
  // Only accept browser-confirmed redirects on this first, empty landing; a
  // later manual profile navigation must never redefine the selected account.
  if (source.origin !== location.origin || source.hostname !== 'www.youtube.com'
    || !/^\/(?:c|user|channel)\//.test(source.pathname)
    || navigation?.type !== 'navigate' || !navigation.redirectCount
    || !/^\/(?:@[^/]+|channel\/UC[A-Za-z0-9_-]{22})\/shorts\/?$/.test(location.pathname)) return;
  accountQueue.resolvedSourceUrl = canonicalSourceUrl(location.href);
}
function accountGrid(): HTMLElement | null {
  if (!atSourceGrid()) return null;
  const grid = first(document, instagram() ? INSTAGRAM.accountGrid : SELECTORS.accountGrid);
  if (grid || !instagram()) return grid;
  // Newer profile pages wrap the grid directly after the account's tab strip.
  const main = first(document, INSTAGRAM.main);
  const tabs = main && first(main, INSTAGRAM.accountTabs);
  let tabWrapper = tabs;
  while (tabWrapper && tabWrapper !== main) {
    let sibling = tabWrapper.nextElementSibling as HTMLElement | null;
    while (sibling) {
      if (!sibling.matches(INSTAGRAM.excludedGrid.join(',')) && first(sibling, INSTAGRAM.accountVideos)) return sibling;
      sibling = sibling.nextElementSibling as HTMLElement | null;
    }
    tabWrapper = tabWrapper.parentElement;
  }
  return null;
}
function collectGridLinks(grid: HTMLElement): number {
  if (!accountQueue || !atSourceGrid()) return 0;
  const sourceHandle = new URL(sourceUrl).pathname.split('/')[1].toLowerCase();
  const links = all(grid, instagram() ? INSTAGRAM.accountVideos : SELECTORS.accountVideos).filter(visible);
  const before = accountQueue.urls.length;
  for (const link of links) {
    if (instagram() && link.closest(INSTAGRAM.excludedGrid.join(','))) continue;
    const href = new URL(link.getAttribute('href') || '', location.origin);
    // A username embedded in a Reel link must belong to the requested profile.
    const accountPath = href.pathname.match(/^\/([^/]+)\/reels?\//);
    if (instagram() && accountPath && accountPath[1].toLowerCase() !== sourceHandle) continue;
    addAccountVideos(accountQueue, [href.href]);
    const id = candidateIdFromUrl(href.href);
    const canonical = canonicalCandidateUrl(href.href);
    if (instagram() && id && canonical && accountQueue.urls.includes(canonical)) {
      const views = instagramTileViews(link);
      if (views !== null) accountQueue.views[id] = views;
    }
  }
  persistQueue();
  return accountQueue.urls.length - before;
}
function navigateAccount(url: string) {
  if (!accountQueue) return;
  const gridUrl = accountQueue.resolvedSourceUrl;
  // Every outgoing video must have been read from this account's profile grid.
  if (url !== gridUrl && !accountQueue.urls.includes(url)) throw new Error('This video is outside the selected account queue.');
  accountQueue.currentUrl = url === gridUrl ? null : url;
  persistQueue();
  location.assign(url);
}
async function exhaust() {
  running = false;
  await send({ type: 'exhausted', sourceUrl, sessionId });
}
async function scanAccountGrid(token: number) {
  if (!accountQueue) return;
  const queued = nextAccountVideo(accountQueue);
  if (queued) { navigateAccount(queued); return; }
  if (accountQueue.exhausted || accountQueue.urls.length >= 500) { await exhaust(); return; }
  window.scrollTo({ top: accountQueue.scrollY });
  let stagnant = 0;
  let missing = 0;
  for (let attempt = 0; attempt < 20 && running && generation === token; attempt++) {
    const blocker = challenge();
    if (blocker) { await pause(blocker); return; }
    const grid = accountGrid();
    if (!grid) {
      if (++missing >= 5) throw new Error('Could not find this account’s Shorts or Reels grid. Let the profile load, then run Self-test.');
      await wait(1200); continue;
    }
    missing = 0;
    collectGridLinks(grid);
    const next = nextAccountVideo(accountQueue);
    if (next) { accountQueue.scrollY = window.scrollY; navigateAccount(next); return; }
    const before = window.scrollY;
    const height = document.documentElement.scrollHeight;
    window.scrollBy({ top: Math.max(500, innerHeight * 0.85), behavior: 'instant' });
    await wait(1600);
    if (!running || generation !== token) return;
    accountQueue.scrollY = window.scrollY;
    const loading = instagram() && first(document, INSTAGRAM.loading);
    const bottom = window.scrollY + innerHeight >= document.documentElement.scrollHeight - 8;
    if (!loading && bottom && before === window.scrollY && height === document.documentElement.scrollHeight) stagnant++;
    else stagnant = 0;
    persistQueue();
    if (stagnant >= 3) {
      // One final read includes tiles loaded during the last rendering interval.
      const finalGrid = accountGrid();
      if (finalGrid) collectGridLinks(finalGrid);
      const finalNext = nextAccountVideo(accountQueue);
      if (finalNext) { navigateAccount(finalNext); return; }
      accountQueue.exhausted = true; persistQueue(); await exhaust(); return;
    }
  }
  if (running && generation === token) throw new Error('The account grid is still loading. Check the page, then resume.');
}
async function pause(reason: string) {
  running = false; generation += 1;
  if (timer) clearTimeout(timer);
  await send({ type: 'problem', reason });
}
async function inspectCaptions(clip: Candidate, token: number): Promise<string | null | undefined> {
  const prepared = await send({ type: 'prepareScan', clip });
  if (!running || generation !== token) return null;
  if (prepared?.error) throw new Error(prepared.error);
  if (!prepared?.running) return null;
  if (prepared.skipCaptionCheck) return undefined;
  if (!prepared.captionJobId) throw new Error('The caption check did not start. Check the local engine, then resume.');
  const jobId = prepared.captionJobId as string;
  while (running && generation === token) {
    const blocker = challenge();
    if (blocker) throw new Error(blocker);
    await wait(2000);
    if (!running || generation !== token) return null;
    const result = await send({ type: 'captionStatus', jobId });
    if (!running || generation !== token) return null;
    if (result?.error) throw new Error(result.error);
    if (!result?.running) return null;
    if (['completed', 'failed', 'cancelled'].includes(result.job?.status)) return jobId;
  }
  return null;
}
async function tick(token: number) {
  if (!running || generation !== token) return;
  try {
    const blocker = challenge();
    if (blocker) { await pause(blocker); return; }
    if (accountQueue && atSourceGrid()) { await scanAccountGrid(token); return; }
    if (accountQueue) {
      const current = canonicalCandidateUrl(location.href);
      if (!current || current !== accountQueue.currentUrl || !accountQueue.urls.includes(current)) {
        await pause(accountQueue.urls.length
          ? 'You left the selected account’s queued video. Return to its account page, then resume.'
          : 'This account opened a different URL. Copy its current @handle or channel URL, stop this session, and start with that URL.'); return;
      }
    } else if ((!candidateIdFromUrl(location.href) && !(instagram() && /^\/reels\/?$/.test(location.pathname))) || (!instagram() && !location.pathname.startsWith('/shorts/'))) {
      await pause('Open a YouTube Short or Instagram Reel, then resume.'); return;
    }
    // A newly opened player needs time to mount its video and action rail.
    if (instagram()) {
      for (let attempt = 0; attempt < 12 && !activeInstagramReel(); attempt++) {
        await wait(250);
        if (!running || generation !== token) return;
        const blocked = challenge();
        if (blocked) throw new Error(blocked);
      }
    }
    const clip = instagram()
      ? readInstagramClip(undefined, accountQueue?.views[candidateIdFromUrl(location.href) || ''])
      : await readYouTubeClip();
    if (!running || generation !== token) return;
    if (clip.video_id === previousId) unchanged += 1;
    else { unchanged = 0; previousId = clip.video_id; }
    if (unchanged >= 3) { await pause('The video did not advance. Open the next Short or Reel yourself, then resume.'); return; }
    const captionJobId = await inspectCaptions(clip, token);
    if (!running || generation !== token) return;
    if (captionJobId === null) { running = false; return; }
    const result = await send({ type: 'scan', clip, ...(captionJobId ? { captionJobId } : {}) });
    if (!running || generation !== token) return;
    if (result.error) throw new Error(result.error);
    if (accountQueue) {
      if (!accountQueue.completed.includes(clip.url)) accountQueue.completed.push(clip.url);
      persistQueue();
    }
    if (!result.running) { running = false; return; }
    timer = setTimeout(async () => {
      if (!running || generation !== token) return;
      try {
        const blocker = challenge();
        if (blocker) { await pause(blocker); return; }
        if (accountQueue) {
          const next = nextAccountVideo(accountQueue);
          if (next) navigateAccount(next);
          else if (accountQueue.exhausted || accountQueue.urls.length >= 500) await exhaust();
          else navigateAccount(accountQueue.resolvedSourceUrl);
          return;
        }
        advance(); advancedAt = Date.now(); await wait(1200); await tick(token);
      } catch (error) { if (running && generation === token) await pause(error instanceof Error ? error.message : 'Could not open the next video.'); }
    }, Math.max(0, 4000 + Math.random() * 5000 - (Date.now() - advancedAt)));
  } catch (error) { if (running && generation === token) await pause(error instanceof Error ? error.message : 'Could not read this video. Run Self-test and reload the page.'); }
}
function run(options: { sourceUrl?: string; sessionId?: string } = {}) {
  const source = options.sourceUrl || '';
  const session = options.sessionId || '';
  if (running && source === sourceUrl && session === sessionId) return;
  if (timer) clearTimeout(timer);
  try {
    sourceUrl = canonicalSourceUrl(source);
    sessionId = session;
    accountQueue = sourceUrl ? restoreQueue(sourceUrl, sessionId) : null;
    if (accountQueue) { resolveInitialAccountRedirect(); persistQueue(); }
  } catch (error) { void pause(error instanceof Error ? error.message : 'Invalid account URL.'); return; }
  running = true; generation += 1; unchanged = 0; previousId = ''; advancedAt = Date.now();
  void tick(generation);
}
async function selftest(): Promise<SelectorCheck[]> {
  let source = '';
  try { source = canonicalSourceUrl(location.href); } catch { /* A player URL. */ }
  if (source) {
    const saved = sourceUrl; sourceUrl = source;
    const grid = accountGrid(); sourceUrl = saved;
    return [
      { name: 'Account Shorts/Reels URL', found: true, required: true },
      { name: 'Account video grid', found: Boolean(grid), required: true },
      { name: 'Visible video links', found: Boolean(grid && first(grid, instagram() ? INSTAGRAM.accountVideos : SELECTORS.accountVideos)), required: true },
      { name: 'No verification prompt', found: !challenge(), required: true },
    ];
  }
  if (instagram()) {
    const root = activeInstagramReel();
    const counts = root ? instagramCounts(root) : { likes: null, views: null };
    return [
      { name: 'Instagram Reel permalink', found: Boolean(instagramReelId(root)), required: true },
      { name: 'Visible active Reel', found: Boolean(root), required: true },
      { name: 'Readable like count', found: counts.likes !== null, required: true },
      { name: 'Readable views (may only appear on account grid)', found: counts.views !== null, required: false },
      { name: 'No verification prompt', found: !challenge(), required: true },
    ];
  }
  const root = activeShort();
  const panel = first(document, SELECTORS.descriptionPanel);
  const counts = root ? readCounts(root, panel) : { likes: null, views: null };
  return [
    { name: 'YouTube Shorts URL', found: Boolean(videoIdFromUrl(location.href)) && location.pathname.startsWith('/shorts/'), required: true },
    { name: 'Active Short', found: Boolean(root), required: true },
    { name: 'Video title', found: Boolean(root && first(root, SELECTORS.title)), required: true },
    { name: 'Readable like count', found: counts.likes !== null, required: true },
    { name: panel ? 'Readable view count' : 'Readable view count (open Description first)', found: counts.views !== null, required: true },
    { name: 'Description access', found: Boolean(panel || (root && (first(root, SELECTORS.descriptionOpen) || first(root, SELECTORS.moreOpen)))), required: true },
    { name: 'Next-video button (keyboard fallback)', found: Boolean(first(document, SELECTORS.next)), required: false },
    { name: 'No verification prompt', found: !challenge(), required: true },
  ];
}
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.type === 'run') { run(message); respond({ ok: true }); }
  if (message.type === 'halt') { running = false; generation += 1; if (timer) clearTimeout(timer); respond({ ok: true }); }
  if (message.type === 'selftest') { selftest().then(checks => respond({ checks })); return true; }
});
void send({ type: 'hello' }).then(result => { if (result.running) run(result); }).catch(() => {});
