# Pinterest creator/video dashboard research

Research date: 2026-10-05. Researcher: pinterest_creator (one of three explicitly requested research agents).

## Access and evidence

I searched Pinterest for `creator dashboard ui design` and `video dashboard ui design`. Direct search pages returned the JavaScript shell; anonymous resource search was initially blocked and later returned empty results. DuckDuckGo challenged these queries, and Yahoo returned HTTP 500 in this worker. The SaaS research agent supplied ten actual indexed Pinterest pin URLs from its successful Yahoo searches; I fetched and visually inspected their Pinterest images. Most were unsuitable or duplicate matches and are not counted as recommended references.

The public reader at https://r.jina.ai/https://www.pinterest.com/search/pins/?q=video%20dashboard%20ui successfully rendered the actual Pinterest search. It returned 19 Pinterest images, all downloaded and visually inspected in `/tmp/shortforge-pinterest-creator/jina-contact.jpg`. Source capture: `/tmp/shortforge-pinterest-creator/jina-pinterest.txt`. Pinterest signed-out search cards omit public pin URLs from the readable output, so references from this feed are explicitly marked as search-image references; pin IDs have not been invented.

Parent narrowed the final deliverable to the three strongest distinct creator/media references because the other two research agents already produced twelve unique, fully verified pins.

## 1. Courseco — Online Education Dashboard, Ahmad Sulaiman

- Pinterest pin: https://id.pinterest.com/pin/1128714725392184328/
- Pinterest title: `Courseco - Online Education Dashboard by Ahmad Sulaiman | Webdesign, Creatief`.
- Image: https://i.pinimg.com/736x/b4/e2/e2/b4e2e279c4592f3dc639ff4fa4b5b7f3.jpg
- Local image: `/tmp/shortforge-pinterest-creator/creator-1128714725392184328.jpg`.
- Evidence: Direct Pinterest pin HTTP 200; actual image downloaded and viewed individually at 736 × 552.
- Composition: A pale rounded application shell contains a tall black sidebar with a violet active selection. The main workspace has search at the top, a clear welcome heading, two large continued-work cards, and a compact list below. A secondary right column groups supporting material and upcoming work.
- Type and spacing: Strong dark headings; clearly subordinate gray metadata; roomy cards with small colored category tags, consistent corner radii, and enough internal space to separate title, progress, and context. The sidebar is genuinely readable at application scale.
- Color: Near-black sidebar, white/off-white main surfaces, soft violet selections, sparse pastel category colors. Bright illustration panels are present in the original but would be excessive for a local utility app.
- UX transfer to ShortForge: Put actual recent media and ongoing work immediately in reach. Use a deliberate main/secondary hierarchy and readable metadata. A large `Create` or `Download` entrypoint can replace the illustration panel, with real counts/status in the quieter secondary area. Keep the user's work as the focus rather than filling the overview with charts.

## 2. Robovision — AI Video Creation workspace

- Pinterest pin fetched: https://www.pinterest.com/pin/416231190587216444/
- Also fetched successfully: https://uk.pinterest.com/pin/416231190587216444/
- Pinterest page canonical: https://in.pinterest.com/pin/1123437069579125613/
- Pinterest title: `We're Building Something New | Ui dashboard for video, Videoclip ui, Video dashboard design`.
- Image: https://i.pinimg.com/736x/b6/73/88/b673888a2bf9b4259e844d629581f9de.jpg
- Local image: `/tmp/shortforge-pinterest-creator/creator-video-workspace.jpg`.
- Evidence: Direct Pinterest pin HTTP 200; actual image downloaded and viewed individually at 736 × 552. Raw pages are `final-ref-0.txt` and `final-ref-1.txt` in the cache folder.
- Composition: A dense but orderly media workspace separates a two-column thumbnail library from a large central preview, with a timeline below. The top toolbar places document context left and saved state, preview, share, and violet export right.
- Type and spacing: Small labels are quiet; thumbnail imagery creates recognition without oversized headings. Rounded panels form a consistent containment system, and controls have clear grouping. Thumbnail cards preserve their visual aspect ratio and use uniform gaps.
- Color: Charcoal/near-black surfaces with subtle differences between outer shell and panels. Violet is reserved for selected tools, play position, and export. Content imagery provides the color.
- UX transfer to ShortForge: On library/overview screens, use large real thumbnail cards, consistent aspect ratios, compact readable title/metadata, and an obvious action toolbar. In Studio, keep controls outside the preview and use violet consistently for the selected tool and primary action. The overview does not need the timeline.

