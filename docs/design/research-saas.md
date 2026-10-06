# Pinterest SaaS / workspace dashboard research

Completed 2026-10-05. Research agent 1 of 3. Six unique design references below were found in indexed Pinterest search results, their actual Pinterest pages were fetched successfully, and their linked Pinterest CDN images were downloaded and visually inspected. Visual quality and suggested UX value are judgments from static screenshots, not usability test results.

## Access and method

- Requested Pinterest search for modern SaaS dashboard design. It returned an unauthenticated application shell without pin results; Pinterest BaseSearchResource returned 403.
- Used indexed Pinterest search at https://html.duckduckgo.com/html/?q=site%3Apinterest.com%2Fpin%2F+saas+dashboard+design and https://search.yahoo.com/search?p=site%3Apinterest.com%2Fpin%2F+minimal+dashboard+design to identify actual pin pages. DuckDuckGo later returned a captcha, so Yahoo supplied the second set.
- All six selected page and image requests returned HTTP 200. Their images are distinct. No login, saving pins, or outbound communication was performed.

## Strongest recommendation for ShortForge

Use **FindMe** as the light workspace shell, **Oripio / Zenxius** for the aligned header, grouped navigation, summary spacing, and activity layout, and **KUBMA** for the actual thumbnail-first media cards. Preserve ShortForge’s existing violet #5347CE and Inter typography. A calm off-white canvas, white sidebar, lightly bordered white surfaces, restrained violet active states, real landscape thumbnails, and a compact visible create/import action give the closest practical match. Keep real local-video data and existing routes/actions; static financial charts, fake avatars, invented growth metrics, and upgrade promotions do not belong in this product.

Suggested desktop composition: approximately 224px sidebar; 64–72px header; generous 28–32px content gutter; heading + concise supporting line + primary action; a short 3–4 fact summary strip; media library with clear type/status filters and a 3-column thumbnail grid; one secondary recent-work panel only if backed by actual state. On narrow screens collapse the navigation accessibly and turn the grid into two or one columns.

## 1. Zenxius — Dashboard Design | SaaS | Mockup

- Pinterest: https://www.pinterest.com/pin/dashboard-design--624944885827729004/
- Pinterest title: Dashboard Design | SaaS | Mockup | Saas admin dashboard ui, Saas ui design inspiration, Saas dashboard ideas
- Image: https://i.pinimg.com/736x/7a/2d/c2/7a2dc29ba2ca5604cdbb03a313b492db.jpg
- Local image: `/tmp/shortforge-pinterest-saas/pin-2.jpg`

Observed: A white, compact left sidebar has uppercase group labels, a full-width blue selected state, and a bottom user identity. A clean title/action row precedes three equal summary cards. The working area uses a two-thirds attendance table plus one-third distribution panel; a task area has board/list/calendar controls and understated colored status strips. Rounded borders are very light; text hierarchy and spacing carry the structure.

Application: Useful for ShortForge: stable labeled navigation; a compact summary row from real library/job counts; a main library area plus a smaller local activity/status area. Keep the existing violet brand for selection and primary actions.

## 2. Oripio — SaaS Web App Design

- Pinterest: https://uk.pinterest.com/pin/saas-web-app-design--589690145003419085/
- Pinterest title: SaaS Web App Design | Dashboard for financial app, Dashboard financial design, Account dashboard
- Image: https://i.pinimg.com/736x/30/8d/9e/308d9e4a32060ff222d95922a7eefc8e.jpg
- Local image: `/tmp/shortforge-pinterest-saas/pin-7.jpg`

Observed: Bright white sidebar and cards sit over a pale gray workspace. Search lives in a slim global header; the page title pairs with an aligned right-side action. Navigation groups use small uppercase labels. A mint selected-state tint and restrained green CTAs provide a single accent. Three headline metrics anchor the page while a larger central chart and a recent-transactions table do the detailed work.

Application: Useful for ShortForge: copy the overall organization and generous left/right alignment. Replace financial summaries with existing downloads, saved media, and completed/active jobs. The recent-transactions table pattern becomes a recent-activity or recent-project list; no invented financial or growth metrics.

## 3. FindMe — Minimalist Dashboard Redesign

