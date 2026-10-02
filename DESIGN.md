---
name: "ShortForge"
description: "A compact local video workspace following the supplied Nexus dashboard reference."
colors:
  bg: "#f5f7f9"
  surface: "#ffffff"
  surface-raised: "#ffffff"
  media-card-bg: "#ffffff"
  media-card-border: "#dcd9eb"
  elevated: "#f0f2f5"
  text: "#22232c"
  muted: "#616571"
  border: "#e6e8ee"
  accent: "#5347ce"
  button-bg: "#5347ce"
  accent-soft: "#eeecfc"
  secondary: "#887cfd"
  info: "#4896fe"
  teal: "#16c8c7"
  success: "#237b68"
  danger: "#bc3748"
  danger-button: "#b42c42"
  warning: "#8c601b"
  sidebar-bg: "#fdfdfe"
  topbar-bg: "#ffffff"
  hero-ink: "#28243f"
  hero-muted: "#625d77"
  dark-bg: "#171820"
  dark-surface: "#20212c"
  dark-surface-raised: "#252633"
  dark-media-card-bg: "#2a2c3b"
  dark-media-card-border: "#48465f"
  dark-elevated: "#2c2d3c"
  dark-text: "#f0f0f6"
  dark-muted: "#b0b0c1"
  dark-border: "#343544"
  dark-accent: "#b5adff"
  dark-button-bg: "#6558d8"
  dark-accent-soft: "#302b4c"
  dark-secondary: "#a59aff"
  dark-info: "#82b3ff"
  dark-teal: "#51d5cd"
  dark-success: "#83c8b0"
  dark-danger: "#ff9daa"
  dark-danger-button: "#b73850"
  dark-warning: "#e4bd7c"
  dark-sidebar-bg: "#1b1c25"
  dark-topbar-bg: "#1e1f29"
  dark-hero-ink: "#efecff"
  dark-hero-muted: "#bab4d3"
  on-action: "#ffffff"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Display\", Inter, \"Segoe UI\", sans-serif"
    fontSize: "25px"
    fontWeight: 620
    lineHeight: 1.25
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Display\", Inter, \"Segoe UI\", sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Display\", Inter, \"Segoe UI\", sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Display\", Inter, \"Segoe UI\", sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Display\", Inter, \"Segoe UI\", sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.45
  navigation:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Display\", Inter, \"Segoe UI\", sans-serif"
    fontSize: "12px"
    fontWeight: 450
    lineHeight: 1.55
  card-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Display\", Inter, \"Segoe UI\", sans-serif"
    fontSize: "12px"
    fontWeight: 570
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "12px"
rounded:
  micro: "4px"
  navigation: "5px"
  compact: "6px"
  button: "7px"
  field: "9px"
  panel: "10px"
  thumbnail: "12px"
  dialog: "16px"
  media-card: "17px"
  card-action: "20px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  group: "20px"
  workspace: "24px"
  panel: "28px"
components:
  button-primary:
    backgroundColor: "{colors.button-bg}"
    textColor: "{colors.on-action}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "8px 12px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "8px 12px"
    height: "36px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "8px 12px"
    height: "36px"
  button-danger:
    backgroundColor: "{colors.danger-button}"
    textColor: "{colors.on-action}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "8px 12px"
    height: "36px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "10px 12px"
  navigation-active:
    backgroundColor: "{colors.elevated}"
    textColor: "{colors.text}"
    typography: "{typography.navigation}"
    rounded: "{rounded.navigation}"
    padding: "8px 10px"
    height: "35px"
  badge-neutral:
    backgroundColor: "{colors.elevated}"
    textColor: "{colors.muted}"
    rounded: "{rounded.compact}"
    padding: "3px 8px"
  section-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    padding: "28px"
  theme-selector:
    backgroundColor: "{colors.elevated}"
    rounded: "{rounded.compact}"
    padding: "2px"
  media-card:
    backgroundColor: "{colors.media-card-bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.media-card}"
    padding: "6px"
---

# Design System: ShortForge

## Overview

**Creative North Star: "The compact creative workspace"**

ShortForge follows the user-supplied Nexus dashboard and brand guide: a compact, precise application frame, white working panels, cool-gray gradients, and violet actions. The selected solid card reference supplies inset rounded media, clear text below the image, and a small capsule action. The interface keeps the real ShortForge library and production tools.

Light, dark, and system modes share the same geometry. Dark mode translates the surfaces into charcoal and readable lavender accents. Apple system fonts lead on Apple platforms; bundled Inter supplies the fallback elsewhere. Lucide line icons and thin neutral rules keep the chrome quiet around actual footage.

**Key Characteristics:**

- A subtle cool-gray/lavender page gradient with solid white light-mode panels.
- The supplied violet, lavender, blue, and teal palette with separate semantic status colors.
- A 200px navigation rail, 56px utility header, and compact working controls.
- Five compact media cards per desktop row, with real thumbnails and metadata.
- Persistent light/dark/system themes, visible focus, and responsive navigation.

