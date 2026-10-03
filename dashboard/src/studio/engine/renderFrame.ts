import { clamp, defaultAdjustments, displayAt } from "../editorModel";
import type { EditorProject, TimelineItem } from "../editorModel";
import { captionSource, keyWordIndexes, styleOf } from "../textPresets";
import { transitionBlend } from "../transitions";
import type { TransitionLayer } from "../transitions";
import { GpuTransitions } from "./gpuTransitions";
import { GpuProcessor } from "./gpu";
export type FrameSources=Map<string,CanvasImageSource>;
export type RenderResources={layer:HTMLCanvasElement;gpu:GpuProcessor;transitions:GpuTransitions;first:HTMLCanvasElement;second:HTMLCanvasElement};
export const createRenderResources=():RenderResources=>({layer:document.createElement("canvas"),gpu:new GpuProcessor(),transitions:new GpuTransitions(),first:document.createElement("canvas"),second:document.createElement("canvas")});
export function sourceTime(item:TimelineItem,time:number):number {
  if(item.freeze_at!=null)return item.freeze_at;
  const local=clamp(time-item.start,0,Math.max(0,item.duration-.00001));
  return item.source_in+(item.reverse?Math.max(0,item.duration-local-.00001):local)*item.speed;
}
export function audibleGain(project:EditorProject,item:TimelineItem,time:number):number {
  const track=project.tracks?.find(t=>t.id===item.track);
  if(item.muted||track?.muted||track?.hidden||time<item.start||time>=item.start+item.duration||item.freeze_at!=null)return 0;
  let gain=clamp(displayAt(item,time-item.start).volume,0,2)*(track?.volume??1);
  if(item.ducking && (item.audio_role==="music"||item.kind==="audio")){
    let duck=0;
    for(const voice of project.items.filter(i=>i.id!==item.id&&i.audio_role==="voiceover"&&!i.muted&&!project.tracks?.find(t=>t.id===i.track)?.muted&&!project.tracks?.find(t=>t.id===i.track)?.hidden)){
      const attack=.15,release=.3;
      if(time>=voice.start-attack&&time<=voice.start+voice.duration+release)duck=Math.max(duck,Math.min(1,(time-voice.start+attack)/attack,(voice.start+voice.duration+release-time)/release));
    }
    gain*=1-.78*clamp(duck,0,1);
  }
  return gain;
}
function rounded(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number){ctx.beginPath();ctx.roundRect(x,y,w,h,Math.min(r,h/2));}
export type CaptionLayout={lines:{text:string;index:number;width:number}[][];lineWidths:number[];lineHeight:number;height:number};
export function layoutCaption(ctx:CanvasRenderingContext2D,item:TimelineItem,maxWidth:number):CaptionLayout {
  const style=styleOf(item),text=captionSource(item,style),space=ctx.measureText(" ").width;
  const lines:{text:string;index:number;width:number}[][]=[], widths:number[]=[];
  let line:{text:string;index:number;width:number}[]=[],width=0,index=0;
  for(const paragraph of text.split("\n")){
    for(const word of paragraph.split(/\s+/).filter(Boolean)){
      const w=ctx.measureText(word).width+Math.max(0,word.length-1)*style.letter_spacing;
      if(line.length && (width+space+w>maxWidth || (item.caption_words && line.length>=4))){lines.push(line);widths.push(width);line=[];width=0;}
      if(line.length)width+=space;line.push({text:word,index:index++,width:w});width+=w;
    }
    if(line.length){lines.push(line);widths.push(width);line=[];width=0;}
  }
  const lineHeight=item.font_size*(style.line_height||1.15);
  return {lines,lineWidths:widths,lineHeight,height:Math.max(1,lines.length)*lineHeight};
}
function drawCaption(ctx:CanvasRenderingContext2D,item:TimelineItem,time:number,w:number,h:number){
  const style=styleOf(item),local=time-item.start;
  if(item.caption_style==="beast-yellow" && item.caption_words?.length){
    const spoken=item.caption_words.find(word=>local>=word.start && local<word.end);if(!spoken)return;
    drawCaption(ctx,{...item,caption_style:"single-word-active",text:spoken.word,caption_words:[spoken]},time,w,h);return;
  }
  const emphasized=keyWordIndexes(captionSource(item,style).trim().split(/\s+/),style);
  ctx.font=`${style.italic?"italic ":""}${style.bold?800:500} ${item.font_size}px "${item.font_family||"ShortForge Captions"}",sans-serif`;
  ctx.textAlign="left";ctx.textBaseline="middle";
  const layout=layoutCaption(ctx,item,w*.88),space=ctx.measureText(" ").width;
  let active=-1;
  if(item.caption_words?.length)active=item.caption_words.findIndex(word=>local>=word.start&&local<word.end);
  // SRT has line timing only. Keep line styles, never invent word alignment.
  const reveal=style.reveal==="typewriter"?Math.floor(clamp(local/Math.min(item.duration,.8),0,1)*item.text.length):Infinity;
  let consumed=0;
  if(item.text_background!=="transparent"){
    const bw=Math.max(...layout.lineWidths,0)+(style.box_padding||18)*2;
    ctx.fillStyle=item.text_background;rounded(ctx,-bw/2,-layout.height/2-10,bw,layout.height+20,12);ctx.fill();
  }
  layout.lines.forEach((line,lineIndex)=>{
    let x=style.align==="left"?-w*.44:style.align==="right"?w*.44-layout.lineWidths[lineIndex]:-layout.lineWidths[lineIndex]/2;
    const y=(lineIndex-(layout.lines.length-1)/2)*layout.lineHeight;
    for(const word of line){
      let shown=word.text.slice(0,Math.max(0,reveal-consumed));consumed+=word.text.length+1;
      if(!shown){x+=word.width+space;continue;}
      const isActive=active===word.index,keyword=emphasized.has(word.index);
      const highlight=isActive||keyword;
      if(highlight&&style.emphasis_case==="upper")shown=shown.toUpperCase();
      if(highlight&&style.emphasis_case==="lower")shown=shown.toLowerCase();
      ctx.save();ctx.translate(x+word.width/2,y);
      const activeWord=item.caption_words?.[word.index];const progress=activeWord?clamp((local-activeWord.start)/Math.max(.04,activeWord.end-activeWord.start),0,1):0;
      if(highlight&&style.emphasis==="pop")ctx.scale(1+.12*Math.sin(progress*Math.PI),1+.12*Math.sin(progress*Math.PI));
      if(highlight&&style.emphasis==="tilt")ctx.rotate(-.045);
      if(highlight&&style.emphasis==="flash"&&Math.sin(local*30)>0)ctx.globalAlpha*=.65;
      if(highlight&&style.emphasis==="shake")ctx.translate(Math.sin(local*60)*2,Math.cos(local*40)*2);
      if(highlight&&style.chip==="emphasis") {ctx.fillStyle=style.highlight;rounded(ctx,-word.width/2-10,-item.font_size*.59,word.width+20,item.font_size*1.18,9);ctx.fill();}
      ctx.shadowColor=style.glow>0?style.glow_color:`${style.shadow_color}${Math.round(style.shadow_opacity*255).toString(16).padStart(2,"0")}`;ctx.shadowBlur=style.glow||style.shadow_soft;ctx.shadowOffsetY=style.shadow;
      ctx.lineJoin="round";ctx.miterLimit=2;ctx.strokeStyle=style.stroke_color;ctx.lineWidth=style.stroke*2;
      const fill=highlight?style.chip==="emphasis"?"#101014":isActive?style.highlight:style.emphasis_color:item.color;
      ctx.fillStyle=fill;
      if(item.caption_style==="karaoke"&&isActive){const sweep=ctx.createLinearGradient(-word.width/2,0,word.width/2,0);sweep.addColorStop(0,style.highlight);sweep.addColorStop(progress,style.highlight);sweep.addColorStop(Math.min(1,progress+.001),item.color);sweep.addColorStop(1,item.color);ctx.fillStyle=sweep;}
      if(style.color_ramp==="words"){
        const gradient=ctx.createLinearGradient(-word.width/2,0,word.width/2,0);gradient.addColorStop(0,fill);gradient.addColorStop(1,style.ramp_color);ctx.fillStyle=gradient;
      }
      if(style.letter_spacing){let at=-word.width/2;for(const char of shown){if(style.stroke)ctx.strokeText(char,at,0);ctx.fillText(char,at,0);at+=ctx.measureText(char).width+style.letter_spacing;}}
      else {if(style.stroke)ctx.strokeText(shown,-word.width/2,0);ctx.fillText(shown,-word.width/2,0);}
      ctx.restore();x+=word.width+space;
    }
  });
}
function clipTransition(ctx:CanvasRenderingContext2D,mine:TransitionLayer|undefined,w:number,h:number){
  if(mine?.clipPath?.startsWith("circle")){
    const radius=parseFloat(mine.clipPath.slice(7))/100*Math.hypot(w,h)/Math.SQRT2;ctx.beginPath();ctx.arc(0,0,radius,0,Math.PI*2);ctx.clip();
  }else if(mine?.clipPath?.startsWith("inset")){
    const parts=mine.clipPath.slice(6,-1).split(" ").map(parseFloat),[top,right,bottom,left]=parts;
    ctx.beginPath();ctx.rect(-w/2+w*left/100,-h/2+h*top/100,w*(1-(left+right)/100),h*(1-(top+bottom)/100));ctx.clip();
  }else if(mine?.mask){const angle=parseFloat(mine.mask.split("#000 ")[1])/180*Math.PI;ctx.beginPath();ctx.moveTo(0,0);ctx.arc(0,0,Math.hypot(w,h),-Math.PI/2,angle-Math.PI/2);ctx.closePath();ctx.clip();}
}
/** The one compositor called by interactive preview AND deterministic export. */
export function renderFrame(ctx:CanvasRenderingContext2D,project:EditorProject,time:number,sources:FrameSources,resources:RenderResources,transparent=false):void {
  const cw=ctx.canvas.width,ch=ctx.canvas.height,w=project.width,h=project.height;
  ctx.save();ctx.setTransform(cw/w,0,0,ch/h,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation="source-over";ctx.filter="none";ctx.clearRect(0,0,w,h);if(!transparent){ctx.fillStyle=project.background;ctx.fillRect(0,0,w,h);}
  const visible=project.items.filter(i=>i.kind!=="audio"&&time>=i.start&&time<i.start+i.duration&&!project.tracks?.find(t=>t.id===i.track)?.hidden).sort((a,b)=>a.track-b.track||a.start-b.start);
  const rendered=new Set<string>();
  for(const item of visible){
    if(rendered.has(item.id))continue;
    const v=displayAt(item,time-item.start),blend=transitionBlend(project.items.filter(i=>i.track===item.track&&i.kind!=="audio"),time);
    if(blend && resources.transitions.available){
      for(const layer of [resources.first,resources.second]){if(layer.width!==cw||layer.height!==ch){layer.width=cw;layer.height=ch;}}
      renderFrame(resources.first.getContext("2d")!,{...project,items:[{...blend.previous,transition_in:"none"}]},time,sources,resources,true);
      renderFrame(resources.second.getContext("2d")!,{...project,items:[{...blend.item,transition_in:"none"}]},time,sources,resources,true);
      const image=resources.transitions.render(resources.first,resources.second,blend.item.transition_in,blend.frame.progress);
      if(image){ctx.drawImage(image,0,0,w,h);rendered.add(blend.previous.id);rendered.add(blend.item.id);continue;}
    }
    let mine=blend?.item.id===item.id?blend.frame.incoming:blend?.previous.id===item.id?blend.frame.outgoing:undefined;
    // Cross dissolve overlays incoming opacity over an opaque outgoing image.
    if(blend?.previous.id===item.id&&["crossfade","blur","zoom-blur","pixelize","luma-burn"].includes(blend.item.transition_in))mine={...mine!,opacity:1};
    if(blend&&["dip-to-white","dip-to-black"].includes(blend.item.transition_in)){
      if(blend.previous.id===item.id){ctx.fillStyle=blend.item.transition_in==="dip-to-white"?"#ffffff":"#000000";ctx.fillRect(0,0,w,h);}
      mine={...(mine!),opacity:blend.item.id===item.id?Math.max(0,2*blend.frame.progress-1):Math.max(0,1-2*blend.frame.progress)};
    }
    ctx.save();ctx.translate(w/2+(v.x+(mine?.x||0))*w/100,h/2+(v.y+(mine?.y||0))*h/100);ctx.rotate(v.rotation*Math.PI/180);ctx.scale(v.scale*(mine?.scale||1)*(item.flip_x?-1:1),v.scale*(mine?.scale||1)*(item.flip_y?-1:1));ctx.globalAlpha=clamp(v.opacity*(mine?.opacity??1),0,1);ctx.globalCompositeOperation=item.blend_mode&&item.blend_mode!=="normal"?item.blend_mode:"source-over";
    if(blend?.item.id===item.id && blend.item.transition_in==="circle-close"){
      const radius=(1-blend.frame.progress)*Math.hypot(w,h)/2;ctx.beginPath();ctx.rect(-w/2,-h/2,w,h);ctx.arc(0,0,radius,0,Math.PI*2);ctx.clip("evenodd");
    }else clipTransition(ctx,mine,w,h);
    if(item.kind==="text")drawCaption(ctx,{...item,font_size:v.values?.font_size ?? v.values?.["text.font_size"] ?? item.font_size},time,w,h);
    else {
      let source=sources.get(item.id)||sources.get(item.asset_id||"");
      if(source){
        const dimensions=source as HTMLVideoElement&HTMLImageElement&HTMLCanvasElement;
        const sw=dimensions.videoWidth||dimensions.naturalWidth||dimensions.width,sh=dimensions.videoHeight||dimensions.naturalHeight||dimensions.height;
        if(sw&&sh){
          const crop={top:0,right:0,bottom:0,left:0,...item.crop};for(const edge of ["top","right","bottom","left"] as const)if(v.values?.[`crop.${edge}`]!==undefined)crop[edge]=clamp(v.values[`crop.${edge}`],0,45);const sx=sw*crop.left/100,sy=sh*crop.top/100,srcw=sw*(1-(crop.left+crop.right)/100),srch=sh*(1-(crop.top+crop.bottom)/100);
          const adjustment={...defaultAdjustments,...item.adjustments};for(const [key,n]of Object.entries(v.values||{}))if(key.startsWith("adjustments."))(adjustment as unknown as Record<string,number>)[key.slice(12)]=n;
          if(Object.keys(item.adjustments||{}).length||Object.keys(v.values||{}).some(key=>key.startsWith("adjustments."))||item.chroma_key?.enabled||(mine?.pixelSize||0)>0)source=resources.gpu.process(source,sw,sh,adjustment,item.chroma_key,time,mine?.pixelSize);
          const factor=item.fit==="cover"?Math.max(w/srcw,h/srch):Math.min(w/srcw,h/srch),dw=srcw*factor,dh=srch*factor;
          if(item.mask?.shape==="circle"){ctx.beginPath();ctx.ellipse(0,0,w*.45,h*.45,0,0,Math.PI*2);ctx.clip();}
          else if(item.mask?.shape==="rectangle"){rounded(ctx,-w*.45,-h*.4,w*.9,h*.8,32);ctx.clip();}
          ctx.filter=`blur(${mine?.blur||0}px) brightness(${mine?.brightness||1})`;
          ctx.drawImage(source,sx,sy,srcw,srch,-dw/2,-dh/2,dw,dh);
          const conceal=item.conceal;
          if(conceal&&conceal.mode!=="none"){
            const x=-w/2+conceal.x*w/100,y=-h/2+conceal.y*h/100,rw=conceal.width*w/100,rh=conceal.height*h/100;
            ctx.save();ctx.beginPath();ctx.rect(x,y,rw,rh);ctx.clip();
            if(conceal.mode==="cover"){ctx.fillStyle=conceal.color;ctx.fillRect(x,y,rw,rh);}
            else if(conceal.mode==="blur"){ctx.filter="blur(24px)";ctx.drawImage(source,sx,sy,srcw,srch,-dw/2,-dh/2,dw,dh);}
            else {let input=source;if(source===resources.gpu.canvas){resources.layer.width=sw;resources.layer.height=sh;resources.layer.getContext("2d")!.drawImage(source,0,0);input=resources.layer;}const pixel=resources.gpu.process(input,sw,sh,undefined,undefined,time,40);ctx.drawImage(pixel,sx,sy,srcw,srch,-dw/2,-dh/2,dw,dh);}
            ctx.restore();
          }
        }
      }
    }
    ctx.restore();
  }
  ctx.restore();
}
