# Handoff: Claude Code → Codex

Generated 2026-09-19. This session is transitioning from Claude Code to Codex. Everything below is the state of the **Transit Companion** project (`/Users/nathankhaw/Documents/GitHub/transit-companion`) at handoff time.

**Read `CLAUDE.md` first** (same directory) — it's the project's own standing instructions file and still applies. This document does not replace it; it supplements it with what's changed since it was last updated, and with this session's specific in-flight state. See [Context Sync](#context-sync) below for exactly where `CLAUDE.md` is now stale.

---

## 1. Current Objective & Status

**Project**: A mobile-first Singapore public transport journey planner built for the NebulaX Hackathon PS2 brief ("Smart Commuter Companion"). Three commuter personas — **Rachel** (fixed-schedule, Tampines→Raffles Place), **Arjun** (flexible multi-modal, Punggol→one-north), **Mdm Lim** (accessibility-constrained, Bedok→SGH fortnightly) — are all served with genuinely distinct, live-data-driven behavior (this is a deliberate over-delivery vs. the brief's "pick one persona" framing; see `PRODUCT.md`).

**What this session did, in order:**
1. Redesigned Rachel's home screen (`RachelHomeScreen.tsx`) to match a set of Telegram-shared mockups: routine/leave-later/rain-disruption/recommended-reroute/active-journey states, all computed from live OneMap + LTA data, with a judging-controls panel rendered *outside* the phone frame (desktop only).
2. Did the same for Arjun (`ArjunHomeScreen.tsx`) and Mdm Lim (`MdmLimHomeScreen.tsx`) — each with their own scenario set, own live-data sourcing, own honesty rules for when a claim ("sheltered", "accessible") is actually verifiable from live data vs. not.
3. Extracted shared pieces as the pattern repeated across personas: `PersonaJudgingPanel.tsx` (generic judging-controls panel), `JourneyProgress.tsx` (the "active journey in progress" step-card UI, used by Rachel and Mdm Lim), `journeyMath.ts` (clock/line/schedule helpers), `DataBadge.tsx` (LIVE/DEMO badge).
4. Made teal (`theme-teal` in `index.css`) the **app-wide default theme**, including the onboarding quiz, which was fully restyled to match (bigger touch targets, new header/progress bar, consistent card language).
5. Collapsed the bottom nav to 3 tabs everywhere — **Journey / Plan / Profile** — folding the old Alerts tab's content into Plan.
6. **Fixed a real honesty bug**: `/api/nearby-live` was hardcoded to a Kent Ridge bus-stop cluster for *every* persona, so Arjun/Mdm Lim/Rachel's "Live Nearby Transit" card showed transit nowhere near their actual homes. Now it takes `lat`/`lng`, queries the genuinely nearest live bus stops, and drops a previously-hardcoded fake Kent Ridge train estimate for any non-default location. Centralized persona home coordinates in `src/data/personaHomes.ts`.
7. **Added door-to-door planning**: Journey Planner previously only accepted MRT station names. Added `/api/geocode` (proxies OneMap's public address/building search) + `src/services/geocodeService.ts` + updated `JourneyPlannerScreen.tsx` so any real Singapore address/building can be searched and selected, merged with the existing MRT-name autocomplete.

**Status right now**: Everything above is implemented, type-checks clean (`npm run lint`), builds clean (`npm run build`), and was **verified working in a live browser against the running dev server with real LTA/OneMap/data.gov.sg data** (not just unit-level — actual clicked-through UI flows, e.g. searching "Fusionopolis" and getting a real OneMap route back).

**Status of downstream artifacts** — all three are now **behind** the working tree and need refreshing once the user says go:
- **Git**: `transit-companion` itself is *not* a git repo. The established pattern is to sync it into `~/Documents/GitHub/mindthegap` (a real git repo, remote `inesgutierreztee/mindthegap`, branch `prototype-1`). The last commit there (`2e5be78`) predates *everything* in this session — see the file list in §3.
- **Cloud Run**: `https://transit-companion-754090303197.asia-southeast1.run.app` is running a build from earlier in the day that has the persona redesigns + the nearby-live fix, but **predates** the onboarding teal restyle and the door-to-door geocoding feature.
- **Zip handoff to teammate**: `~/Desktop/GYG.zip` was built before the onboarding restyle and geocoding work too, same as Cloud Run.
- The user explicitly said pushing to git "can wait" earlier in the session — **do not push/deploy without the user asking**, per this project's standing risk posture (see `CLAUDE.md` §Git and this file's own instructions below).

---

## 2. Key Architectural Decisions

- **Per-persona home screens, not one generic screen.** Each persona gets its own `src/screens/<Name>HomeScreen.tsx`, entirely driven by live data (OneMap `/api/route-plan` + `/api/multimodal-route-plan`, LTA `BusArrival`/`PCDRealTime`/`PCDForecast`/`FacilitiesMaintenance`, data.gov.sg weather). This is intentional over-delivery vs. the brief (see `PRODUCT.md` → Positioning) — the whole point is *functional*, not cosmetic, persona differences.
- **Judging-demo scenarios are a typed, labelled override layer, never silent fakery.** Each persona has a `<Name>Scenario` type in `src/types.ts` (e.g. `RachelScenario = 'live' | 'routine' | 'active' | 'rain' | 'reroute'`). A scenario can pin a demo clock and/or simulate rain/crowding/a lift outage — but every such override is visibly labelled in-app via `<DataBadge tone="demo">`. This is a hard rule carried through the whole project (see `PRODUCT.md` Product Principle #2: "Never let demo data pass as live").
- **Judging controls live outside the phone frame.** `PersonaJudgingPanel.tsx` is generic over the scenario type (`PersonaJudgingPanel<T extends string>`) and renders `hidden lg:flex fixed left-6 top-6` — desktop-only, beside the phone mockup, never occupying real app screen space.
- **Shared step-progress UI.** `JourneyProgress.tsx` (+ its helpers `buildProgressCards`/`scheduleAtPace`/`currentCardKey`/`progressNotification`) implements the "your usual journey, only the current step highlighted, floating map button" pattern. Used identically by Rachel's "Active journey" scenario and Mdm Lim's "Usual journey" scenario, parameterized by walking-pace factor and destination icon/label.
- **Persona home/office coordinates are centralized**, not duplicated per-screen: `src/data/personaHomes.ts` exports `PERSONA_HOME: Record<CommuterPersona, {lat,lng}>`. Individual screens still keep their own richer constants (e.g. `RachelHomeScreen.tsx` also has `DESTINATION` for her office) with comments explaining the assumption, since the brief only specifies corridors ("Tampines to Raffles Place"), not exact addresses — **all such addresses are documented assumptions**, written up in `README.md` → "Persona assumptions".
- **Teal is now the one and only theme** (`App.tsx` root divs apply `theme-teal` unconditionally). The old conditional blue/teal split (blue default, teal only for Rachel) is gone. **The blue CSS custom properties in `index.css`'s `:root`/base layer are now dead code** — `theme-teal` always overrides them — flagged as a cleanup candidate, not yet removed (removing might affect anything that assumed blue-as-fallback; wasn't in scope this session).
- **3-tab nav for everyone**: Journey / Plan / Profile. `hasRedesignedHome` in `App.tsx` is now `true` for all three personas (i.e., always true in practice, since a persona is always selected once onboarding completes) — the old 4-tab / generic-`HomeScreen.tsx` path is effectively legacy/dead for the current onboarding flow, but `HomeScreen.tsx` itself was **not** deleted (still referenced as a fallback in `App.tsx` when `!hasRedesignedHome`).
- **Honesty-first data fixes, twice this session:**
  1. `nearby-live` endpoint: was hardcoded to Kent Ridge; now geolocated. See `server.ts` `/api/nearby-live` — cache is now keyed per rounded lat/lng (`nearbyLiveCache: Record<string, any>`), not a single global value, so personas never see each other's cached "nearby" data.
  2. Door-to-door geocoding: a typed address is **only** ever resolved to coordinates by the user clicking a real OneMap search result (`pickedOrigin`/`pickedDestination` state in `JourneyPlannerScreen.tsx`) — never guessed from free text. This mirrors how `resolveStationCoords` already worked for MRT names, just extended to arbitrary addresses.
- **`/api/geocode` implementation notes**: proxies OneMap's public `common/elastic/search`. Works **unauthenticated** (verified via direct curl), but the endpoint still calls `getOneMapToken()` and sends it when available, in case OneMap tightens this later. Strips a leading `"Blk "`/`"Block "` token before searching (OneMap's index doesn't match it, and that's how most people write Singapore addresses) — see the regex in `server.ts`. Results are de-duplicated by rounded lat/lng (many OneMap results are different shops/units at the same building) and capped at 8, cached in-process for 10 minutes per query string.
- **Dev-loop gotcha, load-bearing for anyone continuing this session's workflow**: the dev server visible in the browser at `localhost:3001` was started **in the user's own terminal**, not by any agent-controlled process — the agent's own shell/sandbox in this session could not reliably bind ports or reach `localhost` itself (hit `EADDRINUSE`/`EPERM` errors attempting to run `npm run dev` directly; agent and user terminal share a filesystem but not a network namespace). It also appears **HMR/file-watching is disabled** on that running process (every single edit, including pure frontend `src/` changes with zero `server.ts` involvement, required a full process restart to show up — no exception was observed). **The reliable way to force a reload this session was `touch server.ts`** (tsx watch always restarts on that file changing) followed by waiting ~5–6s before re-testing. Verification of changes was done via a **live browser automation tool driving the user's real Chrome**, not via `curl localhost` from the agent's own shell (which cannot reach it). If Codex's environment has an equivalent live-browser tool, use the same pattern; if not, ask the user to hard-refresh and report back rather than trying to self-verify over HTTP from the agent shell.

---

## 3. Active / Modified Files

Every file below has been modified since the last git commit reachable from `mindthegap`'s `prototype-1` branch (`2e5be78`, 2026-09-19T03:49:59+08:00) — i.e., **all of it is currently un-synced to git, un-deployed to Cloud Run, and not in the zip already shared with the teammate.**

**New files this session:**
- `src/components/DataBadge.tsx` — shared LIVE/DEMO badge
- `src/components/JourneyProgress.tsx` — shared "active journey" step-card UI
- `src/components/PersonaJudgingPanel.tsx` — generic judging-controls panel
- `src/components/PlanSearchCard.tsx` — extracted "Where to?" search card (was inline in `HomeScreen.tsx`)
- `src/components/NearbyLiveTransit.tsx` — extracted nearby-transit card (was inline in `HomeScreen.tsx`)
- `src/screens/RachelHomeScreen.tsx`
- `src/screens/ArjunHomeScreen.tsx`
- `src/screens/MdmLimHomeScreen.tsx`
- `src/data/personaHomes.ts`
- `src/utils/journeyMath.ts` — shared clock/line/schedule helpers
- `src/services/geocodeService.ts` — client for `/api/geocode`

**Modified files this session** (non-exhaustive summary of *why*; see §2 for the reasoning):
- `server.ts` — added `/api/geocode`; made `/api/nearby-live` location-aware (lat/lng param, nearest-stop lookup, per-location cache, dropped the hardcoded Kent Ridge train estimate for non-default locations); added `walk` mode to `/api/route-plan` (alongside existing `transit`/`cycle`) for computing real walking legs; minor `getTerminusName`/bus-arrival plumbing touched in service of the above.
- `src/App.tsx` — wires in all three persona home screens + their judging panels + scenario state; `theme-teal` now unconditional; 3-tab Plan-tab layout (search + nearby-transit + alerts + map stacked).
- `src/types.ts` — `RachelScenario`, `ArjunScenario`, `MdmLimScenario` types; `TabType` narrowed to drop `'alerts'`.
- `src/index.css` — `.theme-teal` block (was `.theme-rachel`, renamed and made the sole theme).
- `src/components/BottomNavigation.tsx` — 3 tabs, new icons, Plan tab now carries the disruption badge.
- `src/screens/OnboardingQuizScreen.tsx` — full visual restyle to match the teal design language (new header, larger cards/touch targets, removed old `TopAppBar` dependency for this screen).
- `src/screens/JourneyPlannerScreen.tsx` — door-to-door address search (see §2); `resolveLocation()` helper added alongside the existing `resolveStationCoords`.
- `src/screens/JourneyGuidanceScreen.tsx` — removed a stray `ChevronRight` arrow from the "Up next" card (explicit user request; was the *only* "Up next" card in the app — if it still looks present to the user, they're very likely viewing a stale/cached bundle or the old Cloud Run deployment, not a real remaining bug — this was reconfirmed by diffing the served bundle by hash).
- `src/screens/HomeScreen.tsx` — now composes `PlanSearchCard`/`NearbyLiveTransit` instead of inlining them (kept as the legacy/fallback screen).
- `src/services/routingService.ts` — `fetchLiveRoutePlan`'s `routeMode` param widened to include `'walk'`.
- `src/services/ltaService.ts`, `src/services/weatherService.ts` — small honesty-related fixes earlier in the session (see git log message subjects in §1's Cloud Run commit history for the pre-session baseline; this session's changes on top were incremental, not a rewrite).
- `README.md` — added a "Persona assumptions" section documenting every real-world address/timing assumption made (Rachel's office, Arjun's home block + flexible window, Mdm Lim's home block + demo appointment + walking-pace factor) since the brief only specifies corridors, not exact addresses.

**Files referenced but intentionally left alone:**
- `CLAUDE.md` — not edited this session; see §5, it needs a refresh pass but that wasn't asked for.
- `PRODUCT.md`, `DESIGN.md` — not edited this session; still the source of truth for product principles / design tokens referenced throughout.
- `.env`, `.env.local` — never read or written by the agent (contains real API keys; out of scope/sandbox-denied by design).

---

## 4. Next Immediate Steps

In priority order. **Steps 1–2 are read-only/local verification — safe to do immediately. Steps 3–5 touch shared/external state (git push, redeploy, re-share a zip) and must not happen without the user explicitly asking**, consistent with how this session was run throughout.

1. **Re-verify the dev server is reachable and serving current code.**
   - The server is expected to already be running at `http://localhost:3001` (or `:3000`) in the user's own terminal — don't try to start a new one blind; check first, and if the environment's shell can't reach it directly (see the dev-loop gotcha in §2), use a live-browser tool.
   - If any doubt about freshness: `touch server.ts` then wait ~6s, then re-check.

2. **Smoke-test the two most recent, least-battle-tested features** (everything else was already verified in-browser this session, these two were the very last things built):
   - Door-to-door geocoding: in Journey Planner, type a non-MRT address (e.g. a building name) into either field, confirm the dropdown shows address results with a map-pin icon + full address subtitle, select one, confirm a real route comes back labelled "Live routing (OneMap)".
   - Onboarding quiz visuals: run through all 5 steps as a fresh user (`localStorage.setItem('sg_transit_quiz_done','false')` then reload) and confirm the teal restyle looks right at each step, especially step 3 (cycling preferences sub-panel) which has the most nested UI.

3. **When the user asks for it — not before:**
   - Sync `transit-companion` → `mindthegap` (`prototype-1` branch): copy the files listed in §3 over, `git add`, commit with a clear message (there's a full session's worth of work — consider whether one commit or several logical commits reads better for the branch history), push.
   - Regenerate `~/Desktop/GYG.zip` (or a fresh uniquely-named copy) for the teammate.
   - Redeploy to Cloud Run (`gcloud run deploy transit-companion --source . --region asia-southeast1 --allow-unauthenticated --min-instances=0 --set-secrets=LTA_ACCOUNT_KEY=LTA_ACCOUNT_KEY:latest,ONEMAP_TOKEN=ONEMAP_TOKEN:latest`, run from Cloud Shell against the Qwiklabs project `qwiklabs-gcp-04-4ac7be2743c8` — **this is a temporary lab session and may have expired; check before assuming it's usable**).

4. **Known follow-ups flagged but not yet actioned** (surface to the user, don't just do them):
   - Dead blue CSS tokens in `index.css` now that teal is the sole theme — candidate for cleanup.
   - `HomeScreen.tsx` (the pre-redesign generic home screen) is now unreachable in normal use (every persona has its own redesigned screen) — confirm with the user whether to delete it or keep as a documented fallback.
   - `CLAUDE.md`'s "Known gaps" and "Git" sections are stale (see §5) — worth a refresh pass once the git sync in step 3 actually happens, so it reflects reality again.

5. **General standing instruction, carried over from this whole session**: this project treats "never let demo/fallback data pass as live" as a hard rule (see `PRODUCT.md`). Any new feature work should keep that pattern — try the real API, fall back gracefully, and always expose enough of a `source`/`DataBadge` signal that the UI is honest about what's real.

---

## 5. Context Sync

**`CLAUDE.md` (repo root, unedited this session) is the project's standing instructions file and remains authoritative for anything not covered here.** Its content in full, for convenience/mirroring:

> # Transit Companion
>
> A mobile-first Singapore public transport journey planner, built for the **NebulaX Hackathon PS2** brief ("Smart Commuter Companion" — proactive, persona-targeted disruption guidance for Singapore commuters). Originally an AI Studio export; substantially built out since.
>
> ## Architecture
> - **Frontend**: React 19 + TypeScript + Tailwind v4, single-page app driven entirely by React state in `src/App.tsx` (no router — `currentView`/`activeTab` state machines).
> - **Backend**: `server.ts` is an Express server that also runs Vite in middleware mode (`tsx watch server.ts` for dev). It's not a separate deploy target — one process serves both the API and the app.
> - **Dev server**: `npm run dev` (uses `tsx watch`, so backend edits auto-reload — plain `tsx server.ts` does NOT auto-reload on backend changes, that was a real bug hit once already). Default port 3000, but if a sibling project (`mindthegap`, a related/earlier iteration of this same app) is already running there, start on another port: `PORT=3001 npm run dev`.
> - **Type-check**: `npm run lint` (just `tsc --noEmit`, no actual eslint).
>
> ## Live data sources (all with graceful mock/demo fallback if unset)
> Every fetch in this app degrades to bundled mock data on failure — never crashes, never blocks on a missing key. Set these in `.env` (see `.env.example`):
> - `LTA_ACCOUNT_KEY` — LTA DataMall: bus arrivals, train status, platform crowd, lift maintenance. Free registration.
> - `ONEMAP_TOKEN` (or `ONEMAP_EMAIL`/`ONEMAP_PASSWORD`) — OneMap: live public-transit routing (`/api/route-plan`). `ONEMAP_TOKEN` is simplest but expires ~3 days; email/password auto-refreshes. **Known quirk**: OneMap's `StationCode` param on `FacilitiesMaintenance` doesn't actually filter server-side — `server.ts` works around this by fetching the full list once and filtering locally.
> - No key needed for `/api/weather` (data.gov.sg 2-hour forecast).
> - When adding a new live-data endpoint, follow the existing pattern: try the real API, catch and fall back to mock data, and expose enough of a `source` field in the response that the UI can honestly show "LIVE" vs "DEMO DATA" — never present fallback data as if it were live (the hackathon brief explicitly penalizes this).
>
> ## Map tiles
> Use OSM's own tile server (`tile.openstreetmap.org`), not CartoDB — CartoDB's free raster tiles started requiring an API key partway through this project's life. Always keep the `© OpenStreetMap contributors` attribution control enabled on every Leaflet map instance.
>
> ## Known gaps (intentionally not built yet)
> - Arjun's persona needs a cycling leg — scoped but not implemented.
> - No LRT line-code (`STL`/`SLRT`) canonical mapping.
> - `@google/genai` is an installed but unused dependency.
> - The write-up document hasn't been written — `README.md` is still unedited AI Studio boilerplate.
>
> ## Git
> Not yet a git repository. The plan is to push finished changes to the related `mindthegap` repo on a new branch — never directly to `main`, and not until explicitly asked to.

**Where the above is now stale** (do not treat as current fact — treat this handoff and direct repo inspection as the source of truth instead):
- "Arjun's persona needs a cycling leg — scoped but not implemented" → **implemented**, multiple sessions ago (bike-and-ride is live, see `ArjunHomeScreen.tsx` and `src/data/mockCyclingData.ts`).
- "README.md is still unedited AI Studio boilerplate" → **no longer true**, `README.md` now has real content including this session's "Persona assumptions" section.
- "Not yet a git repository. ... push ... on a new branch" → `transit-companion` itself is still genuinely not a git repo, but the "push to a new branch" plan **already happened** — `mindthegap`'s `prototype-1` branch exists and has 9 commits (last: `2e5be78`). The instruction "never directly to `main`, and not until explicitly asked to" **still stands and was honored throughout** — keep honoring it.
- Default dev port guidance ("Default port 3000... `PORT=3001 npm run dev`") is accurate and matches how the server is actually running right now (`:3001`).

**For Codex specifically**: if your tooling looks for an `AGENTS.md` (or similar) rather than `CLAUDE.md`, none exists in this repo yet. Rather than silently duplicating instructions into a new file, either (a) point your equivalent config at `CLAUDE.md` directly, or (b) ask the user whether they want an `AGENTS.md` created — don't invent a second, potentially-drifting source of truth without checking.
