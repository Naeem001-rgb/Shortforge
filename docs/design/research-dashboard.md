# Pinterest dashboard research — agent 3

Research performed 2026-10-05. Six selected references below were retrieved from Pinterest, and each actual image was visually inspected at its native or tool-resized resolution. The topic feed also supplied a 20-design contact sheet; the six selected records are the research deliverable for the combined 15-reference review.

## Retrieval and evidence

- Attempted actual Pinterest searches: https://www.pinterest.com/search/pins/?q=modern%20analytics%20dashboard%20ui and https://www.pinterest.com/search/pins/?q=productivity%20dashboard%20ui . Both responded 200 but only with the logged-out app shell, no pin results. Pinterest BaseSearchResource responded 403. Google returned a JavaScript redirect shell, Bing results were unrelated, and the tested DuckDuckGo analytics/productivity queries returned a bot challenge.
- Working Pinterest discovery URL: https://www.pinterest.com/topics/dashboard-design/ . It returns a genuine Dashboard Design topic feed. The `__PWS_INITIAL_PROPS__` JSON contained 20 pin IDs and their original image URLs; saved as `/tmp/pin-da-topics.json`.
- Original image files and full retrieved pin HTML pages are saved under `/tmp/shortforge-pinterest-dashboard/`.
- All six selected pin URLs were then independently fetched successfully (HTTP 200), and their actual HTML titles are reported exactly below. Pinterest saved titles sometimes describe the image loosely; visual product names are separately identified.
- Contact sheet of all 20 downloaded references: `/tmp/shortforge-pinterest-dashboard/contact-sheet.jpg`.

## 1. Donezo — restrained task dashboard

Pinterest title: **Dashboard Design Examples That Actually Work | Muzli Blog | Dashboard design behance, Website dashboard mockup, Dashboard sample**

Pin: https://www.pinterest.com/pin/35254809577482776/

Original image: https://i.pinimg.com/originals/e4/b5/8c/e4b58c5d1c363d3a7223476d657d0f79.png

Local image: `/tmp/shortforge-pinterest-dashboard/35254809577482776.png` (752 × 564).

Observed: white outer shell, narrow very pale gray sidebar, a separate shallow search/account bar, and a pale gray content well. The heading and two compact actions sit above four concise summary cards. Only the lead card receives the saturated forest-green fill. The lower layout is asymmetric: a wide analysis area and collaboration rows at left, narrow reminder/project panels at right. The active nav state combines a thin edge mark, dark text, and green icon rather than relying only on a filled background. Corners are consistently soft, and most panels are separated by surface tone instead of heavy shadows.

Apply to ShortForge: a real library summary, a single clear import action, a large recent-media area and a narrower status/quick-actions panel. Keep summary values tied to existing video/job state. Strongest layout reference alongside Coursie.

## 2. Coursie — violet task workspace

Pinterest title: **Corporate Website | Ideias de embalagem, Paleta de cores, Web design**

Pin: https://www.pinterest.com/pin/304626362318839469/

Original image: https://i.pinimg.com/originals/8e/38/8a/8e388a8d275d7fbd9019f29bbe073ec0.png

Local image: `/tmp/shortforge-pinterest-dashboard/304626362318839469.png` (1024 × 768).

Observed: a bright white frame encloses two independently rounded pale-gray regions: sidebar and main application. Top search is wide and quiet. Violet is used for the selected nav indicator, primary action, one summary card, and chart marks. Big numeric values sit beneath short labels; muted helper lines are compact. A roughly 2:1:1 arrangement below the summaries creates hierarchy; white cards on a faint neutral well provide depth without prominent shadows. The black/violet timer panel gives the otherwise light dashboard a deliberate dark anchor. Product visible in artwork: Coursie. Its composition is closely related to the Donezo image, so they should be treated as one design family rather than blended as unrelated ideas.

Apply to ShortForge: closest direct visual match for the existing #5347CE violet identity. Reproduce its framing, airy spacing, white/pale-lilac surface layering, modest radii, and restrained accent distribution. Replace decorative charts with real recent videos and actual download/progress state; use a dark-violet import/create panel as the visual anchor. Avoid copying its duplicate Add Project labels or every repeated Project Analytics heading.

## 3. Taskly — task-first information hierarchy

Pinterest title: **Modern task dashboard in pastel tones | Dashboard layout with cards, Dashboard design with cards, Pastel dashboard**

Pin: https://www.pinterest.com/pin/42854633949843939/

Original image: https://i.pinimg.com/originals/1f/e4/df/1fe4df244bca59198bcfca18f7e8648d.png

Local image: `/tmp/shortforge-pinterest-dashboard/42854633949843939.png` (1586 × 992).

Observed: persistent left nav, broad central work area, narrower right rail. The overview row is compact enough that the actual My Tasks list remains prominent. A tab set separates All, To Do, In Progress, and Done; filter and sort controls stay on the same toolbar. Rows have a stable alignment for checkbox, title, category, due date, priority, and overflow actions. Header has an obvious New Task button. Right rail groups calendar, progress, and upcoming tasks. The artwork uses heavy neumorphic shadows and 3D pastel icons, which are less suitable for a crisp production interface.

