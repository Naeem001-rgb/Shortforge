# Timeline editor implementation contract

Studio replaces the script/rewrite/TTS workflow. The requested interaction pattern is CapCut's media bin, preview, property inspector, and editable multitrack timeline. The existing violet light/dark design system remains. No UI claims full CapCut product parity. Every visible editor control must work in preview, persistence, and export.

## Data

Project JSON: `{version:1,width:1080,height:1920,fps:30,background:'#000000',items:TimelineItem[]}`. Supported canvas sizes 1080x1920,1920x1080,1080x1080; export resolution may be 480/720/1080 (short edge). Project duration is max(start+duration), capped at600seconds. Project stored server-side by library clip ID. Undo/redo is client-side.

TimelineItem fields: `id:string,kind:'video'|'audio'|'text',asset_id:string|null,name:string,track:number,start:number,source_in:number,duration:number,speed:number,volume:number,muted:boolean,transform:{x:number,y:number,scale:number,rotation:number,opacity:number},keyframes:Keyframe[],animation_in:Animation,animation_out:Animation,animation_duration:number,fade_in:number,fade_out:number,fit:'contain'|'cover',text:string,font_size:number,color:string,text_background:string`.

Defaults: start/source_in0,speed1,volume1,mutedfalse,transform{x:0,y:0,scale:1,rotation:0,opacity:1},keyframes[],animations'none',animation_duration0.5,fade_in/out0,fit'contain',text'',font_size64,color'#ffffff',text_background'transparent'. Audio ignores visual fields. Text has asset_id null. Track is an integer0–7; higher visual tracks render above lower tracks. Tracks may mix time-separated items. Audio only plays when item is active; source audio of unmuted videos participates in mix. Master time is timeline seconds. Source time = source_in + (master-start)*speed. Duration is timeline seconds, so source out = source_in+duration*speed.

Keyframe `{time:number,x:number,y:number,scale:number,rotation:number,opacity:number,volume:number,easing:'linear'|'ease-in'|'ease-out'|'ease-in-out'}`. Time is relative to item start in timeline seconds. Hold first/last keyframe beyond its bounds, interpolate between neighbors using LEFT keyframe easing (in=q²,out=1-(1-q)²,inout=q²(3-2q)). If no keyframes use base transform+volume. x/y are percent of canvas dimensions, measured as translation from center; scale1 fills fitted bounds. Rotationdegrees,opacity0–1,volume0–2. Keyframes sorted/deduplicated, validatedfinite.

Animation: 'none'|'fade'|'slide-left'|'slide-right'|'slide-up'|'slide-down'|'zoom-in'|'zoom-out'. Presets modify transforms over animation_duration at item entrance/exit. Fade multiplies opacity by progress. Slide offsets x/y by ±100*(1-progress) percent. Zoom-in multiplies scale by0.65+0.35*progress; zoom-out by1.35-0.35*progress. For exit, progress=(duration-localTime)/animation_duration. Clamp progress0–1. Same formulas frontend+renderer. Audio fades independently over fade_in/fade_out and volume keyframes.

EditorMedia extends API Asset with `{name:string,duration:number,width:number,height:number,has_audio:boolean,media_type:'video'|'audio'|'image',waveform:number[]}`. Waveforms are real sampled amplitudes, never decorative fake data. Return emptyarray when unavailable. Assets must belong to same project; paths confined to datafolder.

## API

- GET `/api/editor/{clip_id}` -> `{project:Project,media:EditorMedia[],saved_at:string|null}`. Initialize unsaved project with existing source on track0 and duration from ffprobe. Read-only GET must not mutate DB. Legacy source/voiceover assets remain usable. Unknown-rights projects may open empty editor, but export/download retain existing access gate.
- PUT `/api/editor/{clip_id}` bodyProject -> same response with persisted project.
- POST `/api/editor/{clip_id}/media` multipart `file` and `role` ('video','voiceover','music') -> EditorMedia. Validate uploaded file with probe, max500MB. Audio converted to WAV when necessary for browser playback. Assets persist; removing a timeline item doesn't delete media.
- POST `/api/editor/{clip_id}/extract-audio` body `{asset_id:string}` -> Job, result `{asset:EditorMedia}`. Extract full original source track, leave source untouched. UI adds audio item aligned to selectedvideo, copies in/duration/speed, mutes selectedvideo to avoiddoubleaudio.
- POST `/api/editor/{clip_id}/separate-audio` body `{asset_id:string}` -> Job, result `{vocals:EditorMedia,instrumental:EditorMedia,note:string}`. Uses local actual Demucs vocals/music separation. Frontend actions 'Isolate voice' adds vocals & mutes selectedsource; 'Remove voice' adds instrumental & mutes selectedsource. Extraction/demixing are distinct. No AI speech generation.
- GET `/api/editor-capabilities` -> `{separation:{available:boolean,model_ready:boolean,message:string}}`. Audio agentowns.
- POST `/api/editor/{clip_id}/export` body `{project:Project,resolution:480|720|1080}` -> Job, result `{asset:Asset,duration:number,width:number,height:number}`. Render suppliedvalidated snapshot; persist separatelyexplicit/autosave. Source paths verified and cliprightschecked. Export includes all timeline video/text/audio edits and transforms. Exportstatus updateslibrary.

Core routes `/api/clips/{id}/download`, `/api/assets/{id}`, `/api/jobs/{id}`, `/api/upload` retained. Existing jobscope unique for editor operations. No browser operation calls /rewrite,/tts,/extract-script. No fake generatedmedia or hidden externalAPIcalls.

Root owns shell/settings cleanup, tests, API typeintegration and docs. Frontendagent owns dashboard/src/studio/Studio.tsx, editorModel.ts, EditorPreview.tsx, EditorTimeline.tsx, EditorInspector.tsx and theme/editor.css. Backendagent owns engine/studio/editor*.py, core/db.py schema/assets and core/app.py routerregistration plus backendtests. Audioagent owns engine/studio/separation.py and separation_routes.py, requirements-separation.txt/setup docs and separation tests; coordinate helper imports withbackend. Do not delete existing usermedia or modify real clips during automatedtests.
