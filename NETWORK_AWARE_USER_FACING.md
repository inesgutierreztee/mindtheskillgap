# Network-aware user-facing integration

The Journey Planner now promotes a successful, valid network-aware result to the first `BEST MATCH` card. `rankRoutes()` remains the immediate and failure fallback. Other legacy-ranked alternatives retain their order and the promoted winner is not duplicated.

## Promotion and fallback

Promotion occurs only when `/api/network-aware/evaluate` succeeds, its `recommendedRouteId` maps to a currently eligible candidate, and the matching ranked evaluation is present. Mock candidates cannot be promoted in live network-aware mode. A failed request, empty candidate set, malformed response, or stale route ID leaves the legacy recommendation usable and does not issue ledger demand.

Temporal candidates keep their real trip duration and store waiting separately. A promoted temporal route displays `Leave in 20 min` or `Leave in 40 min`, plus arrival time calculated from departure delay and trip duration. The full route, including geometry, remains available for guidance; map-only arrays are removed only from evaluation and issuance POST payloads.

## Commuter explanations

- `NETWORK_PRESSURE`: Avoids higher expected network pressure on the alternatives.
- `DISRUPTION_AVOIDANCE`: Avoids the affected transport corridor.
- `FLEXIBLE_DEPARTURE`: Leaving N minutes later is expected to avoid higher network pressure.
- `PERSONAL_PREFERENCE`: Best fit for your travel preferences.
- `FASTER_ROUTE`: Fastest suitable option.
- `FAIRNESS_GUARDRAIL`: Balances expected crowding while avoiding a large detour.
- `HYSTERESIS_RETAINED`: Your current recommendation remains the better overall option.
- `UNKNOWN_DATA_CAUTION`: Best available option, with limited crowding data on part of the route.

The card labels crowding as estimated and does not display normalized demand or claim guaranteed outcomes.

## Issuance

After React renders a successfully promoted network-aware BEST MATCH, it calls `POST /api/network-aware/issue` for that winner only. Journey IDs are deterministic from a browser-session nonce plus normalized origin, destination, requested departure offset, and cycling eligibility. The nonce is stored in `sessionStorage`, so rerenders, route-detail opening, and planner remounts in the same browser session reuse the ID. A materially different planning request receives a different ID.

The client issuance tracker claims an ID once, and the server independently deduplicates it. Legacy fallback routes and nonwinning candidates are never issued. Compliance remains the engine default.

## Safety retained

- Cycling and accessibility eligibility are applied before evaluation.
- Corrected personal-baseline, arrival-time fairness is unchanged.
- The separate 25-minute absolute arrival-detour guardrail is unchanged.
- Live/replay separation, stable IDs, OneMap/LTA mapping, proxy calibration, hysteresis, and RecommendationLedger semantics are unchanged.
- The normalized pressure model remains an uncalibrated proxy and is not presented as passenger counts.
