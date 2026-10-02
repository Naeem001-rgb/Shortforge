import { assetUrl } from "../api";
import type { EditorMedia } from "./editorModel";
const cache=new Map<string,Promise<string[]>>();
/** One bounded decode per asset. Filmstrips always come from the user's footage. */
export function mediaThumbnails(asset:EditorMedia):Promise<string[]> {
  if(asset.media_type==="image") return Promise.resolve([assetUrl(asset)]);
  if(asset.media_type!=="video") return Promise.resolve([]);
  const key=asset.id+":"+asset.duration;
  if(cache.has(key))return cache.get(key)!;
  const task=(async()=>{
    const video=document.createElement("video"); video.muted=true; video.preload="auto";video.crossOrigin="anonymous";
    const wait=(event:string)=>new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>{clean();reject(new Error("Preview timed out"));},12000);
      const clean=()=>{clearTimeout(timer);video.removeEventListener(event,done);video.removeEventListener("error",fail);};
      const done=()=>{clean();resolve();};const fail=()=>{clean();reject(new Error("Preview unavailable"));};
      video.addEventListener(event,done,{once:true});video.addEventListener("error",fail,{once:true});
    });
    try {
      const ready=wait("loadeddata");video.src=assetUrl(asset); await ready;
      const canvas=document.createElement("canvas");canvas.width=120;canvas.height=Math.round(120*video.videoHeight/video.videoWidth);
      const ctx=canvas.getContext("2d")!;const frames:string[]=[];
      for(let n=0;n<6;n++) {
        const at=Math.min(Math.max(0,asset.duration-.08),asset.duration*n/6+.001);
        if(Math.abs(video.currentTime-at)>.0001){const seek=wait("seeked");video.currentTime=at;await seek;}
        ctx.drawImage(video,0,0,canvas.width,canvas.height);frames.push(canvas.toDataURL("image/jpeg",.65));
      }
      return frames;
    } catch { return asset.thumbnail_url ? [asset.thumbnail_url] : []; }
    finally {video.removeAttribute("src");video.load();}
  })();
  if(cache.size>80) cache.delete(cache.keys().next().value!);
  cache.set(key,task);return task;
}
