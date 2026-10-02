import { initialState, type ScoutState, type SelectorCheck, type Settings } from './types';

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const button = (id: string) => byId<HTMLButtonElement>(id);
let current = initialState();
let busy = false;
const hints: Record<Settings['mode'], string> = {
  narrated: 'Saves clips meeting your limits. No credits or keywords required. Review narration in Library.',
  auto: 'Starts with credited sources. After 30 misses, collects clips meeting your limits for narration review.',
  credits: 'Looks for attribution in descriptions. Credit alone does not grant permission to reuse a video.',
};
function settings(): Settings {
  return { target: Number(byId<HTMLInputElement>('target').value), minLikes: Number(byId<HTMLInputElement>('minLikes').value), minViews: Number(byId<HTMLInputElement>('minViews').value), mode: byId<HTMLSelectElement>('mode').value as Settings['mode'] };
}
function error(message = '') { byId('error').hidden = !message; byId('error').textContent = message; }
function render(state: ScoutState, populate = false) {
  current = state;
  if (populate) {
    byId<HTMLInputElement>('target').value = String(state.settings.target);
    byId<HTMLInputElement>('minLikes').value = String(state.settings.minLikes);
    byId<HTMLInputElement>('minViews').value = String(state.settings.minViews);
    byId<HTMLSelectElement>('mode').value = state.settings.mode;
  }
  const mode = byId<HTMLSelectElement>('mode').value as Settings['mode'];
  byId('mode-help').textContent = hints[mode];
  byId('status').textContent = state.status[0].toUpperCase() + state.status.slice(1);
  byId('status').dataset.status = state.status;
  byId('progress-label').textContent = state.status === 'idle' ? 'Ready to scout' : state.status === 'running' ? (state.activeMode === 'credits' ? 'Finding credited Shorts' : 'Finding narrated Shorts') : 'Your session';
  byId<HTMLProgressElement>('progress').max = state.settings.target;
  byId<HTMLProgressElement>('progress').value = state.matched;
  byId('scanned').textContent = state.scanned.toLocaleString();
  byId('matched').textContent = `${state.matched} / ${state.settings.target}`;
  byId('reason').textContent = state.reason;
  byId('saved-count').textContent = state.saved ? `${state.saved} saved` : '';
  const lastScan = byId('last-scan');
  lastScan.hidden = !state.lastScan;
  if (state.lastScan) {
    const scan = state.lastScan;
    const count = (value: number | null) => value?.toLocaleString() ?? 'unreadable';
    lastScan.textContent = `Last Short: ${count(scan.likes)} likes · ${count(scan.views)} views. ${scan.matched ? 'Matched' : 'Skipped'} — ${scan.reason}`;
  }
  byId('start-label').textContent = busy ? 'Connecting…' : state.status === 'paused' ? 'Resume' : state.status === 'running' ? 'Scouting…' : 'Start scouting';
  button('start').disabled = busy || state.status === 'running';
  button('pause').disabled = busy || state.status !== 'running';
  button('stop').disabled = busy || ['idle', 'stopped', 'complete'].includes(state.status);
  byId('pending-row').hidden = !state.pending.length;
  byId('pending-text').textContent = `${state.pending.length} ${state.pending.length === 1 ? 'clip' : 'clips'} waiting to save`;
  const logs = byId('logs'); logs.replaceChildren();
  if (!state.logs.length) { const empty = document.createElement('li'); empty.textContent = 'Your scouting activity will appear here.'; logs.append(empty); }
  for (const item of state.logs) {
    const li = document.createElement('li'); const time = document.createElement('time');
    time.dateTime = new Date(item.at).toISOString(); time.textContent = new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    li.append(time, document.createTextNode(item.text)); logs.append(li);
  }
}
async function command(type: string, extras: object = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...extras });
  if (response.error) throw new Error(response.error);
  if (response.state) render(response.state);
  return response;
}
async function action(fn: () => Promise<unknown>) {
  busy = true; error(); render(current);
  try { await fn(); } catch (cause) { error(cause instanceof Error ? cause.message : 'Could not connect. Reload the extension and try again.'); }
  finally { busy = false; render(current); }
}
button('start').addEventListener('click', () => action(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await command(current.status === 'paused' ? 'resume' : 'start', { tabId: tab?.id, settings: settings() });
}));
button('pause').addEventListener('click', () => action(() => command('pause')));
button('stop').addEventListener('click', () => action(() => command('stop')));
button('retry').addEventListener('click', () => action(() => command('retry')));
byId('settings').addEventListener('submit', event => event.preventDefault());
byId('settings').addEventListener('change', () => {
  byId('mode-help').textContent = hints[settings().mode];
  void command('saveSettings', { settings: settings() }).then(() => error()).catch(cause => error(cause.message));
});
const START_HINT = 'ShortForge is not running. Open the ShortForge folder, run ./start.sh (Windows: double-click start.bat), leave that window open, then click again.';
// The editor is packaged with the extension. Only the engine must be running.
button('dashboard').addEventListener('click', async () => {
  error();
  button('dashboard').disabled = true;
  try {
    const response = await fetch('http://127.0.0.1:8787/api/health', { signal: AbortSignal.timeout(2500) });
    if (!response.ok) throw new Error(START_HINT);
    await chrome.tabs.create({ url: chrome.runtime.getURL('studio/index.html') });
  } catch (cause) {
    error(START_HINT);
  } finally {
    button('dashboard').disabled = false;
  }
});
button('selftest').addEventListener('click', async () => {
  error(); const target = byId('checks'); target.hidden = false; target.textContent = 'Checking this YouTube tab…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.startsWith('https://www.youtube.com/shorts/')) throw new Error('Open a YouTube Short first, then run Self-test.');
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'selftest' });
    target.replaceChildren();
    for (const check of result.checks as SelectorCheck[]) {
      const row = document.createElement('div'); row.className = `check${check.found ? '' : check.required ? ' missing' : ' optional'}`;
      const indicator = document.createElement('strong'); indicator.textContent = check.found ? 'OK' : check.required ? 'Fail' : 'Note';
      row.append(indicator, document.createTextNode(check.name)); target.append(row);
    }
    const note = document.createElement('p'); note.className = 'hint'; note.textContent = 'This reads the current page without clicking. Open the Short’s three-dot menu → Description to check views, then run Self-test again. Scouting opens that panel automatically.'; target.append(note);
  } catch (cause) { target.textContent = cause instanceof Error ? cause.message : 'Reload the YouTube tab and try again.'; }
});
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.scout) render(changes.scout.newValue); });
void chrome.runtime.sendMessage({ type: 'state' }).then(result => render(result.state || initialState(), true)).catch(() => error('Could not open Scout. Reload the extension in chrome://extensions.'));
