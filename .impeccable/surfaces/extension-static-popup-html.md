---
version: 1
slug: "extension-static-popup-html"
primary_target: "extension/static/popup.html"
related_targets: ["extension/static/popup.css","extension/src/popup.ts"]
---

# Scout popup redesign

Mode: Operate. Scope: extension popup only, 392×600 Chrome popup, light/dark system themes. The user delegated Pinterest research, selection and implementation. Preserve every scouting mode, numeric limit, account source, caption policy, session action and diagnostic; no dashboard or engine changes.

## Direction contract

THESIS: A compact Scout console makes selecting a discovery policy feel deliberate and keeps count limits immediately reachable. Replace the loose, long radio form with a visibly grouped control surface.

OWN-WORLD: Carry ShortForge's pinned violet identity into Scout: charcoal outer frame, inset neutral surfaces, lavender selection ink, violet action fill, locally bundled Inter. Light mode uses the same geometry with white and pale gray. Native radio, input and select semantics remain.

STORY: Choose one of four modes, set custom engagement minimums, point at an account, adjust caption rules, start. During scouting the session replaces configuration and makes progress and the last decision legible.

FIRST VIEWPORT: A compact brand header with an explicit Library action; a two-by-two mode selector below a short task heading; selected-mode guidance; paired count fields. All four choices and count fields above the fixed start/pause/stop dock. Account and caption controls form clearly labeled subsequent groups. No collapsed settings or ornamental hero. Every button target at least 40px, body and helper text at least 14px.

FORM: Grounded list: 1 editing inspector, 2 broadcast switcher, 3 library index, 4 filming shot list, 5 media remote, 6 system preferences console, 7 discovery inbox. Assignment 6, seed 9ae80ea3. System preferences console wins for familiar grouped controls and distinct selected state, translated through ShortForge's existing violet brand. Code-led implementation of functional controls; the user's delegated selection overrides an additional concept approval round.

Signature interaction: native keyboard radio navigation moves a strong selected surface/check mark; settings remain editable without extra disclosures, running state gives the session the visual focus. 180ms state-color and press transitions; reduced motion disables them.

Challenger judgments: split-flap and transit diagram declined (both obscure a settings task); keep stable alignment and unmistakable selected state. Reference-setting declined (compact form needs familiar sans controls); keep disciplined spacing. Streaming wall declined (there is no poster collection in the popup); keep clear focus. Warm consumer surface competitive for task clarity but loses the pinned brand's compact workspace character; keep generous touch targets. Boarding-pass board declined (no timed departures); keep durable state feedback. No challenger imagery or borrowed motifs ship.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Research

Pinterest 94294185932538602: recording extension, compact selected controls and anchored primary action. Pinterest 680676931154701801: Dark Reader popup, aligned settings density. Pinterest 493988652870598308: dark analytics dashboard, clear neutral layers and restrained violet emphasis. Public Pinterest preview assets inspected locally under .impeccable/research/scout; research only, no artwork bundled. Preserve real product content and use no invented metrics or graphics.
