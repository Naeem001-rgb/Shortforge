import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCount,
  countFromLabel,
  countFromLabeledValue,
  detectCredit,
  hasNarrationHints,
  videoIdFromUrl,
  matchesCandidate,
} from "../src/parsers";
import { activeModeFor, DEFAULTS, type Candidate } from "../src/types";

test("YouTube counts support compact, comma, decimal and accessible forms", () => {
  for (const [input, expected] of [
    ["5.2K", 5200],
    ["1.3M", 1_300_000],
    ["12,400", 12400],
    ["3B", 3_000_000_000],
    ["0", 0],
    ["5000 likes", 5000],
    ["1,2K", 1200],
    ["12\u202f400 views", 12400],
    ["1.234", 1234],
    ["1.234,5K", 1_234_500],
    ["Like this video along with 5,234 other people", 5234],
    ["1.5M views", 1_500_000],
  ] as const)
    assert.equal(parseCount(input), expected, input);
});
test("unknown or absent counts never pass as zero", () => {
  for (const input of [
    "",
    "Like",
    "likes hidden",
    "Unavailable",
    "No likes",
    "Dislike",
    "-12",
    "not a count",
    "1:30",
    "11/23/2024",
  ])
    assert.equal(parseCount(input), null, input);
  assert.equal(parseCount(null), null);
  assert.equal(parseCount(undefined), null);
});
test("two statistics merged into one span never become one huge number", () => {
  // A space groups thousands inside a single number, so these still read.
  assert.equal(parseCount("12 400"), 12400);
  assert.equal(parseCount("1 234 567"), 1_234_567);
  assert.equal(parseCount("12 400 views"), 12400);
  // But a span holding two separate counts is unknown, not their digits glued
  // together. "12,400 1,204" once read as 124001204, which would pass any
  // minimum views or likes the user set.
  for (const input of ["12,400 1,204", "12 4001", "5,234 6,789"])
    assert.equal(parseCount(input), null, input);
  // A merged pair of COMPACT values ("1.2K 3.4K") cannot reach here: the only
  // caller that passes an unlabelled span is the Instagram profile tile, and its
  // BARE_COUNT_WRAPPED gate rejects any string with a letter inside it.
});
test("counts are bound to the requested label", () => {
  assert.equal(
    countFromLabel("1.2K Likes\n12,400 Views\nSep 20, 2026", "views"),
    12400,
  );
  assert.equal(
    countFromLabel("1.2K Likes\n12,400 Views\nSep 20, 2026", "likes"),
    1200,
  );
  assert.equal(countFromLabel("Views: 42,500", "views"), 42500);
  assert.equal(countFromLabel("12\nViews", "views"), 12);
  assert.equal(countFromLabel("Published 2026", "views"), null);
  // Localized pages separate thousands with a non-breaking or thin space. Those are
  // part of the number, not the end of it.
  assert.equal(countFromLabel("Views: 12\u00a0400", "views"), 12400);
  assert.equal(countFromLabel("Likes: 12\u202f400", "likes"), 12400);
  assert.equal(countFromLabel("12\u2009400 views", "views"), 12400);
});
test("a lone statistic may put its label first and drop the colon", () => {
  assert.equal(countFromLabeledValue("likes\n5.2K", "likes"), 5200);
  assert.equal(countFromLabeledValue("Views 12,400", "views"), 12400);
  assert.equal(countFromLabeledValue("5.2K likes", "likes"), 5200);
  // Without a colon the whole value has to be the statistic, so a sentence that
  // merely starts with the word is still unknown.
  assert.equal(
    countFromLabeledValue("likes from 5 of your friends", "likes"),
    null,
  );
});
test("a space inside a count is a thousands separator, not the end of the number", () => {
  // A localized page renders 12400 as "12 400" using an ordinary space, a
  // no-break space (U+00A0), a narrow no-break space (U+202F) or a thin space
  // (U+2009). All four belong to the number. When the extension's count patterns
  // disagreed about that, a no-break space in "Views: 12 400" made the count read
  // as 12 - a thousandfold undercount - so every entry point is pinned here: the
  // bare form Instagram's action rail and profile tiles use, and both labelled
  // forms. parseCount is the only place that reads a number, so holding these
  // three functions to the same answer is what keeps a fourth variant from
  // reappearing.
  for (const space of ["\u00a0", "\u202f", "\u2009", " "]) {
    const label = JSON.stringify(space);
    assert.equal(parseCount(`12${space}400`), 12400, label);
    assert.equal(parseCount(`1${space}234${space}567`), 1234567, label);
    assert.equal(parseCount(`6,2${space}K`), 6200, label);
    assert.equal(countFromLabel(`Views: 12${space}400`, "views"), 12400, label);
    assert.equal(countFromLabel(`12${space}400 likes`, "likes"), 12400, label);
    assert.equal(
      countFromLabeledValue(`views 12${space}400`, "views"),
      12400,
      label,
    );
  }
});
test("credit detection retains an attributable handle, URL, or name", () => {
  for (const [input, expected] of [
    ["Credit: @naturelab", "@naturelab"],
    ["Credits to Jane Doe", "Jane Doe"],
    ["cr: @film.labs", "@film.labs"],
    ["via @ocean-world", "@ocean-world"],
    ["Source: https://youtu.be/tleaVXWF3YI", "https://youtu.be/tleaVXWF3YI"],
    ["Original video by @garden", "@garden"],
    ["All rights belong to @artist", "@artist"],
    ["Thanks @creator for the clip", "@creator"],
    ["https://www.youtube.com/@science", "https://www.youtube.com/@science"],
  ] as const) {
    assert.equal(detectCredit(input)?.target, expected, input);
    assert.equal(detectCredit(input)?.snippet, input);
  }
});
test("credit-related words without a source and self-promotion do not count", () => {
  for (const input of [
    "A credit card trick",
    "Your credit score explained",
    "Original content every day",
    "All rights reserved.",
    "No credits needed",
    "Source code in bio",
    "Credits: me",
    "Credit: the respective owners",
    "An amazing sunset",
    "Follow me @mychannel",
  ])
    assert.equal(detectCredit(input, "mychannel"), null, input);
  assert.equal(detectCredit("Credit: @mychannel", "@mychannel"), null);
});
test("narration hints are a metadata heuristic", () => {
  assert.ok(hasNarrationHints("A strange story #shorts"));
  assert.ok(hasNarrationHints("How it works, explained"));
  assert.ok(hasNarrationHints("#aivoice"));
  assert.equal(hasNarrationHints("The biggest football goal"), false);
});
test("extracts only YouTube video identifiers", () => {
  assert.equal(
    videoIdFromUrl("https://www.youtube.com/shorts/tleaVXWF3YI?x=1"),
    "tleaVXWF3YI",
  );
  assert.equal(videoIdFromUrl("https://youtu.be/tleaVXWF3YI"), "tleaVXWF3YI");
  assert.equal(videoIdFromUrl("https://evil.example/shorts/tleaVXWF3YI"), null);
  assert.equal(videoIdFromUrl("https://www.youtube.com/shorts/invalid"), null);
});
test("mode and thresholds require known counts while narration does not require credit", () => {
  const clip: Candidate = {
    video_id: "tleaVXWF3YI",
    url: "",
    title: "A strange story",
    description: "",
    channel_name: "",
    channel_handle: "",
    likes: 5000,
    views: 10000,
    credit_target: "",
    credit_snippet: "",
    thumbnail_url: "",
  };
  assert.ok(matchesCandidate(clip, DEFAULTS, "narrated").matched);
  assert.equal(matchesCandidate(clip, DEFAULTS, "credits").matched, false);
  assert.equal(
    matchesCandidate({ ...clip, likes: null }, DEFAULTS, "narrated").matched,
    false,
  );
  assert.equal(
    matchesCandidate(
      { ...clip, likes: null },
      { ...DEFAULTS, minLikes: 0 },
      "narrated",
    ).matched,
    true,
  );
  assert.equal(
    matchesCandidate(
      { ...clip, views: null },
      { ...DEFAULTS, minViews: 0 },
      "narrated",
    ).matched,
    true,
  );
  assert.equal(
    matchesCandidate(
      { ...clip, likes: null, views: null },
      { ...DEFAULTS, minLikes: 0, minViews: 0 },
      "narrated",
    ).matched,
    true,
  );
  assert.equal(
    matchesCandidate({ ...clip, views: 9999 }, DEFAULTS, "narrated").matched,
    false,
  );
  assert.ok(
    matchesCandidate(
      { ...clip, credit_target: "@creator" },
      DEFAULTS,
      "credits",
    ).matched,
  );
});
test("narrated candidates are not rejected for ordinary titles, empty descriptions or missing credits", () => {
  const clip: Candidate = {
    video_id: "tleaVXWF3YI",
    url: "",
    title: "Wait for the ending",
    description: "",
    channel_name: "",
    channel_handle: "",
    likes: 5000,
    views: 10000,
    credit_target: "",
    credit_snippet: "",
    thumbnail_url: "",
  };
  for (const title of [
    "Wait for the ending",
    "He never expected this",
    "",
    "یہ کیسے ہوا",
  ]) {
    const result = matchesCandidate(
      { ...clip, title },
      { ...DEFAULTS, mode: "narrated" },
      "narrated",
    );
    assert.equal(result.matched, true, title);
    assert.match(result.reason, /review narration/);
  }
  assert.equal(matchesCandidate(clip, DEFAULTS, "credits").matched, false);
});
test("cleared Look for accepts original clips without credits or narration and still applies count limits", () => {
  const clip: Candidate = {
    video_id: "tleaVXWF3YI",
    url: "",
    title: "My original video",
    description: "",
    channel_name: "",
    channel_handle: "",
    likes: 5000,
    views: 10000,
    credit_target: "",
    credit_snippet: "",
    thumbnail_url: "",
  };
  const settings = { ...DEFAULTS, mode: "any" as const };
  const phase = activeModeFor(settings.mode);
  for (const title of ["My original video", "A narrated story", ""]) {
    const decision = matchesCandidate({ ...clip, title }, settings, phase);
    assert.equal(decision.matched, true);
    assert.equal(decision.reason, "Meets your limits");
  }
  for (const counts of [
    { likes: 4999 },
    { views: 9999 },
    { likes: null },
    { views: null },
  ]) {
    assert.equal(
      matchesCandidate({ ...clip, ...counts }, settings, phase).matched,
      false,
    );
  }
  assert.equal(
    matchesCandidate(
      { ...clip, likes: null, views: null },
      { ...settings, minLikes: 0, minViews: 0 },
      phase,
    ).matched,
    true,
  );
});
test("skip decisions explain the actual missing count or failed threshold", () => {
  const clip: Candidate = {
    video_id: "tleaVXWF3YI",
    url: "",
    title: "Wait for it",
    description: "",
    channel_name: "",
    channel_handle: "",
    likes: 8000,
    views: 25000,
    credit_target: "",
    credit_snippet: "",
    thumbnail_url: "",
  };
  assert.match(
    matchesCandidate({ ...clip, views: null }, DEFAULTS, "narrated").reason,
    /Could not read views/,
  );
  assert.match(
    matchesCandidate({ ...clip, likes: 4999 }, DEFAULTS, "narrated").reason,
    /likes 4,999 < 5,000/,
  );
  assert.match(
    matchesCandidate({ ...clip, views: 9999 }, DEFAULTS, "narrated").reason,
    /views 9,999 < 10,000/,
  );
  assert.equal(
    matchesCandidate({ ...clip, likes: Number.NaN }, DEFAULTS, "narrated")
      .matched,
    false,
  );
  assert.equal(
    matchesCandidate(
      { ...clip, views: Number.POSITIVE_INFINITY },
      DEFAULTS,
      "narrated",
    ).matched,
    false,
  );
});