This document records the user-authorized replacement of the earlier creative-studio styling with the supplied Nexus dashboard, guide, and solid inset-image card. Runtime sources are `dashboard/src/theme/tokens.css`, `app.css`, `workspace.css`, `shell.css`, and `library.css`. The page-specific contract and reference paths live in `.impeccable/surfaces/dashboard.md`.

## Colors

The frontmatter uses runtime token names without the CSS `--` prefix. A `dark-` prefix denotes the corresponding dark-theme value. These extracted values are normative; do not substitute the earlier blue-accent palette.

### Primary

`accent` and `button-bg` use the supplied violet #5347CE in light mode. In dark mode, readable lavender `accent` is separate from the darker `button-bg` fill so white button text stays clear. `accent-soft` carries quiet selected surfaces and tinted details. Text selection uses white on `button-bg`.

### Secondary

The supplied lavender #887CFD is `secondary`, blue #4896FE is `info`, and teal #16C8C7 is `teal`. Their dark-mode counterparts are coordinated brighter values. These colors support the violet hierarchy rather than assigning a different accent to each control.

### Neutral

`bg` supplies the root fallback. The body uses `workspace-gradient`: a slight lavender radial tint over a cool-gray diagonal gradient, attached to the scrolling page. `surface` and `surface-raised` are solid white in light mode; `elevated` gives controls and selected navigation a quiet gray fill. `text`, `muted`, and `border` establish readable hierarchy and thin edges. The near-white sidebar and opaque header use `sidebar-bg` and `topbar-bg`.

The Library collection panel preserves `library-gradient`: the workspace gradient in light mode, and `linear-gradient(135deg, #20232e 0%, #181a24 55%, #10141c 100%)` in dark mode. Media cards use their dedicated `media-card-bg` and `media-card-border` tokens to remain distinct from this gradient.

The shared feature material uses a pale lavender `hero-bg` with dark `hero-ink` and muted purple `hero-muted`; all three switch with the theme. Semantic success, danger, and warning values describe real state. Filled destructive actions use the distinct `danger-button` token.

**The Violet Action Rule.** Use violet for primary actions, links, focus, and selection. Lavender, blue, and teal are supporting guide colors; success, warning, and danger communicate actual state.

**The Paired Material Rule.** Switch semantic tokens together when the theme changes. Preserve layout, control placement, and reading hierarchy across light and dark modes.

## Typography

**Display and body:** `-apple-system`, `BlinkMacSystemFont`, `SF Pro Display`, bundled Inter, Segoe UI, sans-serif. **Code and keyboard hints:** the recorded system monospace stack.

The system stack follows the supplied SF Pro direction where the platform provides it, while retaining the bundled Inter fallback on other systems. No remote font or unlicensed SF Pro file is needed. Headings have balanced wrapping and restrained negative tracking; interface labels stay compact.

The Library title is 25px, weight 620, and steps to 23px at 650px. Standard page headings use 24px, weight 600, stepping to 23px at 820px and 22px at 560px. General body text is 14px/1.55; standard buttons use 13px. Navigation is 12px at rest and weight 600 when selected. Library card titles are 12px/1.4, weight 570, with two-line space; creator and metric text use 10px. On the one-column mobile card these increase to 13px and 11px respectively.

## Layout

The fixed sidebar is 200px wide. Its 56px brand row aligns with the 56px utility header. The header places the workspace search on the left and engine status, theme selector, and workspace settings on the right. Main content has 24px gutters and a maximum width of 1760px. The application fills the viewport without decorative browser chrome.

At 820px the sidebar becomes a 242px drawer, the header grows to 60px, and main gutters become 22px. At 560px gutters become 16px; at 375px they become 12px. The drawer sets focus inside navigation, traps Tab, makes background content inert, closes with Escape, and returns focus to the menu trigger. The app supports a minimum viewport width of 320px.

The Library begins with a compact title/action row and three panels showing actual record counts. Its collection panel has 16px side padding, a 56px tab/view row, and a compact search/filter row. The grid is **five columns maximum**, with 28px row gaps and 24px column gaps; it becomes four at 1100px, three at 820px, two at 650px, and one at 440px. Gaps become 24px by 16px at 1100px and 20px at 440px. Grid and table views show the same records with working filters, selection, and bulk actions. The previously removed creative-workflow footer stays absent.

Cards use 6px exterior padding. The inset thumbnail has a 6:5 aspect ratio constrained to 142–167px tall on desktop; metadata and a stats/action row sit below the image. Cards target a maximum height of 320px at the user’s 1261px desktop width. At 440px the thumbnail range becomes 186–191px. The empty library uses a centered, quiet gradient panel with actual import and discovery actions rather than a promotional media mockup.

The Studio preserves the existing three-pane editing hierarchy: tools, preview/timeline, and contextual properties. Smaller layouts adapt the panes and controls to available space rather than changing the content or workflow.

## Elevation & Depth

