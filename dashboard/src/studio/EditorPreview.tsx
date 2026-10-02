import { Film, Maximize2, Pause, Play, RotateCw, Shield, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { assetUrl } from "../api";
import { IconButton } from "../ui";
import { clamp, displayAt, durationOf, formatTime } from "./editorModel";
import type { EditorMedia, EditorProject, TimelineItem } from "./editorModel";
import { createRenderResources, renderFrame, sourceTime } from "./engine/renderFrame";
import type { FrameSources } from "./engine/renderFrame";
import { mixProjectAudio } from "./engine/audioMix";

type Props={project:EditorProject;media:EditorMedia[];time:number;playing:boolean;selected:string;onTime:(n:number)=>void;onPlaying:(b:boolean)=>void;onSelect:(id:string)=>void;onChange?:(item:TimelineItem)=>void};
export function EditorPreview({project,media,time,playing,selected,onTime,onPlaying,onSelect,onChange}:Props){
  const stage=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),canvasWrap=useRef<HTMLDivElement>(null);
  const elements=useRef(new Map<string,HTMLMediaElement>()),sources=useRef<FrameSources>(new Map()),resources=useRef<ReturnType<typeof createRenderResources>|null>(null);
  const audio=useRef<AudioContext|null>(null),audioSource=useRef<AudioBufferSourceNode|null>(null),monitorGain=useRef<GainNode|null>(null),audioBuffer=useRef<{signature:string;buffer:AudioBuffer}|null>(null);
  const [size,setSize]=useState({width:270,height:480}),[monitorMuted,setMonitorMuted]=useState(false),[playError,setPlayError]=useState(""),[safe,setSafe]=useState(false),[ready,setReady]=useState(0),[draft,setDraft]=useState<TimelineItem|null>(null),[guides,setGuides]=useState({x:false,y:false});
  const live=useRef({project,time,playing});live.current={project,time,playing};
  const drag=useRef<{mode:"move"|"scale"|"rotate";item:TimelineItem;x:number;y:number;latest:TimelineItem;angle:number}|null>(null);
  const duration=durationOf(project), selectedItem=project.items.find(i=>i.id===selected&&i.kind!=="audio");
  useEffect(()=>{resources.current=createRenderResources();return()=>{resources.current?.gpu.dispose();resources.current=null;elements.current.forEach(e=>e.pause());audioSource.current?.stop();void audio.current?.close();};},[]);
  useEffect(()=>{const resize=()=>{if(!stage.current)return;const b=stage.current.getBoundingClientRect(),h=Math.max(80,Math.min(b.height-38,(b.width-64)*project.height/project.width));setSize({width:h*project.width/project.height,height:h});};const observer=new ResizeObserver(resize);if(stage.current)observer.observe(stage.current);resize();return()=>observer.disconnect();},[project.width,project.height]);
  useEffect(()=>{
    for(const item of project.items){const el=elements.current.get(item.id);if(!el)continue;const active=time>=item.start&&time<item.start+item.duration;
      const at=sourceTime(item,time);if(Number.isFinite(el.duration)&&Math.abs(el.currentTime-at)>(playing&&!item.reverse ? .15:.01))el.currentTime=Math.min(at,Math.max(0,el.duration-.0001));
      el.playbackRate=clamp(item.speed,.1,10);el.muted=true;
      if(playing&&active&&!item.reverse&&item.freeze_at==null&&el.paused)void el.play().catch(()=>setPlayError(`Could not play ${item.name}. Pause and retry.`));
      if(!playing||!active||item.reverse||item.freeze_at!=null)el.pause();
    }
  },[project,time,playing,ready]);
  useEffect(()=>{
    let cancelled=false;audioSource.current?.stop();audioSource.current=null;
    if(!playing)return;
    if(!audio.current)audio.current=new AudioContext({sampleRate:48000});const ctx=audio.current;
    if(!monitorGain.current){monitorGain.current=ctx.createGain();monitorGain.current.connect(ctx.destination);}monitorGain.current.gain.value=monitorMuted?0:1;
    void ctx.resume();const signature=JSON.stringify(project);
    const prepare=async()=>{try{
      const buffer=audioBuffer.current?.signature===signature?audioBuffer.current.buffer:await mixProjectAudio(project,media);
      if(cancelled)return;audioBuffer.current={signature,buffer};const source=ctx.createBufferSource();source.buffer=buffer;source.connect(monitorGain.current!);const offset=live.current.time;if(offset<buffer.duration){source.start(0,offset);audioSource.current=source;}
    }catch(e){if(!cancelled)setPlayError(`Audio preview: ${(e as Error).message}`);}};void prepare();return()=>{cancelled=true;audioSource.current?.stop();audioSource.current=null;};
  },[playing,project,media]);
  useEffect(()=>{if(monitorGain.current)monitorGain.current.gain.value=monitorMuted?0:1;},[monitorMuted]);
  useEffect(()=>{
    const c=canvas.current,ctx=c?.getContext("2d");if(!c||!ctx||!resources.current)return;
    // Adaptive 720-wide backing canvas keeps a portrait preview crisp without decoding 1080p text each UI frame.
    const width=Math.min(project.width,Math.max(360,Math.round(size.width*devicePixelRatio)));
    if(c.width!==width||c.height!==Math.round(width*project.height/project.width)){c.width=width;c.height=Math.round(width*project.height/project.width);}
    const document=draft?{...project,items:project.items.map(i=>i.id===draft.id?draft:i)}:project;
    renderFrame(ctx,document,Math.min(time,Math.max(0,duration-1/project.fps)),sources.current,resources.current);
  },[project,time,size,ready,draft,duration]);
  const bind=(id:string,el:HTMLVideoElement|null)=>{if(el){elements.current.set(id,el);sources.current.set(id,el);}else{elements.current.get(id)?.pause();elements.current.delete(id);sources.current.delete(id);}};
  const readyMedia=(item:TimelineItem,el:HTMLMediaElement)=>{el.currentTime=Math.min(sourceTime(item,live.current.time),Math.max(0,el.duration-.001));setReady(v=>v+1);};
  const pick=(event:PointerEvent<HTMLCanvasElement>)=>{
    const box=event.currentTarget.getBoundingClientRect(),x=(event.clientX-box.left)/box.width*100-50,y=(event.clientY-box.top)/box.height*100-50;
    const candidates=project.items.filter(i=>i.kind!=="audio"&&time>=i.start&&time<i.start+i.duration&&!project.tracks?.find(t=>t.id===i.track)?.hidden).sort((a,b)=>b.track-a.track||b.start-a.start);
    const hit=candidates.find(i=>{const v=displayAt(i,time-i.start);return i.kind!=="text"||Math.abs(x-v.x)<44*v.scale&&Math.abs(y-v.y)<i.font_size/project.height*100*1.5*v.scale;});if(hit?.id===selected)begin(event,"move");else onSelect(hit?.id||"");
  };
  const begin=(event:PointerEvent,mode:"move"|"scale"|"rotate")=>{
    if(!selectedItem||!onChange||project.tracks?.find(t=>t.id===selectedItem.track)?.locked)return;
    event.preventDefault();event.stopPropagation();onPlaying(false);
    const box=canvasWrap.current!.getBoundingClientRect(),cx=box.left+box.width*(.5+selectedItem.transform.x/100),cy=box.top+box.height*(.5+selectedItem.transform.y/100);
    drag.current={mode,item:structuredClone(selectedItem),x:event.clientX,y:event.clientY,latest:selectedItem,angle:Math.atan2(event.clientY-cy,event.clientX-cx)};
    canvasWrap.current?.setPointerCapture(event.pointerId);
  };
  const move=(event:PointerEvent<HTMLDivElement>)=>{
    const d=drag.current;if(!d)return;const transform={...d.item.transform},dx=event.clientX-d.x,dy=event.clientY-d.y;let gx=false,gy=false;
    if(d.mode==="move"){
      transform.x+=dx/size.width*100;transform.y+=dy/size.height*100;
      for(const point of [0,-40,40]){if(Math.abs(transform.x-point)<1.4){transform.x=point;gx=point===0;}if(Math.abs(transform.y-point)<1.4){transform.y=point;gy=point===0;}}
    }else if(d.mode==="scale")transform.scale=clamp(d.item.transform.scale*(1+(dx+dy)/(size.width+size.height)*2),.05,4);
    else {const box=canvasWrap.current!.getBoundingClientRect(),cx=box.left+box.width*(.5+transform.x/100),cy=box.top+box.height*(.5+transform.y/100);transform.rotation=d.item.transform.rotation+(Math.atan2(event.clientY-cy,event.clientX-cx)-d.angle)*180/Math.PI;if(event.shiftKey)transform.rotation=Math.round(transform.rotation/15)*15;}
    d.latest={...d.item,transform};setDraft(d.latest);setGuides({x:gx,y:gy});
  };
  const finish=(event:PointerEvent<HTMLDivElement>,cancel=false)=>{const d=drag.current;drag.current=null;setDraft(null);setGuides({x:false,y:false});if(canvasWrap.current?.hasPointerCapture(event.pointerId))canvasWrap.current.releasePointerCapture(event.pointerId);if(d&&!cancel)onChange?.(d.latest);};
  const shown=draft||selectedItem,position=shown?displayAt(shown,time-shown.start):null;
  return <section className="editor-player" aria-label="Video preview">
    <div className="editor-panel-heading"><h2>Preview</h2><div className="preview-heading-actions"><span>{project.width} × {project.height} <span className="editor-divider">/</span> {project.fps} fps</span><IconButton label="Shorts safe zones" aria-pressed={safe} onClick={()=>setSafe(!safe)}><Shield size={14}/></IconButton><IconButton label="Expand preview" onClick={()=>{if(document.fullscreenElement)void document.exitFullscreen();else void stage.current?.requestFullscreen();}}><Maximize2 size={14}/></IconButton></div></div>
    <div className="editor-preview-stage" ref={stage}>
      <div className="editor-canvas" ref={canvasWrap} style={{width:size.width,height:size.height,position:"relative"}} onPointerMove={move} onPointerUp={e=>finish(e)} onPointerCancel={e=>finish(e,true)}>
        <canvas ref={canvas} aria-label="Video canvas" style={{width:"100%",height:"100%",display:"block"}} onPointerDown={pick}/>
        {!project.items.some(i=>i.kind!=="audio")&&<div className="editor-canvas-empty"><Film size={32}/><span>Your story goes here</span><small>Add footage to the timeline</small></div>}
        {safe&&<div className="preview-safe-zones" aria-label="Shorts interface safe zones"><div className="preview-safe-top">Keep titles below this area</div><div className="preview-safe-right"/><div className="preview-safe-bottom">Shorts title & controls</div></div>}
        {shown&&position&&time>=shown.start&&time<shown.start+shown.duration&&onChange&&<div className="preview-selection" style={{position:"absolute",left:`${50+position.x}%`,top:`${50+position.y}%`,width:shown.kind==="text"?"88%":"100%",height:shown.kind==="text"?`${Math.max(12,shown.font_size/project.height*100*2.2)}%`:"100%",transform:`translate(-50%,-50%) rotate(${position.rotation}deg) scale(${position.scale})`,border:"1px solid #b7a7ff",cursor:"move",touchAction:"none",pointerEvents:"none"}} onPointerDown={e=>begin(e,"move")} aria-label="Move selected layer">
          {(["nw","ne","sw","se"] as const).map(corner=><button key={corner} className={`preview-handle ${corner}`} aria-label={`Scale layer ${corner}`} onPointerDown={e=>begin(e,"scale")}/>)}
          <button className="preview-rotate" aria-label="Rotate selected layer" onPointerDown={e=>begin(e,"rotate")}><RotateCw size={12}/></button>
        </div>}
        {guides.x&&<div className="preview-guide vertical"/>}{guides.y&&<div className="preview-guide horizontal"/>}
      </div>
      <div className="preview-format-label">{project.width<project.height?"9:16":project.width===project.height?"1:1":"16:9"} <span>·</span> Fit</div>
    </div>
    <div className="editor-decode-media" style={{position:"absolute",width:1,height:1,overflow:"hidden",opacity:0,pointerEvents:"none"}} aria-hidden="true">
      {project.items.filter(i=>i.kind==="video").map(item=>{const asset=media.find(m=>m.id===item.asset_id);if(!asset)return null;return asset.media_type==="image"?<img key={item.id} crossOrigin="anonymous" src={assetUrl(asset)} alt="" onLoad={e=>{sources.current.set(item.id,e.currentTarget);setReady(v=>v+1);}}/>:<video key={item.id} crossOrigin="anonymous" src={assetUrl(asset)} playsInline muted preload="auto" ref={el=>bind(item.id,el)} onLoadedData={e=>readyMedia(item,e.currentTarget)} onSeeked={()=>setReady(v=>v+1)} onError={()=>setPlayError(`Cannot load ${item.name}. Relink the media or import an H.264 MP4.`)}/>;})}
    </div>
    {playError&&<div className="editor-preview-error" role="status">{playError}<button onClick={()=>setPlayError("")}>Dismiss</button></div>}
    <div className="editor-transport"><span className="editor-timecode"><input aria-label="Playhead" title="Playhead in seconds" type="number" min={0} max={duration} step={1/project.fps} value={Math.round(time*100)/100} onChange={e=>{if(Number.isFinite(e.currentTarget.valueAsNumber))onTime(clamp(e.currentTarget.valueAsNumber,0,duration));}}/><span> / {formatTime(duration,true)}</span></span>
      <div><IconButton label="Previous frame" onClick={()=>onTime(Math.max(0,time-1/project.fps))}><SkipBack size={15}/></IconButton><IconButton label={playing?"Pause preview":"Play preview"} disabled={!duration} onClick={()=>{setPlayError("");if(time>=duration)onTime(0);onPlaying(!playing);}} className="editor-play-button">{playing?<Pause size={18}/>:<Play size={18}/>}</IconButton><IconButton label="Next frame" onClick={()=>onTime(Math.min(duration,time+1/project.fps))}><SkipForward size={15}/></IconButton></div>
      <IconButton label={monitorMuted?"Unmute preview":"Mute preview"} aria-pressed={monitorMuted} onClick={()=>setMonitorMuted(!monitorMuted)}>{monitorMuted?<VolumeX size={15}/>:<Volume2 size={15}/>}</IconButton></div>
  </section>;
}