Apply to ShortForge: keep Downloading, Ready, and All filtering easy to find; put search/sort/view controls beside the content they control; show file state as a concise colored label. Borrow the working hierarchy and central list treatment, not the excessive shadow/3D icon styling.

## 4. iDraft — monochrome productivity and project cards

Pinterest title: **Task Management Dashboard by Awsmd on Dribbble | Digital task manager, Dashboard financial controller, Material design input**

Pin: https://www.pinterest.com/pin/785455991311895862/

Original image: https://i.pinimg.com/originals/f6/86/aa/f686aa16cd9f8367f110f024a3c5757b.png

Local image: `/tmp/shortforge-pinterest-dashboard/785455991311895862.png` (1600 × 1200).

Observed: a long white rounded sidebar groups navigation and integrations; active Dashboard is a charcoal pill. The page title is large and plain, with a compact Create action in the top-right. Three main modules vary in tone: charcoal summary, translucent chart, white progress. Below, task cards and a dashed add-task tile make creation discoverable inside the content grid. Last Projects includes explicit sort and grid/list view controls. The pin artwork includes a textured glass background and tilted note cards; those make a presentation dramatic but would distract from repeated production use.

Apply to ShortForge: a strong dark headline panel can sit within an otherwise light dashboard; recent-video cards should expose stable metadata and a clear action. Keep grid/list tools at the recent-media heading, use a local create/import tile only if it does something. Maintain flat alignment in the functional UI.

## 5. Eduplex — course/content dashboard with dark navigation

Pinterest title: **Educational Dashboard Design | Educational dashboard ideas, Educational dashboard ui, Dashboard ui design**

Pin: https://www.pinterest.com/pin/1477812372350738/

Original image: https://i.pinimg.com/originals/39/b8/0d/39b80d90c8f7585cce93b1e3ad0defee.jpg

Local image: `/tmp/shortforge-pinterest-dashboard/1477812372350738.jpg` (2160 × 3239; design centered within a lavender presentation backdrop).

Observed: navy-black left sidebar contrasts with an off-white content canvas, and lime marks the active nav and primary actions. Three simple course cards at the top use colored icon containers and a short metadata pair. Main content has a wide two-column area with activity and daily schedule; a slim rail contains calendar and assignments. Lower content rows expose a title, author, remaining duration, and circular progress in a predictable alignment. Search is in the top header and includes a specific content noun. The screenshot title initially appeared ambiguous at contact-sheet scale; full-resolution inspection confirms the visible product is Eduplex, not Montask.

Apply to ShortForge: useful content metadata pattern for video duration/source/progress. Search should explicitly say Search videos or Search your library. Dark navigation is an alternative direction if the parent chooses that family; do not mix its lime accents into the violet Coursie direction.

## 6. Bankio — financial overview and activity list

Pinterest title: **Budget Dashboard Design for Financial Planning in Excel | Transaction overview dashboard, Account transaction dashboard, Transaction overview template**

Pin: https://www.pinterest.com/pin/148126275239748454/

Original image: https://i.pinimg.com/originals/1e/a0/9e/1ea09e7dad4ba76329eeb9172dbe4842.jpg

Local image: `/tmp/shortforge-pinterest-dashboard/148126275239748454.jpg` (1472 × 2136; two dashboard screens stacked).

Observed: white sidebar, soft gray content, restrained dark green selection and highlighted summary. Numeric hierarchy is clear: labels are small and values large. The second screenshot is especially useful: Transactions Activity Overview leads into a broad activity table with a dark header, fine horizontal dividers, stable columns, a nearby month filter, and row-level export controls. Completed and Failed statuses remain written words with color reinforcement. Several utility controls in the artwork are small; final implementation should use practical hit areas.

Apply to ShortForge: a real downloaded-video list can use thumbnail/title/source/duration/date/status/action columns, quiet dividers, and text statuses. A large content panel is preferable to making each row an oversized card. Preserve accessible hit areas for open/delete/overflow.

## Recommended coherent direction

Use **Coursie/Donezo as the main layout family**, keeping ShortForge violet. A white or very pale-lilac sidebar with a clear selected tab, a slim topbar, a separate large softly rounded content surface, and a restrained dark-violet create/import feature panel will make the app recognizably match these modern references. Use iDraft for the prominence of creation and recents, Taskly for content filtering/state and toolbar placement, and Bankio for legible compact metadata.

Suggested concrete proportions: desktop sidebar about 220–236 px; top bar about 72 px; page padding 28–36 px; heading 28–32 px; body 13–14 px; panel radii 16–22 px; 20–24 px between major modules; 12–16 px internal card gaps. Subtle cool borders, almost no drop shadows, strong dark ink, and muted text with adequate contrast. Use violet in selected navigation, the lead feature, and primary buttons; other controls stay neutral. Use asymmetry to favor the actual media workspace. Show only real local counts, progress, and file state. Avoid unrelated fake revenue charts, cloud profiles, collaboration counters, or subscription upsells. Keep light/dark/system behavior and adapt the same hierarchy into fewer columns on smaller screens.
