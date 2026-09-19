---
name: Transit Companion
description: A mobile-first Singapore transit instrument that reads like a calibrated gauge and adapts to whoever is holding it.
colors:
  deep-blue: "#0050cb"
  bright-blue: "#0066ff"
  white: "#ffffff"
  near-white-lavender: "#f8f7ff"
  pale-blue: "#dae1ff"
  near-black-navy: "#001849"
  royal-blue: "#003fa4"
  slate-blue: "#3f608c"
  sky-blue: "#abcbfe"
  dark-slate-blue: "#345581"
  pale-sky-blue: "#d4e3ff"
  soft-sky-blue: "#a8c8fb"
  deep-navy: "#001c3a"
  deep-slate-blue: "#264873"
  forest-green: "#006835"
  bright-green: "#118347"
  pale-mint: "#e6ffe7"
  light-mint: "#92f8af"
  soft-mint: "#76db95"
  deep-forest-green: "#005229"
  off-white: "#f7f9fc"
  light-gray: "#d8dadd"
  pale-gray: "#f2f4f7"
  soft-gray: "#eceef1"
  muted-gray: "#e6e8eb"
  deep-muted-gray: "#e0e3e6"
  near-black: "#191c1e"
  dark-slate-gray: "#424656"
  medium-gray: "#626674"
  pale-gray-blue: "#c2c6d8"
  deep-red: "#ba1a1a"
  pale-red: "#ffdad6"
  dark-red: "#93000a"
  crowd-green: "#0f9d58"
  crowd-amber: "#b5750a"
  crowd-red: "#c22a2a"
typography:
  display:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.4
  caption:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.3
rounded:
  sm: "12px"
  md: "16px"
  lg: "28px"
  full: "9999px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.bright-blue}"
    textColor: "{colors.white}"
    typography: "{typography.body}"
    rounded: "{rounded.full}"
    padding: "14px 16px"
  button-primary-hover:
    backgroundColor: "{colors.deep-blue}"
    textColor: "{colors.white}"
    typography: "{typography.body}"
    rounded: "{rounded.full}"
    padding: "14px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.near-black}"
    rounded: "{rounded.full}"
    height: "44px"
    width: "44px"
  card-default:
    backgroundColor: "{colors.white}"
    textColor: "{colors.near-black}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "16px"
  chip-badge:
    backgroundColor: "{colors.bright-blue}"
    textColor: "{colors.white}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "2px 10px"
  input-field:
    backgroundColor: "{colors.pale-gray}"
    textColor: "{colors.near-black}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
---

# Design System: Transit Companion

## Overview

**Creative North Star: "The Considerate Readout"**

Transit Companion is built like an instrument, not a lifestyle app: a calibrated gauge that tells the truth about what it knows, and admits plainly when it doesn't. It reads first, decorates never — everything from the crowd-tier bars to the route duration is designed to be understood in one glance, one-handed, on a real phone screen, because that's the actual condition it will be used under (walking to a bus stop, standing on a train, underground with no signal). That glanceability is not negotiable; whatever else changes, "can a user understand what's happening in one second" is the test every screen has to pass.

Within that instrument-like honesty, the app is quietly considerate: it reconfigures itself around whoever is holding it — larger text and lift warnings for Mdm Lim, a filtered alert threshold for Rachel, a flexible departure window for Arjun — without ever making a show of the adaptation. The personalisation is a property of the data and layout, not a decorated "personalised for you!" banner.

The voice throughout is precise and matter-of-fact — clean numeric readouts ("24 min", "Arr"), terse status language, no gamification, no streaks or badges competing for attention. But it isn't cold: small moments (the LIVE pulse dot, a press that visibly compresses, a route card settling into place) carry a little warmth without ever slowing the reader down or getting in the way of the information.

