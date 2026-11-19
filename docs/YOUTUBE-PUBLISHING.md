# YouTube publishing and scheduling

ShortForge can render your saved Concat edit on your laptop and upload it directly to YouTube. **Studio → Publish to YouTube** has **Publish now** and **Schedule** choices. No paid rendering service, cloud computer or AI key is needed. Opening, editing, saving and ordinary Concat exports never publish anything on their own.

## One-time Google setup

1. Open [Google Cloud Console](https://console.cloud.google.com/apis/library/youtube.googleapis.com), select or create a project, and enable **YouTube Data API v3**.
2. Open **Google Auth Platform**. Complete **Branding** and **Audience**. For personal testing, choose External and add the Google email you use for YouTube under **Test users**. In **Data Access**, add `https://www.googleapis.com/auth/youtube.upload` and `https://www.googleapis.com/auth/youtube.readonly`.
3. In **Clients**, create an OAuth client with application type **Desktop app**, then download its JSON file. An API key or Web application client is not the same credential.
4. Open ShortForge **Settings → YouTube publishing**, choose the downloaded JSON file and click **Save YouTube setup**. The file is read locally; its credentials are stored by the local engine. Alternatively set `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` in your local `.env`.
5. Click **Connect YouTube channel**. Complete Google's sign-in and consent screen, choosing the account/channel you intend to use. The confirmation page follows your workspace's theme and shows the connected channel. Click **Back to Settings** to return to the browser or extension workspace that started the connection. Use **Connect another channel** to add another separately authorized destination.

The normal callback is `http://127.0.0.1:8787/api/youtube/oauth/callback`. If you deliberately run the engine on a different port, set `SHORTFORGE_YOUTUBE_REDIRECT_URI` to the matching loopback callback URL. Keep the engine running while authorizing. The downloaded JSON file and `.env` contain credentials; do not commit or share them.

Google may show an unverified-app screen for your personal testing client. Only authorize a project you created and recognize. Testing-mode authorizations can expire and require reconnecting. If Google blocks sign-in, check your test-user email, enabled API, client application type and requested scopes. Public distribution can require Google's OAuth verification; this personal local setup does not claim that verification.

## Publish a saved edit

1. Open a Library video in Concat, finish editing, and **save in Concat**. Unsaved changes in its window are not included.
2. Return to that video's ShortForge **Studio** page. **Refresh saved edit** checks the saved version. The engine snapshots that version so later timeline changes do not change a queued job.
3. Review the title, description and tags prefilled from Library, choose the connected channel, and answer the audience/altered-content questions. These starting details are local suggestions from existing metadata, not an AI rewrite.
4. Choose **Publish now**, select Public, Private or Unlisted, and press the final button. Private is the default. Or choose **Schedule**, pick a future date/time, and press **Schedule video**.
5. Follow **Publishing activity**. ShortForge creates the finished MP4 with Concat, registers that exact file, uploads it, and shows YouTube's processing result and video link.

The form uses your laptop/browser's time zone and shows its name beside the time picker. For Lahore this is normally **Asia/Karachi**. The chosen time is sent to YouTube as an absolute UTC instant. Scheduling means **upload privately now and make public later**; it does not wait until the selected time to begin rendering. Allow enough time for rendering, your internet upload speed and YouTube processing. An already-passed schedule is rejected instead of becoming an immediate public post.

YouTube confirms schedules separately from accepting video bytes. A new, unaudited YouTube API project can be restricted to private uploads. If YouTube does not confirm the schedule, ShortForge says so and links to YouTube Studio; it does not claim the video is scheduled or public. See [YouTube's upload restrictions](https://developers.google.com/youtube/v3/docs/videos/insert) and [publishAt rules](https://developers.google.com/youtube/v3/docs/videos#status.publishAt). OAuth verification and the YouTube API compliance audit are separate requirements.

## Progress, recovery and laptop use

Keep ShortForge running and the laptop awake until creating and uploading the video finish. The browser tab may be closed; the local engine must keep running. After YouTube confirms the schedule, the laptop can be off at the publication time.

One background publishing worker handles local render-and-upload jobs, with at most eight pending/active jobs. Concat keeps the saved timeline's dimensions and frame rate and creates H.264 MP4 at CRF 20 with its fast preset. Its H.264 encoder normally uses the CPU; this change does not promise faster encoding from a RAM upgrade or force Intel hardware encoding.

- **Cancel job** stops a queued/rendering job before its upload begins. Manage videos that have already uploaded in YouTube Studio.
- **Retry publishing** resumes an interrupted upload using its existing file and session, without rendering again. A stopped render retries its saved snapshot.
- After an engine restart, unfinished jobs show a recovery message and wait for Retry. The app does not silently start a new upload.
- If the final upload response was lost, the uploader checks the old session first. When the outcome cannot be established, check YouTube Studio before starting another attempt.
- If a schedule expires before upload completes, choose a later time and submit a new attempt only when the earlier upload is known not to have completed.

Draft fields persist in the browser per Library video. Job history, schedules, render snapshots and upload recovery state persist locally. Snapshots and finished MP4s live under `data/concat/publishing/<job-id>/`; completed files remain available for recovery and are registered as Library-owned exports. Media/font files referenced by the saved Concat document must remain available. The existing native project is not rewritten.

The [YouTube API contract](../shared/contract/YOUTUBE.md) documents the Studio publishing flow and retained direct-upload API.

## Disconnecting

Disconnect removes the channel's credentials from ShortForge and does not delete YouTube videos. To revoke the application's Google authorization as well, use [Google account connections](https://myaccount.google.com/connections). Saving a different Google client disconnects the old local channels so credentials cannot silently change the upload destination.

## Technical references and verification limits

- [Google Desktop OAuth and PKCE](https://developers.google.com/identity/protocols/oauth2/native-app)
- [YouTube resumable uploads](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol)
- [YouTube upload metadata](https://developers.google.com/youtube/v3/docs/videos/insert)
- [Local API contract](../shared/contract/YOUTUBE.md)

Automated tests use simulated Google responses and temporary local projects. An opt-in test also runs the real Concat renderer on generated footage and compares the MP4 with the bytes received by a fake upload service. Signing in to a real channel and posting/scheduling a real video require the owner's Google setup and remain separate from those tests.
