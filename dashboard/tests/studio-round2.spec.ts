import { test, expect } from "@playwright/test";
import { fixtures, uploadProject, removeProject, videoFixture, editorState } from "./editor-fixtures";

test.beforeAll(fixtures);
test("GPU transitions, compiled animation recipes and geometric selection are deterministic",async({page})=>{
  await page.goto("/");
  const result=await page.evaluate(async()=>{
    const {newItem,animations,displayAt}=await import("/src/studio/editorModel.ts" as string);
    const {compileAnimation}=await import("/src/studio/animationEngine.ts" as string);
    const {renderFrame,createRenderResources}=await import("/src/studio/engine/renderFrame.ts" as string);
    const {transitions}=await import("/src/studio/transitions.ts" as string);
    const {layerSize,layerHit,snappedPosition}=await import("/src/studio/engine/geometry.ts" as string);
    const a=document.createElement("canvas"),b=document.createElement("canvas"),out=document.createElement("canvas");
    for(const c of[a,b,out]){c.width=160;c.height=284;}
    const ac=a.getContext("2d")!,bc=b.getContext("2d")!,ctx=out.getContext("2d")!;
    ac.fillStyle="#fa3526";ac.fillRect(0,0,160,284);ac.fillStyle="#ffdf42";ac.fillRect(8,14,62,115);ac.fillStyle="#521570";ac.fillRect(78,145,40,100);
    bc.fillStyle="#1645e8";bc.fillRect(0,0,160,284);bc.fillStyle="#31ed8c";bc.fillRect(13,90,130,28);bc.fillStyle="#121526";bc.fillRect(108,4,40,70);
    const first={...newItem("video"),id:"a",asset_id:"a",duration:4},second={...newItem("video"),id:"b",asset_id:"b",start:3,duration:4,transition_duration:1};
    const p={version:1,width:1080,height:1920,fps:30,background:"#000000",items:[first,second]},r=createRenderResources(),sources=new Map([["a",a],["b",b]]);
    const hash=()=>{let n=2166136261;for(const byte of ctx.getImageData(0,0,160,284).data)n=Math.imul(n^byte,16777619);return n;};
    const hashes=[],boundaries=[];
    for(const transition of transitions){second.transition_in=transition.id;renderFrame(ctx,p,3,sources,r);const start=hash();renderFrame(ctx,p,3.37,sources,r);const middle=hash();renderFrame(ctx,p,4,sources,r);const end=hash();hashes.push(middle);boundaries.push(start!==middle&&end!==middle);}
    second.transition_in="circle-close";renderFrame(ctx,p,3.6,sources,r);const center=[...ctx.getImageData(80,142,1,1).data],corner=[...ctx.getImageData(2,2,1,1).data];
    const recipes=animations.filter((a:{value:string})=>a.value!=="none").map((preset:{value:string})=>{const item=compileAnimation(first,preset.value,"in",.6);return {id:preset.value,count:item.keyframes.length,raw:item.animation_in,saved:JSON.parse(JSON.stringify(item)).animation_labels.in,changes:JSON.stringify(displayAt(item,0))!==JSON.stringify(displayAt(item,.6))};});
    const blur=compileAnimation(first,"blur-in","in",.6);
    const inset={...first,fit:"contain",transform:{x:20,y:0,scale:.2,rotation:45,opacity:1}},size=layerSize(inset,p,{width:100,height:100});
    const hit=layerHit(inset,0,756,960,p,size),miss=layerHit(inset,0,10,10,p,size),snap=snappedPosition(-34.9,0,0,.2,size,p);
    r.gpu.dispose();r.transitions.dispose();
    return {gpu:r.transitions.available,unique:new Set(hashes).size,total:transitions.length,boundaries,center,corner,recipes,blur:blur.keyframes.some((k:{values?:Record<string,number>})=>(k.values?.["adjustments.blur"]||0)>0),hit,miss,snap};
  });
  expect(result.gpu).toBe(true);expect(result.total).toBeGreaterThanOrEqual(20);expect(result.unique).toBeGreaterThanOrEqual(19);expect(result.boundaries.every(Boolean)).toBe(true);expect(result.center).not.toEqual(result.corner);
  expect(result.recipes.length).toBeGreaterThanOrEqual(25);for(const recipe of result.recipes){expect(recipe.count).toBeGreaterThan(2);expect(recipe.raw).toBe("none");expect(recipe.saved).toBe(recipe.id);}
  expect(result.blur).toBe(true);expect(result.hit).toBe(true);expect(result.miss).toBe(false);
});

