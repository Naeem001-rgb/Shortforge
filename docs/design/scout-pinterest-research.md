# Scout popup — October 7, 2026

The user asked to replace the basic extension panel using Pinterest ideas. This redesign concerns Scout only; the Library and Studio retain their existing appearance and all scouting criteria remain available.

## References inspected

- [Recording extension popup](https://www.pinterest.com/pin/94294185932538602/): directly selectable mode controls, clear selected state, an anchored primary action. The useful lesson is how a compact tool communicates its current configuration.
- [Dark Reader extension popup](https://www.pinterest.com/pin/680676931154701801/): aligned controls and economical grouping. Scout keeps its own readable type and comfortable targets instead of copying the older dense styling.
- [Dark analytics dashboard](https://www.pinterest.com/pin/493988652870598308/): neutral surface layers and violet focus. Scout uses those principles without decorative graphs or invented statistics.

Pinterest page previews were downloaded and visually inspected under `.impeccable/research/scout/`. They are research references, not bundled artwork. The regular browser surface was unavailable and the web fetcher rejected the pin pages; public Pinterest page metadata and preview images were accessible with a normal read-only request.

## Applied principles

1. Use ShortForge's existing violet identity for actions and selection.
2. Give the small tool a clear frame and distinct settings regions.
3. Put all four discovery choices in a visible two-column selector.
4. Preserve native radio keyboard behavior and input semantics.
5. Keep both custom count fields above the action dock at 392×600.
6. Use at least 14px for body/helper copy and 40px interactive targets.
7. Keep account, caption and speech settings directly reachable by scrolling.
8. Distinguish running, paused, complete, disabled and error states with real state data.
9. Pair light/dark colors while preserving the layout.
10. Bundle the existing open-license Inter font locally; no runtime font or artwork requests.

The three patterns are a compact branded header with a named Library action, a native radio selector with clear selected surfaces, and grouped criteria above a persistent session-control dock. The surface contract is `.impeccable/surfaces/extension-static-popup-html.md`.
