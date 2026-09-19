# Transit Companion

A mobile-first Singapore public transport journey planner, built for the **NebulaX Hackathon PS2** brief ("Smart Commuter Companion" — proactive, persona-targeted disruption guidance for Singapore commuters). Originally an AI Studio export; substantially built out since.

## Architecture

- **Frontend**: React 19 + TypeScript + Tailwind v4, single-page app driven entirely by React state in `src/App.tsx` (no router — `currentView`/`activeTab` state machines).
- **Backend**: `server.ts` is an Express server that also runs Vite in middleware mode (`tsx watch server.ts` for dev). It's not a separate deploy target — one process serves both the API and the app.
- **Dev server**: `npm run dev` (uses `tsx watch`, so backend edits auto-reload — plain `tsx server.ts` does NOT auto-reload on backend changes, that was a real bug hit once already). Default port 3000, but if a sibling project (`mindthegap`, a related/earlier iteration of this same app) is already running there, start on another port: `PORT=3001 npm run dev`.
- **Type-check**: `npm run lint` (just `tsc --noEmit`, no actual eslint).

## Live data sources (all with graceful mock/demo fallback if unset)

Every fetch in this app degrades to bundled mock data on failure — never crashes, never blocks on a missing key. Set these in `.env` (see `.env.example`):

- `LTA_ACCOUNT_KEY` — LTA DataMall: bus arrivals, train status, platform crowd, lift maintenance. Free registration.
- `ONEMAP_TOKEN` (or `ONEMAP_EMAIL`/`ONEMAP_PASSWORD`) — OneMap: live public-transit routing (`/api/route-plan`). `ONEMAP_TOKEN` is simplest but expires ~3 days; email/password auto-refreshes. **Known quirk**: OneMap's `StationCode` param on `FacilitiesMaintenance` doesn't actually filter server-side — `server.ts` works around this by fetching the full list once and filtering locally.
- No key needed for `/api/weather` (data.gov.sg 2-hour forecast).

When adding a new live-data endpoint, follow the existing pattern: try the real API, catch and fall back to mock data, and expose enough of a `source` field in the response that the UI can honestly show "LIVE" vs "DEMO DATA" — never present fallback data as if it were live (the hackathon brief explicitly penalizes this).

## Map tiles

Use OSM's own tile server (`tile.openstreetmap.org`), not CartoDB — CartoDB's free raster tiles started requiring an API key partway through this project's life (silently rendered an "API KEY REQUIRED" watermark instead of erroring, which took a while to notice). Always keep the `© OpenStreetMap contributors` attribution control enabled on every Leaflet map instance — it's a hard brief requirement, and it's been accidentally disabled (`attributionControl: false`) more than once.

## Known gaps (intentionally not built yet)

- Arjun's persona needs a cycling leg — scoped (geocode + OneMap `cycle` routeType + a new route-step type) but not implemented.
- No LRT line-code (`STL`/`SLRT`) canonical mapping — irrelevant until LRT station data is actually wired in somewhere.
- `@google/genai` is an installed but unused dependency.
- The write-up document (persona justification, architecture, assumptions/limitations, methodology) hasn't been written — `README.md` is still unedited AI Studio boilerplate.

## Git

Not yet a git repository. The plan is to push finished changes to the related `mindthegap` repo (`~/Documents/GitHub/mindthegap`, remote `inesgutierreztee/mindthegap`) on a new branch — never directly to `main`, and not until explicitly asked to.
