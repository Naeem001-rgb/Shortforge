# Research and design direction

Research on 2026-09-29, bounded to six references. Dribbble video-editor searches surfaced Flush, VEED library, and caption-dashboard work; 21st.dev public docs describe segmented lists, sidebars, and command search. Mobbin and Apple HIG pages were reachable but their detailed examples require client rendering/login; no claim to have inspected gated screens.

- https://dribbble.com/search/video-editor-dashboard — media-first hierarchy and restrained editor chrome.
- https://help.21st.dev/magic-chat/quick-start — sidebar and reusable component patterns, inspiration only.
- https://mcp.21st.dev/changelog — table/grid switching and state-specific tabs.
- https://mobbin.com/discover/apps/web — flow research reference; gated content not copied.
- https://developer.apple.com/design/human-interface-guidelines/layout — layout reference.

## Principles
1. A quiet creative workbench, with one clear next action.
2. Use the spec's neutral ink/white palette with blue reserved for action.
3. Let real footage supply color; no fabricated library or metrics.
4. Generous typography and space, compact controls.
5. Empty library is useful: import, upload, or connect Scout.
6. Differentiate inspiration from footage ready to edit without blocking discovery.
7. Keep costs and installed capabilities explicit at the point of use.
8. Preserve drafts when changing tools.
9. Respect keyboard, reduced motion, readable contrast, and narrow screens.
10. Caption cleanup previews its actual approximation.

## Patterns
- Fixed quiet sidebar, breadcrumb/connection header, content-first workspace.
- Library with compact segmented filters, portrait thumbnails, and detail drawer.
- Studio with tool navigation, a portrait canvas and contextual properties; timeline below.
