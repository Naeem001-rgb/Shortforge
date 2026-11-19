# Documentation

Start with the current product and setup guides. Dated reports record what was checked at that time.

| Area | Documents |
| --- | --- |
| Start and product scope | [Project README](../README.md) |
| API and maintenance | [API contract](../shared/contract/API.md), [security](SECURITY.md), [testing](TESTING.md) |
| Native editing | [Concat setup, saved projects and recovery](CONCAT.md) |
| Scout | [Extension guide](../extension/README.md), [media workers](../engine/studio/README.md), [speech screening](../engine/studio/SCOUT_SPEECH.md) |
| Publishing and scheduling | [YouTube setup and workflow](YOUTUBE-PUBLISHING.md), [YouTube API](../shared/contract/YOUTUBE.md) |
| Optional backend services | [Voice and speech](VOICE.md) |
| Validation | [Latest cleanup and scaling review](CLEANUP-2026-11-10.md), [October 30 audit](AUDIT-2026-10-30.md), [Testing](TESTING.md), [browser harnesses](QA-HARNESS.md), [performance results](PERFORMANCE-RESULTS-2026-10-26.md) |
| Design research | [Dashboard references](design/pinterest-dashboard-research.md), [Scout references](design/scout-pinterest-research.md), [earlier notes](design-notes.md) |
| Change history | [Changelog](PROGRESS.md) |
| Licensing | [Historical editor notices](licenses/browser-editor.md), [MI-GAN notice](licenses/MI-GAN.txt) |

`design/` holds consolidated research; `licenses/` retains third-party notices. Private media, saved edits and downloaded models stay under the ignored `data/` directory. Credentials stay in local settings or `.env`, never documentation.
