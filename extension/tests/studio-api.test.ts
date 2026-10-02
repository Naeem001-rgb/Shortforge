import assert from 'node:assert/strict';
import test from 'node:test';

// The same API module runs in the dashboard and the packaged extension tab.
test('extension requests and nested asset URLs use only the local engine', async () => {
  Object.defineProperty(globalThis, 'location', { value: { protocol: 'chrome-extension:' }, configurable: true });
  const { api, assetUrl, API_ORIGIN } = await import('../../dashboard/src/api.ts');
  assert.equal(API_ORIGIN, 'http://127.0.0.1:8787');
  const savedFetch = globalThis.fetch;
  let requested = '';
  globalThis.fetch = async input => {
    requested = String(input);
    return new Response(JSON.stringify({ result: { asset: { id: 'one', url: '/api/assets/one' } }, media: [{ url: '/api/assets/two', thumbnail_url: '/api/editor/two/thumbnail' }], title: '/api/assets/keep-text', original_url: 'https://youtube.com/shorts/test' }), { status: 200 });
  };
  try {
    const result = await api<any>('/jobs/job');
    assert.equal(requested, 'http://127.0.0.1:8787/api/jobs/job');
    assert.equal(result.result.asset.url, 'http://127.0.0.1:8787/api/assets/one');
    assert.equal(result.media[0].thumbnail_url, 'http://127.0.0.1:8787/api/editor/two/thumbnail');
    assert.equal(result.title, '/api/assets/keep-text');
    assert.equal(result.original_url, 'https://youtube.com/shorts/test');
    assert.equal(assetUrl(result.result.asset), result.result.asset.url);
  } finally {
    globalThis.fetch = savedFetch;
  }
});
