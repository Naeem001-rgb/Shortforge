# ShortForge shared contract v1

Engine: http://127.0.0.1:8787. Dashboard: http://localhost:5173. JSON except multipart uploads, file responses and SSE. Errors use FastAPI `{detail: string}`. IDs are UUID strings. Times ISO8601 UTC. All paths saved in SQLite are relative to data directory. No absolute paths from clients.

## Core exports (engine/core)
`engine.core.app:app` FastAPI application; includes `engine.ai.routes.router` and `engine.studio.routes.router` if present.
`engine.core.db`: `DATA_DIR: Path`, `connect()` context manager yields sqlite3.Connection with Row row_factory, `get_clip(id)->dict` raises HTTPException(404), `add_asset(clip_id, kind, path)->dict`, `get_asset(id)->dict`, `get_settings()->dict` (real values for internal use), `save_script(clip_id, original_text, rewritten_text)->dict`, `new_job(type, clip_id)->dict`, `update_job(id, **fields)`, `require_editable(clip_id)->dict` (403 unless cc_by/permission/owned). Schema initializes when connect used. Paths accepted by add_asset are Paths under DATA_DIR. Asset returned has url `/api/assets/{id}`.

## Entities
Clip: id, video_id(nullable), url, channel_name, channel_handle, title, description, likes(nullable integer), views(nullable integer), credit_target, credit_snippet, license_status: unknown|cc_by|permission|owned, permission_note, thumbnail_url, workflow_status: collected|downloaded|transcribed|editing|exported|archived, discovery_mode: credits|narrated|manual|upload, created_at, published_at(nullable).
Clip detail additionally includes assets: Asset[], script: Script|null, transcript: {text, words:[{word,start,end}]}|null.
Asset: id, clip_id(nullable for voice references), kind: source|voiceover|export|reference, path, url, created_at.
Job: id, type, clip_id, status: queued|running|completed|failed, progress 0..100, error|null, result: object|null.
Script: clip_id, original_text, rewritten_text, words_original, words_rewritten.

## Core API
GET /api/health -> {status:'ok', tools:{ffmpeg:bool,yt_dlp:bool,whisper:bool,piper:bool,espeak:bool}, version:'0.1.0'}
GET /api/clips -> {clips:Clip[]} (optional q, license_status, workflow_status, sort)
POST /api/clips {clips: partial Clip[]} -> {clips:Clip[],added:number}; accepts URL-only YouTube import (canonicalize, validate ID); all new external clips license_status=unknown regardless of client; API enrichment can promote CC. Don't auto-seed database.
GET /api/clips/{id} -> Clip detail
PATCH /api/clips/{id} {title?, license_status?:'permission'|'unknown', permission_note?, workflow_status?} -> Clip. Permission requires nonempty note. Client cannot claim cc_by or owned.
DELETE /api/clips/{id} -> {ok:true}. Removes the clip, its cascaded jobs/scripts/transcript/assets, and the media files it owns (source, voiceover + `.timing.json`, export + `.ass`) so disk space is reclaimed. Voice-clone `reference` recordings are owned by a voice profile and are never deleted here. Every path is re-resolved through the data-folder guard, so a tampered asset row cannot delete files outside `data/`. Empty per-clip folders are pruned.
POST /api/clips/delete-bulk {ids:string[]} (1-200, de-duplicated) -> {deleted:string[],missing:string[]}. Deletes each existing clip and reports ids that were already gone; a missing id never aborts the rest. Empty list or unknown fields are rejected.
POST /api/upload multipart `file`, `title` optional -> Clip (license owned; max 500 MB video)
POST /api/clips/{id}/enrich -> Clip (YouTube free key required)
POST /api/clips/{id}/download -> Job (gate first; background yt-dlp)
POST /api/clips/{id}/transcribe {model?:'base'|'small'} -> Job (gate, source required; installed local model only, no silent download)
POST /api/clips/{id}/extract-script {provider?:'auto'|'gemini',replace_existing?:false} -> Job type 'extract-script'. Text extraction is available to all Library clips. Auto reuses saved text, then tries original-language public YouTube captions or an existing authorized local source with installed Whisper. No video download or cloud calls in Auto. Gemini explicitly sends the public YouTube URL to the configured model for verbatim transcription. Result: {text,words,source,language,word_count,original_updated}. Persists transcript and scripts.original_text together, preserving rewritten text and concurrent edits. replace_existing:true bypasses saved text only for an explicit re-extraction. Unknown/missing speech fails honestly; never derive an original script from title/description.
PUT /api/clips/{id}/transcript {text,words:[{word,start,end}]} -> {text,words}
GET /api/jobs/{id} -> Job
GET /api/jobs/{id}/events -> SSE `data: {Job}\n\n` until completed/failed.
GET /api/assets/{id} -> FileResponse; resolve only within DATA_DIR.
GET /api/settings -> {gemini_model, youtube_api_key_set, gemini_api_key_set, elevenlabs_api_key_set, niche,language, min_likes,min_views,target_count,scout_mode,tts_provider,piper_model,whisper_model,clone_model_path}; NEVER returns API key values.
PUT /api/settings partial settings + gemini_api_key?, youtube_api_key?, elevenlabs_api_key? -> same masked settings. Unknown setting keys rejected.

