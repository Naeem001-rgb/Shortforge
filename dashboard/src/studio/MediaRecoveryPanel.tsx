import { FileWarning, Link2, LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "../api";
import { trimItem } from "./editorModel";
import type { EditorMedia,EditorProject } from "./editorModel";
import { clearMediaCache } from "./mediaStorage";
export function MediaRecoveryPanel({clipId,project,media,onChange,onMedia,notify}:{clipId:string;project:EditorProject;media:EditorMedia[];onChange:(p:EditorProject)=>void;onMedia:(m:EditorMedia)=>void;notify:(m:string)=>void}){
  const [target,setTarget]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");const input=useRef<HTMLInputElement>(null);
  const current = useRef({project, onChange, onMedia});
  current.current = {project, onChange, onMedia};
  const missing=[...new Set(project.items.filter(i=>i.asset_id&&!media.some(m=>m.id===i.asset_id)).map(i=>i.asset_id!))];
  const relink=async(file?:File)=>{if(!file||!target)return;setBusy(true);setError("");try{
    const item=project.items.find(i=>i.asset_id===target)!;const body=new FormData();body.set("file",file);body.set("role",item.kind==="audio"?"voiceover":"video");
    const asset=await api<EditorMedia>(`/editor/${clipId}/media`,{method:"POST",body});
    if ((item.kind === "audio" && asset.media_type !== "audio") || (item.kind === "video" && asset.media_type === "audio")) throw new Error("Choose the same kind of media as the missing file: a picture for a video track, or audio for a sound track.");
    current.current.onMedia(asset);
    const latest = current.current.project;
    current.current.onChange({...latest,items:latest.items.map(i=>{
      if(i.asset_id!==target)return i;
      const source_in=asset.media_type==="image"?0:Math.min(i.source_in,Math.max(0,asset.duration-.1));
      const duration=asset.media_type==="image"?i.duration:Math.min(i.duration,Math.max(.001,(asset.duration-source_in)/i.speed));
      return {...trimItem(i,0,duration),asset_id:asset.id,source_in,freeze_at:i.freeze_at==null?i.freeze_at:Math.min(i.freeze_at,Math.max(0,asset.duration-1/latest.fps))};
    })});notify(`${file.name} relinked. Existing edits were kept within the replacement file’s duration.`);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);if(input.current)input.current.value="";}};
  return <div className="media-recovery-panel">{missing.length>0&&<><h3><FileWarning size={15}/> Missing media</h3><p>Locate these files to restore the preview and export.</p>{missing.map(id=><button key={id} className="button secondary small full" disabled={busy} onClick={()=>{setTarget(id);input.current?.click();}}>{busy?<LoaderCircle size={14} className="spin"/>:<Link2 size={14}/>}Relink {project.items.find(i=>i.asset_id===id)?.name||"media"}</button>)}<input ref={input} type="file" hidden accept="video/*,audio/*,image/png,image/jpeg,image/webp" onChange={e=>void relink(e.target.files?.[0])}/></>}{error&&<p role="alert">{error}</p>}<button className="media-cache-clear" onClick={()=>void clearMediaCache().then(()=>notify("Cached media cleared. Your project and original files are saved.")).catch(()=>setError("The temporary cache could not be cleared. Close other Studio tabs and try again."))}>Clear temporary media cache</button></div>;
}