## 3. EditorPro — light video editing workspace (recommended media treatment)

- Pinterest search source: https://www.pinterest.com/search/pins/?q=video%20dashboard%20ui
- Specific search image: result 16 in the saved rendered search capture (image hash `300ff5386413c6edf71f9fc563c712f7`). The visible product name is `EditorPro`; the open document is `Minimalistic houses 2024`.
- Exact pin URL: Not exposed by the signed-out rendered search. This is a verified Pinterest search-image reference, not a verified pin permalink.
- Image: https://i.pinimg.com/736x/30/0f/f5/300ff5386413c6edf71f9fc563c712f7.jpg
- Local image: `/tmp/shortforge-pinterest-creator/jina-image-16.jpg`.
- Evidence: Actual Pinterest search image downloaded and viewed individually at 736 × 607, not inferred from a title.
- Composition: A softly rounded pale outer shell contains a narrow icon rail, a separate media asset column, a large uncluttered preview, a compact inspector, and a generous timeline. The title sits quietly in the top bar and Export is an unmistakable dark pill at upper right.
- Type and spacing: Compact functional type, dark section titles, light gray secondary labels; restrained rounded corners; precise alignment; broad calm surfaces rather than heavy borders or shadows. Media thumbnails and the video itself dominate.
- Color: Warm near-white canvas, subtly darker gray panel fills, black text and top-level actions. Violet and orange occur as small timeline track accents; they do not tint every surface.
- UX transfer to ShortForge: This pairs especially well with the parent-selected Coursie violet/pale composition. Use a calm light workspace, a clear top action, large photographic thumbnail cards, and subtle grouped surfaces. Let ShortForge's bundled Inter and existing violet #5347CE define type and action states. Actual downloaded videos should supply the imagery; empty states should explain the next useful step.

## Additional visually verified media evidence (not needed to reach the requested total)

**Opedia AI video editor**, Pinterest video-dashboard search image 9.
- Image: https://i.pinimg.com/736x/a0/71/fe/a071feff8b09c3e04e34f042dd9ddc07.jpg
- Local: `/tmp/shortforge-pinterest-creator/jina-image-09.jpg`.
- True video-creation UI: sidebar actions Home/Templates/Avatars/Clone Voice/My Creations/My Files, violet active navigation, large preview, thumbnail templates, scene timeline. Primary Export Video is top-right. Helpful for coherent violet selection and template organization, but too dense to copy into the home overview.

**Blue-action video editor**, Pinterest video-dashboard search image 2.
- Image: https://i.pinimg.com/736x/17/d0/fe/17d0fe6b8fb7c8c2fe2f1e06d618e708.jpg
- Local: `/tmp/shortforge-pinterest-creator/jina-image-02.jpg`.
- Media library and audio separated left, centered landscape video, controls right, multitrack timeline below. Export and upload use the same blue as active controls; purple and green are reserved for track meaning.

## Recommendation

Use Coursie from the parallel analytics research as the primary overall composition, Courseco for the clear recent-work/secondary-work hierarchy, and EditorPro for restrained media presentation. Robovision supplies a trustworthy visual reference for actual video thumbnail grids and Studio controls. The combined result should remain a local video workspace: readable navigation, one obvious primary action, real recent content, useful status, and a controlled violet accent. Avoid transplanting the references' fake financial charts, decorative avatars, promotional upgrade cards, or overly dense timeline onto the overview.

## Rejected matches

Roblox Creator Dashboard results were a Roblox splash banner and an avatar image, not dashboard UI. Two indexed `Dashboard settings [Video]` pins used the same analytics thumbnail. A SaaS explainer image and mobile travel animation were not creator dashboards. These were inspected but deliberately excluded from recommended counts.