## AI API (engine/ai)
POST /api/rewrite {clip_id, text, mode?:'rewrite'|'original', topic?:string} -> {original_text,rewritten_text,words_original,words_rewritten,within_tolerance,exact_word_count?,attempts}. Gemini configurable model default gemini-3.8-flash, missing key is actionable 400. Script rewriting is available to all Library references independently of footage permissions. Rewrite preserves original language, tone, perspective, context, fact sequence, names/numbers/qualifiers and hook/payoff, targets the exact whitespace word count, retries max twice, and retains the closest draft without padding or truncation. Semantic preservation is instructed, not guaranteed. Original mode separately writes from topic/title/description, not a transcription.
PUT /api/scripts/{clip_id} {original_text,rewritten_text} -> Script
POST /api/seo {clip_id,text} -> {titles:[{title,reason,characters}],description,tags:string[]}. Preserve attribution if CC.
GET /api/voices -> {voices:[{id,name,provider,language,description,available,cloned}],providers:[{id,name,available,note}]}
POST /api/tts {clip_id,text,provider:'piper'|'edge'|'elevenlabs'|'clone'|'espeak',voice_id,speed:0.9..1.1,pitch?:number} -> Job. Only background generation. No model installs. Re-align voice if whisper installed, otherwise explicit timing approximation label. Do not reuse old transcript timing for new voice.
POST /api/voices/clone multipart file, name, consent ('true'), reference_text optional -> {id,name,provider:'clone',language,description,available,cloned:true}. Stores reference and consent for future local Chatterbox / Chatterbox Nano usage. Report unavailable until model dependencies/local checkpoint configured. Never pretend profile creation trained a model.
DELETE /api/voices/{id} -> {ok:true}

## Studio API (engine/studio)
GET /api/presets -> {presets:[{id,name,font,size,fill,stroke,highlight,position,animation,description}]}; ten named presets from spec.
POST /api/captions/detect {clip_id} -> {x,y,width,height,detected:boolean,method,message}; normalized 0..1; sample frames with tesseract if installed; explicit suggested region fallback if not.
POST /api/export {clip_id,trim_start:0,trim_end?:number,crop_zoom:1,caption_mode:'none'|'blur'|'cover'|'crop',caption_region:{x:0,y:.6,width:1,height:.18},preset:'bold-pop',captions:true,caption_text?:string,font_size:64,caption_position:0.75,words_per_line:4,caption_color:'#FFFFFF',highlight_color:'#0A84FF',audio_mode:'original'|'replace'|'mix',original_volume:1,voice_volume:1} -> Job; gate/source first; use latest voiceover asset for replace/mix. ffmpeg CPU H264/AAC 1080x1920, result asset. Accurate source/voice transcript if available; proportional timing clearly marked otherwise. Exports cannot erase watermarks for unknown rights.

## SQLite schema ownership
Core owns schema: clips entity above; jobs(id,type,clip_id,status,progress,error,result JSON); scripts(clip_id PRIMARY KEY,original_text,rewritten_text,words_original,words_rewritten); assets(id,clip_id,kind,path,created_at); settings(key PRIMARY KEY,value JSON); transcripts(clip_id PRIMARY KEY,text,words JSON); voices(id PRIMARY KEY,name,reference_asset_id,reference_text,consent,created_at). Foreign keys enabled. Agent AI may access connect using this schema.

## Extension
Manifest V3. Built dist directory loaded unpacked. Popup modes 'credits' and 'narrated' (count-qualified candidates for narration review; credits and keywords are not required, no audio AI detection). Default narrated after latest request; optional 'auto' starts credits and switches after 30 misses. Counts with unknown likes/views skip. Explicit mode overrides saved Auto phase. Changing mode or count limits allows skipped videos to be checked again; matched videos remain deduplicated. Popup shows last-scan counts and decision, including skips. Human-paced 4–9 sec, max 500, pause on challenges. Never stealth or social actions. Posts bulk to /api/clips. Popup state from chrome.storage.local. All selectors in selectors.ts. Parser unit tests with Node assert.
