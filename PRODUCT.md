# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Three Singapore public-transport commuter personas, targeted equally (this app deliberately goes beyond the source brief, which asks teams to choose only one — see Positioning):

- **Rachel** — fixed-schedule professional commuting Tampines → Raffles Place, 07:40 daily. Wants to be interrupted only for delays of 15+ minutes, and wants one-line guidance, not a status dump.
- **Arjun** — flexible multi-modal worker commuting Punggol → one-north. Optimizes for comfort and crowding avoidance over raw speed; cares about bike accommodation on his route.
- **Mdm Lim** — accessibility-constrained traveler commuting Bedok → Singapore General Hospital fortnightly. Needs advance planning, large text, lift/exit warnings, and sheltered routes.

## Product Purpose

A mobile-first Singapore public transport journey planner that delivers proactive, personalized transit advice during disruptions — recommending concrete *actions* ("Take the 190 from Bt Batok, +11 min") rather than just reporting status. Originally built for the NebulaX Hackathon PS2 brief ("Smart Commuter Companion"), with intent to continue development beyond the hackathon rather than treat it as a one-off demo.

## Positioning

The source brief (NebulaX Hackathon, Problem Statement 2 — https://github.com/aochinwen/NebulaX-Hackathon-ProblemStatement/tree/main/PS2) explicitly frames the three personas as "choose one." This product deliberately goes further, serving all three with genuinely distinct functional behavior (not just cosmetic labels) — differing alert thresholds, text scale, and departure flexibility per persona. This is a conscious over-delivery decision with an accepted trade-off: the brief's "Problem Fit → persona fit" judging criterion may read broader persona coverage as diluted focus rather than depth on one persona. The mechanism a competitor targeting only one persona could not truthfully claim: one app that behaves meaningfully differently depending on who's using it, backed by live official government data with honest live/demo disclosure throughout.

## Operating Context

**Mandatory capabilities (per brief; missing any one caps Technical Execution at rubric level 3):**
1. Multi-modal route planning (rail, bus, walk, **cycle**) door-to-door, responsive to live conditions, with visible timing uncertainty. Note: the cycling leg is not yet implemented — this was previously tracked only as an "Arjun-specific" nice-to-have, but the brief makes it a mandatory capability for the whole app, not persona flavor.
2. OpenStreetMap as the geospatial foundation, with proper attribution ("© OpenStreetMap contributors") kept visible on every map instance.
3. Visualization legible on a phone screen in one second: affected route portions, alternatives, and crowding must all read at a glance.

**Live data sources:**
- LTA DataMall: `TrainServiceAlerts` (disruptions + mitigations), `PCDRealTime`/`PCDForecast` (crowding), `v3/BusArrival`, `v2/FacilitiesMaintenance` (lift status)
- data.gov.sg: weather forecasts, public holidays, school terms
- OpenStreetMap: footways, stairs, lifts, covered walkways, cycle paths
- OneMap: live public-transport itineraries plus first-mile cycling geometry, time, distance, and turn instructions

**Critical design/operating constraints:**
- Mobile-first — judges test on real phones, not desktop emulation.
- Offline graceful degradation required (underground = no signal is a real, expected condition, not an edge case).
- Web app only — no native builds.
- Must respect every data source's terms of use and rate limits.
- No API credentials may ever be committed to the repository.
- Every claim must be verifiable; any mocked/demo data must be clearly labeled as such, never presented as live.

**Judging rubric (0–5 scale), for context on what "success" means here:**
- Problem Fit (40%): real commuter value, persona fit, proactivity
- Technical Execution (35%): live-condition routing on OSM, data breadth, a working system
- Ease of Use (25%): one-handed mobile browser usability, information hierarchy, accessibility

**Beyond the brief:** optional AI use (service-notice parsing, duration prediction, routine learning, voice interaction) scores extra if it measurably improves the commuter experience; open innovation earning real value is also creditable.

## Capabilities and Constraints

Confirmed and built:
- Live bus arrivals, train status/crowd, and lift-maintenance status via LTA DataMall.
- Live multi-modal public-transit routing via OneMap.
- Integrated bike-and-ride routing: cycle to a useful MRT connection, secure the bicycle, then continue by train/bus and walking, with one combined itinerary, map preview, scoring, and step-by-step guidance.
- Comfort-first conditional cycling preferences: selected crowding, wait-time and disruption triggers can promote bike-and-ride only when weather, infrastructure, parking, distance and extra-time constraints pass. Positive and negative recommendation explanations are shown on route cards.
- Live weather via data.gov.sg.
- Persona-driven behavioral differences (not just visual): Rachel's alert-threshold filtering, Mdm Lim's large-text scaling, Arjun's flexible departure window.
- Multiple saved commute routines (add/edit/delete), not just one.
- Offline / no-signal demo mode, toggleable for judging.
- Honest "LIVE" vs "DEMO DATA" source labeling everywhere data is shown — every fetch degrades to bundled mock data on failure without crashing, but never disguises itself as live.
- Non-color-dependent 3-tier crowd visualization (filled-bar glyphs, not just color).

Explicitly not yet built (see known gaps in `CLAUDE.md`):
- LRT line-code (`STL`/`SLRT`) canonical mapping.
- `@google/genai` is an installed but unused dependency.

Terminology: "LIVE" and "DEMO DATA" are the app's standing vocabulary for real vs. fallback data — keep this pair rather than inventing synonyms.

## Brand Commitments

Name: "Transit Companion." No other brand identity is established yet — no logo, no fixed voice, no committed visual language. `package.json` still carries the generic AI Studio export name (`react-example`) and `README.md` is unedited AI Studio boilerplate; both are known gaps, not intentional brand choices.

## Evidence on Hand

- The hackathon brief itself (fetched and quoted above) is the primary source of truth for scope, personas, and judging criteria: https://github.com/aochinwen/NebulaX-Hackathon-ProblemStatement/tree/main/PS2
- All transit data is real, live, official Singapore government data (LTA DataMall, data.gov.sg, OneMap) when configured — no fabricated testimonials, case studies, benchmarks, or pricing exist and none should be invented.

## Product Principles

1. **Persona-driven means functional, not cosmetic.** Differences between Rachel, Arjun, and Mdm Lim must change what the app actually does (thresholds, scaling, routing behavior), not just relabel the same experience three ways.
2. **Never let demo data pass as live.** Every data surface must disclose its source honestly; graceful fallback is required, silent misrepresentation is not acceptable under any circumstance.
3. **One-second legibility, one-handed, on a real phone.** Design and build mobile-first for real device use, not a shrunk-down desktop layout.
4. **Mandatory capabilities are load-bearing, not checkboxes.** Route planning (including cycling), the OSM foundation, and at-a-glance visualization are the product's core, not optional polish.
5. **Built to outlast judging day.** Since development continues past the hackathon, avoid shortcuts whose cost would just be deferred — technical and design decisions should hold up under real, ongoing use.

## Accessibility & Inclusion

No formal accessibility standard (e.g. a specific WCAG level) has been set by the brief or the user. Accessibility is explicitly part of the brief's "Ease of Use" judging criterion (25%: one-handed mobile usability, information hierarchy, accessibility) without a named compliance bar — treat it as a real, judged requirement, not a nice-to-have, using best-effort practice. Known concrete needs, driven by Mdm Lim's persona: large-text scaling, non-color-dependent status/crowd indicators, step-free and lift-aware routing, and support for advance trip planning.
