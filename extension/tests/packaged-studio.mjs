// Load the real unpacked MV3 build. API fixtures never touch the owner's data.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from '../../dashboard/node_modules/playwright/index.mjs';
const dist = resolve(import.meta.dirname, '../dist');
const profile = await mkdtemp(resolve(tmpdir(), 'shortforge-extension-'));
const manifest = JSON.parse(await readFile(resolve(dist, 'manifest.json'), 'utf8'));
assert.match(manifest.content_security_policy.extension_pages, /script-src 'self';/);
assert.doesNotMatch(manifest.content_security_policy.extension_pages, /unsafe-eval|script-src[^;]*https?:/);
assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1:8787/*', 'http://localhost:8787/*']);
const html = await readFile(resolve(dist, 'studio/index.html'), 'utf8');
assert.doesNotMatch(html, /<script>([\s\S]*?)<\/script>/);
assert.match(html, /src="\.\/assets\//);
const clip = { id: 'extension-fixture', video_id: 'testEntry01', url: 'https://youtube.com/shorts/testEntry01', title: 'Packaged Studio fixture', channel_name: 'Fixture', channel_handle: '', description: '', license_status: 'unknown', permission_note: '', thumbnail_url: '', workflow_status: 'collected', created_at: '2026-10-02', assets: [], script: null, transcript: null };
const project = { version: 1, width: 1080, height: 1920, fps: 30, background: '#000000', items: [], tracks: [], markers: [], script: '', source_seeded: false };
const context = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium', args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, '--no-sandbox'], viewport: { width: 1440, height: 960 } });
const errors = [];
context.on('page', page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (/content security policy|Refused to load|Refused to execute/i.test(message.text())) errors.push(message.text()); });
});
const requested = [];
await context.route('http://127.0.0.1:8787/api/**', async route => {
  const path = new URL(route.request().url()).pathname.replace('/api', '');
  requested.push(path);
  let json = {};
  if (path === '/clips') json = { clips: [clip] };
  else if (path === '/health') json = { status: 'ok', tools: {}, version: 'test' };
  else if (path === `/clips/${clip.id}`) json = clip;
  else if (path === `/editor/${clip.id}`) json = { project, media: [], saved_at: null };
  else if (path.endsWith('/download')) return route.fulfill({ status: 503, json: { detail: 'Test source is offline. Retry with real footage.' } });
  else if (path === '/voices') json = { voices: [], providers: [] };
  else if (path.includes('capabilities')) json = { available: false, model_ready: false, message: 'Test fixture' };
  await route.fulfill({ json });
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).hostname;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/studio/index.html`);
  await page.getByRole('heading', { name: 'Your library.' }).waitFor();
  const opened = context.waitForEvent('page');
  await page.getByRole('button', { name: `Edit ${clip.title} in a new tab` }).click();
  const studio = await opened;
  await studio.locator('main.studio-tab').waitFor();
  assert.equal(new URL(studio.url()).searchParams.get('studio'), clip.id);
  await studio.waitForFunction(() => !document.body.innerText.includes('Loading your edit'));
  await studio.reload();
  await studio.locator('main.studio-tab').waitFor();
  assert.ok(requested.includes(`/editor/${clip.id}`), 'editor must fetch from loopback');
  assert.deepEqual(errors, [], 'packaged assets and scripts must satisfy MV3 CSP');
  console.log('Loaded unpacked MV3 extension: relative assets, strict CSP, loopback API, Library Edit and Studio reload passed.');
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
