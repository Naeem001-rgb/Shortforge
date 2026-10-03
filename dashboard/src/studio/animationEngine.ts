import { clamp, displayAt } from "./editorModel";
import type { Animation, Keyframe, TimelineItem } from "./editorModel";
/** Presets are recipes: applying one leaves editable numeric keyframes. */
export function compileAnimation(item:TimelineItem,preset:Animation,target:"in"|"out"|"loop",duration=item.animation_duration):TimelineItem {
  const span=clamp(duration,.1,item.duration),labels={in:item.animation_in,out:item.animation_out,loop:item.animation_loop||"none",...item.animation_labels,[target]:preset};
  const clear={...item,animation_in:"none" as const,animation_out:"none" as const,animation_loop:"none" as const,animation_labels:labels,animation_duration:span};
  const retained=item.keyframes.filter(k=>!k.preset);
  if(Object.values(labels).every(label=>label==="none"))return {...clear,keyframes:retained};
  const times=new Set<number>([0,item.duration]);
  for(const side of ["in","out"] as const)if(labels[side]!=="none")for(let n=0;n<=24;n++)times.add((side==="out"?item.duration-span:0)+span*n/24);
  if(labels.loop!=="none"){const count=Math.min(960,Math.max(16,Math.ceil(item.duration/span*12)));for(let n=0;n<=count;n++)times.add(item.duration*n/count);}
  const recipe={...item,keyframes:[],animation_in:labels.in,animation_out:labels.out,animation_loop:labels.loop,animation_duration:span};
  const frames:Keyframe[]=[...times].sort((a,b)=>a-b).map(time=>{
    const value=displayAt(recipe,time),frame:Keyframe={...value,time,easing:"linear",preset:target};
    let blur=0;if(labels.in==="blur-in")blur=Math.max(blur,(1-clamp(time/span,0,1))*24);if(labels.out==="blur-in")blur=Math.max(blur,(1-clamp((item.duration-time)/span,0,1))*24);
    if(labels.in==="blur-in"||labels.out==="blur-in")frame.values={...frame.values,"adjustments.blur":blur};
    return frame;
  });
  return {...clear,keyframes:[...retained.filter(k=>!times.has(k.time)),...frames].sort((a,b)=>a.time-b.time)};
}
