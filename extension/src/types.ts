export type Mode = 'narrated' | 'credits' | 'auto';
export type Status = 'idle' | 'running' | 'paused' | 'stopped' | 'complete';
export type CaptionPolicy = 'brief-only' | 'small-text-no-speech';
export interface Settings {
  target: number; minLikes: number; minViews: number; mode: Mode;
  sourceUrl?: string; captionFilter?: 'off' | CaptionPolicy; maxCaptionSeconds?: number;
}
export interface Candidate {
  video_id: string; url: string; title: string; channel_name: string; channel_handle: string;
  description: string; likes: number | null; views: number | null; credit_target: string;
  credit_snippet: string; thumbnail_url: string; discovery_mode?: 'credits' | 'narrated';
}
export interface LogEntry { at: number; text: string }
export interface ScanResult {
  video_id: string; title: string; likes: number | null; views: number | null;
  mode: 'credits' | 'narrated'; matched: boolean; reason: string;
}
export interface ScoutState {
  sessionId: string; sessionSourceUrl: string;
  captionCheck: { jobId: string; videoId: string; maxSeconds: number; sessionId: string; policy?: CaptionPolicy } | null;
  status: Status; settings: Settings; activeMode: 'credits' | 'narrated'; tabId: number | null;
  tabProtection: { tabId: number; autoDiscardable: boolean } | null;
  scanned: number; matched: number; saved: number; creditMisses: number; reason: string;
  pending: Candidate[]; knownIds: string[]; seenIds: string[]; logs: LogEntry[]; lastScan: ScanResult | null;
}
export const DEFAULTS: Settings = { target: 30, minLikes: 5000, minViews: 10000, mode: 'narrated', sourceUrl: '', captionFilter: 'brief-only', maxCaptionSeconds: 3 };
export function initialState(): ScoutState {
  return { sessionId: '', sessionSourceUrl: '', captionCheck: null, status: 'idle', settings: { ...DEFAULTS }, activeMode: 'narrated', tabId: null, tabProtection: null,
    scanned: 0, matched: 0, saved: 0, creditMisses: 0,
    reason: 'Open a Short or Reel, or paste an account above.', pending: [], knownIds: [], seenIds: [], logs: [], lastScan: null };
}
export interface SelectorCheck { name: string; found: boolean; required: boolean }
