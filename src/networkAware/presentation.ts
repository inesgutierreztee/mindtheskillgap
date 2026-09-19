import type { RouteOption } from '../types';

export type DecisionReasonCode =
  | 'NETWORK_PRESSURE'
  | 'PERSONAL_PREFERENCE'
  | 'FASTER_ROUTE'
  | 'FLEXIBLE_DEPARTURE'
  | 'FAIRNESS_GUARDRAIL'
  | 'HYSTERESIS_RETAINED'
  | 'UNKNOWN_DATA_CAUTION'
  | 'DISRUPTION_AVOIDANCE';

export interface PresentedEvaluation {
  routeId: string;
  decisionReasonCode: DecisionReasonCode;
  bottleneckResourceName?: string;
  bottleneckResourceId?: string;
}

export interface PresentedNetworkResult {
  recommendedRouteId: string | null;
  rankedRoutes: PresentedEvaluation[];
}

export interface PromotedRoutes {
  routes: RouteOption[];
  bestMatch: RouteOption | null;
  networkAware: boolean;
}

export function commuterExplanation(
  evaluation: PresentedEvaluation,
  route: RouteOption
): string {
  const delay = route.networkAwareDepartureDelayMin ?? 0;
  switch (evaluation.decisionReasonCode) {
    case 'NETWORK_PRESSURE':
      return 'Avoids higher expected network pressure on the alternatives.';
    case 'DISRUPTION_AVOIDANCE':
      return 'Avoids the affected transport corridor.';
    case 'FLEXIBLE_DEPARTURE':
      return `Leaving ${delay || 'a little'} min later is expected to avoid higher network pressure.`;
    case 'PERSONAL_PREFERENCE':
      return 'Best fit for your travel preferences.';
    case 'FASTER_ROUTE':
      return 'Fastest suitable option.';
    case 'FAIRNESS_GUARDRAIL':
      return 'Balances expected crowding while avoiding a large detour.';
    case 'HYSTERESIS_RETAINED':
      return 'Your current recommendation remains the better overall option.';
    case 'UNKNOWN_DATA_CAUTION':
      return 'Best available option, with limited crowding data on part of the route.';
  }
}

export function departureLabel(delayMin: number): string {
  return delayMin > 0 ? `Leave in ${Math.round(delayMin)} min` : 'Leave now';
}

export function arrivalOffsetMinutes(route: RouteOption): number {
  return (route.networkAwareDepartureDelayMin ?? 0) + route.totalDurationMin;
}

export function promoteNetworkAwareRoutes(
  legacyRanked: RouteOption[],
  eligibleCandidates: RouteOption[],
  result: PresentedNetworkResult | null
): PromotedRoutes {
  const fallback = legacyRanked.map((route, index) => withBestBadge(route, index === 0));
  if (!result?.recommendedRouteId) {
    return { routes: fallback, bestMatch: fallback[0] ?? null, networkAware: false };
  }
  const winner = eligibleCandidates.find((route) => route.id === result.recommendedRouteId);
  const evaluation = result.rankedRoutes.find((item) => item.routeId === result.recommendedRouteId);
  if (!winner || !evaluation || winner.dataSource === 'mock') {
    return { routes: fallback, bestMatch: fallback[0] ?? null, networkAware: false };
  }
  const promoted: RouteOption = {
    ...winner,
    badge: 'BEST MATCH',
    networkAwareRecommendation: true,
    networkAwareReasonCode: evaluation.decisionReasonCode,
    networkAwareExplanation: commuterExplanation(evaluation, winner),
    whyRecommended: commuterExplanation(evaluation, winner),
  };
  const rest = legacyRanked
    .filter((route) => !samePresentedOption(route, promoted))
    .map((route) => withBestBadge(route, false));
  return { routes: [promoted, ...rest], bestMatch: promoted, networkAware: true };
}

export function journeyDecisionKey(
  origin: string,
  destination: string,
  requestedDepartureOffsetMin: number,
  cyclingEnabled: boolean
): string {
  return [origin.trim().toLowerCase(), destination.trim().toLowerCase(), requestedDepartureOffsetMin, cyclingEnabled ? 1 : 0].join('|');
}

export function createJourneyRequestId(sessionNonce: string, decisionKey: string): string {
  let hash = 2166136261;
  for (const char of `${sessionNonce}|${decisionKey}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `journey-${(hash >>> 0).toString(16)}`;
}

export class RecommendationIssuanceTracker {
  private issued = new Set<string>();
  public claim(journeyRequestId: string): boolean {
    if (this.issued.has(journeyRequestId)) return false;
    this.issued.add(journeyRequestId);
    return true;
  }
}

function samePresentedOption(a: RouteOption, b: RouteOption): boolean {
  const aBase = a.networkAwareBaseRouteId || a.id;
  const bBase = b.networkAwareBaseRouteId || b.id;
  if (aBase !== bBase) return false;
  const aDeparture = Math.round((a.departureTimeMs ?? 0) / 60_000);
  const bDeparture = Math.round((b.departureTimeMs ?? 0) / 60_000);
  return aDeparture === bDeparture;
}

function withBestBadge(route: RouteOption, best: boolean): RouteOption {
  const badge = best
    ? 'BEST MATCH'
    : route.badge === 'BEST MATCH' || route.badge === 'RECOMMENDED FOR YOU'
    ? undefined
    : route.badge;
  return { ...route, badge, networkAwareRecommendation: false, networkAwareExplanation: undefined, networkAwareReasonCode: undefined };
}
