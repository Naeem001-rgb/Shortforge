export type Mode = 'narrated' | 'credits' | 'auto';
export type Status = 'idle' | 'running' | 'paused' | 'stopped' | 'complete';
export interface Settings { target: number; minLikes: number; minViews: number; mode: Mode }
export interface Candidate {
  video_id: string; url: string; title: string; channel_name: string; channel_handle: string;
  description: string; likes: number | null; views: number | null; credit_target: string;
  credit_snippet: string; thumbnail_url: string; discovery_mode?: 'credits' | 'narrated';
}
export interface LogEntry { at: number; text: string }
export interface ScoutState {
  status: Status; settings: Settings; activeMode: 'credits' | 'narrated'; tabId: number | null;
  scanned: number; matched: number; saved: number; creditMisses: number; reason: string;
  pending: Candidate[]; knownIds: string[]; seenIds: string[]; logs: LogEntry[];
}
export const DEFAULTS: Settings = { target: 30, minLikes: 5000, minViews: 10000, mode: 'narrated' };
export function initialState(): ScoutState {
  return { status: 'idle', settings: { ...DEFAULTS }, activeMode: 'narrated', tabId: null,
    scanned: 0, matched: 0, saved: 0, creditMisses: 0,
    reason: 'Open a YouTube Short, then start scouting.', pending: [], knownIds: [], seenIds: [], logs: [] };
}
export interface SelectorCheck { name: string; found: boolean; required: boolean }
