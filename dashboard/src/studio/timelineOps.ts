import { clamp, defaultAdjustments, newItem, trimItem, uid, valueAt } from "./editorModel";
import type { EditorProject, EditorTrack, Keyframe, TimelineItem } from "./editorModel";

export function tracksOf(project: EditorProject): EditorTrack[] {
  const tracks = new Map((project.tracks || []).map(t => [t.id, t]));
  for (let id = 0; id < 3; id++) if (!tracks.has(id)) tracks.set(id, {
    id, name: ["Video", "Voice & audio", "Text & captions"][id],
    kind: id === 1 ? "audio" : id === 2 ? "text" : "video", locked: false, hidden: false, muted: false,
  });
  for (const item of project.items) if (!tracks.has(item.track)) tracks.set(item.track, {
    id: item.track, name: `${item.kind === "audio" ? "Audio" : item.kind === "text" ? "Text" : "Video"} ${item.track + 1}`,
    kind: item.kind, locked: false, hidden: false, muted: false,
  });
  return [...tracks.values()].sort((a,b) => a.id-b.id);
}
export const trackLocked = (project: EditorProject, item: TimelineItem) => Boolean(project.tracks?.find(t => t.id === item.track)?.locked);
export function removeItems(project: EditorProject, ids: string[], ripple = false): EditorProject {
  const removed = project.items.filter(i => ids.includes(i.id) && !trackLocked(project, i));
  if (!removed.length) return project;
  const items = project.items.filter(i => !removed.some(r => r.id === i.id)).map(i => {
    if (!ripple || trackLocked(project,i)) return i;
    // Union the deleted spans on this track, so overlaps are never counted twice.
    const spans = removed.filter(r => r.track === i.track && r.start < i.start)
      .map(r => [r.start, Math.min(i.start,r.start+r.duration)]).sort((a,b) => a[0]-b[0]);
    let end = -1, shift = 0;
    for (const [a,b] of spans) { shift += Math.max(0,b-Math.max(a,end)); end = Math.max(end,b); }
    return { ...i, start: Math.max(0,i.start-shift) };
  });
  return cleanTransitions({ ...project, items });
}
export function cleanTransitions(project: EditorProject): EditorProject {
  return { ...project, items: project.items.map(i => {
    if (!i.transition_in || i.transition_in === "none") return i;
    const previous = project.items.filter(p => p.id !== i.id && p.track === i.track && p.kind !== "audio" && p.start <= i.start)
      .sort((a,b) => b.start-a.start)[0];
    const overlap = previous ? Math.min(previous.start+previous.duration, i.start+i.duration)-i.start : 0;
    return overlap < .1 ? { ...i, transition_in: "none" as const } : { ...i, transition_duration: Math.min(i.transition_duration,overlap,2) };
  }) };
}
export function splitAt(project: EditorProject, ids: string[], time: number): EditorProject {
  return cleanTransitions({ ...project, items: project.items.flatMap(i => {
    const local = time-i.start;
    if (!ids.includes(i.id) || trackLocked(project,i) || local < 1/project.fps || local > i.duration-1/project.fps) return [i];
    const a = { ...trimItem(i,0,local), animation_out: "none" as const };
    const b = { ...trimItem(i,local,i.duration), id: uid(), animation_in: "none" as const, transition_in: "none" as const };
    return [a,b];
  }) });
}
export function pasteItems(project: EditorProject, originals: TimelineItem[], at: number) {
  if (!originals.length) return { project, ids: [] as string[] };
  const first = Math.min(...originals.map(i => i.start));
  const groupMap = new Map<string,string>();
  const copies = originals.map(i => {
    if(i.group_id && !groupMap.has(i.group_id)) groupMap.set(i.group_id,uid());
    const start = Math.max(0, at+i.start-first);
    return { ...structuredClone(i), id: uid(), start, group_id: i.group_id ? groupMap.get(i.group_id) : undefined };
  }).filter(i => i.start+i.duration <= 600);
  return { project: cleanTransitions({ ...project, items: [...project.items,...copies] }), ids: copies.map(i=>i.id) };
}
export function groupItems(project: EditorProject, ids: string[], ungroup = false): EditorProject {
  const id = uid();
  return { ...project, items: project.items.map(i => ids.includes(i.id) && !trackLocked(project,i) ? { ...i, group_id: ungroup ? undefined : id } : i) };
}
export function addKeyframe(item: TimelineItem, time: number, property?: string): TimelineItem {
  const local = clamp(time-item.start,0,item.duration);
  const frame: Keyframe = { ...valueAt(item,local), time:local, easing:"ease-in-out" };
  if (property) {
    const [group,key] = property.split(".");
    const base = group === "adjustments" ? {...defaultAdjustments,...item.adjustments} : group === "crop" ? {...item.crop} : item;
    const n = (base as Record<string,unknown>)[key || group];
    frame.values = {...frame.values,[property]: typeof n === "number" ? n : 0};
  }
  const existing = item.keyframes.findIndex(k => Math.abs(k.time-local)<.001);
  const frames = [...item.keyframes];
  if(existing>=0) frames[existing] = frame; else frames.push(frame);
  return { ...item, keyframes: frames.sort((a,b)=>a.time-b.time) };
}
export function captionItems(words: {word:string;start:number;end:number}[], offset=0, wordsPerLine=3, track=2): TimelineItem[] {
  const valid=words.filter(w => w.word.trim() && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end>w.start).sort((a,b)=>a.start-b.start);
  const result:TimelineItem[]=[];
  for(let n=0;n<valid.length;n+=wordsPerLine) {
    const group=valid.slice(n,n+wordsPerLine), start=group[0].start, end=group.at(-1)!.end;
    if(start+offset>=600) break;
    result.push({ ...newItem("text",undefined,start+offset,track), text:group.map(w=>w.word).join(" "), name:group.map(w=>w.word).join(" "),
      duration:Math.min(end-start,600-start-offset), caption_words:group.map(w=>({...w,start:w.start-start,end:w.end-start})),
      caption_style:"bold-pop", font_size:82, transform:{x:0,y:25,scale:1,rotation:0,opacity:1},
      text_style:{bold:true,italic:false,uppercase:true,align:"center",stroke:7,stroke_color:"#000000",shadow:3,letter_spacing:0,reveal:"karaoke",highlight:"#f9e54c"},
    });
  }
  return result;
}
export function projectSrt(project:EditorProject):string {
  const stamp=(seconds:number)=>{ const ms=Math.round(seconds*1000);return `${String(Math.floor(ms/3600000)).padStart(2,"0")}:${String(Math.floor(ms/60000)%60).padStart(2,"0")}:${String(Math.floor(ms/1000)%60).padStart(2,"0")},${String(ms%1000).padStart(3,"0")}`;};
  return project.items.filter(i=>i.kind==="text").sort((a,b)=>a.start-b.start).map((i,n)=>`${n+1}\n${stamp(i.start)} --> ${stamp(i.start+i.duration)}\n${i.text}\n`).join("\n");
}