**Key Characteristics:**
- Reads like a calibrated instrument: numeric, honest about live vs. demo data, glanceable in one second.
- Quietly personalises around the current persona instead of announcing that it has.
- Flat and quiet at rest; every interactive element gives an immediate, tactile response the moment it's touched.
- Precise, matter-of-fact voice with occasional warmth in small, deliberate moments — never at the expense of legibility.
- Material Design 3's full role-based token system (primary/secondary/tertiary/surface/error, each with container and "fixed" variants) as the underlying color architecture — not custom-named brand hues.

## Colors

The palette is Material Design 3's full role-based system: one primary action color, one secondary accent, one tertiary (status-positive) color, a wide neutral/surface scale, and a dedicated error role — plus a small, separate signature palette just for the accessibility-critical crowd-level indicator.

### Primary
- **Deep Blue** (`#0050cb`, role `primary`): The single most important action color — active navigation state, primary text links, the "start guidance" affordance.
- **Bright Blue** (`#0066ff`, role `primary-container`): Primary button fills, the "BEST MATCH" route badge, the service-number avatar on bus arrival cards.
- **Pale Blue** (`#dae1ff`, role `primary-fixed`) / **Royal Blue** (`#003fa4`, role `on-primary-fixed-variant`): Reserved for fixed-tone surfaces that must not shift with light/dark theme state.

### Secondary
- **Slate Blue** (`#3f608c`, role `secondary`) / **Sky Blue** (`#abcbfe`, role `secondary-container`): The "FASTEST" route badge, secondary highlight banners (personalised-highlight strip on route cards), stop-code chips.
- **Pale Sky Blue** (`#d4e3ff`, role `secondary-fixed`) / **Soft Sky Blue** (`#a8c8fb`, role `secondary-fixed-dim`): Preference-toggle badges and other small fixed-tone accents.

### Tertiary (status-positive)
- **Forest Green** (`#006835`, role `tertiary`) / **Bright Green** (`#118347`, role `tertiary-container`): "Normal service," low-crowd states, the LIVE pulse dot, confirmed-routine checkmarks.

### Neutral / Surface
- **Off-White** (`#f7f9fc`, roles `surface` / `background`): The app's page background beneath every card.
- **White** (`#ffffff`, role `surface-container-lowest`): Card, sheet, and input-container backgrounds.
- **Pale Gray** (`#f2f4f7`) → **Deep Muted Gray** (`#e0e3e6`): The `surface-container` ramp, low to highest — used to separate nested surfaces (e.g. an input field inside a card) without a visible border.
- **Near-Black** (`#191c1e`, role `on-surface`): Primary text.
- **Dark Slate Gray** (`#424656`, role `on-surface-variant`): Secondary text, meta rows, descriptions.
- **Medium Gray** (`#626674`, role `outline`) / **Pale Gray-Blue** (`#c2c6d8`, role `outline-variant`): Icon strokes, hairline borders, and secondary meta text. Darkened from an earlier `#727687` after an audit found the lighter value failed WCAG AA contrast (4.28:1) at the 11px sizes it's used at for text; the current value clears 5.4:1.

### Status (error)
- **Deep Red** (`#ba1a1a`, role `error`) / **Pale Red** (`#ffdad6`, role `error-container`) / **Dark Red** (`#93000a`, role `on-error-container`): Reserved for system/data problems — a disrupted train line, a failed fetch — never for real-world crowding.

### Signature: Crowd-Tier Accents (separate from the theme palette)
- **Crowd Green** (`#0f9d58`), **Crowd Amber** (`#b5750a`), **Crowd Red** (`#c22a2a`): A dedicated 3-step palette that exists only to fill the crowd-level bar glyph (see Components → Crowd-Tier Indicator). Deliberately distinct hex values from Forest Green and Deep Red — this palette answers "how crowded is it," the theme palette answers "is something wrong with the system."

### External, read-only: MRT line colors
Individual MRT line colors (e.g. the official color of each line, driven by `LineSummary.color` from live data) are rendered directly from data via inline styles, not from this token system. They are fixed external facts about the Singapore rail network, not part of the app's own expressive palette — never substitute a theme color for a line's real color or vice versa.

