# Direct YouTube publishing

User-approved local rendering, direct publishing and scheduling. Studio snapshots a reviewed saved Concat edit and renders/uploads it only after an explicit final Publish/Schedule action. Opening, editing, saving and ordinary manual exports never post automatically. A connected Google channel is required.

All routes below are under `/api/youtube`. Tokens and resumable session URLs are engine-only and never appear in API responses. Use Google Desktop OAuth with PKCE and a single-use, expiring state. Callback defaults to `http://127.0.0.1:8787/api/youtube/oauth/callback` (override with `SHORTFORGE_YOUTUBE_REDIRECT_URI` for another local engine port).

## Connection

- `GET /channels`: `{configured: boolean, redirect_uri: string, channels: Channel[]}`.
- `PUT /config`: `{client_id: string, client_secret: string}`. Returns `{configured: true}`. Credentials are saved locally; changing credentials clears connections and pending authorization states.
- `POST /oauth/start`: optional `{theme: "light"|"dark"|"system"}`; empty/absent bodies remain supported. Returns `{authorization_url: string}`. Browser opens this URL to connect one account/channel, repeat to add another. The pending state records the initiating approved workspace's Settings URL and appearance.
- `GET /oauth/callback?state=...&code=...`: themed HTML success/cancelled/expired/error using the production dashboard's local assets. Success shows the escaped channel title. Back to Settings targets the initiating approved browser or extension workspace (`?settings=youtube`); unrecognized destinations fall back to the local dashboard. Google may return `error=access_denied`. Never return tokens or reflect provider errors/code/state. The page removes consumed query parameters from browser history, allows only self-hosted scripts/styles/fonts, and is never cached.
- `DELETE /channels/{id}`: disconnect local channel credentials; returns `{disconnected: true}`. Does not delete videos from YouTube.
- `Channel`: `{id: string, title: string, thumbnail_url: string}`. The identity must come from `channels.list(mine=true)` using the upload grant.

Backend auth module `engine/core/youtube_auth.py` exposes `get_access_token(channel_id: str) -> str`, `get_channel(channel_id: str) -> dict`, `router`, and `init_storage()`. Access token refresh is internal. Settings secrets use `youtube_client_id` and `youtube_client_secret` in `db.SECRET_SETTINGS`.

## Uploads

- `POST /uploads`: `{clip_id, asset_id, channel_id, title, description, tags: string[], privacy_status: "private"|"unlisted"|"public", publish_at?: string|null, self_declared_made_for_kids: boolean, contains_synthetic_media: boolean}`. Returns Upload. Requires a real saved export belonging to that project, channel authorization, nonblank title <=100 characters, description <=5000 UTF-8 bytes, valid tags within YouTube's 500-character combined limit. A schedule must be a future ISO 8601 instant with a time zone and requires private visibility; the engine normalizes it to UTC and sends `status.publishAt`. Existing upload for the same asset/channel is returned to prevent double posting. Retry uses the original immutable metadata.
- `GET /uploads?clip_id=...`: `{uploads: Upload[]}` newest first, durable across page reloads.
- `GET /uploads/{id}`: Upload, including YouTube processing status when available.
- `POST /uploads/{id}/retry`: Upload. Resume the same session after checking how many bytes YouTube received. Never blindly create a second upload after an uncertain final response. Expired uncertain sessions need a user check in YouTube Studio.
- `Upload`: `{id, clip_id, asset_id, channel_id, channel_title, title, privacy_status, publish_at: string|null, status: "queued"|"uploading"|"processing"|"scheduled"|"completed"|"failed"|"needs_attention", progress: number (0..100), error: string|null, video_id: string|null, video_url: string|null, retryable: boolean, created_at, updated_at}`.

Upload workers run on the engine and persist resumable session state outside generic jobs. `engine/core/youtube_uploads.py` exposes `router` and `recover_uploads()` to convert interrupted jobs into explicit recoverable states at startup. Use bounded chunks, timeouts and provider errors without secrets. Verify channel identity before upload; only the connected authorization determines destination. Private is the default. Never claim publicly visible just because upload completed.

`scheduled` requires a processed, still-private video whose `publishAt` YouTube confirmed. Missing/changed schedule confirmation becomes `needs_attention`; public visibility is reported only from YouTube's actual status. The engine rechecks the deadline before beginning a session and sending file chunks, and never turns an expired schedule into a new immediate public request. An uncertain existing final response is probed before deadline rejection so it can still be recovered. `publish_at` is added to existing databases through an idempotent migration.

## Studio publishing API

These routes are under `/api/studio`, implemented in `engine/core/publishing.py`:

- `GET /publishing?clip_id=...` returns `{project:{ready,revision,saved_at,error},defaults:{title,description,tags:string[]},publications:Publication[]}`. Revision is SHA-256 of the saved native manifest, limited to 16 MiB. Defaults derive from Library metadata/hashtags and require no AI key. The newest 50 records are returned; this endpoint never launches Concat or contacts Google.
- `POST /publish` accepts `{clip_id,request_id,project_revision,channel_id,title,description,tags,privacy_status,publish_at?,self_declared_made_for_kids,contains_synthetic_media}` and returns Publication. `request_id` is a client-generated stable identifier for a specific submission. All metadata uses the Upload limits above. A missing edit or changed revision is HTTP 409, unavailable Concat is 503, and eight pending/active jobs fill the queue (429).
- `GET /publications/{id}` returns Publication and refreshes the existing upload's processing/scheduled status, throttled by the YouTube service.
- `POST /publications/{id}/retry` reuses the same render snapshot or delegates to the existing resumable upload. A passed schedule needs a new reviewed future time.
- `POST /publications/{id}/cancel` cancels queued/rendering work before the upload handoff. After upload begins it returns 409; manage the uploaded video in YouTube Studio.
- `Publication`: `{id,clip_id,channel_id,channel_title,title,status,progress,error,asset_id,upload_id,privacy_status,publish_at,retryable,can_cancel,video_url,created_at,updated_at}`. Status is `queued|rendering|uploading|processing|scheduled|completed|failed|needs_attention|cancelled`; progress is for the current stage.

The single local publishing worker snapshots `concat.json` under `data/concat/publishing/<id>/project/`, renders through Concat's offline headless MCP, probes the result, registers the finished MP4 as an export and durably attaches its upload before sending bytes. Original projects are unchanged; Concat stores referenced media/font paths absolutely, and those files must still exist. No source-file substitute is uploaded after a render failure. Restart recovery retains snapshot/asset/upload identity and requires explicit Retry.

Repeated submissions reuse an existing job for the same saved revision/channel, including after a lost response. A failed/cancelled attempt can be replaced only when no remote video or uncertain final request exists. Retrying a registered upload keeps the reviewed metadata and exact export. A past deadline is revalidated after rendering before handing off the file.

## UI integration

`dashboard/src/studio/Publishing.tsx` extends the existing Studio status page for a selected Library video. It includes local metadata defaults, channel/setup controls, explicit audience/altered-content inputs, visibility or a schedule, and durable job activity. `datetime-local` uses the browser's clearly displayed time zone and converts to UTC before submission. Drafts persist per clip; periodic polling pauses while hidden and does not overlap. A stale response cannot overwrite a just-submitted or cancelled job. Native Concat's manual export and the retired browser-editor/SEO routes are separate from this flow.
