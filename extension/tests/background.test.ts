import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import type { Candidate, ScoutState } from '../src/types';

async function harness(existingIds: string[] = []) {
  let handler: Function;
  let stored: Record<string, unknown> = {};
  let online = true;
  const known = new Set(existingIds);
  const sends: object[] = [];
  const code = await build({ entryPoints: ['src/background.ts'], bundle: true, write: false, format: 'iife', platform: 'browser' });
  const chrome = {
    runtime: { onMessage: { addListener: (fn: Function) => { handler = fn; } }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
    storage: { local: { get: async () => structuredClone(stored), set: async (value: object) => { stored = structuredClone(value); } } },
    action: { setBadgeBackgroundColor: async () => {}, setBadgeText: async () => {} },
    tabs: { get: async (id: number) => ({ id, url: 'https://www.youtube.com/shorts/tleaVXWF3YI' }), sendMessage: async (_id: number, message: object) => { sends.push(message); }, onRemoved: { addListener() {} }, onUpdated: { addListener() {} } },
    alarms: { create() {}, onAlarm: { addListener() {} } },
  };
  vm.runInNewContext(code.outputFiles[0].text, { chrome, console, AbortSignal, setTimeout, Date, fetch: async (url: string, options: RequestInit) => {
    if (!online) throw new Error('network');
    let added = 0;
    if (options.body) for (const clip of JSON.parse(options.body as string).clips) if (!known.has(clip.video_id)) { known.add(clip.video_id); added++; }
    return { ok: true, json: async () => ({ clips: [...known].map(video_id => ({ video_id })), added }) };
  } });
  const message = (payload: object, tab = false) => new Promise<any>(resolve => handler(payload, tab ? { tab: { id: 7 } } : {}, resolve));
  return { message, state: () => stored.scout as ScoutState, online: (value: boolean) => { online = value; }, known, sends };
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
});
test('failed uploads persist and pause; retry saves once without losing the clip', async () => {
  const h = await harness();
  await h.message({ type: 'start', tabId: 7, settings });
  h.online(false);
  await h.message({ type: 'scan', clip: clip(1) }, true);
  assert.equal(h.state().status, 'paused');
  assert.equal(h.state().pending.length, 1);
  assert.equal(h.state().saved, 0);
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
  await h.message({ type: 'scan', clip: clip(31) }, true);
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
