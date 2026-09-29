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
function challenge(): string | null {
  for (const node of all(document, SELECTORS.challenges).filter(visible)) {
    if (node instanceof HTMLIFrameElement) return 'A verification check appeared. Complete it yourself, then resume.';
    if (/sign in|log in|confirm your age|not a bot|unusual traffic|captcha|before you continue|accept all|verify/i.test(text(node))) return 'YouTube needs your attention. Handle the sign-in, consent, or verification prompt, then resume.';
  }
  return null;
}
async function descriptionPanel(root: HTMLElement): Promise<{ panel: HTMLElement | null; opened: boolean }> {
  let panel = first(document, SELECTORS.descriptionPanel);
  if (panel) return { panel, opened: false };
  const direct = first(root, SELECTORS.descriptionOpen);
  if (direct) { direct.click(); await wait(450); }
  else {
    const more = first(root, SELECTORS.moreOpen);
    if (more) {
      more.click(); await wait(250);
      // Opening this one informational panel is the only menu action Scout takes.
      const description = all(document, SELECTORS.menuItems).find(item => visible(item) && /^description$/i.test(text(item)));
      if (description) { description.click(); await wait(450); }
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    }
  }
  panel = first(document, SELECTORS.descriptionPanel);
  return { panel, opened: Boolean(panel) };
}
async function readClip(): Promise<Candidate> {
  const id = videoIdFromUrl(location.href);
  const root = activeShort();
  if (!id || !root) throw new Error('Could not find the active Short. Reload this page and use Self-test.');
  const title = text(first(root, SELECTORS.title));
  const channel = first(root, SELECTORS.channel);
  const channelHref = channel?.getAttribute('href') || '';
  const channelHandle = channelHref.match(/\/@([^/?]+)/)?.[1] || text(channel).match(/@([^\s]+)/)?.[1] || '';
  const likeNode = first(root, SELECTORS.like);
  let likes: number | null = null;
  if (likeNode) {
    likes = countFromLabel(likeNode.getAttribute('aria-label') || '', 'likes')
      ?? parseCount(likeNode.getAttribute('aria-label')) ?? parseCount(text(likeNode));
    // The accessible count may live on a nested label instead of the button.
    if (likes === null) for (const item of all(root, SELECTORS.like)) likes ??= parseCount(text(item)) ?? parseCount(item.getAttribute('aria-label'));
  }
  const { panel, opened } = await descriptionPanel(root);
  try {
    if (videoIdFromUrl(location.href) !== id) throw new Error('The Short changed while reading. Resume once the video has loaded.');
    const description = text(first(panel || root, SELECTORS.description));
    const metadata = [panel ? text(panel) : '', ...all(root, SELECTORS.views).map(text)].join('\n');
    const views = countFromLabel(metadata, 'views');
    likes ??= countFromLabel(metadata, 'likes');
    const credit = detectCredit(description, channelHandle);
    return { video_id: id, url: `https://www.youtube.com/shorts/${id}`, title, channel_name: text(channel), channel_handle: channelHandle ? `@${channelHandle}` : '', description,
      likes, views, credit_target: credit?.target || '', credit_snippet: credit?.snippet || '', thumbnail_url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
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
  return [
    { name: 'YouTube Shorts URL', found: Boolean(videoIdFromUrl(location.href)) && location.pathname.startsWith('/shorts/'), required: true },
    { name: 'Active Short', found: Boolean(root), required: true },
    { name: 'Video title', found: Boolean(root && first(root, SELECTORS.title)), required: true },
    { name: 'Like count element', found: Boolean(root && first(root, SELECTORS.like)), required: true },
    { name: 'Description access', found: Boolean(first(document, SELECTORS.descriptionPanel) || (root && (first(root, SELECTORS.descriptionOpen) || first(root, SELECTORS.moreOpen)))), required: true },
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