### Named Rules
**The One Action Rule.** Bright Blue / Deep Blue mark the single most important action on a screen. A screen with more than one element competing in Blue has not made a choice — status meaning (green/amber/red) carries information elsewhere and should never compete with it.

**The Two Reds Rule.** Deep Red (`error`) means something is wrong with the system or the data (a disruption, a failed fetch). Crowd Red means the real world is simply crowded right now. They must never be swapped for each other — a full train is not a system error, and a data outage is not "high crowding."

## Typography

**Font:** Inter, falling back to the OS system stack (`-apple-system, BlinkMacSystemFont, sans-serif`) — a legible, native-feeling instrument face, not a brand display font.

**Character:** Functional and glanceable over literary. Notably, this system's "Body" role is bolder (weight 600) than a typical reading-body text — because most of what a user reads here is a scanned label or a card title, not a paragraph. Actual paragraph-weight reading text (descriptions, explanations) lives one step down, at Caption size and regular weight.

### Hierarchy
- **Display** (700, 24px, 1.0 line-height, -0.01em tracking): Hero numeric moments only — a route's total duration, a bus's arrival countdown. Tight line-height keeps these numbers reading as a single instrument readout.
- **Title** (700, 16px, 1.3 line-height): Screen headers (top app bar title), modal/sheet titles.
- **Body** (600, 14px, 1.4 line-height): Card titles and primary labels — bus destination, route summary, preference-toggle title. Bolded by default; this is a scanned label, not prose.
- **Caption** (400, 12px, 1.5 line-height): The system's actual paragraph-weight text — descriptions, explanations, meta rows (transfer count, walking time, "Following: 8m").
- **Label** (600, 11px, 1.3 line-height): Chips, nav labels, small badges. A few uppercase eyebrow headings (e.g. "Live Arrivals," section headers in Profile & Preferences) sit slightly larger at 12px, bold, uppercase, tracked — a deliberate emphasis exception, not a separate scale step.

### Named Rules
**The Scan, Don't Read Rule.** Default text weight leans bold (Body is 600, not 400) because this app is used while walking or standing, glanced at rather than settled into. Reserve regular weight (Caption) for the handful of places someone genuinely reads a sentence.

## Layout

A single fixed mobile viewport (`max-width: 430px`), not a responsive multi-column layout — designed once, for a phone, matching the brief's mobile-first requirement directly (judges test on real phones). Content scrolls in one column; drill-down screens push in as a new full-screen view or a bottom sheet, never a side panel. Spacing follows Tailwind's 4px-based scale in practice as `sm` (8px, tightly related inline items), `md` (16px, the standard card padding and inter-block gap), and `lg` (24px, between major page sections).

## Elevation & Depth

Flat by default, depth reserved for overlays — nearly every surface uses one subtle shadow class (`card-shadow`: two very soft layered shadows, ≤0.04 opacity) that barely lifts a card off the page. That restraint breaks on purpose for the one class of surface that floats above everything else: bottom sheets and modals use `custom-sheet-shadow` (a much stronger shadow, up to 0.12 opacity) paired with a blurred backdrop scrim. If two surfaces carry the same shadow weight, they should carry the same stakes.

Depth alone isn't the whole story here: interaction itself needs to read as depth. Every element the user can act on should give an immediate, physical-feeling response the instant it's touched — a press that visibly compresses (`active:scale-95`/`98`), a hover state that isn't just a color swap. The app already does this in ~17 places via Tailwind's `transition-all` and `active:scale-*` utilities; the intent going forward is to extend this further and more expressively, not just as press-feedback but as small moments of real delight (see Motion below) — the kind that make routine actions (confirming a route, starting guidance) feel satisfying enough to want to come back to.

### Shadow Vocabulary
- **Resting** (`card-shadow`: `0 1px 3px rgba(0,0,0,0.03), 0 4px 12px rgba(14,53,95,0.04)`): Default state for nearly every card, toggle, and route option.
- **Sheet** (`custom-sheet-shadow`: `0 -8px 30px rgba(14,53,95,0.12), 0 -2px 8px rgba(0,0,0,0.04)` + backdrop blur): Bottom sheets and modals only — the app's one deliberately "heavy" surface.

