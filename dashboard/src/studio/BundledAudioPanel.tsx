import { LoaderCircle, Pause, Play, Plus, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { newItem } from "./editorModel";
import type { EditorProject,EditorMedia } from "./editorModel";
import { tracksOf } from "./timelineOps";
import "./media-extras.css";
const sounds=[
  {id:"after-hours",name:"After hours",type:"music",duration:"0:24",detail:"Warm, spacious keys"},
  {id:"quiet-momentum",name:"Quiet momentum",type:"music",duration:"0:24",detail:"A steady, understated pulse"},
  {id:"small-wonders",name:"Small wonders",type:"music",duration:"0:24",detail:"Bright and curious"},
  {id:"soft-pop",name:"Soft pop",type:"sfx",duration:"0:01",detail:"For a word or reveal"},
  {id:"gentle-ding",name:"Gentle ding",type:"sfx",duration:"0:02",detail:"A small moment of clarity"},
  {id:"whoosh",name:"Whoosh",type:"sfx",duration:"0:01",detail:"Fast transition"},
  {id:"tap",name:"Tap",type:"sfx",duration:"0:01",detail:"A subtle click"},
  {id:"low-impact",name:"Low impact",type:"sfx",duration:"0:01",detail:"Give the hook some weight"},
  {id:"rising-chime",name:"Rising chime",type:"sfx",duration:"0:02",detail:"Light upward motion"},
] as const;
export function BundledAudioPanel({clipId,project,playhead,onChange,onMedia,notify}:{clipId:string;project:EditorProject;playhead:number;onChange:(p:EditorProject)=>void;onMedia:(m:EditorMedia)=>void;notify:(s:string)=>void}){
  const [playing,setPlaying]=useState(""),[busy,setBusy]=useState(""),[error,setError]=useState("");const preview=useRef<HTMLAudioElement|null>(null),current=useRef(project);current.current=project;
  const url=(id:string)=>new URL(`audio/${id}.mp3`,document.baseURI).href;
  useEffect(()=>()=>{preview.current?.pause();},[]);
  const play=(id:string)=>{preview.current?.pause();if(playing===id){setPlaying("");return;}const audio=new Audio(url(id));preview.current=audio;audio.volume=.5;audio.onended=()=>setPlaying("");void audio.play().then(()=>setPlaying(id)).catch(()=>setError("This sound could not play. Reload the editor and try again."));};
  const add=async(sound:typeof sounds[number])=>{setBusy(sound.id);setError("");try{
    const response=await fetch(url(sound.id));if(!response.ok)throw new Error("The bundled sound is missing. Rebuild the extension to restore the sound pack.");
    const form=new FormData();form.set("file",new File([await response.blob()],sound.name+".mp3",{type:"audio/mpeg"}));form.set("role","music");
    const asset=await api<EditorMedia>(`/editor/${clipId}/media`,{method:"POST",body:form});onMedia(asset);
    const p=current.current,tracks=tracksOf(p),id=Math.max(...tracks.map(t=>t.id))+1;
    onChange({...p,tracks:[...tracks,{id,name:sound.type==="music"?"Music":"Sound effects",kind:"audio",locked:false,hidden:false,muted:false}],items:[...p.items,{...newItem("audio",asset,Math.min(playhead,599),id),audio_role:sound.type,volume:sound.type==="music"?.25:.8,ducking:sound.type==="music"}]});
    notify(`${sound.name} added${sound.type==="music"?" with automatic voice ducking":""}.`);
  }catch(e){setError((e as Error).message);}finally{setBusy("");}};
  return <section className="bundled-audio"><h3>Music & sounds <span>{sounds.length}</span></h3><p>Original sounds for your stories. Free to use, including commercially.</p>{sounds.map(sound=><div className="bundled-sound" key={sound.id}><button className="sound-preview" aria-label={`${playing===sound.id?"Pause":"Preview"} ${sound.name}`} onClick={()=>play(sound.id)}>{playing===sound.id?<Pause size={15}/>:<Play size={15}/>}</button><div><strong>{sound.name}</strong><small>{sound.detail}</small></div><span>{sound.duration}</span><button className="sound-add" disabled={!!busy} aria-label={`Add ${sound.name}`} onClick={()=>void add(sound)}>{busy===sound.id?<LoaderCircle size={15} className="spin"/>:<Plus size={16}/>}</button></div>)}{error&&<p role="alert">{error}</p>}<div className="sound-license"><Volume2 size={12}/>Original ShortForge pack · CC0</div></section>;
}
