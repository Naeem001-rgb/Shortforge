import { DEFAULTS, initialState, type Candidate, type ScoutState, type Settings } from './types';
import { matchesCandidate } from './parsers';

import { canonicalSourceUrl, candidateIdFromUrl, isScoutUrl } from './sources';

const API = 'http://127.0.0.1:8787/api';
let state: ScoutState;
let serial: Promise<unknown> = Promise.resolve();
async function load() {
  if (!state) {
    const stored = await chrome.storage.local.get('scout');
    state = { ...initialState(), ...stored.scout };
    state.settings = { ...DEFAULTS, ...state.settings };
    // Only Auto has a separate phase. Explicit choices always win over a
    // stale phase saved by an older extension worker.
    if (state.settings.mode !== 'auto') state.activeMode = state.settings.mode;
  }
  return state;
}
function log(text: string) { state.logs = [{ at: Date.now(), text }, ...state.logs].slice(0, 8); }
async function syncTabProtection() {
  // Protect only the scouting tab, without activating it or changing other tabs.
  // Persist the old setting so a suspended MV3 worker can restore it later.
  const previous = state.tabProtection;
  if (previous && (state.status !== 'running' || previous.tabId !== state.tabId)) {
    try { await chrome.tabs.update(previous.tabId, { autoDiscardable: previous.autoDiscardable }); }
    catch { /* The tab may already be closed. */ }
    state.tabProtection = null;
  }
  if (state.status === 'running' && state.tabId !== null && !state.tabProtection) {
    try {
      const tab = await chrome.tabs.get(state.tabId);
      await chrome.tabs.update(state.tabId, { autoDiscardable: false });
      state.tabProtection = { tabId: state.tabId, autoDiscardable: tab.autoDiscardable !== false };
    } catch { /* Normal tab-close/navigation recovery still handles lost tabs. */ }
  }
}
async function save() {
  await syncTabProtection();
  await chrome.storage.local.set({ scout: state });
  await chrome.action.setBadgeBackgroundColor({ color: state.status === 'paused' ? '#946600' : '#006EDC' });
  await chrome.action.setBadgeText({ text: state.matched ? String(state.matched) : '' });
}
async function api(path: string, body?: object) {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000) });
  } catch { throw new Error('Engine is offline. Run ShortForge, then retry. Your pending clips are kept.'); }
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `Engine returned ${response.status}. Try again.`);
  return data;
}
async function tellTab(command: 'run' | 'halt') {
  if (state.tabId === null) return;
  try { await chrome.tabs.sendMessage(state.tabId, { type: command, sourceUrl: state.sessionSourceUrl || '', sessionId: state.sessionId }); }
  catch {
    if (command === 'run') {
      // Reloading the extension disconnects content scripts in existing pages.
      // The fresh page's hello message starts Scout after its state is saved.
      if (state.sessionSourceUrl) await chrome.tabs.update(state.tabId, { url: state.sessionSourceUrl });
      else await chrome.tabs.reload(state.tabId);
    }
  }
}
async function existingTab(id: unknown): Promise<chrome.tabs.Tab | null> {
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0) return null;
  try { return await chrome.tabs.get(id); }
  catch { return null; }
}
function tabUrl(tab: chrome.tabs.Tab): string { return tab.pendingUrl || tab.url || ''; }
function atAccount(tab: chrome.tabs.Tab, source: string): boolean {
  try { return canonicalSourceUrl(tabUrl(tab)) === source; }
  catch { return false; }
}
function feedUrl(url: string): boolean {
  return isScoutUrl(url) && (Boolean(candidateIdFromUrl(url)) || /^https:\/\/(?:www\.)?instagram\.com\/reels\/?(?:[?#].*)?$/.test(url));
}
async function resumeTab(activeId: unknown): Promise<{ tab: chrome.tabs.Tab; reconnect: boolean }> {
  const source = state.sessionSourceUrl;
  const previous = await existingTab(state.tabId);
  if (previous) {
    const url = tabUrl(previous);
    if (source && atAccount(previous, source)) {
      return { tab: previous, reconnect: new URL(url).pathname.replace(/\/$/, '') !== new URL(source).pathname.replace(/\/$/, '') };
    }
    // The original tab retains the queue that proves a player belongs to the
    // selected account. The content script still enforces that allowlist.
    if (feedUrl(url) && (!source || new URL(url).hostname === new URL(source).hostname)) {
      return { tab: previous, reconnect: false };
    }
  }
  const active = await existingTab(activeId);
  if (source) {
    // A replacement tab has no trusted per-tab queue. Rejoin only at the
    // account grid, never at an arbitrary Reel or a different creator's page.
    const tab = active && atAccount(active, source) ? active
      : (await chrome.tabs.query({})).find(candidate => atAccount(candidate, source));
    return { tab: tab || await chrome.tabs.create({ url: 'about:blank', active: true }), reconnect: true };
  }
  if (active && feedUrl(tabUrl(active))) return { tab: active, reconnect: true };
  throw new Error('Your previous scouting tab is no longer available. Open a YouTube Short or Instagram Reel, then press Resume. To scout an account, press Stop and start with its URL.');
}
async function flush(): Promise<boolean> {
  if (!state.pending.length) return true;
  const batch = [...state.pending];
  try {
    const result = await api('/clips', { clips: batch });
    const sentIds = new Set(batch.map(clip => clip.video_id));
    state.pending = state.pending.filter(clip => !sentIds.has(clip.video_id));
    state.knownIds = [...new Set([...state.knownIds, ...sentIds])];
    state.saved += Number(result.added || 0);
    log(`${result.added || 0} ${result.added === 1 ? 'clip' : 'clips'} added to your Library.`);
    await save();
    return true;
  } catch (error) {
    if (state.status === 'running') { state.status = 'paused'; await tellTab('halt'); }
    state.reason = error instanceof Error ? error.message : 'Could not send clips. Retry when the engine is running.';
    log(state.reason);
    await save();
    return false;
  }
}
async function cancelCaptionCheck() {
  const check = state.captionCheck;
  state.captionCheck = null;
  if (check) {
    try { await api(`/scout/caption-check/${encodeURIComponent(check.jobId)}/cancel`, {}); }
    catch { /* A disconnected engine cannot be cancelled; never save its unverified result. */ }
  }
}
function settingsFrom(value: unknown): Settings {
  const candidate = value as Settings;
  if (!candidate || !['narrated', 'credits', 'auto'].includes(candidate.mode)) throw new Error('Choose a discovery mode.');
  for (const [name, max] of [['target', 500], ['minLikes', 1e12], ['minViews', 1e12]] as const) {
    if (!Number.isSafeInteger(candidate[name]) || candidate[name] < (name === 'target' ? 1 : 0) || candidate[name] > max) throw new Error(name === 'target' ? 'Target must be a whole number from 1 to 500.' : 'Enter a valid whole-number minimum.');
  }
  const sourceUrl = canonicalSourceUrl(String(candidate.sourceUrl || ''));
  const captionFilter = candidate.captionFilter ?? DEFAULTS.captionFilter;
  const maxCaptionSeconds = candidate.maxCaptionSeconds ?? 3;
  if (!['off', 'brief-only'].includes(captionFilter!)) throw new Error('Choose a caption filter.');
  if (!Number.isFinite(maxCaptionSeconds) || maxCaptionSeconds < 0 || maxCaptionSeconds > 10) throw new Error('Caption allowance must be between 0 and 10 seconds.');
  return { target: candidate.target, minLikes: candidate.minLikes, minViews: candidate.minViews, mode: candidate.mode, sourceUrl, captionFilter, maxCaptionSeconds };
}
function filtersChanged(previous: Settings, next: Settings): boolean {
  return previous.mode !== next.mode || previous.minLikes !== next.minLikes || previous.minViews !== next.minViews || previous.captionFilter !== next.captionFilter || previous.maxCaptionSeconds !== next.maxCaptionSeconds || previous.sourceUrl !== next.sourceUrl;
}
function validCandidate(value: unknown): Candidate {
  const clip = value as Candidate;
  if (!clip || !clip.url || candidateIdFromUrl(clip.url) !== clip.video_id) throw new Error('Could not read this video’s source link. Reload the page and try again.');
  return clip;
}
async function captionDecision(clip: Candidate, jobId: unknown): Promise<{ matched: boolean; reason: string }> {
  const check = state.captionCheck;
  if (!check || check.jobId !== jobId || check.videoId !== clip.video_id || check.sessionId !== state.sessionId || check.maxSeconds !== state.settings.maxCaptionSeconds) return { matched: false, reason: 'Skipped: captions were not checked with the current filter.' };
  const job = await api(`/jobs/${encodeURIComponent(check.jobId)}`);
  const result = job.result;
  if (job.status !== 'completed' || !result || result.video_id !== clip.video_id || candidateIdFromUrl(result.url) !== clip.video_id) return { matched: false, reason: job.error || 'Skipped: caption check could not finish.' };
  const seconds = Number(result.caption_seconds);
  const verified = ['clear', 'brief'].includes(result.status) && Number.isFinite(seconds) && seconds >= 0 && seconds <= check.maxSeconds && result.frames_scanned > 0 && result.duration > 0;
  return { matched: verified, reason: String(result.reason || (verified ? `Estimated caption time: ${seconds.toFixed(1)} seconds.` : 'Skipped: persistent or unreadable on-screen captions.')) };
}
async function handle(message: Record<string, unknown>, sender: chrome.runtime.MessageSender): Promise<unknown> {
  await load();
  if (message.type === 'state') return { state };
  if (['prepareScan', 'captionStatus', 'scan', 'problem', 'exhausted'].includes(String(message.type))
      && (sender.tab?.id !== state.tabId || message.sessionId !== state.sessionId)) return { running: false, skipCaptionCheck: true };
  if (message.type === 'hello') return { running: state.status === 'running' && state.tabId === sender.tab?.id, sourceUrl: state.sessionSourceUrl || '', sessionId: state.sessionId };
  if (message.type === 'saveSettings') {
    const previous = state.settings;
    state.settings = settingsFrom(message.settings);
    // Re-read the current Short after changing filters; otherwise a prior skip
    // would remain cached even when the video meets the newly chosen criteria.
    if (filtersChanged(previous, state.settings)) {
      state.seenIds = [];
      if (state.status === 'running') {
        state.status = 'paused';
        state.reason = 'Filters changed. Resume to apply them, or Stop to choose another account.';
        await tellTab('halt');
        await cancelCaptionCheck();
      }
    }
    if (previous.mode !== state.settings.mode) { state.activeMode = state.settings.mode === 'narrated' ? 'narrated' : 'credits'; state.creditMisses = 0; }
    await save(); return { state };
  }
  if (message.type === 'start' || message.type === 'resume') {
    const settings = settingsFrom(message.settings);
    if (message.type === 'resume' && settings.sourceUrl !== state.sessionSourceUrl) throw new Error('Stop this session before scouting another account.');
    // Verify the engine and save pending matches before opening/reloading tabs.
    const existing = await api('/clips');
    const known = new Set<string>((existing.clips || []).map((clip: Candidate) => clip.video_id).filter(Boolean));
    state.knownIds = [...known];
    state.pending = state.pending.filter(clip => !known.has(clip.video_id));
    if (!(await flush())) return { state };
    if (message.type === 'resume' && (state.matched >= settings.target || state.scanned >= 500)) {
      state.settings = settings;
      state.status = 'complete'; state.reason = state.scanned >= 500 ? 'Reached the 500-video session limit. Start a new session to continue.' : 'Target reached. Your clips are in the Library.';
      await save(); return { state };
    }
    let tab: chrome.tabs.Tab;
    let reconnect = false;
    if (message.type === 'resume') {
      ({ tab, reconnect } = await resumeTab(message.tabId));
    } else if (settings.sourceUrl) {
      tab = await chrome.tabs.create({ url: 'about:blank', active: true });
    } else {
      const active = await existingTab(message.tabId);
      if (!active || !feedUrl(tabUrl(active))) throw new Error('Open a YouTube Short or Instagram Reel, or paste an account URL.');
      tab = active;
    }
    if (message.type === 'start') {
      await cancelCaptionCheck();
      state = { ...initialState(), tabProtection: state.tabProtection, knownIds: state.knownIds, settings, sessionSourceUrl: settings.sourceUrl || '', sessionId: `${Date.now()}-${Math.random().toString(36).slice(2)}`, tabId: tab.id!, activeMode: settings.mode === 'narrated' ? 'narrated' : 'credits' };
    } else {
      if (reconnect) await cancelCaptionCheck();
      state.tabId = tab.id!;
      if (filtersChanged(state.settings, settings)) state.seenIds = [];
      if (settings.mode !== state.settings.mode) { state.activeMode = settings.mode === 'narrated' ? 'narrated' : 'credits'; state.creditMisses = 0; }
      state.settings = settings;
    }
    state.status = 'running'; state.reason = `Looking for ${state.activeMode === 'credits' ? 'credited' : 'narrated'} Shorts and Reels.`;
    log(message.type === 'start' ? 'Scout started. Keep the scouting tab open; you can switch tabs.' : reconnect ? 'Scout reconnected. Your session progress was kept.' : 'Scout resumed.');
    await save();
    try {
      if ((message.type === 'start' || reconnect) && settings.sourceUrl) await chrome.tabs.update(tab.id!, { url: settings.sourceUrl });
      else if (reconnect) await chrome.tabs.reload(tab.id!);
      else await tellTab('run');
    }
    catch {
      state.status = 'paused'; state.reason = 'Could not reconnect to the scouting tab. Press Resume to try again, or reopen the selected account first.';
      await cancelCaptionCheck(); await save(); throw new Error(state.reason);
    }
    return { state };
  }
  if (message.type === 'pause' || message.type === 'stop') {
    state.status = message.type === 'pause' ? 'paused' : 'stopped';
    state.reason = message.type === 'pause' ? 'Paused. Resume when you are ready.' : 'Stopped. Your collected clips stay in the Library.';
    log(state.reason); await save(); await tellTab('halt'); await cancelCaptionCheck(); await save(); return { state };
  }
  if (message.type === 'retry') { const ok = await flush(); if (ok) { state.reason = 'Pending clips saved. You can resume scouting.'; await save(); } return { state }; }
  if (message.type === 'problem' && sender.tab?.id === state.tabId && state.status === 'running') {
    state.status = 'paused'; state.reason = String(message.reason).slice(0, 400); log(state.reason);
    await save(); await tellTab('halt'); await cancelCaptionCheck(); await save(); return { state };
  }
  if (message.type === 'exhausted' && sender.tab?.id === state.tabId && state.status === 'running' && state.sessionSourceUrl && message.sourceUrl === state.sessionSourceUrl) {
    state.status = 'complete'; state.reason = 'Finished this account’s available Shorts or Reels. Your matches are in the Library.';
    log(state.reason); await save(); await tellTab('halt'); await cancelCaptionCheck(); await save(); return { running: false, state };
  }
  if (message.type === 'prepareScan' && sender.tab?.id === state.tabId && state.status === 'running') {
    const clip = validCandidate(message.clip);
    const eligible = matchesCandidate(clip, state.settings, state.activeMode).matched;
    if (state.settings.captionFilter === 'off' || !eligible || state.seenIds.includes(clip.video_id) || state.knownIds.includes(clip.video_id) || state.pending.some(item => item.video_id === clip.video_id)) return { running: true, skipCaptionCheck: true };
    const limit = state.settings.maxCaptionSeconds ?? 3;
    let check = state.captionCheck;
    if (!check || check.videoId !== clip.video_id || check.maxSeconds !== limit || check.sessionId !== state.sessionId) {
      if (check) await cancelCaptionCheck();
      const job = await api('/scout/caption-check', { url: clip.url, max_caption_seconds: limit });
      if (!job.id) throw new Error('Caption screening is unavailable. Restart the updated ShortForge engine.');
      check = state.captionCheck = { jobId: job.id, videoId: clip.video_id, maxSeconds: limit, sessionId: state.sessionId };
    }
    state.reason = 'Checking on-screen captions across this video. You can pause at any time.';
    await save(); return { running: true, captionJobId: check.jobId };
  }
  if (message.type === 'captionStatus' && sender.tab?.id === state.tabId && state.status === 'running') {
    if (message.jobId !== state.captionCheck?.jobId) throw new Error('Caption check changed. Resume to check again.');
    const job = await api(`/jobs/${encodeURIComponent(String(message.jobId))}`);
    state.reason = `Checking on-screen captions… ${Math.round(Number(job.progress) || 0)}%`;
    await save(); return { running: true, job };
  }
  if (message.type === 'scan' && sender.tab?.id === state.tabId && state.status === 'running') {
    const clip = validCandidate(message.clip);
    if (state.seenIds.includes(clip.video_id)) return { running: true, repeat: true };
    const duplicate = state.knownIds.includes(clip.video_id) || state.pending.some(item => item.video_id === clip.video_id);
    if (state.settings.mode !== 'auto') state.activeMode = state.settings.mode;
    const decision = matchesCandidate(clip, state.settings, state.activeMode);
    if (!duplicate && decision.matched && state.settings.captionFilter !== 'off') {
      const caption = await captionDecision(clip, message.captionJobId);
      decision.matched = caption.matched; decision.reason = caption.reason;
    }
    const reason = duplicate ? 'Already in your Library or waiting to save' : decision.reason;
    const matched = !duplicate && decision.matched;
    state.seenIds.push(clip.video_id); state.scanned += 1;
    state.lastScan = { video_id: clip.video_id, title: clip.title, likes: clip.likes, views: clip.views, mode: state.activeMode, matched, reason };
    const counts = `${clip.likes?.toLocaleString('en-US') ?? 'unreadable'} likes; ${clip.views?.toLocaleString('en-US') ?? 'unreadable'} views`;
    log(`${matched ? 'Matched' : 'Skipped'}: ${clip.title.slice(0, 70) || clip.video_id} — ${counts}. ${reason}`);
    if (!duplicate && decision.matched) {
      const match = { ...clip, discovery_mode: state.activeMode };
      state.pending.push(match); state.matched += 1; state.creditMisses = 0;
      // Persist before making the network request so a stopped worker cannot lose a match.
      await save(); await flush();
    } else if (state.settings.mode === 'auto' && state.activeMode === 'credits') {
      state.creditMisses += 1;
      if (state.creditMisses >= 30) {
        state.activeMode = 'narrated'; state.reason = 'Switched to narrated candidates after 30 Shorts without a new credited match. Credits and keywords are no longer required.';
        log(state.reason);
      }
    }
    if (state.status === 'running' && (state.matched >= state.settings.target || state.scanned >= 500)) {
      state.status = 'complete'; state.reason = state.matched >= state.settings.target ? 'Target reached. Your clips are in the Library.' : 'Reached the 500-video session limit.'; log(state.reason);
    }
    state.captionCheck = null;
    if (state.status === 'running') state.reason = reason;
    await save(); return { running: state.status === 'running', reason };
  }
  return { state, running: false, skipCaptionCheck: true };
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Content-only commands are handled inside the scouting tab.
  if (['run', 'halt', 'selftest'].includes(message.type)) return;
  serial = serial.then(() => handle(message, sender)).then(respond, error => respond({ error: error instanceof Error ? error.message : 'Something went wrong. Try again.' }));
  return true;
});
chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create('retry-pending', { periodInMinutes: 1 }); });
chrome.runtime.onStartup.addListener(() => {
  serial = serial.then(async () => { await load(); if (state.status === 'running') { state.status = 'paused'; state.reason = 'Browser restarted. Open your scouting tab and resume.'; await cancelCaptionCheck(); await save(); } });
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== 'retry-pending') return;
  serial = serial.then(async () => { await load(); if (state.pending.length) await flush(); }).catch(() => {});
});
chrome.tabs.onRemoved.addListener(tabId => {
  serial = serial.then(async () => {
    await load();
    if (state.tabId !== tabId) return;
    state.tabId = null;
    if (state.status === 'running' || state.status === 'paused') {
      state.status = 'paused';
      state.reason = state.sessionSourceUrl ? 'Your scouting tab was closed. Press Resume to reconnect to this account and keep your progress.' : 'Your scouting tab was closed. Open a Short or Reel, then press Resume to keep your progress.';
    }
    await cancelCaptionCheck(); await save();
  }).catch(() => {});
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (!change.url || isScoutUrl(change.url)) return;
  serial = serial.then(async () => {
    await load();
    if (state.tabId === tabId && state.status === 'running') {
      // Chrome may still report about:blank as the committed URL while the
      // selected account is loading in pendingUrl. Ignore that queued event.
      try { const currentTab = await chrome.tabs.get(tabId); if (isScoutUrl(tabUrl(currentTab))) return; }
      catch { /* The removed-tab handler also releases this session. */ }
      state.status = 'paused';
      state.reason = 'This tab left Shorts or Reels. Handle any prompt, return to a video, then resume.';
      log(state.reason); await save(); await tellTab('halt'); await cancelCaptionCheck(); await save();
    }
  }).catch(() => {});
});
