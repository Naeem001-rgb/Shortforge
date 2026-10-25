# Direct YouTube publishing

User-approved extension to the original manual-upload brief. Upload only after the user reviews a saved export, destination channel and metadata and presses Publish. Editing/export never posts automatically.

All routes below are under `/api/youtube`. Tokens and resumable session URLs are engine-only and never appear in API responses. Use Google Desktop OAuth with PKCE and a single-use, expiring state. Callback defaults to `http://127.0.0.1:8787/api/youtube/oauth/callback` (override with `SHORTFORGE_YOUTUBE_REDIRECT_URI` for another local engine port).

## Connection

- `GET /channels`: `{configured: boolean, redirect_uri: string, channels: Channel[]}`.
- `PUT /config`: `{client_id: string, client_secret: string}`. Returns `{configured: true}`. Credentials are saved locally; changing credentials clears connections and pending authorization states.
- `POST /oauth/start`: empty object; returns `{authorization_url: string}`. Browser opens this URL to connect one account/channel, repeat to add another.
- `GET /oauth/callback?state=...&code=...`: human-readable HTML success/error. Google may return `error=access_denied`. Never return tokens or reflect provider errors/code/state.
- `DELETE /channels/{id}`: disconnect local channel credentials; returns `{disconnected: true}`. Does not delete videos from YouTube.
- `Channel`: `{id: string, title: string, thumbnail_url: string}`. The identity must come from `channels.list(mine=true)` using the upload grant.

Backend auth module `engine/core/youtube_auth.py` exposes `get_access_token(channel_id: str) -> str`, `get_channel(channel_id: str) -> dict`, `router`, and `init_storage()`. Access token refresh is internal. Settings secrets use `youtube_client_id` and `youtube_client_secret` in `db.SECRET_SETTINGS`.

## Uploads

- `POST /uploads`: `{clip_id, asset_id, channel_id, title, description, tags: string[], privacy_status: "private"|"unlisted"|"public", self_declared_made_for_kids: boolean, contains_synthetic_media: boolean}`. Returns Upload. Requires a real saved export belonging to that project, channel authorization, nonblank title <=100 characters, description <=5000 UTF-8 bytes, valid tags within YouTube's 500-character combined limit. Existing upload for the same asset/channel is returned to prevent double posting. Retry uses the original immutable metadata.
- `GET /uploads?clip_id=...`: `{uploads: Upload[]}` newest first, durable across page reloads.
- `GET /uploads/{id}`: Upload, including YouTube processing status when available.
- `POST /uploads/{id}/retry`: Upload. Resume the same session after checking how many bytes YouTube received. Never blindly create a second upload after an uncertain final response. Expired uncertain sessions need a user check in YouTube Studio.
- `Upload`: `{id, clip_id, asset_id, channel_id, channel_title, title, privacy_status, status: "queued"|"uploading"|"processing"|"completed"|"failed"|"needs_attention", progress: number (0..100), error: string|null, video_id: string|null, video_url: string|null, retryable: boolean, created_at, updated_at}`.

Upload workers run on the engine and persist resumable session state outside generic jobs. `engine/core/youtube_uploads.py` exposes `router` and `recover_uploads()` to convert interrupted jobs into explicit recoverable states at startup. Use bounded chunks, timeouts and provider errors without secrets. Verify channel identity before upload; only the connected authorization determines destination. Private is the default. Never claim publicly visible just because upload completed.

## UI integration

The existing Publish kit page stays reachable as `seo`, retains optional Gemini suggestions and adds a manual publishing form that works without Gemini. Select a specific export, preview it, edit title/description/tags, select a connected channel and visibility/audience/synthetic-media settings, review, then explicitly publish. Show setup link when not configured, connect action when no channel, no-export guidance, progress/processing, recovery and final video link. Keep history visible after navigation/reload.

SEOPage accepts optional `onSettings: () => void` and `initialExportId?: string` from the shell. Settings mounts `YouTubeSettings` connection/setup controls. The export panel's `Publish to YouTube` action passes the saved asset ID through Studio to the publishing page. This exact ID overrides remembered draft selection; a missing handoff asset blocks publishing instead of substituting an older export.