### Motion
No dedicated motion vocabulary exists yet beyond CSS transitions and Tailwind's `animate-in`/`animate-pulse` utilities (sheet slide-ins, the LIVE status dot's pulse, generic hover/press transitions). The `motion` (Framer Motion) package is already an installed dependency but currently unused anywhere in the codebase — it's the natural tool to reach for when building out the richer, joy-bringing micro-interactions this system now calls for (e.g. a route card settling into place on confirm, a satisfying transition into guidance mode). This is a stated direction for upcoming work, not yet implemented; see `.impeccable/design.json` → `extensions.motion` for concrete starting values.

### Named Rules
**The Weight-Matches-Stakes Rule.** Shadow depth is a signal of consequence, not decoration. A routine card floats lightly; a bottom sheet or modal — the moment that takes over the screen — is allowed real depth.

**The Felt Response Rule.** Every element a user can act on must respond immediately and physically to being touched (compression, lift, or an equivalent tactile cue) — never a bare color swap alone. Purely informational elements (a timestamp, a static meta row) must NOT get this treatment; motion there would falsely imply they're tappable.

## Shapes

Corner radius is deliberately split by role:
- **Cards, containers, service-number avatars:** 16px (`rounded-2xl`) — the default "informational surface" corner.
- **Input containers, highlight banners, the map-preview toggle:** 12px (`rounded-xl`) — a slightly tighter corner for content nested inside a card.
- **Chips, pills, primary CTA buttons, the toggle switch, origin/destination dot markers:** fully rounded (`rounded-full`) — always, no exceptions, across every semantic chip variant and every pill-shaped button.
- **Bottom sheets:** 28px on the top corners only (`rounded-t-[28px]`) — a deliberately larger radius than any other surface, reinforcing that a sheet is a distinct, heavier kind of object sliding up from the edge of the screen.

Borders are hairline throughout (1–1.5px `outline-variant`, almost always at reduced opacity `/20`–`/30`) rather than heavy strokes; separation between nested surfaces is usually done with a background-shade shift (the `surface-container` ramp) instead of a visible border.

## Components

### Buttons
- **Primary (pill CTA):** Bright Blue fill, white text, fully rounded, ~14px vertical padding, `shadow-sm` at rest. Hover shifts to Deep Blue; press compresses to `active:scale-98`. Example: "Plan journey from this stop."
- **Ghost/icon (back, close):** Transparent background, 44px circular hit target (bumped from 36px after an audit flagged it under the mobile touch-target minimum), `hover:bg-surface-container-high`, `active:scale-95`. No visible border.
- **Text/link (skip, section actions):** No background or border; primary-colored text, subtle opacity shift on hover.

### Chips (StatusChip — signature, semantic)
Every chip is `rounded-full`, small (11px Label text), and its color is picked purely by meaning, never by position or decoration: crowd tier, traffic level, train status, "LIVE" pulse, or a route-quality badge ("BEST MATCH" = Bright Blue, "FASTEST" = Sky Blue, "SIMPLEST" = neutral gray). A chip's color is load-bearing information, not styling.

### Crowd-Tier Indicator (signature component — accessibility-critical)
A small glyph of 3 vertical bars, filled left-to-right by crowd tier (1 of 3 = Low, 2 of 3 = Moderate, 3 of 3 = High), rendered inline before the chip's text label. This exists specifically to satisfy the brief's requirement that crowding "must not rely on color alone" — the bar-fill count is the primary signal; Crowd Green/Amber/Red color is reinforcement, not the only cue. This is the single most important accessibility pattern in the app (see `crowdLevel.ts`) and must never be simplified back down to a bare color dot.

### LIVE / DEMO DATA Badge (signature component — the honesty commitment)
A small uppercase pill in the top app bar: green with a pulsing dot for `LIVE`, amber (no pulse) for `DEMO DATA`. This is the visual expression of the app's core promise — real data is never presented as if it were the same as fallback data. It must appear anywhere data could plausibly be either live or mocked, and its two states must stay visually distinct at a glance (pulse vs. no pulse, green vs. amber), not just by the text label alone.

