import { initialState, type Candidate, type ScoutState, type Settings } from './types';
import { matchesCandidate } from './parsers';

const API = 'http://127.0.0.1:8787/api';
let state: ScoutState;
let serial: Promise<unknown> = Promise.resolve();
async function load() {
  if (!state) {
    const stored = await chrome.storage.local.get('scout');
    state = { ...initialState(), ...stored.scout };
    // Only Auto has a separate phase. Explicit choices always win over a
    // stale phase saved by an older extension worker.
    if (state.settings.mode !== 'auto') state.activeMode = state.settings.mode;
  }
  return state;
}
function log(text: string) { state.logs = [{ at: Date.now(), text }, ...state.logs].slice(0, 8); }
async function save() {
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
  try { await chrome.tabs.sendMessage(state.tabId, { type: command }); }
  catch {
    if (command === 'run') throw new Error('Reload your YouTube Shorts tab once, then press Start again.');
  }
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
function settingsFrom(value: unknown): Settings {
  const candidate = value as Settings;
  if (!candidate || !['narrated', 'credits', 'auto'].includes(candidate.mode)) throw new Error('Choose a discovery mode.');
  for (const [name, max] of [['target', 500], ['minLikes', 1e12], ['minViews', 1e12]] as const) {
    if (!Number.isSafeInteger(candidate[name]) || candidate[name] < (name === 'target' ? 1 : 0) || candidate[name] > max) throw new Error(name === 'target' ? 'Target must be a whole number from 1 to 500.' : 'Enter a valid whole-number minimum.');
  }
  return { target: candidate.target, minLikes: candidate.minLikes, minViews: candidate.minViews, mode: candidate.mode };
}
function filtersChanged(previous: Settings, next: Settings): boolean {
  return previous.mode !== next.mode || previous.minLikes !== next.minLikes || previous.minViews !== next.minViews;
}
async function handle(message: Record<string, unknown>, sender: chrome.runtime.MessageSender): Promise<unknown> {
  await load();
  if (message.type === 'state') return { state };
  if (message.type === 'hello') return { running: state.status === 'running' && state.tabId === sender.tab?.id };
  if (message.type === 'saveSettings') {
    const previous = state.settings;
    state.settings = settingsFrom(message.settings);
    // Re-read the current Short after changing filters; otherwise a prior skip
    // would remain cached even when the video meets the newly chosen criteria.
    if (filtersChanged(previous, state.settings)) state.seenIds = [];
    if (previous.mode !== state.settings.mode) { state.activeMode = state.settings.mode === 'narrated' ? 'narrated' : 'credits'; state.creditMisses = 0; }
    await save(); return { state };
  }
  if (message.type === 'start' || message.type === 'resume') {
    const settings = settingsFrom(message.settings);
    const tab = await chrome.tabs.get(Number(message.tabId));
    if (!tab.url?.startsWith('https://www.youtube.com/shorts/')) throw new Error('Open a YouTube Short in this tab first.');
    const existing = await api('/clips');
    const known = new Set<string>((existing.clips || []).map((clip: Candidate) => clip.video_id).filter(Boolean));
    state.knownIds = [...known];
    state.pending = state.pending.filter(clip => !known.has(clip.video_id));
    if (!(await flush())) return { state };
    if (message.type === 'start') {
      state = { ...initialState(), knownIds: state.knownIds, settings, tabId: tab.id!, activeMode: settings.mode === 'narrated' ? 'narrated' : 'credits' };
    } else {
      if (state.tabId !== tab.id) throw new Error('Resume in the same YouTube tab, or Stop and start a new session.');
      if (filtersChanged(state.settings, settings)) state.seenIds = [];
      if (settings.mode !== state.settings.mode) { state.activeMode = settings.mode === 'narrated' ? 'narrated' : 'credits'; state.creditMisses = 0; }
      state.settings = settings;
    }
    if (state.matched >= settings.target || state.scanned >= 500) {
      state.status = 'complete'; state.reason = state.scanned >= 500 ? 'Reached the 500-Short session limit. Start a new session to continue.' : 'Target reached. Your clips are in the Library.';
      await save(); return { state };
    }
    state.status = 'running'; state.reason = `Looking for ${state.activeMode === 'credits' ? 'credited' : 'narrated'} Shorts.`;
    log(message.type === 'start' ? 'Scout started. Leave this YouTube tab open.' : 'Scout resumed.');
    await save();
    try { await tellTab('run'); }
    catch (error) { state.status = 'paused'; state.reason = (error as Error).message; await save(); throw error; }
    return { state };
  }
  if (message.type === 'pause' || message.type === 'stop') {
    state.status = message.type === 'pause' ? 'paused' : 'stopped';
    state.reason = message.type === 'pause' ? 'Paused. Resume when you are ready.' : 'Stopped. Your collected clips stay in the Library.';
    log(state.reason); await save(); await tellTab('halt'); return { state };
  }
  if (message.type === 'retry') { const ok = await flush(); if (ok) { state.reason = 'Pending clips saved. You can resume scouting.'; await save(); } return { state }; }
  if (message.type === 'problem' && sender.tab?.id === state.tabId && state.status === 'running') {
    state.status = 'paused'; state.reason = String(message.reason).slice(0, 400); log(state.reason);
    await save(); await tellTab('halt'); return { state };
  }
  if (message.type === 'scan' && sender.tab?.id === state.tabId && state.status === 'running') {
    const clip = message.clip as Candidate;
    if (!clip || !/^[A-Za-z0-9_-]{11}$/.test(clip.video_id)) throw new Error('Could not read this Short’s video ID.');
    if (state.seenIds.includes(clip.video_id)) return { running: true, repeat: true };
    state.seenIds.push(clip.video_id); state.scanned += 1;
    const duplicate = state.knownIds.includes(clip.video_id) || state.pending.some(item => item.video_id === clip.video_id);
    if (state.settings.mode !== 'auto') state.activeMode = state.settings.mode;
    const decision = matchesCandidate(clip, state.settings, state.activeMode);
    const reason = duplicate ? 'Already in your Library or waiting to save' : decision.reason;
    const matched = !duplicate && decision.matched;
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
      state.status = 'complete'; state.reason = state.matched >= state.settings.target ? 'Target reached. Your clips are in the Library.' : 'Reached the 500-Short session limit.'; log(state.reason);
    }
    await save(); return { running: state.status === 'running', reason };
  }
  return { state };
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Content-only commands are handled inside the YouTube tab.
  if (['run', 'halt', 'selftest'].includes(message.type)) return;
  serial = serial.then(() => handle(message, sender)).then(respond, error => respond({ error: error instanceof Error ? error.message : 'Something went wrong. Try again.' }));
  return true;
});
chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create('retry-pending', { periodInMinutes: 1 }); });
chrome.runtime.onStartup.addListener(() => {
  serial = serial.then(async () => { await load(); if (state.status === 'running') { state.status = 'paused'; state.reason = 'Browser restarted. Open your Shorts tab and resume.'; await save(); } });
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== 'retry-pending') return;
  serial = serial.then(async () => { await load(); if (state.pending.length) await flush(); }).catch(() => {});
});
chrome.tabs.onRemoved.addListener(tabId => {
  serial = serial.then(async () => { await load(); if (state.tabId === tabId && state.status === 'running') { state.status = 'paused'; state.reason = 'Your Shorts tab was closed. Stop this session and start in another tab.'; await save(); } }).catch(() => {});
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (!change.url || change.url.startsWith('https://www.youtube.com/shorts/')) return;
  serial = serial.then(async () => {
    await load();
    if (state.tabId === tabId && state.status === 'running') {
      state.status = 'paused';
      state.reason = 'This tab left YouTube Shorts. Handle any prompt, return to a Short, then resume.';
      log(state.reason); await save(); await tellTab('halt');
    }
  }).catch(() => {});
});
