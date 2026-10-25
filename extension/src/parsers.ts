import type { Candidate, Settings } from "./types";

/** YouTube may hide counts: unknown must never turn into a believable zero. */
export function parseCount(input: string | null | undefined): number | null {
  if (!input || /(?:hidden|unavailable|no likes|disabled)/i.test(input))
    return null;
  const text = input.replace(/[\u00a0\u202f\u2009]/g, " ").trim();
  const match = text.match(
    /(?:^|[^\d.,:/-])(\d[\d., ]*?)(?:\s*([KMB]))?(?=\s*(?:$|likes?\b|views?\b|other\b|people\b|times\b|[;)]))/i,
  );
  if (!match) return null;
  // A space is only ever a thousands separator INSIDE one number, where it groups
  // three digits at a time: "12 400" is 12400. Two statistics that the page merged
  // into a single span ("12,400 1,204") are not one number, and joining them would
  // report 124001204 - a 10,000x overcount that sails past any minimum. Anything
  // spaced that is not plain three-digit grouping is therefore unknown, not a
  // guess: per this function's contract, a count we cannot read must stay null.
  const spaced = match[1].trim();
  if (spaced.includes(" ") && !/^\d{1,3}(?: \d{3})+$/.test(spaced)) return null;
  let numeric = spaced.replace(/ /g, "");
  const unit = (match[2] || "").toUpperCase();
  if (numeric.includes(",") && numeric.includes(".")) {
    numeric =
      numeric.lastIndexOf(",") > numeric.lastIndexOf(".")
        ? numeric.replace(/\./g, "").replace(",", ".")
        : numeric.replace(/,/g, "");
  } else if (numeric.includes(",")) {
    numeric =
      unit && /^\d+,\d{1,2}$/.test(numeric)
        ? numeric.replace(",", ".")
        : numeric.replace(/,/g, "");
  } else if (!unit && /^\d{1,3}(?:\.\d{3})+$/.test(numeric))
    numeric = numeric.replace(/\./g, "");
  if (!/^\d+(?:\.\d+)?$/.test(numeric)) return null;
  const value =
    Number(numeric) * ({ K: 1000, M: 1_000_000, B: 1_000_000_000 }[unit] || 1);
  return Number.isSafeInteger(Math.round(value)) ? Math.round(value) : null;
}

/** One number, with the thousands separators real pages actually use. parseCount
 * above already treats the ordinary space, the non-breaking space, the narrow
 * no-break space and the thin space as separators, because localized YouTube and
 * Instagram pages render "12 400" with any of them. Every label pattern below is
 * built from this one piece so they cannot drift apart: while they had, a
 * non-breaking space in "Views: 12 400" made the count read as 12. */
const NUMBER = "\\d[\\d.,\\u00a0\\u202f\\u2009 ]*\\s*[KMB]?";
function labelPatterns(label: string) {
  return {
    /** "5.2K likes" somewhere inside a longer string. */
    after: new RegExp(`(${NUMBER})\\s*${label}\\b`, "i"),
    /** "likes: 5.2K" somewhere inside a longer string. The colon is what proves
     * this is a labelled statistic and not a sentence that mentions a number. */
    before: new RegExp(`\\b${label}\\s*[:：]\\s*(${NUMBER})`, "i"),
    /** The whole string is nothing but this label and its number, so the colon may
     * be missing: a stat card can print "likes" on the line above "5.2K". */
    only: new RegExp(`^${label}\\s*[:：]?\\s*(${NUMBER})$`, "i"),
  };
}
// Built once at load. These run against every candidate label and span on the page,
// so recompiling them on each call would be pure waste.
const COUNT_PATTERNS = {
  likes: labelPatterns("likes?"),
  views: labelPatterns("views?"),
} as const;

/** Find "5.2K likes" or "likes: 5.2K" inside any text, such as an aria-label. */
export function countFromLabel(
  text: string,
  kind: "likes" | "views",
): number | null {
  const pattern = COUNT_PATTERNS[kind];
  // Some screen readers place the label before the value.
  const match = text.match(pattern.after) || text.match(pattern.before);
  return match ? parseCount(match[1]) : null;
}

/** The same rule for a value that is meant to be one statistic and nothing else -
 * an element whose entire text or aria-label is the count. This additionally
 * accepts a label with no colon ("likes 5.2K"), which is only safe because the
 * whole value has to match: a caption sentence or comment can never qualify. */
export function countFromLabeledValue(
  value: string,
  kind: "likes" | "views",
): number | null {
  const found = countFromLabel(value, kind);
  if (found !== null) return found;
  const only = value.trim().match(COUNT_PATTERNS[kind].only);
  return only ? parseCount(only[1]) : null;
}