test("every original caption preset loads its bundled font and renders a distinct timed style",async({page},testInfo)=>{
  await page.goto("/");
  const matrix=await page.evaluate(async()=>{
    const {textPresets,applyTextPreset}=await import("/src/studio/textPresets.ts" as string),{newItem}=await import("/src/studio/editorModel.ts" as string),{renderFrame,createRenderResources}=await import("/src/studio/engine/renderFrame.ts" as string);
    const tile=document.createElement("canvas");tile.width=216;tile.height=384;const ctx=tile.getContext("2d")!,matrix=document.createElement("canvas");matrix.width=6*216;matrix.height=5*420;const mc=matrix.getContext("2d")!,r=createRenderResources(),hashes=[];
    for(let n=0;n<textPresets.length;n++){
      const preset=textPresets[n],item=applyTextPreset({...newItem("text"),text:"Make every word count",duration:3,caption_words:[{word:"Make",start:0,end:.5},{word:"every",start:.5,end:1},{word:"word",start:1,end:1.5},{word:"count",start:1.5,end:2}]},preset);
      await document.fonts.load(`800 64px "${item.font_family}"`);const project={version:1,width:1080,height:1920,fps:30,background:"#181a20",items:[item]};renderFrame(ctx,project,.7,new Map(),r);const data=ctx.getImageData(0,0,216,384).data;let hash=2166136261;for(const byte of data)hash=Math.imul(hash^byte,16777619);hashes.push(hash);
      const x=n%6*216,y=Math.floor(n/6)*420;mc.drawImage(tile,x,y);mc.fillStyle="#ffffff";mc.font="13px sans-serif";mc.fillText(preset.name,x+10,y+406);
    }
    r.gpu.dispose();r.transitions.dispose();return {count:textPresets.length,unique:new Set(hashes).size,image:matrix.toDataURL("image/png")};
  });
  expect(matrix.count).toBeGreaterThanOrEqual(20);expect(matrix.unique).toBeGreaterThanOrEqual(20);
  await testInfo.attach("caption-style-matrix",{body:Buffer.from(matrix.image.split(",")[1],"base64"),contentType:"image/png"});
});

test("missing footage can be relinked and original bundled music becomes an editable ducked track",async({page,request})=>{
  const clip=await uploadProject(request,"Recovery round two fixture");
  try{
    const state=await editorState(request,clip.id),missing={...state,media:[],project:{...state.project,source_seeded:true,items:state.project.items.map(i=>({...i,asset_id:"missing-test-file"}))}};
    await page.route(`**/api/editor/${clip.id}`,route=>route.request().method()==="GET"?route.fulfill({json:missing}):route.continue());
    await page.goto(`/?studio=${clip.id}`);
    const chooser=page.waitForEvent("filechooser");await page.getByRole("button",{name:/Relink Recovery round two fixture/}).click();await(await chooser).setFiles(videoFixture);
    await expect.poll(async()=> (await editorState(request,clip.id)).project.items[0].asset_id).not.toBe("missing-test-file");
    await expect(page.getByRole("heading",{name:"Missing media"})).toHaveCount(0);
    await page.getByRole("button",{name:"Audio",exact:true}).click();await page.getByRole("button",{name:"Add After hours"}).click();
    await expect.poll(async()=> (await editorState(request,clip.id)).project.items.some(i=>i.audio_role==="music"&&i.ducking)).toBe(true);
    await page.getByLabel("Project menu").click();await page.getByRole("button",{name:"Duplicate project",exact:true}).click();
    await expect(page.getByRole("textbox",{name:"Project name"})).toHaveValue(/copy$/);
    const copiedId=new URL(page.url()).searchParams.get("studio");expect(copiedId).not.toBe(clip.id);
    await page.getByLabel("Project menu").click();page.once("dialog",dialog=>dialog.accept());await page.getByRole("button",{name:"Delete project",exact:true}).click();
    await expect.poll(async()=> (await request.get(`/api/clips/${copiedId}`)).status()).toBe(404);
  }finally{await removeProject(request,clip.id);}
});
