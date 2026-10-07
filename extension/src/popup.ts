import { DEFAULTS, initialState, type ScoutState, type SelectorCheck, type Settings } from './types';
import { isScoutUrl } from './sources';

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const button = (id: string) => byId<HTMLButtonElement>(id);
let current = initialState();
let busy = false;
const selectedMode = () => document.querySelector<HTMLInputElement>('input[name="mode"]:checked')!.value as Settings['mode'];
const hints: Record<Settings['mode'], string> = {
  narrated: 'Matches your limits; narration is not verified. No credits or keywords required.',
  auto: 'Starts with credited sources. After 30 misses, collects clips meeting your limits for narration review.',
  credits: 'Requires attribution and your count limits. Caption and speech filters still apply.',
  'credits-any': 'Requires attribution and your count limits. Captions and voiceover are allowed.',
};
function numberSetting(id: string, label: string, min: number, max: number, whole = true, report = false): number {
  const input = byId<HTMLInputElement>(id);
  const value = input.valueAsNumber;
  if (!Number.isFinite(value) || value < min || value > max || (whole && !Number.isInteger(value))) {
    const message = `${label}: enter ${whole ? 'a whole number' : 'a number'} from ${min.toLocaleString()} to ${max.toLocaleString()}.`;
    input.setAttribute('aria-invalid', 'true');
    input.setCustomValidity(message);
    // Auto-saving on blur must not steal focus from a mode the user is choosing.
    if (report) input.reportValidity();
    throw new Error(message);
  }
  input.removeAttribute('aria-invalid');
  input.setCustomValidity('');
  return value;
}
function settings(report = false): Settings {
  const mode = selectedMode();
  const captionFilter = mode === 'credits-any' ? 'off' : byId<HTMLSelectElement>('captionFilter').value as Settings['captionFilter'];
  const allowance = byId<HTMLInputElement>('maxCaptionSeconds');
  let maxCaptionSeconds: number;
  if (captionFilter === 'off') {
    // An inactive check must not be blocked by its hidden, unfinished field.
    const valid = (value: number | undefined): value is number => Number.isFinite(value) && value! >= 0 && value! <= 10;
    maxCaptionSeconds = valid(allowance.valueAsNumber) ? allowance.valueAsNumber
      : valid(current.settings.maxCaptionSeconds) ? current.settings.maxCaptionSeconds : DEFAULTS.maxCaptionSeconds!;
    allowance.value = String(maxCaptionSeconds);
    allowance.removeAttribute('aria-invalid');
    allowance.setCustomValidity('');
  } else {
    maxCaptionSeconds = numberSetting('maxCaptionSeconds', 'Text allowance', 0, 10, false, report);
  }
  return {
    minLikes: numberSetting('minLikes', 'Minimum likes', 0, 1e12, true, report),
    minViews: numberSetting('minViews', 'Minimum views', 0, 1e12, true, report),
    target: numberSetting('target', 'Clips to collect', 1, 500, true, report),
    mode,
    sourceUrl: byId<HTMLInputElement>('sourceUrl').value.trim(),
    captionFilter,
    maxCaptionSeconds,
  };
}
function error(message = '') { byId('error').hidden = !message; byId('error').textContent = message; }
function captionHint() {
  const forcedOff = selectedMode() === 'credits-any';
  const select = byId<HTMLSelectElement>('captionFilter');
  if (forcedOff) select.value = 'off';
  select.disabled = forcedOff || current.status === 'running';
  byId<HTMLInputElement>('maxCaptionSeconds').disabled = select.disabled;
  const policy = select.value;
  const allowance = byId<HTMLInputElement>('maxCaptionSeconds').value || '0';
  byId('caption-allowance').hidden = policy === 'off';
  byId('caption-allowance-label').textContent = policy === 'small-text-no-speech' ? 'Other text (sec.)' : 'Text allowance (sec.)';
  byId('caption-help').textContent = forcedOff
    ? 'Captions and voiceover are allowed in this mode. Choose another mode to filter them.'
    : policy === 'small-text-no-speech'
    ? `Small Chinese annotations allowed. Requires no detected speech. Other text: up to ${allowance} seconds. Local estimate; unverified clips are skipped.`
    : policy === 'brief-only'
      ? `Allow up to ${allowance} seconds of visible text in total. Local estimate; unreadable clips are skipped.`
      : 'Save videos without checking for burned-in captions or speech.';
}
function modeHint() {
  const mode = selectedMode();
  const noSpeech = byId<HTMLSelectElement>('captionFilter').value === 'small-text-no-speech';
  byId('mode-help').textContent = noSpeech && mode !== 'credits' && mode !== 'credits-any'
    ? mode === 'auto'
      ? 'Starts with credited sources. After 30 misses, applies your limits without requiring credit.'
      : 'No credits or keywords required. Your count, caption and speech limits still apply.'
    : hints[mode];
}
function render(state: ScoutState, populate = false) {
  state = { ...state, settings: { ...DEFAULTS, ...state.settings } };
  current = state;
  if (populate) {
    byId<HTMLInputElement>('target').value = String(state.settings.target);
    byId<HTMLInputElement>('minLikes').value = String(state.settings.minLikes);
    byId<HTMLInputElement>('minViews').value = String(state.settings.minViews);
    for (const option of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) option.checked = option.value === state.settings.mode;
    byId<HTMLInputElement>('sourceUrl').value = state.settings.sourceUrl || '';
    byId<HTMLSelectElement>('captionFilter').value = state.settings.captionFilter!;
    byId<HTMLInputElement>('maxCaptionSeconds').value = String(state.settings.maxCaptionSeconds);
  }
  byId('settings').hidden = state.status === 'running';
  for (const input of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('#settings input, #settings select')) input.disabled = state.status === 'running';
  captionHint();
  modeHint();
  byId('status').textContent = state.status[0].toUpperCase() + state.status.slice(1);
  byId('status').dataset.status = state.status;
  byId('progress-label').textContent = state.status === 'idle' ? 'Ready to scout' : state.status === 'running' ? (state.activeMode === 'credits' ? 'Finding credited videos' : 'Finding matching videos') : 'Your session';
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
    lastScan.textContent = `Last video: ${count(scan.likes)} likes · ${count(scan.views)} views. ${scan.matched ? 'Matched' : 'Skipped'} — ${scan.reason}`;
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
  await command(current.status === 'paused' ? 'resume' : 'start', { tabId: tab?.id, settings: settings(true) });
}));
button('pause').addEventListener('click', () => action(() => command('pause')));
button('stop').addEventListener('click', () => action(() => command('stop')));
button('retry').addEventListener('click', () => action(() => command('retry')));
byId('settings').addEventListener('submit', event => event.preventDefault());
byId('settings').addEventListener('input', event => {
  if (event.target instanceof HTMLInputElement) {
    event.target.removeAttribute('aria-invalid');
    event.target.setCustomValidity('');
  }
});
byId('settings').addEventListener('change', () => {
  captionHint();
  modeHint();
  void (async () => {
    await command('saveSettings', { settings: settings() });
    error();
  })().catch(cause => error(cause.message));
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
  error(); const target = byId('checks'); target.hidden = false; target.textContent = 'Checking this Shorts or Reels tab…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !isScoutUrl(tab.url)) throw new Error('Open a YouTube Short, Instagram Reel, or account page first, then run Self-test.');
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'selftest' });
    target.replaceChildren();
    for (const check of result.checks as SelectorCheck[]) {
      const row = document.createElement('div'); row.className = `check${check.found ? '' : check.required ? ' missing' : ' optional'}`;
      const indicator = document.createElement('strong'); indicator.textContent = check.found ? 'OK' : check.required ? 'Fail' : 'Note';
      row.append(indicator, document.createTextNode(check.name)); target.append(row);
    }
    const note = document.createElement('p'); note.className = 'hint'; note.textContent = 'This reads the current page without clicking. For YouTube, open the Short’s menu → Description to check views. Instagram layouts may hide counts; required unreadable counts are skipped.'; target.append(note);
  } catch (cause) { target.textContent = cause instanceof Error ? cause.message : 'Reload the YouTube tab and try again.'; }
});
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.scout) render(changes.scout.newValue); });
void chrome.runtime.sendMessage({ type: 'state' }).then(result => render(result.state || initialState(), true)).catch(() => error('Could not open Scout. Reload the extension in chrome://extensions.'));
