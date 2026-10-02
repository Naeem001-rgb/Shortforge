import { assetUrl } from "../../api";
import { durationOf } from "../editorModel";
import type { EditorMedia, EditorProject } from "../editorModel";
import { audibleGain } from "./renderFrame";
const decoded=new Map<string,Promise<AudioBuffer>>();
export async function decodeAudio(asset:EditorMedia):Promise<AudioBuffer>{
  if(decoded.has(asset.id))return decoded.get(asset.id)!;
  const task=(async()=>{const r=await fetch(assetUrl(asset));if(!r.ok)throw new Error(`Cannot load audio for ${asset.name}. Relink the media and retry.`);const bytes=await r.arrayBuffer();return new OfflineAudioContext(2,1,48000).decodeAudioData(bytes);})();
  decoded.set(asset.id,task);task.catch(()=>decoded.delete(asset.id));return task;
}
/** Preview and export use this exact sample clock and gain envelope. */
export async function mixProjectAudio(project:EditorProject,media:EditorMedia[],signal?:AbortSignal):Promise<AudioBuffer>{
  const sampleRate=48000,duration=durationOf(project),ctx=new OfflineAudioContext(2,Math.max(1,Math.ceil(duration*sampleRate)),sampleRate);
  for(const item of project.items){
    signal?.throwIfAborted();const asset=media.find(m=>m.id===item.asset_id),track=project.tracks?.find(t=>t.id===item.track);
    if(!asset?.has_audio||item.kind==="text"||item.muted||track?.muted||track?.hidden||item.freeze_at!=null)continue;
    const buffer=await decodeAudio(asset);signal?.throwIfAborted();
    const source=ctx.createBufferSource(),gain=ctx.createGain();
    if(item.reverse){
      const offset=Math.round(item.source_in*buffer.sampleRate),length=Math.min(buffer.length-offset,Math.ceil(item.duration*item.speed*buffer.sampleRate));
      if(length<=0)continue;const reverse=ctx.createBuffer(buffer.numberOfChannels,length,buffer.sampleRate);
      for(let channel=0;channel<buffer.numberOfChannels;channel++){const output=reverse.getChannelData(channel),input=buffer.getChannelData(channel);for(let n=0;n<length;n++)output[n]=input[offset+length-1-n];}
      source.buffer=reverse;
    }else source.buffer=buffer;
    source.playbackRate.value=item.speed;source.connect(gain).connect(ctx.destination);
    const samples=Math.max(2,Math.ceil(item.duration*100)),curve=new Float32Array(samples);
    for(let n=0;n<samples;n++)curve[n]=audibleGain(project,item,item.start+Math.min(item.duration-.00001,n/(samples-1)*item.duration));
    gain.gain.setValueCurveAtTime(curve,item.start,item.duration);
    source.start(item.start,item.reverse?0:item.source_in,Math.min(item.duration*item.speed,(source.buffer.duration-(item.reverse?0:item.source_in))));
    source.stop(item.start+item.duration);
  }
  const result=await ctx.startRendering();signal?.throwIfAborted();return result;
}