- Pinterest: https://www.pinterest.com/pin/findme-minimalist-dashboard-redesign--462885667963443900/
- Pinterest title: FindMe - Minimalist Dashboard Redesign | Minimalist admin panel design, Simple dashboard design, Web design design
- Image: https://i.pinimg.com/736x/56/34/06/563406e611570dda4227469d683a4e79.jpg
- Local image: `/tmp/shortforge-pinterest-saas/pin-21.jpg`

Observed: An almost monochrome white/gray workspace with a distinct left navigation column, search at the top of content, and a greeting immediately below it. Three compact KPI cards sit above a wide, quiet activity table; two smaller summary cards occupy the right rail. Rounded selection bands and pastel status tags are subtle. The dashed Import New Product control is visually separated at the bottom of navigation.

Application: Strong shell reference for ShortForge: use a clear product sidebar, short header with global search or search affordance, aligned page heading and CTA, then summary and a main media/activity region. Keep the action and empty states explicit; increase text contrast versus the faint reference screenshot.

## 4. Minimal dashboard — Hello David

- Pinterest: https://www.pinterest.com/pin/292452569560757182/
- Pinterest title: Minimal dashboard | Digital marketing dashboard interface, Modern dashboard ui, Fintech dashboard design
- Image: https://i.pinimg.com/736x/56/83/67/568367ede47a68b34209213fa264403b.jpg
- Local image: `/tmp/shortforge-pinterest-saas/pin-26.jpg`

Observed: A white canvas gives the content considerable breathing room. A very narrow labeled sidebar has a simple vertical marker for selection. An unboxed top metric strip sits above four softly tinted pastel panels; a tall black summary panel on the right creates the single strong focal point. Very little chrome surrounds individual labels.

Application: Useful for ShortForge: avoid wrapping every number in another card; a quiet summary strip plus one prominent branded action/creation panel can establish hierarchy. Use violet for the key creation action and small success/processing tints for meaning. The black financial sidebar is optional inspiration, not a requirement.

## 5. KUBMA — Business intelligence dashboard / My Properties

- Pinterest: https://au.pinterest.com/pin/minimal-dashboard-design--615163630351164319/
- Pinterest title: Business intelligence dashboard design | Minimal dashboard, Kubernetes dashboard interface, Web ui
- Image: https://i.pinimg.com/736x/e5/a9/c7/e5a9c7d2288c1f71fe2326db9240e1c7.jpg
- Local image: `/tmp/shortforge-pinterest-saas/pin-29.jpg`

Observed: A left sidebar leads directly into a three-column media grid. Every project card starts with a large landscape image, then a concise title and URL metadata, then side-by-side primary View and secondary Settings actions. Active card and active navigation use a matching blue. It is more utilitarian than the other references, but the content structure maps closely to a local media library.

Application: Best content-model reference for ShortForge: large real video thumbnails, title, source/type/duration metadata, and an obvious Open in Studio or Play action. Show secondary menu actions at the same spot on each card; avoid copying the unrelated social buttons or URL inputs.

## 6. Clean dashboard design — Portfolio workspace

- Pinterest: https://au.pinterest.com/pin/676243700345136219/
- Pinterest title: Clean dashboard design | Minimal dashboard design, How to create a clean ui, App design | Statistics ui, Ui ux inspiration, Ui inspo
- Image: https://i.pinimg.com/736x/02/e5/41/02e5419672345525f7ec10f97503c9dc.jpg
- Local image: `/tmp/shortforge-pinterest-saas/pin-30.jpg`

Observed: A compact icon rail and soft gray global header surround a large uninterrupted white content surface. Headline value uses a large black numeral with a muted label. A thin black line and pale dot grid keep the chart visually spare. Time controls are tiny pills; secondary asset cards sit in one quiet strip and the table begins with a simple heading. Broad corner radii and fine dividers replace visible shadows.

Application: Useful for ShortForge: fewer heavy card borders, consistent rounded media wells, calm gray header chrome, and clear typography. Keep sidebar labels for discoverability instead of making the full app icon-only. Use thumbnail content and actual progress, not an invented analytics chart.

## Local artifacts

- Six-reference contact sheet: `/tmp/shortforge-pinterest-saas/selected-contact-sheet.jpg`
- Machine-readable shortlist: `/tmp/shortforge-pinterest-saas/selected.json`
- Raw fetched pages and metadata remain under `/tmp/shortforge-pinterest-saas/`.
