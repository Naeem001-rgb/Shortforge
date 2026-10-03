import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from "webm-muxer";
import { cacheMedia } from "../mediaStorage";
import { assetUrl } from "../../api";
import { durationOf } from "../editorModel";
import type { EditorMedia,EditorProject } from "../editorModel";
import { mixProjectAudio } from "./audioMix";
import { createRenderResources,renderFrame,sourceTime } from "./renderFrame";
import type { FrameSources } from "./renderFrame";
export type ExportProgress={progress:number;phase:string;eta:number;frame:number;totalFrames:number};
export type ExportOptions={resolution:720|1080;fps?:24|30|60;quality?:"standard"|"high"|"maximum";signal?:AbortSignal;onProgress?:(progress:ExportProgress)=>void};
export type ExportResult={blob:Blob;extension:"mp4"|"webm";width:number;height:number;fps:number;duration:number;elapsed:number};
function waitFor(element:HTMLMediaElement,event:string,signal?:AbortSignal):Promise<void>{
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>fail(new Error("A video frame could not be decoded. Relink the media and retry.")),20000);
    const clean=()=>{clearTimeout(timer);element.removeEventListener(event,done);element.removeEventListener("error",failed);signal?.removeEventListener("abort",abort);};
    const done=()=>{clean();resolve();}, fail=(error:Error)=>{clean();reject(error);},failed=()=>fail(new Error("A source video cannot be decoded. Import an H.264 MP4 and retry.")),abort=()=>fail(new DOMException("Export cancelled","AbortError"));
    element.addEventListener(event,done,{once:true});element.addEventListener("error",failed,{once:true});signal?.addEventListener("abort",abort,{once:true});if(signal?.aborted)abort();
  });
}
/** Frame-stepped export never uses requestAnimationFrame or real-time recording. */
export async function exportProject(project:EditorProject,media:EditorMedia[],options:ExportOptions):Promise<ExportResult>{
  if(typeof VideoEncoder==="undefined"||typeof AudioEncoder==="undefined")throw new Error("This browser does not support video encoding. Use the local compatibility export or current Chrome.");
  const start=performance.now(),duration=durationOf(project),fps=options.fps||project.fps,width=project.width<=project.height?options.resolution:Math.round(options.resolution*project.width/project.height/2)*2,height=project.width<=project.height?Math.round(options.resolution*project.height/project.width/2)*2:options.resolution,totalFrames=Math.ceil(duration*fps);
  if(!totalFrames)throw new Error("Add media to the timeline before exporting.");
  const bitrate=({standard:6,high:12,maximum:20}[options.quality||"high"])*1_000_000*(options.resolution/1080)**2;
  let extension:"mp4"|"webm"="mp4",videoConfig:VideoEncoderConfig={codec:"avc1.420034",width,height,bitrate,framerate:fps,latencyMode:"quality",avc:{format:"avc"}},audioConfig:AudioEncoderConfig={codec:"mp4a.40.2",sampleRate:48000,numberOfChannels:2,bitrate:192000};
  const supports=async()=>{try{return (await VideoEncoder.isConfigSupported(videoConfig)).supported&&(await AudioEncoder.isConfigSupported(audioConfig)).supported;}catch{return false;}};
  if(!await supports()){
    extension="webm";videoConfig={codec:"vp09.00.41.08",width,height,bitrate,framerate:fps,latencyMode:"realtime"};audioConfig={codec:"opus",sampleRate:48000,numberOfChannels:2,bitrate:160000};
    if(!await supports())throw new Error("No supported video/audio encoder was found. Choose local compatibility export.");
  }
  const target=extension==="mp4"?new ArrayBufferTarget():new WebmTarget();
  const muxer=extension==="mp4"?new Muxer({target:target as ArrayBufferTarget,video:{codec:"avc",width,height,frameRate:fps},audio:{codec:"aac",sampleRate:48000,numberOfChannels:2},fastStart:"in-memory",firstTimestampBehavior:"offset"}):new WebmMuxer({target:target as WebmTarget,video:{codec:"V_VP9",width,height,frameRate:fps},audio:{codec:"A_OPUS",sampleRate:48000,numberOfChannels:2},firstTimestampBehavior:"offset"});
  let encodingError:Error|null=null;
  const encoder=new VideoEncoder({output:(chunk,meta)=>muxer.addVideoChunk(chunk,meta),error:error=>{encodingError=error;}}),audioEncoder=new AudioEncoder({output:(chunk,meta)=>muxer.addAudioChunk(chunk,meta),error:error=>{encodingError=error;}});
  const localUrls=new Map<string,string>();
  const videos=new Map<string,HTMLVideoElement>(),sources:FrameSources=new Map(),resources=createRenderResources(),canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;const ctx=canvas.getContext("2d")!;
  const report=(progress:number,phase:string,frame=0)=>{const elapsed=(performance.now()-start)/1000;options.onProgress?.({progress,phase,frame,totalFrames,eta:progress>5?Math.max(0,elapsed*(100-progress)/progress):0});};
  try{
    options.signal?.throwIfAborted();report(1,"Preparing media");
    const visual=project.items.filter(i=>i.kind==="video"&&!project.tracks?.find(t=>t.id===i.track)?.hidden);
    // Limit setup concurrency: one decoder per timeline clip only while exporting.
    for(const item of visual){
      options.signal?.throwIfAborted();const asset=media.find(m=>m.id===item.asset_id);if(!asset)throw new Error(`Missing media: ${item.name}. Relink the file before exporting.`);
      if(!localUrls.has(asset.id)){const file=await cacheMedia(asset,options.signal);localUrls.set(asset.id,file?URL.createObjectURL(file):assetUrl(asset));}
      if(asset.media_type==="image"){
        const image=new Image();image.crossOrigin="anonymous";image.src=localUrls.get(asset.id)!;await image.decode();sources.set(item.id,image);
      }else{
        const video=document.createElement("video");video.crossOrigin="anonymous";video.muted=true;video.preload="auto";video.playsInline=true;
        videos.set(item.id,video);const ready=waitFor(video,"loadeddata",options.signal);video.src=localUrls.get(asset.id)!;await ready;sources.set(item.id,video);
      }
    }
    // Fonts must have settled before measuring any caption for either path.
    await Promise.all([...new Set(project.items.filter(i=>i.kind==="text").map(i=>i.font_family||"ShortForge Captions"))].map(family=>document.fonts.load(`800 64px "${family}"`)));await document.fonts.ready;report(4,"Mixing audio");const audio=await mixProjectAudio(project,media,options.signal);
    encoder.configure(videoConfig);audioEncoder.configure(audioConfig);report(8,"Rendering video");
    for(let frame=0;frame<totalFrames;frame++){
      options.signal?.throwIfAborted();if(encodingError)throw encodingError;const time=frame/fps;
      await Promise.all(visual.filter(i=>time>=i.start&&time<i.start+i.duration).map(async item=>{
        const video=videos.get(item.id);if(!video)return;const at=Math.min(sourceTime(item,time),Math.max(0,video.duration-.0001));
        if(Math.abs(video.currentTime-at)>.00001){const seek=waitFor(video,"seeked",options.signal);video.currentTime=at;await seek;}
      }));
      renderFrame(ctx,project,time,sources,resources);
      const timestamp=Math.round(frame/fps*1_000_000),next=Math.round((frame+1)/fps*1_000_000),videoFrame=new VideoFrame(canvas,{timestamp,duration:next-timestamp});
      encoder.encode(videoFrame,{keyFrame:frame%(fps*2)===0});videoFrame.close();
      if(encoder.encodeQueueSize>8)await new Promise<void>((resolve,reject)=>{
        const done=()=>{if(encoder.encodeQueueSize<=4){clean();resolve();}};
        const abort=()=>{clean();reject(new DOMException("Export cancelled","AbortError"));};
        const clean=()=>{encoder.removeEventListener("dequeue",done);options.signal?.removeEventListener("abort",abort);};
        encoder.addEventListener("dequeue",done);options.signal?.addEventListener("abort",abort,{once:true});done();
      });
      if(frame%5===0)report(8+frame/totalFrames*82,"Rendering video",frame);
    }
    await encoder.flush();report(91,"Encoding audio",totalFrames);
    const left=audio.getChannelData(0),right=audio.getChannelData(Math.min(1,audio.numberOfChannels-1));
    const length=Math.ceil(totalFrames/fps*48000);
    for(let offset=0;offset<length;offset+=1024){
      options.signal?.throwIfAborted();if(encodingError)throw encodingError;
      const count=Math.min(1024,length-offset),data=new Float32Array(count*2);
      data.set(left.subarray(offset,Math.min(offset+count,left.length)),0);data.set(right.subarray(offset,Math.min(offset+count,right.length)),count);
      const frame=new AudioData({format:"f32-planar",sampleRate:48000,numberOfChannels:2,numberOfFrames:count,timestamp:Math.round(offset/48000*1_000_000),data});audioEncoder.encode(frame);frame.close();
      if(audioEncoder.encodeQueueSize>40)await new Promise<void>((resolve,reject)=>{
        const done=()=>{if(audioEncoder.encodeQueueSize<=20){clean();resolve();}};
        const abort=()=>{clean();reject(new DOMException("Export cancelled","AbortError"));};
        const clean=()=>{audioEncoder.removeEventListener("dequeue",done);options.signal?.removeEventListener("abort",abort);};
        audioEncoder.addEventListener("dequeue",done);options.signal?.addEventListener("abort",abort,{once:true});done();
      });
    }
    await audioEncoder.flush();if(encodingError)throw encodingError;options.signal?.throwIfAborted();report(98,"Finalizing file",totalFrames);muxer.finalize();
    const result:ExportResult={blob:new Blob([target.buffer],{type:extension==="mp4"?"video/mp4":"video/webm"}),extension,width,height,fps,duration:totalFrames/fps,elapsed:(performance.now()-start)/1000};report(100,"Export complete",totalFrames);return result;
  }finally{
    if(encoder.state!=="closed")encoder.close();if(audioEncoder.state!=="closed")audioEncoder.close();videos.forEach(v=>{v.removeAttribute("src");v.load();});resources.gpu.dispose();resources.transitions.dispose();localUrls.forEach(url=>{if(url.startsWith("blob:"))URL.revokeObjectURL(url);});
  }
}