export function videoIdFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      !["www.youtube.com", "youtube.com", "m.youtube.com", "youtu.be"].includes(
        url.hostname,
      )
    )
      return null;
    const id =
      url.hostname === "youtu.be"
        ? url.pathname.slice(1).split("/")[0]
        : url.pathname.startsWith("/shorts/")
          ? url.pathname.split("/")[2]
          : url.searchParams.get("v");
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function detectCredit(
  description: string,
  ownHandle = "",
): { target: string; snippet: string } | null {
  const own = ownHandle.replace(/^@/, "").toLowerCase();
  for (const raw of description.split(/[\n\r]+/)) {
    const line = raw.trim();
    if (
      !line ||
      /(?:credit cards?|credit scores?|no credits?\b|no copyright|original (?:content|recipe|song|idea)|source code|all rights reserved\s*[.!]?$)/i.test(
        line,
      )
    )
      continue;
    const marked = line.match(
      /(?:\bcredits?\s*(?:to|for|by|:|-)\s*|\bcr\s*:\s*|\bvia\s*:?\s+|\bsource\s*[:\-]\s*|\boriginal\s+(?:video|creator|footage)\s*(?:by|from|:|-)\s*|\ball rights\s+(?:go|belong)\s+to\s*)(.+)/i,
    );
    const rest = marked?.[1]?.trim() || "";
    const handle = (rest || line).match(/(?:^|[^\w])@([\w.-]{2,})/);
    const url = (rest || line).match(
      /https?:\/\/(?:www\.)?(?:instagram\.com\/[^\s]+|youtube\.com\/(?:@[^\s]+|shorts\/[^\s]+|watch\?v=[^\s]+)|youtu\.be\/[^\s]+)/i,
    );
    let target =
      url?.[0] ||
      (handle ? `@${handle[1]}` : marked ? rest.split(/[|•]/)[0].trim() : "");
    target = target.replace(/[.,!;]+$/, "").slice(0, 180);
    if (
      !target ||
      /^(?:me|myself|us|my channel|our channel|unknown|none|n\/?a|owner|the (?:respective |original )?owners?)[.!\s]*$/i.test(
        target,
      )
    )
      continue;
    if (target.replace(/^@/, "").toLowerCase() === own) continue;
    if (
      !marked &&
      /(?:follow (?:me|us)|subscribe (?:to my|to our)|my (?:instagram|channel)|our (?:instagram|channel))/i.test(
        line,
      )
    )
      continue;
    if (marked || url || handle) return { target, snippet: line.slice(0, 300) };
  }
  return null;
}

/** This is metadata matching, never an assertion that audio is AI generated. */
export function hasNarrationHints(text: string): boolean {
  return /\b(?:voice[ -]?over|narrat(?:ed|ion|or)|explained|explainer|facts?|story(?:time)?|stories|did you know|what happens|why does|how it works|documentary|subtitles?|captions?)\b|#(?:aivoice|voiceover|storytelling|facts|didyouknow)\b/i.test(
    text,
  );
}

export function matchesCandidate(
  clip: Candidate,
  settings: Settings,
  mode: "credits" | "narrated",
): { matched: boolean; reason: string } {
  const unreadable = (value: number | null) =>
    !Number.isSafeInteger(value) || value === null || value < 0;
  const missingLikes = settings.minLikes > 0 && unreadable(clip.likes);
  const missingViews = settings.minViews > 0 && unreadable(clip.views);
  if (missingLikes || missingViews) {
    const missing = [missingLikes ? "likes" : "", missingViews ? "views" : ""]
      .filter(Boolean)
      .join(" and ");
    return {
      matched: false,
      reason: `Could not read ${missing}. Run Self-test, or set that minimum to 0 to ignore it.`,
    };
  }
  if (clip.likes! < settings.minLikes || clip.views! < settings.minViews) {
    const below = [
      clip.likes! < settings.minLikes
        ? `likes ${clip.likes!.toLocaleString("en-US")} < ${settings.minLikes.toLocaleString("en-US")}`
        : "",
      clip.views! < settings.minViews
        ? `views ${clip.views!.toLocaleString("en-US")} < ${settings.minViews.toLocaleString("en-US")}`
        : "",
    ]
      .filter(Boolean)
      .join("; ");
    return { matched: false, reason: `Below your limits: ${below}` };
  }
  if (mode === "credits" && !clip.credit_target)
    return { matched: false, reason: "No credited source found" };
  if (settings.mode === "any")
    return { matched: true, reason: "Meets your limits" };
  // Narrators rarely identify their format in the description. Keywords are a
  // useful hint, but their absence is not evidence that a clip has no narration.
  // Collect eligible candidates for review without requiring credits or keywords.
  return {
    matched: true,
    reason:
      mode === "credits"
        ? "Credited source found"
        : hasNarrationHints(`${clip.title}\n${clip.description}`)
          ? "Narration hints found; review audio in Library"
          : "Meets your limits; review narration in Library",
  };
}
