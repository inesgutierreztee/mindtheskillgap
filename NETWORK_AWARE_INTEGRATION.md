# Network-aware routing integration

## Status

The portable engine is integrated into Transit Companion in **shadow mode**. The existing `rankRoutes()` result remains the commuter-facing `BEST MATCH`; the network-aware result is calculated separately, is logged only in development, and is never issued to the recommendation ledger by the normal UI.

This integration proves compatibility with GYG route structures and available LTA inputs. It does not establish real-world congestion-prediction accuracy.

## Architecture

1. OneMap itineraries are mapped in `server.ts` to GYG `RouteOption` objects with deterministic IDs, an absolute `departureTimeMs`, and structured boarding/alighting stop or station identifiers where reliable.
2. `transitCompanionAdapter.ts` converts an eligible `RouteOption` into the host-agnostic `NetworkAwareRoute<RouteOption>` consumed by the portable engine.
3. The Express process owns one `RecommendationLedger` and `NetworkAwareEngine`. Network observations are rebuilt for each evaluation from the current matched LTA data, then passed to the engine.
4. `JourneyPlannerScreen` keeps its existing personal ranking and visible winner. It filters impossible routes, calculates a separate non-network personal cost, and calls `POST /api/network-aware/evaluate` for a shadow comparison.
5. `POST /api/network-aware/issue` is implemented and idempotent, but the normal UI does not call it in shadow mode.

## Portable files

The following core files were copied unchanged into `src/networkAware/`:

- `types.ts`
- `time.ts`
- `RecommendationLedger.ts`
- `NetworkState.ts`
- `Fairness.ts`
- `NetworkAwareEngine.ts`
- `departureEvaluation.ts`
- `index.ts`

No old Smart Commute adapter, graph, route generator, UI, DataMall service, scoring, optimiser, or simulation was ported.

## Route adaptation

The Transit Companion adapter uses structured fields, not instruction text.

- Train legs add a boarding station, line/corridor, and alighting station resource. A corridor resembles `RAIL_CCL_CC13_CC22`.
- Bus legs add `BUS_SERVICE_<service>`, a boarding stop, and an alighting stop when their codes are available.
- Unresolved identifiers become stable `UNKNOWN` resources. They are not guessed.
- Pure cycling and ordinary walking add no public-transport congestion resource.
- Bike-and-ride ignores the cycle portion but includes subsequent bus/train resources.
- Arrival offsets are cumulative route-step durations.
- Duplicate use of one resource within the same five-minute bucket is collapsed.

Intermediate MRT stations are not reconstructed in this first pass. The model currently covers boarding stations, transfer/alighting stations, and line/corridor resources.

## Stable route identity

`createStableRouteId()` hashes a canonical signature containing route mode, ordered leg modes, line/service identifiers, boarding/alighting identifiers where available, and start/end locations. It uses Node's built-in SHA-256 implementation and introduces no dependency. Repeated mapping of the same logical OneMap itinerary produces the same ID, enabling incumbent tracking and hysteresis.

## Eligibility before fairness

`filterNetworkAwareEligibleRoutes()` runs before evaluation. A cycling-containing route is excluded when cycling or cycling preferences are disabled. A route explicitly marked `stepFreeAccessible === false` is excluded when step-free access is required. An undefined accessibility value remains unknown and is not rejected.

This ensures an impossible route cannot become the fastest fairness baseline.

## Personal cost versus network cost

The existing `rankRoutes()` behavior remains the visible UI ranking. `scorePersonalCostForNetworkAware()` is a separate input to the network engine and includes travel time, walking, transfers, fare preferences, mode preferences, static reliability, accessibility, weather, cycling suitability, parking, infrastructure, route length, and extra-time limits.

It deliberately excludes current `crowdRating`, RecommendationLedger demand, live network congestion, and route-specific live train disruption penalties. Those belong to `NetworkState`, avoiding double counting.

## NetworkState and data provenance

### Live LTA observations

- `PCDRealTime` maps `l`, `m`, and `h` to `LOW`, `MODERATE`, and `HIGH`. LTA `h` is never relabelled `CRITICAL`; `CRITICAL` can only be derived internally when combined load exceeds the configured threshold.
- `PCDForecast` remains a separate `forecastCrowd`/`forecastAtMs` signal when a route resource and target interval can be matched.
- `TrainServiceAlerts` marks only resources on actually affected lines as disrupted.
- `BusArrival` occupancy is used only when both the route's structured boarding-stop code and service number match. The Kent Ridge-specific nearby feed is not used for arbitrary journeys.
- Missing or unmatched data leaves the resource absent from the snapshot, so the engine returns `UNKNOWN` and applies its conservative uncertainty treatment. Missing data is never converted to `LOW` or described as seats being available.

### Derived/proxy values

`networkProxyConfig.ts` centralises a normalized prototype model with `capacity15Min = 100` and category-to-background-demand mappings. These values are not actual passenger counts, are not official LTA capacities, and must not be shown to commuters as such. The engine's five-minute result is a derived short-horizon estimate, not an LTA five-minute forecast.

## RecommendationLedger semantics

`evaluate()` reads but never mutates the ledger. `issueRecommendation()` is the only mutation path. Issuance is idempotent by `journeyRequestId`, and demand for one resource/time bucket is deduplicated for one passenger.

The ledger is process-local and resets whenever the Express server restarts. A multi-instance production deployment needs shared persistence such as Redis, Firestore, or a database. No database was added for this prototype.

Shadow evaluation does not issue recommendations because the commuter was not actually shown the network-aware winner. Recording that demand would create false feedback.

## Endpoints

### `POST /api/network-aware/evaluate`

Accepts eligible `RouteOption[]`, personal cost by route ID, an optional incumbent route ID, and time/context. It validates the input, adapts routes, obtains matched observations, evaluates the engine, and returns only safe route-level costs, crowd risk, bottleneck, reason, and provenance. It verifies that ledger size did not change.

### `POST /api/network-aware/issue`

Accepts `journeyRequestId`, a selected/recommended route, optional compliance probability, and optional represented-user count. It delegates to `issueRecommendation()` and is idempotent. It is intentionally not called by Journey Planner yet.

## Known limitations

- The normalized demand/capacity proxy has not been empirically calibrated.
- LRT resource mapping is incomplete. Unresolved LRT resources stay `UNKNOWN`; station codes are not fabricated.
- Intermediate MRT stations are not reconstructed for every train leg.
- One service-level bus resource can only reflect an occupancy observation matched at a known boarding stop; richer direction/trip-specific resource identity is future work.
- Live data availability, timing, and OneMap identifiers vary. Missing structured identifiers reduce coverage and correctly increase uncertainty.
- The in-memory ledger resets on restart.
- Multi-instance deployment requires shared ledger persistence and concurrency control.

## Promoting beyond shadow mode

Before making the network-aware winner commuter-facing, calibrate the proxy model against measured outcomes, expand LRT and intermediate-station mapping, add persistence, and monitor fairness/reliability metrics. Then change the UI selection only after a successful shadow evaluation and explicitly call `/api/network-aware/issue` with a unique journey request ID when that recommendation is actually shown. Keep the existing route as a safe fallback when evaluation or live data is unavailable.

## Verification

Run:

```bash
npm install
npm run lint
npm run test:network-aware
npm run build
```

The integration self-test covers the 25 requested cases plus a fixed-seed 1,000-evaluation stress/fuzz pass for finite/bounded scores, non-negative demand, empty resources, ledger idempotency, stable ties, and fairness invariants.