Ordinary panels use solid theme surfaces with thin neutral borders and no shadow. The body gradient supplies atmospheric depth without glass or blur. Media cards use a 1px `media-card-border` edge, a separate `media-card-bg` fill, and no shadow. Hover mixes 45% accent with 55% default border; selected cards retain the inset accent outline. Dialogs keep the stronger overlay shadow.

`shadow-sm` is 0 2px 4px with light/dark opacity 0.045/0.12. `shadow-card` is 0 5px 15px -7px with opacity 0.12/0.28. The overlay `shadow` is 0 24px 70px -15px with opacity 0.2/0.5. Exact color-bearing declarations and workspace/library gradients are recorded in the sidecar. The available shared `shadow-card` token is not applied to Library media cards. Primary actions use a small 0 2px 3px violet cast shadow; the Library heading action suppresses it.

**The Quiet Frame Rule.** Use thin borders for working panels and media cards, and the large shadow for overlays. Keep media cards shadow-free and the frame quieter than the video content.

Feedback transitions run for 160–180ms with ease/ease-out. The Library has no entrance animation. Reduced-motion rules remove media-card and shared-control transitions; no content depends on animation to become visible.

## Shapes

The frame uses precise small corners: navigation 5px, compact search/select/theme controls 6px, standard buttons 7px, standard fields 9px, and working panels 10px. Inset thumbnails use 12px corners, media cards 17px, and dialogs 16px. The small capsule action on a media card uses a 20px radius following the chosen card reference.

Lucide icons use consistent line strokes, normally 1.6; the violet brand and selected navigation use slightly stronger strokes. Images crop inside rounded insets with `object-fit: cover` and center 42% positioning. Native controls, focus outlines, carets, scrollbars, and text selection follow semantic theme tokens.

## Components

### Buttons

Primary actions use violet fill with white text, 36px minimum height, 8px 12px padding, and 7px corners. Hover mixes 10% black into the fill. Secondary buttons use raised surfaces with thin borders; ghost buttons gain an inset surface on hover. Danger actions use the dedicated danger fill. Disabled controls fade and retain the not-allowed cursor. Keyboard focus keeps the global 2px accent outline and 4px offset.

### Chips

Permission/status badges show factual record state. Global neutral badges use elevated fill, muted text, 6px corners, and 3px 8px padding. Card badges are smaller: 9px text, 17px minimum height, 4px corners, and 3px 5px padding. Verified states use the success tint and text.

### Cards / Containers

Section cards and settings sections use a 10px radius, surface fill, thin border, and no shadow; base section-card padding remains 28px. Library count panels use a 9px radius and 14px 16px padding. Media cards follow the supplied solid inset-image reference: 17px shell, 12px image, a 1px theme-specific border, readable metadata below, actual metrics, and a small capsule action. Their dedicated fill is white in light mode and #2A2C3B in dark mode; the border is #DCD9EB and #48465F respectively. The image remains clickable; selection and a visible more menu retain full record actions.

### Inputs / Fields

Standard form fields retain a 42px minimum height, 10px 12px padding, 9px corners, and thin border. The shell search is a 32px-high launch control, 284px wide on desktop and 236px at 1080px. Library search and selects use 33–35px minimum heights with 6px corners. Fields keep descriptive labels, readable placeholders, accent carets, and a visible focus outline. Mobile library filters wrap while retaining all controls.

### Navigation

Workspace, Production, and Workspace settings organize real destinations. Desktop nav rows are 35px high with 8px 10px padding; mobile rows are 43px high. Resting labels use primary text and muted icons. Active rows use a neutral elevated background, stronger text, and a violet icon. The footer's personal workspace control opens Settings. The utility header retains a functional search palette, factual engine state, and persistent light/dark/system choice; system mode follows operating-system changes.

### Theme selector

The compact header track has a 6px radius and 2px padding. Each desktop choice is 27px square with 4px corners; the selected choice uses the raised surface and a violet icon. Mobile choices grow to 30px. All icon controls retain accessible names and pressed state.

## Do's and Don'ts

### Do:

- Do use the semantic variables in dashboard/src/theme/tokens.css for shared UI.
- Do follow the supplied Nexus hierarchy and brand colors with the real ShortForge identity.
- Do keep five cards as the desktop maximum and preserve the shorter inset thumbnails.
- Do use the Apple system font where available, bundled Inter elsewhere, and Lucide icons.
- Do show actual library counts, truthful states, and useful empty-state actions.
- Do preserve all routes, keyboard access, focus treatment, and reduced-motion behavior.

### Don't:

- Don't replace the gradient light canvas with a flat pure-white page.
- Don't restore the removed creative-workflow footer or the earlier six-column grid.
- Don't copy finance charts, fake accounts, browser chrome, or invented metrics from the reference.
- Don't put metadata over busy thumbnails or stretch the compact cards into tall portrait panels.
- Don't use unlicensed font downloads, remote font dependencies, or gratuitous glass effects.
- Don't change theme geometry or remove core creation, navigation, or editing routes on mobile.
