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
        if (!tabs.has(id)) throw new Error('No tab');
        return { id, url: 'https://www.youtube.com/shorts/tleaVXWF3YI', active: false, autoDiscardable: tabs.get(id) };
      },
      update: async (id: number, properties: { autoDiscardable?: boolean; active?: boolean }) => {
        if (!tabs.has(id)) throw new Error('No tab');
        tabUpdates.push({ id, ...properties });
        if (properties.autoDiscardable !== undefined) tabs.set(id, properties.autoDiscardable);
      },
      sendMessage: async (_id: number, message: object) => { sends.push(message); },
      onRemoved: { addListener: (fn: Function) => { tabEvents.removed = fn; } },
      onUpdated: { addListener: (fn: Function) => { tabEvents.updated = fn; } },
    },
    alarms: { create() {}, onAlarm: { addListener() {} } },
  };
  vm.runInNewContext(code.outputFiles[0].text, { chrome, console, AbortSignal, setTimeout, Date, fetch: async (url: string, options: RequestInit) => {
    if (!online) throw new Error('network');
    let added = 0;
    if (options.body) for (const clip of JSON.parse(options.body as string).clips) if (!known.has(clip.video_id)) { known.add(clip.video_id); added++; }
    return { ok: true, json: async () => ({ clips: [...known].map(video_id => ({ video_id })), added }) };
  } });
  const message = (payload: object, tab = false) => new Promise<any>(resolve => handler(payload, tab ? { tab: { id: 7 } } : {}, resolve));
  const tabEvent = async (name: string, ...args: unknown[]) => {
    if (name === 'removed') tabs.delete(args[0] as number);
    tabEvents[name](...args);
    await message({ type: 'state' });
  };
  return { message, state: () => stored.scout as ScoutState, online: (value: boolean) => { online = value; }, known, sends, tabUpdates, tabs, tabEvent };
}
const settings = { target: 30, minLikes: 5000, minViews: 10000, mode: 'narrated' };
const clip = (index: number, extra: Partial<Candidate> = {}): Candidate => ({ video_id: `test${String(index).padStart(7, '0')}`, url: 'https://www.youtube.com/shorts/tleaVXWF3YI', title: 'A narrated story', description: '', likes: 8000, views: 20000, credit_target: '', credit_snippet: '', channel_handle: '', channel_name: '', thumbnail_url: '', ...extra });

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
  const h = await harness([], { ...initialState(), status: 'running', activeMode: 'credits', tabId: 7 });
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
  await h.message({ type: 'resume', tabId: 7, settings });
  await h.tabEvent('removed', 7);
  assert.equal(h.state().status, 'paused');
  assert.equal(h.state().tabProtection, null);
});
