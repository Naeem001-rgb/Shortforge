# YouTube channel setup and retained upload services

Settings can connect YouTube channels to the local engine. The former **Publish to YouTube** and **Publish kit** interfaces were removed with the browser editor. Concat exports are not handed to these backend services; upload a finished Concat file through YouTube Studio yourself. Opening, editing or exporting a video never publishes it.

## One-time Google setup

1. Open [Google Cloud Console](https://console.cloud.google.com/apis/library/youtube.googleapis.com), select or create a project, and enable **YouTube Data API v3**.
2. Open **Google Auth Platform**. Complete **Branding** and **Audience**. For personal testing, choose External and add the Google email you use for YouTube under **Test users**. In **Data Access**, add `https://www.googleapis.com/auth/youtube.upload` and `https://www.googleapis.com/auth/youtube.readonly`.
3. In **Clients**, create an OAuth client with application type **Desktop app**, then download its JSON file. An API key or Web application client is not the same credential.
4. Open ShortForge **Settings → YouTube publishing**, choose the downloaded JSON file and click **Save YouTube setup**. The file is read locally; its credentials are stored by the local engine. Alternatively set `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` in your local `.env`.
5. Click **Connect YouTube channel**. Complete Google's sign-in and consent screen, choosing the account/channel you intend to use. Return to ShortForge and confirm the displayed channel name. Use **Connect another channel** to add another separately authorized destination.

The normal callback is `http://127.0.0.1:8787/api/youtube/oauth/callback`. If you deliberately run the engine on a different port, set `SHORTFORGE_YOUTUBE_REDIRECT_URI` to the matching loopback callback URL. Keep the engine running while authorizing. The downloaded JSON file and `.env` contain credentials; do not commit or share them.

Google may show an unverified-app screen for your personal testing client. Only authorize a project you created and recognize. Testing-mode authorizations can expire and require reconnecting. If Google blocks sign-in, check your test-user email, enabled API, client application type and requested scopes. Public distribution can require Google's OAuth verification; this personal local setup does not claim that verification.

## Retained backend uploads

The [YouTube API contract](../shared/contract/YOUTUBE.md) documents the retained upload and recovery endpoints for registered export assets. Existing upload records and recovery safeguards remain in the engine. There is no current dashboard upload workflow; the previous interface is [archived](archive/browser-editor/YOUTUBE-PUBLISHING.md).

## Disconnecting

Disconnect removes the channel's credentials from ShortForge and does not delete YouTube videos. To revoke the application's Google authorization as well, use [Google account connections](https://myaccount.google.com/connections). Saving a different Google client disconnects the old local channels so credentials cannot silently change the upload destination.

## Technical references and verification limits

- [Google Desktop OAuth and PKCE](https://developers.google.com/identity/protocols/oauth2/native-app)
- [YouTube resumable uploads](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol)
- [YouTube upload metadata](https://developers.google.com/youtube/v3/docs/videos/insert)
- [Local API contract](../shared/contract/YOUTUBE.md)

Automated tests use simulated Google responses and temporary local projects. Signing in to a real channel and posting a real video require the owner's Google setup and are separate from those tests.