### Cards / Containers
- **Corner Style:** 16px (`rounded-2xl`).
- **Background:** White (`surface-container-lowest`) on Off-White page background.
- **Shadow Strategy:** Resting by default; a selected/best-match card gets a 2px Bright-Blue ring plus a tinted border instead of extra shadow — selection state is communicated by border/ring, not by elevation.
- **Border:** 1–1.5px `outline-variant` at ~30% opacity; shifts to a semantic-tinted border to signal a highlighted state.
- **Internal Padding:** 16px.
- **Icon/service-number avatar badges inside a card:** tinted fill only, no border — a bordered box nested in the card's own bordered edge would read as a card-inside-a-card.

### Inputs / Fields
- **Style:** Filled, not outlined — `surface-container-low` background, 12px radius (`rounded-xl`), no visible border at rest. A small colored dot (Deep Blue for origin, Deep Red for destination) precedes the field, echoing a transit line's start/end markers.
- **Focus:** A 2px primary `focus-within` ring (offset 1px) on the input's container, since the `<input>` itself is borderless/transparent inside a filled pill — fixed after an audit found every real input previously had `focus:outline-none` with no replacement.
- **Error/Disabled:** Not yet implemented anywhere in the app — an open gap for a future pass, not an established convention.

### Navigation (bottom bar)
Fixed bar, white/surface background, hairline top border, safe-area-aware bottom padding. Active tab: Deep Blue icon (bolder stroke, slightly scaled up) and bold Label text; inactive tabs: Dark Slate Gray. An unread-alert indicator is a small amber dot on the icon corner, never a number badge or text.

### Bottom Sheet
Slides up from the screen edge, capped at the fixed 430px viewport width, 28px top-radius, `custom-sheet-shadow`, backdrop blur scrim behind it. A drag-handle bar and a mock "home indicator" bar bookend the sheet, reinforcing the native-app feel within a web app. This is the app's one deliberately heavy, high-stakes surface — reserved for genuinely modal moments (bus-stop detail, route confirmation, edit-routine), never used for routine informational content.

## Do's and Don'ts

### Do:
- **Do** reserve the Felt Response treatment (compression, lift, hover transitions) for anything a user acts on; keep purely informational elements motionless.
- **Do** keep the crowd-tier bar glyph wherever crowd level is shown — color alone is never sufficient per the brief's own accessibility requirement.
- **Do** keep the LIVE/DEMO DATA badge visually binary (pulse vs. no pulse) everywhere data could be either.
- **Do** use the `surface-container` shade ramp to separate nested surfaces before reaching for a visible border.
- **Do** treat MRT line colors as fixed, external, read-only facts — never approximate them with a nearby theme color.
- **Do** give every real text input a visible `focus-within` ring (2px primary, offset 1px) — every input in the app now does this; keep it on any new one.
- **Do** keep interactive hit targets at 44×44px minimum, even when the visible icon inside is smaller.

### Don't:
- **Don't** use Deep Red (system error) and Crowd Red (real-world crowding) interchangeably — they answer different questions.
- **Don't** apply Felt Response motion to a static meta row, timestamp, or label — it falsely implies the element is tappable.
- **Don't** let text render below 11px (Label) for anything functional — an audit pass swept the app's remaining 9–10px instances up to 11px; the floor now holds with zero exceptions, keep it that way.
- **Don't** introduce a new accent hue outside the existing Material-3 role set without a genuine new semantic meaning for it to carry.
- **Don't** let a judging/demo-only control sit at the same visual weight as a real setting — collapse it behind a closed disclosure, as the two "Judging tools" sections now do.
- **Don't** reach for a literal-pixel arbitrary text size (`text-[11px]`) when a rem-based Tailwind size utility would do — only rem-based sizes respond to Mdm Lim's large-text mode, which now scales the root font size rather than using `zoom`.
