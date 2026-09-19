import type { RouteOption, UserPreferences } from '../types';
import { filterNetworkAwareEligibleRoutes } from './eligibility';

export interface CandidateRouteBatch {
  routes: RouteOption[];
  source: 'immediate-transit' | 'later-transit' | 'cycling' | 'bike-and-ride';
}

/**
 * Builds shadow-only candidates from real host routes. Topology IDs remain the
 * stable OneMap IDs; a deterministic departure suffix distinguishes the same
 * topology in another time bucket. Waiting time is stored separately so UI
 * can show trip duration while personal scoring still charges for waiting.
 */
export function buildNetworkAwareCandidateSet(
  batches: CandidateRouteBatch[],
  preferences: UserPreferences
): RouteOption[] {
  const eligible = batches
    .flatMap((batch) => batch.routes.map((route) => ({ route, source: batch.source })))
    .filter(({ route }) => filterNetworkAwareEligibleRoutes([route], preferences).length === 1);
  const departures = eligible
    .map(({ route }) => route.departureTimeMs)
    .filter((value): value is number => Number.isFinite(value));
  const earliest = departures.length > 0 ? Math.min(...departures) : Date.now();
  const departureCounts = new Map<string, Set<number>>();
  for (const { route } of eligible) {
    const minute = Math.round((route.departureTimeMs ?? earliest) / 60_000);
    const values = departureCounts.get(route.id) ?? new Set<number>();
    values.add(minute);
    departureCounts.set(route.id, values);
  }

  const byKey = new Map<string, RouteOption>();
  for (const { route, source } of eligible) {
    const departure = route.departureTimeMs ?? earliest;
    const departureMinute = Math.round(departure / 60_000);
    const delayMin = Math.max(0, Math.round((departure - earliest) / 60_000));
    const temporal = (departureCounts.get(route.id)?.size ?? 0) > 1;
    const id = temporal ? `${route.id}--depart-${departureMinute}` : route.id;
    const key = `${route.id}::${departureMinute}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        ...route,
        id,
        steps: route.steps.map((step) => ({ ...step })),
        networkAwareBaseRouteId: route.id,
        networkAwareDepartureDelayMin: delayMin,
        networkAwareCandidateSource: source,
      });
    }
  }
  return Array.from(byKey.values()).sort(
    (a, b) =>
      (a.departureTimeMs ?? 0) - (b.departureTimeMs ?? 0) ||
      a.id.localeCompare(b.id)
  );
}

/** Removes map-only payload before posting candidates to the evaluator. */
export function toNetworkAwareEvaluationRoutes(routes: RouteOption[]): RouteOption[] {
  return routes.map((route) => ({
    ...route,
    steps: route.steps.map(({ pathCoordinates: _path, navigationInstructions: _nav, progressionStops: _progress, ...step }) => step),
  }));
}
