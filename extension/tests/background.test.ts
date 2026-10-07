import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import type { Candidate, ScoutState } from '../src/types';
import { initialState } from '../src/types';

async function harness(existingIds: string[] = [], initial?: ScoutState, autoDiscardable = true) {
  let handler: Function;
  let stored: Record<string, unknown> = initial ? { scout: initial } : {};
  let online = true;
  const known = new Set(existingIds);
  const sends: object[] = [];
  const jobs = new Map<string, any>();
  const created: any[] = [];
  const requests: string[] = [];
  const tabUrls = new Map<number, string>();
  const pendingUrls = new Map<number, string>();
  const reloads: number[] = [];
  const disconnected = new Set<number>();
  const tabUpdates: { id: number; autoDiscardable?: boolean; active?: boolean }[] = [];
  const tabs = new Map<number, boolean>([[7, autoDiscardable], [8, true]]);
  const tabEvents: Record<string, Function> = {};
  const code = await build({ entryPoints: ['src/background.ts'], bundle: true, write: false, format: 'iife', platform: 'browser' });
  const chrome = {
    runtime: { onMessage: { addListener: (fn: Function) => { handler = fn; } }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
    storage: { local: { get: async () => structuredClone(stored), set: async (value: object) => { stored = structuredClone(value); } } },
    action: { setBadgeBackgroundColor: async () => {}, setBadgeText: async () => {} },
    tabs: {
      get: async (id: number) => {
        if (!tabs.has(id)) throw new Error(`No tab with id: ${id}.`);
        return { id, url: tabUrls.get(id) || 'https://www.youtube.com/shorts/tleaVXWF3YI', pendingUrl: pendingUrls.get(id), active: false, autoDiscardable: tabs.get(id) };
      },
      query: async () => [...tabs.keys()].map(id => ({ id, url: tabUrls.get(id) || 'https://www.youtube.com/shorts/tleaVXWF3YI' })),
      reload: async (id: number) => {
        if (!tabs.has(id)) throw new Error(`No tab with id: ${id}.`);
        reloads.push(id);
      },
      update: async (id: number, properties: { autoDiscardable?: boolean; active?: boolean; url?: string }) => {
        if (!tabs.has(id)) throw new Error('No tab');
        tabUpdates.push({ id, ...properties });
        if (properties.url) tabUrls.set(id, properties.url);
        if (properties.autoDiscardable !== undefined) tabs.set(id, properties.autoDiscardable);
      },
      create: async (props: any) => { const tab = { id: 9, ...props }; created.push(tab); tabs.set(9, true); tabUrls.set(9, props.url); return tab; },
      sendMessage: async (id: number, message: object) => {
        if (!tabs.has(id) || disconnected.has(id)) throw new Error('Receiving end does not exist');
        sends.push(message);
      },
      onRemoved: { addListener: (fn: Function) => { tabEvents.removed = fn; } },
      onUpdated: { addListener: (fn: Function) => { tabEvents.updated = fn; } },
    },
    alarms: { create() {}, onAlarm: { addListener() {} } },
  };
  vm.runInNewContext(code.outputFiles[0].text, { chrome, console, AbortSignal, setTimeout, Date, URL, fetch: async (url: string, options: RequestInit) => {
    if (!online) throw new Error('network');
    requests.push(url);
    if (url.endsWith('/scout/caption-check')) {
      const body = JSON.parse(options.body as string);
      const path = new URL(body.url).pathname.split('/');
      const video_id = body.url.includes('instagram.com') ? `ig:${path[2]}` : path[2];
      const job = { id: `job-${jobs.size + 1}`, status: 'running', progress: 10, result: { video_id, url: body.url, max_caption_seconds: body.max_caption_seconds, policy: body.policy ?? 'brief-only' } };
      jobs.set(job.id, job); return { ok: true, json: async () => structuredClone(job) };
    }
    if (url.endsWith('/cancel')) {
      const job = jobs.get(url.split('/').at(-2)!);
      if (job) job.status = 'cancelled';
      return { ok: true, json: async () => job };
    }
    if (url.includes('/jobs/')) return { ok: true, json: async () => structuredClone(jobs.get(url.split('/').at(-1)!)) };
    let added = 0;
    if (options.body) for (const clip of JSON.parse(options.body as string).clips) if (!known.has(clip.video_id)) { known.add(clip.video_id); added++; }
    return { ok: true, json: async () => ({ clips: [...known].map(video_id => ({ video_id })), added }) };
  } });
  const message = (payload: object, tab: boolean | number = false) => new Promise<any>(resolve => handler(tab ? { sessionId: (stored.scout as ScoutState)?.sessionId || '', ...payload } : payload, tab ? { tab: { id: typeof tab === 'number' ? tab : 7 } } : {}, resolve));
  const tabEvent = async (name: string, ...args: unknown[]) => {
    if (name === 'removed') tabs.delete(args[0] as number);
    if (name === 'updated' && (args[1] as any).url) tabUrls.set(args[0] as number, (args[1] as any).url);
    tabEvents[name](...args);
    await message({ type: 'state' });
  };
  return { message, state: () => stored.scout as ScoutState, online: (value: boolean) => { online = value; }, known, sends, tabUpdates, tabs, tabEvent, jobs, created, requests, tabUrls, pendingUrls, reloads, disconnected };
}
const settings = { target: 30, minLikes: 5000, minViews: 10000, mode: 'narrated', sourceUrl: '', captionFilter: 'off', maxCaptionSeconds: 3 };
const clip = (index: number, extra: Partial<Candidate> = {}): Candidate => ({ video_id: `test${String(index).padStart(7, '0')}`, url: `https://www.youtube.com/shorts/test${String(index).padStart(7, '0')}`, title: 'A narrated story', description: '', likes: 8000, views: 20000, credit_target: '', credit_snippet: '', channel_handle: '', channel_name: '', thumbnail_url: '', ...extra });

test('new collection dedupes engine records and stops exactly at target', async () => {
  const h = await harness([clip(0).video_id]);
  await h.message({ type: 'start', tabId: 7, settings: { ...settings, target: 2 } });
  await h.message({ type: 'scan', clip: clip(0) }, true);
  await h.message({ type: 'scan', clip: clip(1) }, true);
  await h.message({ type: 'scan', clip: clip(1) }, true);
  await h.message({ type: 'scan', clip: clip(2) }, true);
  assert.equal(h.state().scanned, 3);
  assert.equal(h.state().matched, 2);
  assert.equal(h.state().saved, 2);
  assert.equal(h.state().status, 'complete');
  assert.equal(h.state().pending.length, 0);
  assert.deepEqual(h.tabUpdates, [{ id: 7, autoDiscardable: false }, { id: 7, autoDiscardable: true }]);
  assert.equal(h.state().tabProtection, null);
});
test('failed uploads persist and pause; retry saves once without losing the clip', async () => {
  const h = await harness();
  await h.message({ type: 'start', tabId: 7, settings });
  h.online(false);
  await h.message({ type: 'scan', clip: clip(1) }, true);
  assert.equal(h.state().status, 'paused');
  assert.equal(h.state().pending.length, 1);
  assert.equal(h.state().saved, 0);
  assert.equal(h.tabs.get(7), true, 'An engine failure releases the running tab protection');
  h.online(true);
  await h.message({ type: 'retry' });
  assert.equal(h.state().pending.length, 0);
  assert.equal(h.state().saved, 1);
  assert.equal(h.state().matched, 1);
  await h.message({ type: 'retry' });
  assert.equal(h.state().saved, 1);
});
test('credit-first fallback changes after 30 misses and does not imply audio verification', async () => {
  const h = await harness();
  await h.message({ type: 'start', tabId: 7, settings: { ...settings, mode: 'auto' } });
  for (let i = 0; i < 30; i++) await h.message({ type: 'scan', clip: clip(i) }, true);
  assert.equal(h.state().activeMode, 'narrated');
  assert.equal(h.state().matched, 0);
  await h.message({ type: 'scan', clip: clip(31, { title: 'Wait for the ending', description: '' }) }, true);
  assert.equal(h.state().matched, 1);
  assert.equal(h.state().saved, 1);
});
test('500 scanned Shorts is a hard stop and unknown counts cannot match', async () => {
  const h = await harness();
  await h.message({ type: 'start', tabId: 7, settings });
  for (let i = 0; i < 500; i++) await h.message({ type: 'scan', clip: clip(i, { likes: null }) }, true);
  assert.equal(h.state().status, 'complete');
  assert.equal(h.state().scanned, 500);
  assert.equal(h.state().matched, 0);
  const late = await h.message({ type: 'scan', clip: clip(501) }, true);
  assert.equal(late.state.scanned, 500);
});
test('challenge pauses only the active tab, and stopped sessions ignore in-flight reads', async () => {
  const h = await harness();
  await h.message({ type: 'start', tabId: 7, settings });
  await h.message({ type: 'problem', reason: 'Verify first' });
  assert.equal(h.state().status, 'running');
  await h.message({ type: 'problem', reason: 'Verify first' }, true);
  assert.equal(h.state().status, 'paused');
  await h.message({ type: 'scan', clip: clip(1) }, true);
  assert.equal(h.state().matched, 0);
  await h.message({ type: 'stop' });
  assert.equal(h.state().status, 'stopped');
});
test('narrated mode saves a full target without credits or narration keywords', async () => {
  const h = await harness();
  await h.message({ type: 'start', tabId: 7, settings });
  for (let i = 0; i < 36; i++) {
    await h.message({ type: 'scan', clip: clip(i, { title: 'Wait for the ending', description: '', likes: 5000, views: 10000 }) }, true);
  }
  assert.equal(h.state().matched, 30);
  assert.equal(h.state().saved, 30);
  assert.equal(h.known.size, 30);
  assert.equal(h.state().scanned, 30);
  assert.equal(h.state().status, 'complete');
  assert.equal(h.state().lastScan?.matched, true);
  assert.equal(h.state().lastScan?.mode, 'narrated');
});
test('explicit narrated mode overrides a stale saved credits phase after a worker reload', async () => {
  const h = await harness([], { ...initialState(), settings: { ...initialState().settings, captionFilter: 'off' }, status: 'running', activeMode: 'credits', tabId: 7 });
  await h.message({ type: 'scan', clip: clip(1, { title: 'Wait for the ending' }) }, true);
  assert.equal(h.state().activeMode, 'narrated');
  assert.equal(h.state().saved, 1);
  assert.equal(h.state().lastScan?.mode, 'narrated');
});
test('changing credits to narrated while paused takes effect immediately on resume', async () => {
  const h = await harness();
  await h.message({ type: 'start', tabId: 7, settings: { ...settings, mode: 'credits' } });
  await h.message({ type: 'scan', clip: clip(1, { title: 'Wait for the ending' }) }, true);
  assert.equal(h.state().saved, 0);
  assert.match(h.state().lastScan!.reason, /No credited source/);
  await h.message({ type: 'pause' });
  await h.message({ type: 'saveSettings', settings });
  await h.message({ type: 'resume', tabId: 7, settings });
  await h.message({ type: 'scan', clip: clip(1, { title: 'Wait for the ending' }) }, true);
  assert.equal(h.state().saved, 1);
});
test('lowering a threshold on resume rechecks a previously skipped Short', async () => {
  const h = await harness();
  await h.message({ type: 'start', tabId: 7, settings });
  await h.message({ type: 'scan', clip: clip(1, { likes: 4999 }) }, true);
  assert.equal(h.state().saved, 0);
  await h.message({ type: 'pause' });
  await h.message({ type: 'resume', tabId: 7, settings: { ...settings, minLikes: 4000 } });
  await h.message({ type: 'scan', clip: clip(1, { likes: 4999 }) }, true);
  assert.equal(h.state().saved, 1);
});
test('last scan and recent activity expose missing views, low counts, and duplicates', async () => {
  const h = await harness([clip(3).video_id]);
  await h.message({ type: 'start', tabId: 7, settings });
  await h.message({ type: 'scan', clip: clip(1, { views: null }) }, true);
  assert.equal(h.state().lastScan?.likes, 8000);
  assert.equal(h.state().lastScan?.views, null);
  assert.match(h.state().logs[0].text, /Skipped:.*8,000 likes; unreadable views/);
  await h.message({ type: 'scan', clip: clip(2, { likes: 4999 }) }, true);
  assert.match(h.state().lastScan!.reason, /likes 4,999 < 5,000/);
  await h.message({ type: 'scan', clip: clip(3) }, true);
  assert.match(h.state().lastScan!.reason, /Already in your Library/);
  await h.message({ type: 'pause' });
  assert.match(h.state().lastScan!.reason, /Already in your Library/);
  assert.equal(h.state().matched, 0);
});

test('background scouting protects only its tab and restores on pause, resume and stop', async () => {
  const h = await harness();
  await h.message({ type: 'start', tabId: 7, settings });
  assert.equal(h.state().status, 'running');
  assert.equal(h.tabs.get(7), false);
  assert.equal(h.tabs.get(8), true);
  await h.message({ type: 'pause' });
  assert.equal(h.tabs.get(7), true);
  await h.message({ type: 'resume', tabId: 7, settings });
  assert.equal(h.tabs.get(7), false);
  await h.message({ type: 'stop' });
  assert.equal(h.tabs.get(7), true);
  assert.ok(h.tabUpdates.every(update => !('active' in update)), 'Never steal focus');
});

test('a previously protected tab stays protected after Scout finishes', async () => {
  const h = await harness([], undefined, false);
  await h.message({ type: 'start', tabId: 7, settings: { ...settings, target: 1 } });
  await h.message({ type: 'scan', clip: clip(1) }, true);
  assert.equal(h.state().status, 'complete');
  assert.equal(h.tabs.get(7), false);
  assert.equal(h.state().tabProtection, null);
});

test('protection survives worker reload and is restored before scouting a different tab', async () => {
  const h = await harness([], { ...initialState(), status: 'running', tabId: 7,
    tabProtection: { tabId: 7, autoDiscardable: true } }, false);
  await h.message({ type: 'start', tabId: 8, settings });
  assert.equal(h.tabs.get(7), true);
  assert.equal(h.tabs.get(8), false);
  await h.message({ type: 'stop' });
  assert.equal(h.tabs.get(8), true);
});

test('navigation and closed-tab recovery release tab protection', async () => {
  const h = await harness();
  await h.message({ type: 'start', tabId: 7, settings });
  await h.tabEvent('updated', 8, { url: 'https://example.com/' });
  assert.equal(h.state().status, 'running');
  await h.tabEvent('updated', 7, { url: 'https://example.com/' });
  assert.equal(h.state().status, 'paused');
  assert.equal(h.tabs.get(7), true);
  h.tabUrls.set(7, 'https://www.youtube.com/shorts/tleaVXWF3YI');
  await h.message({ type: 'resume', tabId: 7, settings });
  await h.tabEvent('removed', 7);
  assert.equal(h.state().status, 'paused');
  assert.equal(h.state().tabProtection, null);
});


test('legacy stored settings gain the caption filter and account defaults', async () => {
  const h = await harness([], { ...initialState(), settings: { target: 30, minLikes: 5000, minViews: 10000, mode: 'narrated' } });
  const result = await h.message({ type: 'state' });
  assert.equal(result.state.settings.captionFilter, 'brief-only');
  assert.equal(result.state.settings.maxCaptionSeconds, 3);
  assert.equal(result.state.settings.sourceUrl, '');
});

test('account start opens the canonical account and resume keeps its scouting tab', async () => {
  const h = await harness();
  const account = { ...settings, sourceUrl: 'https://instagram.com/example.creator/' };
  await h.message({ type: 'start', tabId: 7, settings: account });
  assert.equal(h.state().status, 'running');
  assert.equal(h.state().tabId, 9);
  assert.equal(h.tabUrls.get(9), 'https://www.instagram.com/example.creator/reels/');
  await h.message({ type: 'pause' });
  await h.message({ type: 'resume', tabId: 7, settings: account });
  assert.equal(h.state().status, 'running');
  assert.equal(h.created.length, 1);
});

test('account changes require a new session even after settings were saved', async () => {
  const h = await harness();
  await h.message({ type: 'start', tabId: 7, settings });
  await h.message({ type: 'pause' });
  const next = { ...settings, sourceUrl: 'https://www.youtube.com/@example/shorts' };
  await h.message({ type: 'saveSettings', settings: next });
  const response = await h.message({ type: 'resume', tabId: 7, settings: next });
  assert.match(response.error, /Stop this session/);
});

const accountUrl = 'https://www.instagram.com/qianxiang_guyue/reels/';
function lostAccount(): ScoutState {
  return { ...initialState(), status: 'paused', tabId: 666544235, sessionId: 'existing-account-session', sessionSourceUrl: accountUrl,
    settings: { ...settings, mode: 'narrated', captionFilter: 'off', sourceUrl: accountUrl }, scanned: 21, matched: 2, saved: 2,
    seenIds: [clip(1).video_id], knownIds: [clip(1).video_id] };
}

test('stale account tab reconnects to the active profile without losing session progress', async () => {
  const initial = lostAccount();
  const h = await harness([clip(1).video_id], initial);
  h.tabUrls.set(7, accountUrl);
  const response = await h.message({ type: 'resume', tabId: 7, settings: initial.settings });
  assert.equal(response.error, undefined);
  assert.equal(h.state().status, 'running');
  assert.equal(h.state().tabId, 7);
  assert.equal(h.state().scanned, 21);
  assert.equal(h.state().matched, 2);
  assert.equal(h.state().saved, 2);
  assert.equal(h.state().sessionId, initial.sessionId);
  assert.deepEqual(h.state().seenIds, initial.seenIds);
  assert.equal(h.created.length, 0);
  assert.equal(h.tabUrls.get(7), accountUrl);
  await h.message({ type: 'scan', clip: clip(1) }, true);
  assert.equal(h.state().scanned, 21, 'Previously seen videos are not counted again');
  await h.message({ type: 'scan', clip: clip(2) }, 666544235);
  assert.equal(h.state().saved, 2, 'Late messages from the lost tab are ignored');
});

test('recovery finds the selected account in another tab and leaves unrelated tabs alone', async () => {
  const initial = lostAccount();
  const h = await harness([], initial);
  h.tabUrls.set(7, 'https://www.instagram.com/another.creator/reels/');
  h.tabUrls.set(8, 'https://instagram.com/qianxiang_guyue/?hl=en');
  await h.message({ type: 'resume', tabId: 7, settings: initial.settings });
  assert.equal(h.state().tabId, 8);
  assert.equal(h.tabUrls.get(8), accountUrl, 'Profile root is opened at its Reels grid');
  assert.equal(h.created.length, 0);
  assert.equal(h.tabUrls.get(7), 'https://www.instagram.com/another.creator/reels/');
  assert.ok(h.tabUpdates.every(update => update.id !== 7 && !('active' in update)));
});

test('missing account tab is recreated from its grid; arbitrary Reel tabs are not adopted', async () => {
  const initial = lostAccount();
  const h = await harness([], initial);
  h.tabUrls.set(7, 'https://www.instagram.com/reel/AbCde12345_/');
  await h.message({ type: 'resume', tabId: 7, settings: initial.settings });
  assert.equal(h.state().tabId, 9);
  assert.equal(h.state().scanned, 21);
  assert.equal(h.state().sessionId, initial.sessionId);
  assert.equal(h.created[0].url, 'about:blank');
  assert.equal(h.tabUrls.get(9), accountUrl);
  assert.equal(h.tabUrls.get(7), 'https://www.instagram.com/reel/AbCde12345_/');
});

test('closing an already-paused tab clears its ID and Resume recovers the account', async () => {
  const initial = { ...lostAccount(), tabId: 7 };
  const h = await harness([], initial);
  h.tabUrls.set(7, accountUrl);
  await h.tabEvent('removed', 7);
  assert.equal(h.state().tabId, null);
  assert.equal(h.state().status, 'paused');
  assert.match(h.state().reason, /Resume to reconnect/);
  const response = await h.message({ type: 'resume', tabId: 8, settings: initial.settings });
  assert.equal(response.error, undefined);
  assert.equal(h.state().tabId, 9);
  assert.equal(h.state().scanned, 21);
});

test('a newly recovered tab does not pause on about:blank while its account is loading', async () => {
  const initial = lostAccount();
  const h = await harness([], initial);
  await h.message({ type: 'resume', tabId: 7, settings: initial.settings });
  h.pendingUrls.set(9, accountUrl);
  await h.tabEvent('updated', 9, { url: 'about:blank' });
  assert.equal(h.state().status, 'running');
  assert.equal(h.state().tabId, 9);
  h.pendingUrls.delete(9);
  await h.tabEvent('updated', 9, { url: accountUrl });
  assert.equal(h.state().status, 'running');
  await h.tabEvent('updated', 9, { url: 'https://example.com/' });
  assert.equal(h.state().status, 'paused', 'Real navigation away must still pause');
});

test('unrelated URL in the remembered tab is not overwritten during recovery', async () => {
  const initial = { ...lostAccount(), tabId: 7 };
  const h = await harness([], initial);
  h.tabUrls.set(7, 'https://www.instagram.com/someone.else/reels/');
  await h.message({ type: 'resume', tabId: 7, settings: initial.settings });
  assert.equal(h.state().tabId, 9);
  assert.equal(h.tabUrls.get(7), 'https://www.instagram.com/someone.else/reels/');
});

test('returning the original scouting tab to the account profile reopens its Reels grid', async () => {
  const initial = { ...lostAccount(), tabId: 7 };
  const h = await harness([], initial);
  h.tabUrls.set(7, 'https://www.instagram.com/qianxiang_guyue/');
  await h.message({ type: 'resume', tabId: 7, settings: initial.settings });
  assert.equal(h.state().tabId, 7);
  assert.equal(h.tabUrls.get(7), accountUrl);
  assert.equal(h.created.length, 0);
  assert.equal(h.state().scanned, 21);
});

test('changing accounts still requires Stop before any stale-tab lookup or new navigation', async () => {
  const initial = lostAccount();
  const h = await harness([], initial);
  const response = await h.message({ type: 'resume', tabId: 7, settings: { ...initial.settings, sourceUrl: 'https://instagram.com/another.creator/' } });
  assert.match(response.error, /Stop this session/);
  assert.equal(h.created.length, 0);
  assert.equal(h.state().scanned, 21);
});

test('recovery saves pending clips first and cancels the old caption ticket', async () => {
  const initial = lostAccount();
  initial.pending = [clip(2)];
  initial.matched = 3;
  initial.captionCheck = { jobId: 'old-job', videoId: clip(3).video_id, maxSeconds: 3, sessionId: initial.sessionId };
  const h = await harness([clip(1).video_id], initial);
  h.jobs.set('old-job', { status: 'running' });
  h.online(false);
  const failed = await h.message({ type: 'resume', tabId: 7, settings: initial.settings });
  assert.match(failed.error, /offline/);
  assert.equal(h.created.length, 0);
  assert.equal(h.state().pending.length, 1);
  h.online(true);
  await h.message({ type: 'resume', tabId: 7, settings: initial.settings });
  assert.equal(h.state().saved, 3);
  assert.equal(h.state().pending.length, 0);
  assert.equal(h.state().captionCheck, null);
  assert.equal(h.jobs.get('old-job').status, 'cancelled');
});

test('a completed session with a missing tab does not open a replacement', async () => {
  const initial = lostAccount();
  initial.scanned = 500;
  const h = await harness([], initial);
  await h.message({ type: 'resume', tabId: 7, settings: initial.settings });
  assert.equal(h.state().status, 'complete');
  assert.equal(h.created.length, 0);
});

test('lost feed session resumes in an open player or explains which page to open', async () => {
  const initial = { ...lostAccount(), sessionSourceUrl: '', settings: { ...lostAccount().settings, sourceUrl: '' } };
  const h = await harness([], initial);
  h.tabUrls.set(7, 'https://example.com/');
  const failed = await h.message({ type: 'resume', tabId: 7, settings: initial.settings });
  assert.match(failed.error, /Open a YouTube Short or Instagram Reel/);
  assert.doesNotMatch(failed.error, /No tab with id/);
  assert.equal(h.created.length, 0);
  h.tabUrls.set(7, 'https://www.instagram.com/reel/AbCde12345_/');
  const result = await h.message({ type: 'resume', tabId: 7, settings: initial.settings });
  assert.equal(result.error, undefined);
  assert.equal(h.state().tabId, 7);
  assert.equal(h.state().scanned, 21);
  assert.deepEqual(h.reloads, [7]);
});

test('after extension reload, disconnected content scripts reload and resume automatically', async () => {
  for (const sourceUrl of ['', accountUrl]) {
    const initial = { ...lostAccount(), tabId: 7, sessionSourceUrl: sourceUrl, settings: { ...lostAccount().settings, sourceUrl } };
    const h = await harness([], initial);
    if (sourceUrl) h.tabUrls.set(7, sourceUrl);
    h.disconnected.add(7);
    const response = await h.message({ type: 'resume', tabId: 7, settings: initial.settings });
    assert.equal(response.error, undefined);
    assert.equal(h.state().status, 'running');
    assert.equal(h.state().scanned, 21);
    if (sourceUrl) assert.ok(h.tabUpdates.some(update => (update as any).url === accountUrl));
    else assert.deepEqual(h.reloads, [7]);
    const hello = await h.message({ type: 'hello' }, true);
    assert.equal(hello.running, true);
    assert.equal(hello.sessionId, initial.sessionId);
  }
});

test('Instagram ids save independently and candidate URL mismatches are rejected', async () => {
  const h = await harness();
  await h.message({ type: 'start', tabId: 7, settings });
  await h.message({ type: 'scan', clip: clip(1, { video_id: 'ig:AbCde12345_', url: 'https://www.instagram.com/reel/AbCde12345_/' }) }, true);
  assert.equal(h.state().saved, 1);
  const bad = await h.message({ type: 'scan', clip: clip(2, { url: 'https://evil.example/shorts/test0000002' }) }, true);
  assert.match(bad.error, /source link/);
});

async function captionHarness(policy = 'brief-only') {
  const h = await harness();
  await h.message({ type: 'start', tabId: 7, settings: { ...settings, captionFilter: policy } });
  return h;
}
function finishCaption(h: Awaited<ReturnType<typeof harness>>, jobId: string, seconds: number, extra: object = {}) {
  const job = h.jobs.get(jobId);
  job.status = 'completed';
  job.result = { ...job.result, status: seconds <= 3 ? 'brief' : 'persistent', duration: 30, caption_seconds: seconds, frames_scanned: 60, reason: 'Caption check', ...extra };
}

test('brief checked captions save; persistent, unchecked and wrong-video results never save', async () => {
  const h = await captionHarness();
  const first = await h.message({ type: 'prepareScan', clip: clip(1) }, true);
  assert.ok(first.captionJobId);
  finishCaption(h, first.captionJobId, 3);
  await h.message({ type: 'scan', clip: clip(1), captionJobId: first.captionJobId }, true);
  assert.equal(h.state().saved, 1);
  const second = await h.message({ type: 'prepareScan', clip: clip(2) }, true);
  finishCaption(h, second.captionJobId, 24);
  await h.message({ type: 'scan', clip: clip(2), captionJobId: second.captionJobId }, true);
  await h.message({ type: 'scan', clip: clip(3) }, true);
  const fourth = await h.message({ type: 'prepareScan', clip: clip(4) }, true);
  finishCaption(h, fourth.captionJobId, 0, { video_id: clip(1).video_id });
  await h.message({ type: 'scan', clip: clip(4), captionJobId: fourth.captionJobId }, true);
  assert.equal(h.state().saved, 1);
  assert.equal(h.state().scanned, 4);
});

const silentSmallText = { small_text_seconds: 20, speech_status: 'absent', speech_seconds: 0, speech_analysis_duration: 30, speech_model: 'silero-vad-test' };

test('optional small-Chinese-text policy saves only after full caption and speech verification', async () => {
  const h = await captionHarness('small-text-no-speech');
  const prepared = await h.message({ type: 'prepareScan', clip: clip(1) }, true);
  assert.ok(prepared.captionJobId);
  assert.equal(h.jobs.get(prepared.captionJobId).result.policy, 'small-text-no-speech');
  assert.equal(h.state().captionCheck?.policy, 'small-text-no-speech');
  finishCaption(h, prepared.captionJobId, 1, silentSmallText);
  await h.message({ type: 'scan', clip: clip(1), captionJobId: prepared.captionJobId }, true);
  assert.equal(h.state().saved, 1);
});

test('new policy fails closed on speech, partial audio, missing evidence and incompatible results', async () => {
  const h = await captionHarness('small-text-no-speech');
  const invalid = [
    { speech_status: 'present', speech_seconds: 2, status: 'speech' },
    { speech_status: 'unknown' }, { speech_status: undefined },
    { speech_analysis_duration: 5 }, { speech_analysis_duration: null },
    { speech_model: '' }, { speech_seconds: null }, { speech_seconds: 0.1 },
    { small_text_seconds: null }, { small_text_seconds: 31 },
    { policy: 'brief-only' }, { policy: undefined }, { max_caption_seconds: 10 },
    { duration: null }, { status: 'unknown' }, { caption_seconds: null },
  ];
  for (const [index, extra] of invalid.entries()) {
    const candidate = clip(index + 1);
    const prepared = await h.message({ type: 'prepareScan', clip: candidate }, true);
    finishCaption(h, prepared.captionJobId, 0, { ...silentSmallText, ...extra });
    await h.message({ type: 'scan', clip: candidate, captionJobId: prepared.captionJobId }, true);
    assert.equal(h.state().saved, 0, JSON.stringify(extra));
  }
});

test('persistent other subtitles still fail the small-text exception even with no speech', async () => {
  const h = await captionHarness('small-text-no-speech');
  const prepared = await h.message({ type: 'prepareScan', clip: clip(1) }, true);
  finishCaption(h, prepared.captionJobId, 12, silentSmallText);
  await h.message({ type: 'scan', clip: clip(1), captionJobId: prepared.captionJobId }, true);
  assert.equal(h.state().saved, 0);
});

test('switching caption policy cancels its job and cannot reuse a previous policy result', async () => {
  const h = await captionHarness();
  const old = await h.message({ type: 'prepareScan', clip: clip(1) }, true);
  await h.message({ type: 'saveSettings', settings: { ...settings, captionFilter: 'small-text-no-speech' } });
  assert.equal(h.jobs.get(old.captionJobId).status, 'cancelled');
  await h.message({ type: 'resume', tabId: 7, settings: { ...settings, captionFilter: 'small-text-no-speech' } });
  const next = await h.message({ type: 'prepareScan', clip: clip(1) }, true);
  assert.notEqual(next.captionJobId, old.captionJobId);
  finishCaption(h, old.captionJobId, 0, silentSmallText);
  await h.message({ type: 'scan', clip: clip(1), captionJobId: old.captionJobId }, true);
  assert.equal(h.state().saved, 0);
});

test('brief-only keeps speech optional and rejects using relaxed-policy results', async () => {
  const h = await captionHarness();
  const first = await h.message({ type: 'prepareScan', clip: clip(1) }, true);
  finishCaption(h, first.captionJobId, 2, { policy: undefined });
  await h.message({ type: 'scan', clip: clip(1), captionJobId: first.captionJobId }, true);
  assert.equal(h.state().saved, 1, 'Legacy strict OCR results remain compatible');
  const second = await h.message({ type: 'prepareScan', clip: clip(2) }, true);
  finishCaption(h, second.captionJobId, 0, { ...silentSmallText, policy: 'small-text-no-speech' });
  await h.message({ type: 'scan', clip: clip(2), captionJobId: second.captionJobId }, true);
  assert.equal(h.state().saved, 1, 'An exemption must not leak into the strict filter');
});

test('user-chosen thresholds, including zero, govern eligibility instead of the defaults', async () => {
  const h = await harness();
  const custom = { ...settings, minLikes: 100, minViews: 1000, captionFilter: 'small-text-no-speech' };
  await h.message({ type: 'start', tabId: 7, settings: custom });
  const candidate = clip(1, { likes: 242, views: 15381 });
  const prepared = await h.message({ type: 'prepareScan', clip: candidate }, true);
  assert.ok(prepared.captionJobId, 'The screenshot clip clears custom100/1000 minimums');
  finishCaption(h, prepared.captionJobId, 0, silentSmallText);
  await h.message({ type: 'scan', clip: candidate, captionJobId: prepared.captionJobId }, true);
  assert.equal(h.state().saved, 1);
  await h.message({ type: 'pause' });
  await h.message({ type: 'resume', tabId: 7, settings: { ...custom, minLikes: 0, minViews: 0, captionFilter: 'off' } });
  await h.message({ type: 'scan', clip: clip(2, { likes: null, views: null }) }, true);
  assert.equal(h.state().saved, 2, 'Zero ignores hidden counts');
  assert.equal(h.state().settings.minLikes, 0);
  assert.equal(h.state().settings.minViews, 0);
});

test('credited-any mode accepts captions and voiceover without analysis, but still requires credit and custom counts', async () => {
  const h = await harness();
  const chosen = { ...settings, mode: 'credits-any', captionFilter: 'small-text-no-speech', minLikes: 100, minViews: 1000 };
  const started = await h.message({ type: 'start', tabId: 7, settings: chosen });
  assert.equal(started.error, undefined);
  assert.equal(h.state().settings.captionFilter, 'off');
  assert.equal(h.state().activeMode, 'credits');
  const credited = clip(1, { video_id: 'ig:Credit12345', url: 'https://www.instagram.com/reel/Credit12345/', title: 'Voiceover with full-length subtitles', credit_target: '@original', credit_snippet: 'Credit: @original', likes: 242, views: 15381 });
  const prepared = await h.message({ type: 'prepareScan', clip: credited }, true);
  assert.equal(prepared.skipCaptionCheck, true);
  assert.equal(h.jobs.size, 0);
  await h.message({ type: 'scan', clip: credited }, true);
  assert.equal(h.state().saved, 1);
  assert.equal(h.state().lastScan?.mode, 'credits');
  assert.match(h.state().lastScan!.reason, /Credited source/);
  await h.message({ type: 'scan', clip: clip(2, { title: 'Narrated with captions, no attribution' }) }, true);
  assert.equal(h.state().saved, 1);
  assert.match(h.state().lastScan!.reason, /No credited source/);
  await h.message({ type: 'scan', clip: clip(3, { credit_target: '@original', likes: 99 }) }, true);
  assert.equal(h.state().saved, 1);
  assert.match(h.state().lastScan!.reason, /likes 99 < 100/);
  assert.equal(h.requests.some(url => url.includes('/scout/caption-check')), false);
});

test('credited-any never falls back to uncredited videos after misses', async () => {
  const h = await harness();
  await h.message({ type: 'start', tabId: 7, settings: { ...settings, mode: 'credits-any' } });
  for (let index = 0; index < 32; index++) await h.message({ type: 'scan', clip: clip(index) }, true);
  assert.equal(h.state().activeMode, 'credits');
  assert.equal(h.state().matched, 0);
  assert.equal(h.state().status, 'running');
});

test('restoring credited-any normalizes stale caption and active-mode settings', async () => {
  const h = await harness([], { ...initialState(), settings: { ...initialState().settings, mode: 'credits-any', captionFilter: 'brief-only' }, activeMode: 'narrated' });
  const restored = await h.message({ type: 'state' });
  assert.equal(restored.state.settings.mode, 'credits-any');
  assert.equal(restored.state.settings.captionFilter, 'off');
  assert.equal(restored.state.activeMode, 'credits');
});

test('switching to credited-any cancels analysis, and switching back restores configurable credit filtering', async () => {
  const h = await captionHarness('small-text-no-speech');
  const candidate = clip(1, { credit_target: '@creator' });
  const prepared = await h.message({ type: 'prepareScan', clip: candidate }, true);
  await h.message({ type: 'saveSettings', settings: { ...settings, mode: 'credits-any', captionFilter: 'brief-only' } });
  assert.equal(h.jobs.get(prepared.captionJobId).status, 'cancelled');
  assert.equal(h.state().settings.captionFilter, 'off');
  await h.message({ type: 'resume', tabId: 7, settings: { ...settings, mode: 'credits-any', captionFilter: 'small-text-no-speech' } });
  await h.message({ type: 'scan', clip: candidate }, true);
  assert.equal(h.state().saved, 1);
  await h.message({ type: 'pause' });
  await h.message({ type: 'resume', tabId: 7, settings: { ...settings, mode: 'credits', captionFilter: 'brief-only' } });
  const next = await h.message({ type: 'prepareScan', clip: clip(2, { credit_target: '@creator' }) }, true);
  assert.ok(next.captionJobId);
  finishCaption(h, next.captionJobId, 20);
  await h.message({ type: 'scan', clip: clip(2, { credit_target: '@creator' }), captionJobId: next.captionJobId }, true);
  assert.equal(h.state().saved, 1, 'Existing credited-only mode still honors the chosen caption filter');
});

test('metadata failures and duplicates avoid caption downloads', async () => {
  const h = await captionHarness();
  const result = await h.message({ type: 'prepareScan', clip: clip(1, { likes: 20 }) }, true);
  assert.equal(result.skipCaptionCheck, true);
  assert.equal(h.jobs.size, 0);
});

test('pause cancels a running caption check and ignores late results', async () => {
  const h = await captionHarness();
  const prepared = await h.message({ type: 'prepareScan', clip: clip(1) }, true);
  const check = await h.message({ type: 'captionStatus', jobId: prepared.captionJobId }, true);
  assert.equal(check.job.status, 'running');
  await h.message({ type: 'pause' });
  assert.equal(h.jobs.get(prepared.captionJobId).status, 'cancelled');
  finishCaption(h, prepared.captionJobId, 0);
  await h.message({ type: 'scan', clip: clip(1), captionJobId: prepared.captionJobId }, true);
  assert.equal(h.state().saved, 0);
  const stopped = await h.message({ type: 'prepareScan', clip: clip(1) }, true);
  assert.equal(stopped.running, false);
});


test('challenge and closed-tab pauses cancel their outstanding caption check', async () => {
  for (const event of ['challenge', 'closed']) {
    const h = await captionHarness();
    const prepared = await h.message({ type: 'prepareScan', clip: clip(1) }, true);
    if (event === 'challenge') await h.message({ type: 'problem', reason: 'Please sign in' }, true);
    else await h.tabEvent('removed', 7);
    assert.equal(h.state().status, 'paused');
    assert.equal(h.jobs.get(prepared.captionJobId).status, 'cancelled');
    assert.equal(h.state().captionCheck, null);
  }
});

test('network failure while checking a completed result keeps the video retryable', async () => {
  const h = await captionHarness();
  const prepared = await h.message({ type: 'prepareScan', clip: clip(1) }, true);
  finishCaption(h, prepared.captionJobId, 0);
  h.online(false);
  const failed = await h.message({ type: 'scan', clip: clip(1), captionJobId: prepared.captionJobId }, true);
  assert.match(failed.error, /offline/);
  h.online(true);
  const state = await h.message({ type: 'state' });
  assert.equal(state.state.scanned, 0);
  assert.deepEqual([...state.state.seenIds], []);
});


test('messages from an old scouting session cannot save or finish the current session', async () => {
  const h = await harness();
  await h.message({ type: 'start', tabId: 7, settings });
  await h.message({ type: 'scan', clip: clip(1), sessionId: 'old-session' }, true);
  await h.message({ type: 'problem', reason: 'old problem', sessionId: 'old-session' }, true);
  await h.message({ type: 'exhausted', sessionId: 'old-session', sourceUrl: 'https://www.instagram.com/previous/reels/' }, true);
  assert.equal(h.state().status, 'running');
  assert.equal(h.state().saved, 0);
});
