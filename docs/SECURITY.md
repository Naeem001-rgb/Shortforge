# ShortForge security

Updated November 2, 2026. ShortForge is a local, single-user application. These protections reduce specific risks; they do not make the computer or third-party software impossible to compromise.

The Scout Library button can start the engine and renew the extension’s own session through a user-installed Chrome native messaging host. Only the extension ID for this checkout is allowed. Connection credentials stay in trusted extension storage.

## Using the protected workspace

Start with `start.sh` or `start.bat`. The launcher opens a connected dashboard at **http://127.0.0.1:8787**. Normal startup serves the built dashboard rather than a Vite development server.

The launcher opens a private local HTML file, which redirects to the dashboard with a random, one-use code in the URL fragment. The browser command contains only the private file path, so the code is not exposed in process arguments. The code expires after five minutes, is removed from the dashboard URL when consumed, and is never sent as an HTTP URL/query string. The local file is removed after redemption when possible. If the browser cannot open automatically, open the private file link printed by the launcher in your browser’s address bar; do not share the file. Chrome is preferred when available so Scout can connect automatically.

Scout connects automatically when the installed Chrome extension is available in that browser. Otherwise choose **Settings → Connect Scout**. After updating an unpacked extension, reload ShortForge Scout in Chrome's Extensions page once. The extension's existing ID, settings and pending clips are preserved. A moved checkout must be loaded from its new `extension/dist` path.

Each engine restart invalidates previous browser/extension credentials. Use the fresh window opened by the launcher. With Linux automatic startup installed, open **ShortForge** from the application menu or run `./start.sh`; this creates a fresh private connection to the background engine without restarting it or invalidating other clients. The background service does not open a browser at login. An unrelated local app or extension cannot obtain access merely by claiming a localhost origin. Authentication does not protect against malware already controlling your user account or browser.

## Protections implemented

| Boundary | Protection |
| --- | --- |
| Local API | Random bearer credentials, stored as hashes server-side; approved origins; credentials bound to the paired origin; explicit revocation and restart invalidation. Public exceptions are health, connection-code redemption and the Google OAuth callback. |
| Scout | A one-use grant is issued only for this checkout's real extension ID. External messages must come from an approved top-level dashboard. Chrome storage is restricted to trusted extension contexts; content scripts do not receive connection credentials. |
| Media URLs | Read-only signatures cover the exact media path and expire within two hours. They are invalid after an engine restart and grant no general API access. Treat these links as private. |
| Browser | Production scripts are self-hosted with a restrictive CSP. Dashboard embedding is denied. Loading a Studio URL does not launch a native application; normal Library/Studio button clicks still do. |
| Requests | JSON is capped at 2 MiB. Video multipart requests are capped at 501 MiB, voice-reference requests at 21 MiB, with lower file-content limits. Content-Type parameters cannot raise limits. Stalled body reads time out. |
| Resources | At most two expensive requests run concurrently; overflow is rejected after a short admission wait. Uploads have a bounded queue. Request rates, media subprocess CPU/memory/files/logs, download progress and file sizes are bounded. Growth stops near 1 GiB free disk space or a 512 MiB Library database; reads, connection recovery and deletion remain available. |
| Secrets | Saved API/OAuth credentials, PKCE verifiers and resumable-upload URLs are encrypted with Fernet. Linux uses the system Secret Service when available; otherwise a private key lives outside the project. Windows fallback keys are protected with DPAPI. Linux data directories/files use owner-only permissions. `.env`, when used, is made owner-only on POSIX at startup. |
| Media processing | Supported FFmpeg versions are checked against the executable. Normal setup installs pinned FFmpeg/ffprobe 8.1.3 binaries, checks the archive hash/size, extracts only the two executables, and checks installed hashes. Older bundled binaries are not used as a fallback. |
| Linux workers | Bubblewrap exposes runtime code/libraries, selected inputs and output folders. Media decoding and cloning have no network; Scout's download worker needs network but has a restricted filesystem and environment. This is not a sandbox around every library loaded by the engine. |
| Native editor | Concat runs with networking disabled on supported Linux/macOS isolation mechanisms. On Linux, the engine's database/private-key files are hidden and project source is read-only. The GUI retains its file-picker/export permissions; it is not a complete filesystem sandbox. |
| Startup supply chain | Python runtime dependencies are installed from an exact, hash-verified lock with wheels only. JavaScript uses existing lockfiles. Routine startup does not silently upgrade yt-dlp or other packages. Native downloads remain pinned and verified. |
| Logs | A bounded local connection/mutation audit is kept in `data/security/access.db`. It excludes credentials, request bodies and query strings. Normal startup disables URL access logging. |

## Backups and recovery

Back up the entire `data/` folder, including its `security/vault.json` record, plus the system keyring or separate private-key directory. On Linux the fallback directory is `~/.local/share/ShortForge/private-keys/`; on Windows it is under `%LOCALAPPDATA%/ShortForge/private-keys/`. A configured `SHORTFORGE_PRIVATE_KEYS_DIR` must remain outside the Library directory.

A Library/database copy alone does not contain the credential-decryption key. Do not delete or regenerate that key to fix a temporary keyring problem. Unlock the system keyring or restore the original private key. Existing encrypted values are kept if decryption fails. Store backups privately; keep an offline copy to recover from deletion or ransomware. Disk encryption remains useful.

## Free ongoing checks

Run `npm run security:check`, or ask Codex to run it. It checks all three npm projects, installed Python distributions, the available Concat source lockfile, media-tool versions and native network-isolation availability. Only dependency names/versions go to public advisory services; it does not send Library data or credentials. Exit code 1 means findings remain; exit code 2 means a check could not finish.

The Concat 0.2.8 source still has upstream advisories and maintenance warnings. Its latest published native release has not incorporated all source dependency fixes. **Offline isolation mitigates network exposure; it does not patch those dependencies or prove every native code path safe.** The checker intentionally continues to report them.

Update the actual native runtime when a reviewed patched release becomes available, along with its pin and checksums. Refresh `engine/requirements-lock.txt` deliberately and rerun dependency/security and media-quality tests. Optional OCR/voice installers remain explicit setup actions; their packages also need review when changed.

## Deployment and verification limits

Keep the engine on loopback. Use one engine process; the current authorization/media-link lifecycle is not a multi-worker or hosted-server design. Vite is for development only and retains the inline-script allowance needed by its React development tooling. It is not used by normal startup.

Linux is the verified environment. Windows/macOS branches need separate execution checks. Concat is unavailable when offline isolation is unavailable; an affected native binary is not silently launched without that protection. Windows therefore needs a patched/safely isolated native editor before this Concat release can be enabled there. The media installer provides Linux and Windows binaries; other platforms require a supported FFmpeg installation.

This work does not certify the operating system, browser/extensions, downloaded models, live accounts, every dependency feature, or every instruction in third-party native binaries. Do not expose the app publicly on the strength of these local protections.
