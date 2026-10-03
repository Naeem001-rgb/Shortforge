import { displayAt } from "../editorModel";
import type { EditorMedia, EditorProject, TimelineItem } from "../editorModel";
import { layoutCaption } from "./renderFrame";
import { styleOf } from "../textPresets";
export function layerSize(item:TimelineItem,project:EditorProject,asset?:EditorMedia,ctx?:CanvasRenderingContext2D|null){
  if(item.kind==="text"){
    if(ctx){ctx.save();const style=styleOf(item);ctx.font=`${style.italic?"italic ":""}${style.bold?800:500} ${item.font_size}px "${item.font_family||"ShortForge Captions"}"`;const layout=layoutCaption(ctx,item,project.width*.88);ctx.restore();return {width:Math.max(40,Math.max(...layout.lineWidths,0)+style.stroke*2+20),height:layout.height+style.stroke*2+20};}
    return {width:project.width*.88,height:item.font_size*1.5};
  }
  if(asset?.width&&asset.height){const crop=item.crop||{left:0,right:0,top:0,bottom:0},sw=asset.width*(1-(crop.left+crop.right)/100),sh=asset.height*(1-(crop.top+crop.bottom)/100),factor=item.fit==="cover"?Math.max(project.width/sw,project.height/sh):Math.min(project.width/sw,project.height/sh);return {width:sw*factor,height:sh*factor};}
  return {width:project.width,height:project.height};
}
export function layerHit(item:TimelineItem,time:number,x:number,y:number,project:EditorProject,size:{width:number;height:number}):boolean{
  const v=displayAt(item,time-item.start);if(v.opacity<=0)return false;
  const dx=x-(.5+v.x/100)*project.width,dy=y-(.5+v.y/100)*project.height,angle=-v.rotation*Math.PI/180;
  const lx=(dx*Math.cos(angle)-dy*Math.sin(angle))/v.scale,ly=(dx*Math.sin(angle)+dy*Math.cos(angle))/v.scale;
  if(item.mask?.shape==="circle"&&(lx/(project.width*.45))**2+(ly/(project.height*.45))**2>1)return false;
  return Math.abs(lx)<=size.width/2&&Math.abs(ly)<=size.height/2;
}
export function snappedPosition(x:number,y:number,rotation:number,scale:number,size:{width:number;height:number},project:EditorProject){
  const a=rotation*Math.PI/180,halfW=(Math.abs(Math.cos(a))*size.width+Math.abs(Math.sin(a))*size.height)*scale/2,halfH=(Math.abs(Math.sin(a))*size.width+Math.abs(Math.cos(a))*size.height)*scale/2;
  const nearest=(position:number,targets:number[],threshold:number)=>targets.reduce((best,t)=>Math.abs(position-t)<Math.abs(position-best)&&Math.abs(position-t)<threshold?t:best,Infinity);
  const cx=(.5+x/100)*project.width,cy=(.5+y/100)*project.height;
  const sx=nearest(cx,[project.width/2,halfW,project.width-halfW,project.width*.05+halfW,project.width*.85-halfW],project.width*.014),sy=nearest(cy,[project.height/2,halfH,project.height-halfH,project.height*.08+halfH,project.height*.78-halfH],project.height*.014);
  return {x:Number.isFinite(sx)?(sx/project.width-.5)*100:x,y:Number.isFinite(sy)?(sy/project.height-.5)*100:y,guideX:sx===project.width/2,guideY:sy===project.height/2};
}
