import { activeShort, all, first, SELECTORS, visible } from './selectors';
import { countFromLabel, detectCredit, parseCount, videoIdFromUrl } from './parsers';
import type { Candidate, SelectorCheck } from './types';

let running = false;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let unchanged = 0;
let previousId = '';
let advancedAt = 0;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const send = (message: object) => chrome.runtime.sendMessage(message);
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
  return null;
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
  return null;
}
function challenge(): string | null {
  for (const node of all(document, SELECTORS.challenges).filter(visible)) {
    if (node instanceof HTMLIFrameElement) return 'A verification check appeared. Complete it yourself, then resume.';
    if (/sign in|log in|confirm your age|not a bot|unusual traffic|captcha|before you continue|accept all|verify/i.test(text(node))) return 'YouTube needs your attention. Handle the sign-in, consent, or verification prompt, then resume.';
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
async function readClip(): Promise<Candidate> {
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
  const next = first(document, SELECTORS.next);
  if (next) { next.click(); return; }
  // Keyboard navigation is YouTube's own next-Short action; no social action is used.
  const root = activeShort();
  root?.focus({ preventScroll: true });
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true }));
}
async function pause(reason: string) {
  running = false; generation += 1;
  if (timer) clearTimeout(timer);
  await send({ type: 'problem', reason });
}
async function tick(token: number) {
  if (!running || generation !== token) return;
  try {
    if (!location.pathname.startsWith('/shorts/')) { await pause('You left YouTube Shorts. Return to a Short, then resume.'); return; }
    if (document.visibilityState !== 'visible') {
      await pause('Your Shorts tab is in the background. Bring it to the front, then resume.'); return;
    }
    const blocker = challenge();
    if (blocker) { await pause(blocker); return; }
    const clip = await readClip();
    if (!running || generation !== token) return;
    if (clip.video_id === previousId) unchanged += 1;
    else { unchanged = 0; previousId = clip.video_id; }
    if (unchanged >= 3) { await pause('YouTube did not advance. Move to the next Short yourself, then resume.'); return; }
    const result = await send({ type: 'scan', clip });
    if (result.error) throw new Error(result.error);
    if (!result.running) { running = false; return; }
    // Wait 4–9 seconds between advances. No stealth or bot-check bypasses.
    timer = setTimeout(async () => {
      if (!running || generation !== token) return;
      if (document.visibilityState !== 'visible') { await pause('Your Shorts tab is in the background. Bring it to the front, then resume.'); return; }
      const blocker = challenge();
      if (blocker) { await pause(blocker); return; }
      advance(); advancedAt = Date.now(); await wait(1200); await tick(token);
    }, Math.max(0, 4000 + Math.random() * 5000 - (Date.now() - advancedAt)));
  } catch (error) { await pause(error instanceof Error ? error.message : 'Could not read this Short. Run Self-test and reload the page.'); }
}
function run() {
  if (running) return;
  running = true; generation += 1; unchanged = 0; previousId = ''; advancedAt = Date.now();
  void tick(generation);
}
async function selftest(): Promise<SelectorCheck[]> {
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
  if (message.type === 'run') { run(); respond({ ok: true }); }
  if (message.type === 'halt') { running = false; generation += 1; if (timer) clearTimeout(timer); respond({ ok: true }); }
  if (message.type === 'selftest') { selftest().then(checks => respond({ checks })); return true; }
});
void send({ type: 'hello' }).then(result => { if (result.running) run(); }).catch(() => {});
