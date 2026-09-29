import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCount, countFromLabel, detectCredit, hasNarrationHints, videoIdFromUrl, matchesCandidate } from '../src/parsers';
import { DEFAULTS, type Candidate } from '../src/types';

test('YouTube counts support compact, comma, decimal and accessible forms', () => {
  for (const [input, expected] of [
    ['5.2K', 5200], ['1.3M', 1_300_000], ['12,400', 12400], ['3B', 3_000_000_000], ['0', 0], ['5000 likes', 5000],
    ['1,2K', 1200], ['12\u202f400 views', 12400], ['1.234', 1234], ['1.234,5K', 1_234_500],
    ['Like this video along with 5,234 other people', 5234], ['1.5M views', 1_500_000],
  ] as const) assert.equal(parseCount(input), expected, input);
});
test('unknown or absent counts never pass as zero', () => {
  for (const input of ['', 'Like', 'likes hidden', 'Unavailable', 'No likes', 'Dislike', '-12', 'not a count', '1:30', '11/23/2024']) assert.equal(parseCount(input), null, input);
  assert.equal(parseCount(null), null);
  assert.equal(parseCount(undefined), null);
});
test('counts are bound to the requested label', () => {
  assert.equal(countFromLabel('1.2K Likes\n12,400 Views\nSep 20, 2026', 'views'), 12400);
  assert.equal(countFromLabel('1.2K Likes\n12,400 Views\nSep 20, 2026', 'likes'), 1200);
  assert.equal(countFromLabel('Views: 42,500', 'views'), 42500);
  assert.equal(countFromLabel('12\nViews', 'views'), 12);
  assert.equal(countFromLabel('Published 2026', 'views'), null);
});
test('credit detection retains an attributable handle, URL, or name', () => {
  for (const [input, expected] of [
    ['Credit: @naturelab', '@naturelab'], ['Credits to Jane Doe', 'Jane Doe'], ['cr: @film.labs', '@film.labs'],
    ['via @ocean-world', '@ocean-world'], ['Source: https://youtu.be/tleaVXWF3YI', 'https://youtu.be/tleaVXWF3YI'],
    ['Original video by @garden', '@garden'], ['All rights belong to @artist', '@artist'], ['Thanks @creator for the clip', '@creator'],
    ['https://www.youtube.com/@science', 'https://www.youtube.com/@science'],
  ] as const) {
    assert.equal(detectCredit(input)?.target, expected, input);
    assert.equal(detectCredit(input)?.snippet, input);
  }
});
test('credit-related words without a source and self-promotion do not count', () => {
  for (const input of ['A credit card trick', 'Your credit score explained', 'Original content every day', 'All rights reserved.', 'No credits needed', 'Source code in bio', 'Credits: me', 'Credit: the respective owners', 'An amazing sunset', 'Follow me @mychannel']) assert.equal(detectCredit(input, 'mychannel'), null, input);
  assert.equal(detectCredit('Credit: @mychannel', '@mychannel'), null);
});
test('narration hints are a metadata heuristic', () => {
  assert.ok(hasNarrationHints('A strange story #shorts'));
  assert.ok(hasNarrationHints('How it works, explained'));
  assert.ok(hasNarrationHints('#aivoice'));
  assert.equal(hasNarrationHints('The biggest football goal'), false);
});
test('extracts only YouTube video identifiers', () => {
  assert.equal(videoIdFromUrl('https://www.youtube.com/shorts/tleaVXWF3YI?x=1'), 'tleaVXWF3YI');
  assert.equal(videoIdFromUrl('https://youtu.be/tleaVXWF3YI'), 'tleaVXWF3YI');
  assert.equal(videoIdFromUrl('https://evil.example/shorts/tleaVXWF3YI'), null);
  assert.equal(videoIdFromUrl('https://www.youtube.com/shorts/invalid'), null);
});
test('mode and thresholds require known counts while narration does not require credit', () => {
  const clip: Candidate = { video_id: 'tleaVXWF3YI', url: '', title: 'A strange story', description: '', channel_name: '', channel_handle: '', likes: 5000, views: 10000, credit_target: '', credit_snippet: '', thumbnail_url: '' };
  assert.ok(matchesCandidate(clip, DEFAULTS, 'narrated').matched);
  assert.equal(matchesCandidate(clip, DEFAULTS, 'credits').matched, false);
  assert.equal(matchesCandidate({ ...clip, likes: null }, { ...DEFAULTS, minLikes: 0 }, 'narrated').matched, false);
  assert.equal(matchesCandidate({ ...clip, views: 9999 }, DEFAULTS, 'narrated').matched, false);
  assert.ok(matchesCandidate({ ...clip, credit_target: '@creator' }, DEFAULTS, 'credits').matched);
});
