# Network-aware pre-promotion stabilization

This pass keeps the commuter-facing `rankRoutes()` winner unchanged. Network-aware evaluation remains shadow-only and never issues ledger demand automatically.

## Saturation trace

The configured normalized proxy capacity is 100 per 15 minutes. `NetworkState` converts that to 33.3 per five-minute bucket. RecommendationLedger demand is already bucket-specific and is therefore not divided again. The ledger deduplicates the same resource and bucket, while legitimately recording one passenger on sequential route resources.

For the live Punggol → one-north route in the final run, LTA current crowd was unavailable for the matched resources and the separate LTA forecast was LOW. The trace was:

| Represented | Expected compliant | Resource demand (forecast + ledger) | Utilization | Risk | Route network cost |
|---:|---:|---:|---:|---|---:|
| 0 | 0 | 0.4 | 0.01 | LOW | 0 |
| 25 | 17.5 | live-input dependent | HIGH | 22.25 |
| 50 | 35 | live-input dependent | CRITICAL | 80 |
| 100 | 70 | 70.4 | 2.11 | CRITICAL | 80 (cap) |

At 50 users, each of six sequential resources has the same legitimate expected passenger contribution. The route cost combines the largest resource penalty plus 25% of the other resource penalties. This, the 33.3 five-minute proxy capacity, and the nonlinear post-1.05 load penalty explain the steep rise. There is no duplicate same-resource/time-bucket demand and no incorrect bucket accumulation. The previous 50-user cap was sensitive to the live observation mix; the final trace reaches 69.75 at 50 and the cap at 100.

No proxy values, thresholds, weights, or caps were changed. Altering them without empirical calibration would be arbitrary. These values remain normalized proxies, not official LTA capacity or passenger counts.

## Candidate diversity

`buildNetworkAwareCandidateSet()` aggregates only real application-supported candidates. It keeps stable OneMap topology IDs as metadata and adds a deterministic departure suffix for the same topology at another departure time. It strips map geometry from shadow POST payloads because the engine does not consume it. Waiting time is included in generalized duration and fairness.

The final fairness-correction run supplied five legitimate candidates: transit now, the same real OneMap topology at +20 and +40 minutes, and two real bike-and-ride routes. The +20 and +40 routes carry their real absolute departure times, so resource buckets and LTA matching shift. Pressure issued into NOW buckets did not leak into later departures. At 50 and 100 represented users, the shorter bike-and-ride candidate was the highest-ranked fair alternative; +20 had a lower numeric total but its approximately 21-minute later arrival was just outside the existing severe-condition 20-minute soft limit. Visible routing was unchanged.

## Personal scoring and Clementi

Both scorers now use the same non-network personal foundation for duration, walking, transfers, fare, accessibility, mode preference, static reliability, and weather. The visible scorer still adds its legacy live crowd/disruption and conditional cycling terms; the network-aware path adds NetworkState cost, fairness, and hysteresis instead.

Fairness now uses the lowest-personal-cost eligible route as its baseline. Sacrifice is the positive difference between candidate and baseline arrival times, so a faster arrival receives zero sacrifice and a later departure includes its real waiting tradeoff. A separate absolute guardrail still rejects arrivals more than 25 minutes behind the earliest eligible arrival.

For the final Clementi → Dhoby Ghaut run, the bus route had personal cost 52 and remained the personal baseline despite taking 40 minutes. It received zero fairness penalty. The train had personal cost 57, zero network cost, and a 3-point switching cost. The bus remained both the visible and shadow winner at total 54. The old fastest-route-based 51-point penalty no longer exists.

Structured `decisionReasonCode` values now distinguish network pressure, personal preference, faster routes, flexible departure, fairness, retained hysteresis, unknown-data caution, and disruption avoidance. Hysteresis is only named when it actually retains the incumbent. Equal-pressure bottlenecks use a deterministic explanation-only priority; route costs are unchanged.

## Bus-stop synchronization

The former implementation requested fixed pages in parallel, converted any failed page into an empty page, flattened partial results, and replaced the cache. That directly allowed variable partial totals.

The new paginator retrieves offset pages with retries, requires a genuine terminal short page, deduplicates by bus-stop code, builds the replacement off to the side, and swaps the cache only after a complete valid fetch. An incomplete refresh retains the previous valid cache (or the small startup fallback). The final live startup atomically synchronized 5,208 unique stops from 11 complete pages; this is an observed result, not a hard-coded expected Singapore total.

## Remaining limitations

- The normalized demand/capacity model is not empirically calibrated.
- Network cost still reaches its configured cap at 70 expected compliant users in the final Punggol test.
- LTA current observations are not available for every mapped resource; UNKNOWN remains UNKNOWN and separate forecast provenance is retained.
- Flexible departure adds legitimate choice, but +40 minutes is usually blocked by the existing fairness guardrail for this journey.
- Promotion must define when a shadow choice becomes an actually issued recommendation and then call the explicit idempotent issue path; this remains intentionally disabled.
