import { Copy, Diamond, Eye, EyeOff, Film, Flag, Group, LockKeyhole, Magnet, Maximize2, Music2, Plus, Redo2, Scissors, Trash2, Type, Undo2, UnlockKeyhole, Volume2, VolumeX, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { IconButton } from "../ui";
import { clamp, durationOf, formatTime, trimItem, uid } from "./editorModel";
import type { EditorMedia, EditorProject, TimelineItem } from "./editorModel";
import { cleanTransitions, groupItems, pasteItems, removeItems, splitAt, trackLocked, tracksOf } from "./timelineOps";
import { mediaThumbnails } from "./mediaThumbnails";

type Props={project:EditorProject;media:EditorMedia[];selected:string;time:number;onTime:(n:number)=>void;onSelect:(id:string)=>void;onChange:(item:TimelineItem)=>void;onSplit:()=>void;onDelete:()=>void;onDuplicate:()=>void;onUndo:()=>void;onRedo:()=>void;canUndo:boolean;canRedo:boolean;onProjectChange?:(p:EditorProject)=>void;onSelectionChange?:(ids:string[])=>void;playing?:boolean;onDropMedia?:(assetId:string,start:number,track:number)=>void};
function Filmstrip({asset}:{asset:EditorMedia}) {
  const [frames,setFrames]=useState<string[]>([]);
  useEffect(()=>{let active=true;mediaThumbnails(asset).then(f=>{if(active)setFrames(f);});return()=>{active=false;};},[asset.id,asset.duration]);
  return <span className="timeline-filmstrip" aria-hidden="true">{frames.map((src,n)=><img src={src} key={n} alt="" draggable={false}/>)}</span>;
}
export function EditorTimeline(p:Props) {
  const {project,media,selected,time,onTime,onSelect,onChange,onSplit,onDelete,onDuplicate,onUndo,onRedo,canUndo,canRedo,onProjectChange,playing}=p;
  const [zoom,setZoom]=useState(35),[snap,setSnap]=useState(true),[magnetic,setMagnetic]=useState(false),[selection,setSelection]=useState<string[]>([]),[draft,setDraft]=useState<TimelineItem[]>([]),[markerEdit,setMarkerEdit]=useState("");
  const scroller=useRef<HTMLDivElement>(null),clipboard=useRef<TimelineItem[]>([]),root=useRef<HTMLElement>(null);
  const drag=useRef<{mode:"move"|"left"|"right"|"key";items:TimelineItem[];x:number;y:number;latest:TimelineItem[];keyIndex?:number}|null>(null);
  const rowHeight=62, labelWidth=164;
  const tracks=tracksOf(project), duration=durationOf(project), extent=Math.min(610,Math.max(15,Math.ceil(duration/5)*5+5)),width=extent*zoom;
  useEffect(()=>{if(selected && !selection.includes(selected))setSelection([selected]);if(!selected)setSelection([]);},[selected]);
  useEffect(()=>{setSelection(ids=>ids.filter(id=>project.items.some(i=>i.id===id)));},[project.items]);
  useEffect(()=>{if(!playing || !scroller.current)return; const node=scroller.current,x=time*zoom;
    if(x>node.scrollLeft+node.clientWidth-labelWidth-50 || x<node.scrollLeft)node.scrollLeft=Math.max(0,x-100);
  },[time,playing,zoom]);
  const select=(ids:string[])=>{setSelection(ids);onSelect(ids.at(-1)||"");p.onSelectionChange?.(ids);};
  const selectedItems=project.items.filter(i=>selection.includes(i.id));
  const commit=(next:EditorProject)=>{onProjectChange?.(cleanTransitions(next));};
  const choose=(item:TimelineItem,add=false)=>{
    const ids=item.group_id ? project.items.filter(i=>i.group_id===item.group_id).map(i=>i.id) : [item.id];
    const next=add ? (selection.includes(item.id)?selection.filter(id=>!ids.includes(id)):[...new Set([...selection,...ids])]) : ids;
    select(next);return next;
  };
  const fit=()=>{if(scroller.current)setZoom(clamp((scroller.current.clientWidth-labelWidth-32)/Math.max(duration,10),6,240));};
  const snapAt=(n:number,item:TimelineItem,end=false)=>{
    let value=n;
    if(snap){const points=[0,time,...(project.markers||[]).map(m=>m.time),...project.items.filter(i=>!selection.includes(i.id)).flatMap(i=>[i.start,i.start+i.duration])];
      let distance=8/zoom;
      for(const point of points){const d=Math.abs(point-n);if(d<distance){value=point;distance=d;}
        if(end){const e=Math.abs(point-(n+item.duration));if(e<distance){value=point-item.duration;distance=e;}}}
    }
    return Math.round(value*project.fps)/project.fps;
  };
  const begin=(event:PointerEvent,item:TimelineItem,mode:"move"|"left"|"right"|"key",keyIndex?:number)=>{
    if(event.button!==0)return;event.preventDefault();event.stopPropagation();root.current?.focus();
    if(trackLocked(project,item))return;
    let ids=selection.includes(item.id)?selection:choose(item,event.shiftKey||event.ctrlKey||event.metaKey);
    if((event.shiftKey||event.ctrlKey||event.metaKey)&&selection.includes(item.id)){choose(item,true);return;}
    if(mode!=="move")ids=[item.id];
    const items=project.items.filter(i=>ids.includes(i.id)&&!trackLocked(project,i));
    scroller.current?.setPointerCapture(event.pointerId);
    drag.current={mode,items,x:event.clientX,y:event.clientY,latest:items,keyIndex};setDraft(items);
  };
  const move=(event:PointerEvent<HTMLDivElement>)=>{
    const d=drag.current;if(!d)return;const delta=(event.clientX-d.x)/zoom, first=d.items[0];if(!first)return;
    let dt=snapAt(first.start+delta,first,true)-first.start;
    dt=clamp(dt,-Math.min(...d.items.map(i=>i.start)),600-Math.max(...d.items.map(i=>i.start+i.duration)));
    const rowDelta=Math.round((event.clientY-d.y)/rowHeight);
    d.latest=d.items.map(item=>{
      if(d.mode==="move"){
        const current=tracks.findIndex(t=>t.id===item.track), target=tracks[clamp(current+rowDelta,0,tracks.length-1)];
        return {...item,start:item.start+dt,track:target.locked?item.track:target.id};
      }
      if(d.mode==="key"){
        return {...item,keyframes:item.keyframes.map((k,n)=>n===d.keyIndex?{...k,time:clamp(Math.round((k.time+delta)*project.fps)/project.fps,0,item.duration)}:k)};
      }
      const asset=media.find(a=>a.id===item.asset_id);
      if(d.mode==="left"){
        const minimum=item.reverse ? -Math.max(0,(asset?.duration||600)-item.source_in-item.duration*item.speed)/item.speed : -item.source_in/item.speed;
        const front=clamp(snapAt(item.start+delta,item)-item.start,Math.max(-item.start,minimum),item.duration-1/project.fps);
        return trimItem(item,front,item.duration);
      }
      const max=item.kind==="text"||asset?.media_type==="image"||item.freeze_at!=null ? 600-item.start : Math.max(item.duration,((asset?.duration||600)-item.source_in)/item.speed);
      const end=clamp(snapAt(item.start+item.duration+delta,item)-item.start,1/project.fps,Math.min(max,600-item.start));
      return trimItem(item,0,end);
    });setDraft(d.latest);
  };
  const finish=(event:PointerEvent<HTMLDivElement>,cancel=false)=>{
    const d=drag.current;drag.current=null;setDraft([]);if(scroller.current?.hasPointerCapture(event.pointerId))scroller.current.releasePointerCapture(event.pointerId);
    if(!d||cancel)return;
    let items=project.items.map(i=>d.latest.find(j=>j.id===i.id)||i);
    if(magnetic&&d.mode==="move"&&d.latest.some(i=>i.track===0)){
      let at=0;const starts=new Map(items.filter(i=>i.track===0).sort((a,b)=>a.start-b.start).map(i=>{const start=at;at+=i.duration;return [i.id,start];}));
      items=items.map(i=>starts.has(i.id)?{...i,start:starts.get(i.id)!}:i);
    }
    if(onProjectChange)commit({...project,items});else d.latest.forEach(onChange);
  };
  const seek=(event:PointerEvent<HTMLDivElement>)=>{
    const rect=event.currentTarget.getBoundingClientRect();onTime(clamp(Math.round((event.clientX-rect.left)/zoom*project.fps)/project.fps,0,Math.max(duration,0)));
  };
  const addMarker=()=>{if(onProjectChange)commit({...project,markers:[...(project.markers||[]),{id:uid(),time,label:`Marker ${(project.markers?.length||0)+1}`,color:"#aa9bff"}]});};
  const remove=(ripple=false)=>{if(onProjectChange){commit(removeItems(project,selection,ripple));select([]);}else onDelete();};
  const duplicate=()=>{if(onProjectChange){const result=pasteItems(project,selectedItems,Math.max(...selectedItems.map(i=>i.start+i.duration),time));commit(result.project);select(result.ids);}else onDuplicate();};
  const keys=(event:KeyboardEvent<HTMLElement>)=>{
    if((event.target as HTMLElement).closest("input,textarea,select,[contenteditable=true]"))return;
    const key=event.key.toLowerCase(),mod=event.ctrlKey||event.metaKey;
    let handled=true;
    if(mod&&key==="a")select(project.items.filter(i=>!trackLocked(project,i)).map(i=>i.id));
    else if(mod&&key==="c")clipboard.current=structuredClone(selectedItems);
    else if(mod&&key==="v"&&onProjectChange){const r=pasteItems(project,clipboard.current,time);commit(r.project);select(r.ids);}
    else if(mod&&key==="d")duplicate();
    else if(mod&&key==="g"&&onProjectChange)commit(groupItems(project,selection,event.shiftKey));
    else if(key==="delete"||key==="backspace")remove(event.shiftKey);
    else if(key==="s"&&!mod){if(onProjectChange)commit(splitAt(project,selection,time));else onSplit();}
    else if(key==="m"&&!mod)addMarker();
    else if(key==="+"||key==="=")setZoom(z=>clamp(z*1.25,6,240));
    else if(key==="-")setZoom(z=>clamp(z/1.25,6,240));
    else if(key==="arrowleft")onTime(Math.max(0,time-(event.shiftKey?10:1)/project.fps));
    else if(key==="arrowright")onTime(Math.min(duration,time+(event.shiftKey?10:1)/project.fps));
    else if(key==="escape")select([]);
    else handled=false;
    if(handled){event.preventDefault();event.stopPropagation();}
  };
  const interval=zoom<15?10:zoom<40?5:zoom<85?2:1;
  const ticks=Array.from({length:Math.ceil(extent/interval)+1},(_,n)=>n*interval);
  const visible=project.items.map(i=>draft.find(d=>d.id===i.id)||i);
  return <section ref={root} className="editor-timeline" aria-label="Timeline" tabIndex={0} onKeyDown={keys}>
    <div className="editor-timeline-toolbar">
      <div className="timeline-toolgroup">
        <IconButton label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={onUndo}><Undo2 size={16}/></IconButton>
        <IconButton label="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={onRedo}><Redo2 size={16}/></IconButton>
        <span className="timeline-toolbar-divider"/>
        <IconButton label="Split at playhead (S)" disabled={!selection.length} onClick={()=>onProjectChange?commit(splitAt(project,selection,time)):onSplit()}><Scissors size={16}/></IconButton>
        <IconButton label="Duplicate (Ctrl+D)" disabled={!selection.length} onClick={duplicate}><Copy size={16}/></IconButton>
        <IconButton label="Delete selection (Delete)" disabled={!selection.length} onClick={()=>remove()}><Trash2 size={16}/></IconButton>
        <IconButton label="Group selection (Ctrl+G)" disabled={selection.length<2||!onProjectChange} onClick={()=>commit(groupItems(project,selection))}><Group size={16}/></IconButton>
        <IconButton label="Add marker (M)" disabled={!onProjectChange} onClick={addMarker}><Flag size={15}/></IconButton>
      </div>
      <span className="timeline-selection-hint">{selection.length>1?`${selection.length} clips selected`:"Drag clips to arrange · Drag edges to trim"}</span>
      <div className="timeline-toolgroup">
        <IconButton label="Snap to clips and markers" aria-pressed={snap} onClick={()=>setSnap(!snap)}><Magnet size={16}/></IconButton>
        {onProjectChange&&<button className={`timeline-magnetic ${magnetic?"active":""}`} title="Pack the main video track when moving clips" aria-pressed={magnetic} onClick={()=>setMagnetic(!magnetic)}>Magnetic</button>}
        <IconButton label="Fit timeline to view" onClick={fit}><Maximize2 size={15}/></IconButton>
        <IconButton label="Zoom out timeline" onClick={()=>setZoom(z=>clamp(z/1.25,6,240))}><ZoomOut size={15}/></IconButton>
        <input aria-label="Timeline zoom" type="range" min="6" max="240" value={zoom} onChange={e=>setZoom(+e.target.value)}/>
        <IconButton label="Zoom in timeline" onClick={()=>setZoom(z=>clamp(z*1.25,6,240))}><ZoomIn size={15}/></IconButton>
      </div>
    </div>
    <div className="timeline-scroll" ref={scroller} onPointerMove={move} onPointerUp={e=>finish(e)} onPointerCancel={e=>finish(e,true)}>
      <div className="timeline-content" style={{width:width+labelWidth,minWidth:"100%"}}>
        <div className="timeline-ruler-row">
          <div className="timeline-track-heading" style={{width:labelWidth}}>TRACKS <span>{tracks.length}</span></div>
          <div className="editor-ruler" role="slider" aria-label="Playhead position" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={Math.min(time,duration)} tabIndex={0} style={{width}} onPointerDown={e=>{seek(e);e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(e.buttons===1&&e.currentTarget.hasPointerCapture(e.pointerId))seek(e);}}>
            {ticks.map(t=><span key={t} className="timeline-tick" style={{left:t*zoom}}>{formatTime(t)}</span>)}
            {(project.markers||[]).map(m=><button key={m.id} className="timeline-marker" style={{left:m.time*zoom,color:m.color}} title={`${m.label} · double-click to rename`} aria-label={`Marker: ${m.label}`} onPointerDown={e=>e.stopPropagation()} onClick={()=>onTime(m.time)} onDoubleClick={()=>setMarkerEdit(m.id)}><Flag size={12} fill="currentColor"/></button>)}
          </div>
        </div>
        {tracks.map(track=><div className={`timeline-track-row ${track.locked?"locked":""} ${track.hidden?"hidden-track":""}`} key={track.id} style={{height:rowHeight}}>
          <div className="timeline-track-label" style={{width:labelWidth}}>
            <div className="timeline-track-name">{track.kind==="audio"?<Music2 size={14}/>:track.kind==="text"?<Type size={14}/>:<Film size={14}/>}<span title={track.name}>{track.name}</span></div>
            <div className="timeline-track-actions">{onProjectChange&&<>
              <button title={track.locked?"Unlock track":"Lock track"} aria-label={`${track.locked?"Unlock":"Lock"} ${track.name}`} aria-pressed={track.locked} onClick={()=>commit({...project,tracks:tracks.map(t=>t.id===track.id?{...t,locked:!t.locked}:t)})}>{track.locked?<LockKeyhole size={12}/>:<UnlockKeyhole size={12}/>}</button>
              <button title={track.hidden?"Show track":"Hide track"} aria-label={`${track.hidden?"Show":"Hide"} ${track.name}`} aria-pressed={track.hidden} onClick={()=>commit({...project,tracks:tracks.map(t=>t.id===track.id?{...t,hidden:!t.hidden}:t)})}>{track.hidden?<EyeOff size={13}/>:<Eye size={13}/>}</button>
              <button title={track.muted?"Unmute track":"Mute track"} aria-label={`${track.muted?"Unmute":"Mute"} ${track.name}`} aria-pressed={track.muted} onClick={()=>commit({...project,tracks:tracks.map(t=>t.id===track.id?{...t,muted:!t.muted}:t)})}>{track.muted?<VolumeX size={13}/>:<Volume2 size={13}/>}</button>
            </>}</div>
          </div>
          <div className="timeline-track-lane" style={{width}} onDragOver={e=>{if(!track.locked)e.preventDefault();}} onDrop={e=>{e.preventDefault();if(track.locked)return;const id=e.dataTransfer.getData("application/x-shortforge-media")||e.dataTransfer.getData("text/plain");const rect=e.currentTarget.getBoundingClientRect();p.onDropMedia?.(id,Math.max(0,(e.clientX-rect.left)/zoom),track.id);}} onPointerDown={e=>{if(e.target===e.currentTarget){select([]);seek(e);root.current?.focus();}}}>
            {visible.filter(i=>i.track===track.id).map(item=>{
              const asset=media.find(a=>a.id===item.asset_id),itemWidth=Math.max(5,item.duration*zoom);
              return <div key={item.id} className={`timeline-clip ${item.kind} ${selection.includes(item.id)?"selected":""} ${item.muted?"muted":""}`} style={{left:item.start*zoom,width:itemWidth}} role="button" tabIndex={0} aria-label={`${item.name||item.text||item.kind}, ${formatTime(item.start)} to ${formatTime(item.start+item.duration)}`} aria-pressed={selection.includes(item.id)} onPointerDown={e=>begin(e,item,"move")} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();choose(item,e.shiftKey);}}}>
                {asset?.media_type!=="audio"&&asset&&<Filmstrip asset={asset}/>}
                {item.kind==="audio"&&asset&&<svg className="timeline-waveform" viewBox="0 0 400 36" preserveAspectRatio="none" aria-hidden="true">{asset.waveform?.map((peak,n)=>{const source=item.source_in+n/(asset.waveform.length-1||1)*item.duration*item.speed;const index=Math.min(asset.waveform.length-1,Math.floor(source/asset.duration*asset.waveform.length));const value=asset.waveform[index]??peak;return <line key={n} x1={n*400/asset.waveform.length} x2={n*400/asset.waveform.length} y1={18-value*15} y2={18+value*15} stroke="currentColor" strokeWidth="2"/>;})}</svg>}
                <div className="timeline-clip-label">{item.kind==="audio"?<Music2 size={12}/>:item.kind==="text"?<Type size={12}/>:<Film size={12}/>}<span>{item.name||item.text||"Clip"}</span>{item.group_id&&<Group size={11}/>}</div>
                {item.kind==="text"&&<span className="timeline-caption-copy">{item.text}</span>}
                {item.transition_in!=="none"&&<span className="timeline-transition" title={item.transition_in} style={{width:Math.max(10,item.transition_duration*zoom)}}>⋈</span>}
                {item.keyframes.map((frame,n)=><button key={n} className="timeline-keyframe" style={{left:clamp(frame.time*zoom,4,itemWidth-8)}} aria-label={`Keyframe at ${formatTime(frame.time,true)}`} title="Drag to retime keyframe" onPointerDown={e=>begin(e,item,"key",n)}><Diamond size={9} fill="currentColor"/></button>)}
                <button className="timeline-trim left" aria-label={`Trim start of ${item.name}`} onPointerDown={e=>begin(e,item,"left")}/><button className="timeline-trim right" aria-label={`Trim end of ${item.name}`} onPointerDown={e=>begin(e,item,"right")}/>
              </div>;
            })}
            {!visible.some(i=>i.track===track.id)&&<span className="timeline-track-empty">{track.kind==="audio"?"Drop voiceover, music or sound effects":track.kind==="text"?"Add text or generate captions":"Drop footage here"}</span>}
          </div>
        </div>)}
        <div className="timeline-add-row">{onProjectChange&&<button onClick={()=>{const id=Math.max(...tracks.map(t=>t.id))+1;commit({...project,tracks:[...tracks,{id,name:`Track ${id+1}`,kind:"video",locked:false,hidden:false,muted:false}]});}}><Plus size={13}/> Add track</button>}</div>
        <div className="timeline-playhead" style={{left:labelWidth+time*zoom,top:0,bottom:0}}><span/></div>
      </div>
    </div>
    {markerEdit&&<div className="timeline-marker-editor"><label>Marker name<input autoFocus value={project.markers?.find(m=>m.id===markerEdit)?.label||""} onChange={e=>commit({...project,markers:project.markers?.map(m=>m.id===markerEdit?{...m,label:e.target.value}:m)})}/></label><button onClick={()=>{commit({...project,markers:project.markers?.filter(m=>m.id!==markerEdit)});setMarkerEdit("");}}>Delete marker</button><button onClick={()=>setMarkerEdit("")}>Done</button></div>}
    <footer className="editor-timeline-status"><span>{project.items.length} clips <span>·</span> {formatTime(duration,true)}</span><span>Space play / pause <span>·</span> S split <span>·</span> Shift + Delete ripple delete</span></footer>
  </section>;
}
