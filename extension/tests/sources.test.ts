import test from 'node:test';
import assert from 'node:assert/strict';
import { addAccountVideos, candidateIdFromUrl, canonicalSourceUrl, createAccountQueue, isScoutUrl, nextAccountVideo } from '../src/sources';

test('account URLs canonicalize to the requested account video grid', () => {
  assert.equal(canonicalSourceUrl(''), '');
  assert.equal(canonicalSourceUrl(' youtube.com/@Creator?feature=shared '), 'https://www.youtube.com/@Creator/shorts');
  assert.equal(canonicalSourceUrl('https://m.youtube.com/channel/UCabcdefghijklmnopqrstuv/videos'), 'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv/shorts');
  assert.equal(canonicalSourceUrl('https://www.youtube.com/c/Creator/shorts'), 'https://www.youtube.com/c/Creator/shorts');
  assert.equal(canonicalSourceUrl('https://www.youtube.com/user/Creator'), 'https://www.youtube.com/user/Creator/shorts');
  assert.equal(canonicalSourceUrl('https://instagram.com/Some.Creator/reels/?igsh=abc'), 'https://www.instagram.com/some.creator/reels/');
});
test('feed, individual video and impostor URLs cannot be used as an account', () => {
  for (const url of [
    'https://youtube.com.evil.test/@creator', 'https://instagram.com.evil.test/creator/',
    'https://instagram.com@evil.test/creator/', 'https://evil.test@instagram.com/creator/',
    'https://instagram.com:8080/creator/', 'https://instagram.com/accounts/login/',
    'https://instagram.com/explore/', 'https://instagram.com/reels/',
    'https://instagram.com/reel/ABCdef_123/', 'https://youtube.com/watch?v=test0000001',
    'https://youtube.com/shorts/test0000001', 'https://youtube.com/playlist?list=abc',
    'https://youtu.be/test0000001', 'file://instagram.com/creator',
  ]) assert.throws(() => canonicalSourceUrl(url), undefined, url);
});
test('platform-prefixed identities validate canonical supported routes', () => {
  assert.equal(candidateIdFromUrl('https://www.instagram.com/reel/ABCdef_123/?x=1'), 'ig:ABCdef_123');
  assert.equal(candidateIdFromUrl('https://www.instagram.com/reels/ABCdef_123/'), 'ig:ABCdef_123');
  assert.equal(candidateIdFromUrl('https://www.instagram.com/creator/reel/ABCdef_123/'), 'ig:ABCdef_123');
  assert.equal(candidateIdFromUrl('https://www.youtube.com/shorts/test0000001'), 'test0000001');
  for (const url of ['https://instagram.com/p/ABCdef_123/', 'https://evil.test/reel/ABCdef_123/', 'https://youtube.com/@wrong?v=test0000001', 'https://youtube.com/shorts/test0000001/extra']) assert.equal(candidateIdFromUrl(url), null);
  for (const url of ['https://instagram.com/reels/', 'https://instagram.com/creator/', 'https://youtube.com/@creator/shorts', 'https://youtube.com/shorts/test0000001']) assert.equal(isScoutUrl(url), true, url);
  for (const url of ['https://youtube.com/', 'https://instagram.com/accounts/login/', 'https://evil.test/shorts/test0000001']) assert.equal(isScoutUrl(url), false, url);
});
test('account queues deduplicate, reject other platforms, stay bounded and exhaust', () => {
  const queue = createAccountQueue('https://www.instagram.com/creator/reels/', 'test-session');
  addAccountVideos(queue, ['https://instagram.com/reel/ABCdef_123/?x=1', 'https://instagram.com/reels/ABCdef_123/', 'https://youtube.com/shorts/test0000001', 'https://evil.test/reel/ABCdef_123/']);
  assert.deepEqual(queue.urls, ['https://www.instagram.com/reel/ABCdef_123/']);
  assert.equal(nextAccountVideo(queue), queue.urls[0]);
  queue.completed.push(queue.urls[0]);
  assert.equal(nextAccountVideo(queue), null);
  addAccountVideos(queue, Array.from({ length: 600 }, (_, i) => `https://instagram.com/reel/clip_${String(i).padStart(8, '0')}/`));
  assert.equal(queue.urls.length, 500);
  queue.completed = [...queue.urls];
  assert.equal(nextAccountVideo(queue), null);
});
