# Publish a finished edit to YouTube

ShortForge can upload a saved export to a connected YouTube channel with your title, description and tags. You review the export, destination channel, visibility and audience before pressing Publish. Rendering or downloading a video never publishes it. Gemini suggestions are optional; you can type all post details yourself.

## One-time Google setup

1. Open [Google Cloud Console](https://console.cloud.google.com/apis/library/youtube.googleapis.com), select or create a project, and enable **YouTube Data API v3**.
2. Open **Google Auth Platform**. Complete **Branding** and **Audience**. For personal testing, choose External and add the Google email you use for YouTube under **Test users**. In **Data Access**, add `https://www.googleapis.com/auth/youtube.upload` and `https://www.googleapis.com/auth/youtube.readonly`.
3. In **Clients**, create an OAuth client with application type **Desktop app**, then download its JSON file. An API key or Web application client is not the same credential.
4. Open ShortForge **Settings → YouTube publishing**, choose the downloaded JSON file and click **Save YouTube setup**. The file is read locally; its credentials are stored by the local engine. Alternatively set `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` in your local `.env`.
5. Click **Connect YouTube channel**. Complete Google's sign-in and consent screen, choosing the account/channel you intend to use. Return to ShortForge and confirm the displayed channel name. Use **Connect another channel** to add another separately authorized destination.

The normal callback is `http://127.0.0.1:8787/api/youtube/oauth/callback`. If you deliberately run the engine on a different port, set `SHORTFORGE_YOUTUBE_REDIRECT_URI` to the matching loopback callback URL. Keep the engine running while authorizing. The downloaded JSON file and `.env` contain credentials; do not commit or share them.

Google may show an unverified-app screen for your personal testing client. Only authorize a project you created and recognize. Testing-mode authorizations can expire and require reconnecting. If Google blocks sign-in, check your test-user email, enabled API, client application type and requested scopes. Public distribution can require Google's OAuth verification; this personal local setup does not claim that verification.

## Publish in five steps

1. Finish editing, open **Export**, and export your video. Wait until the export is saved to project history.
2. Click **Publish to YouTube**. Select and preview the specific saved export. Changes made after that export require a new export.
3. Enter the title, description and tags, or apply suggestions from the optional Publish kit. Select the connected destination channel.
4. Choose Private, Unlisted or Public, the audience designation, and the altered/synthetic-content setting. Review the details, then click Publish.
5. Keep the local engine running. The screen shows upload progress, then YouTube processing, and provides the video link. You can leave and return to the Publish kit to see upload history.

Private is the initial visibility. Uploaded does not mean public: visibility is shown separately and YouTube can still be processing or reviewing a video. YouTube decides whether an eligible video appears as a Short; uploading does not override its format rules.

## Interrupted uploads and connections

Uploads use YouTube's resumable protocol. **Retry** continues the original upload after checking the bytes YouTube received, with the original title and settings. Repeated Publish clicks for the same export and channel return the existing upload. A lost final response can mean the video already exists; if the session can no longer confirm that, the screen asks you to check YouTube Studio instead of blindly creating another video.

Restarting the engine marks interrupted uploads for recovery. Reconnect a revoked/expired channel before retrying. If the export file was removed or changed, recovery requires attention rather than sending a different video under the old upload. Upload history is local to the project.

Disconnect removes the channel's credentials from ShortForge and does not delete YouTube videos. To revoke the application's Google authorization as well, use [Google account connections](https://myaccount.google.com/connections). Saving a different Google client disconnects the old local channels so credentials cannot silently change the upload destination.

## Technical references and verification limits

- [Google Desktop OAuth and PKCE](https://developers.google.com/identity/protocols/oauth2/native-app)
- [YouTube resumable uploads](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol)
- [YouTube upload metadata](https://developers.google.com/youtube/v3/docs/videos/insert)
- [Local API contract](../shared/contract/YOUTUBE.md)

Automated tests use simulated Google responses and temporary local projects. Signing in to a real channel and posting a real video require the owner's Google setup and are separate from those tests.
