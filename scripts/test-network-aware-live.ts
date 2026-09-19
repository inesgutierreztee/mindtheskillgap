import fs from 'node:fs';
import path from 'node:path';
import { NetworkAwareEngine } from '../src/networkAware/NetworkAwareEngine';
import { NetworkState } from '../src/networkAware/NetworkState';
import { RecommendationLedger } from '../src/networkAware/RecommendationLedger';
import type { CrowdRisk, ResourceObservation } from '../src/networkAware/types';
import { adaptTransitCompanionRoute } from '../src/networkAware/adapters/transitCompanionAdapter';
import { filterNetworkAwareEligibleRoutes } from '../src/networkAware/eligibility';
import { rankRoutes, scorePersonalCostForNetworkAware } from '../src/services/routeScoring';
import type { RouteOption, UserPreferences } from '../src/types';
import { normalizeLineToCode } from '../src/utils/lineCodes';
import { resolveStationCoords } from '../src/utils/stationLookup';
import { buildNetworkAwareCandidateSet, CandidateRouteBatch, toNetworkAwareEvaluationRoutes } from '../src/networkAware/candidateSet';
import { promoteNetworkAwareRoutes } from '../src/networkAware/presentation';
import type { DecisionReasonCode } from '../src/networkAware/presentation';

type TestMode = 'transit' | 'cycle' | 'multimodal';
type Flag =
  | 'FLAG_LARGE_DETOUR'
  | 'FLAG_COST_CAP'
  | 'FLAG_EARLY_SATURATION'
  | 'FLAG_UNKNOWN_DOMINANCE'
  | 'FLAG_MAPPING'
  | 'FLAG_WRONG_LINE'
  | 'FLAG_DISABLED_MODE'
  | 'FLAG_OSCILLATION'
  | 'FLAG_UNSTABLE_ID'
  | 'FLAG_REPLAY_LIVE_MIX'
  | 'FLAG_EXTREME_FAIRNESS';

interface JourneySpec {
  origin: string;
  destination: string;
  mode: TestMode;
}

interface ShadowResource {
  resourceId: string;
  resourceType?: ResourceObservation['type'];
  resourceName?: string;
  targetTimeMs: number;
  crowdRisk: CrowdRisk;
  currentCrowd: CrowdRisk;
  forecastCrowd?: CrowdRisk;
  forecastAtMs?: number;
  disrupted: boolean;
  normalizedBackgroundDemand15Min?: number;
  normalizedCapacity15Min?: number;
  ledgerDemand: number;
  provenance: Array<'LTA_REALTIME' | 'LTA_FORECAST' | 'PROXY' | 'REPLAY' | 'UNKNOWN'>;
}

interface ShadowRouteResult {
  routeId: string;
  personalCost: number;
  networkCost: number;
  fairnessPenalty: number;
  switchingCost: number;
  totalCost: number;
  crowdRisk: CrowdRisk;
  bottleneckResourceId?: string;
  bottleneckResourceName?: string;
  reason: string;
  decisionReasonCode: DecisionReasonCode;
  resources: ShadowResource[];
}

interface ShadowResponse {
  recommendedRouteId: string | null;
  personalBaselineRouteId: string | null;
  rankedRoutes: ShadowRouteResult[];
  provenance: { mode: 'live' | 'replay'; usesProxyDemandModel: boolean };
}

const BASE_URL = (process.env.NETWORK_AWARE_LIVE_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const REPORT_PATH = path.join(process.cwd(), 'network-aware-live-shadow-results.json');
const MAX_NETWORK_COST = 80;

const preferences: UserPreferences = {
  lessWalking: false,
  fewerTransfers: true,
  lessCrowded: true,
  fastestJourney: false,
  lowerFare: false,
  stepFreeAccess: false,
  travelMode: 'no_preference',
  priorities: ['crowd'],
  priority: 'comfort',
  transportModes: { rail: true, bus: true, walking: true, cycling: true },
  cyclingPreferences: {
    enabled: true,
    suggestWhen: { busesCrowded: true, crowdedInterchange: true, longBusWait: true, disruptionReliability: true },
    maxExtraMinutes: 15,
    avoidWhen: { heavyRain: true, poorInfrastructure: true, noBikeParking: true, routeTooLong: true },
    bikeAtStation: 'park',
  },
};

const journeys: JourneySpec[] = [
  { origin: 'Punggol', destination: 'one-north', mode: 'transit' },
  { origin: 'Tampines', destination: 'Raffles Place', mode: 'transit' },
  { origin: 'Woodlands', destination: 'Orchard', mode: 'transit' },
  { origin: 'Sengkang', destination: 'Buona Vista', mode: 'transit' },
  { origin: 'Jurong East', destination: 'Paya Lebar', mode: 'transit' },
  { origin: 'Bedok', destination: 'one-north', mode: 'transit' },
  { origin: 'Punggol', destination: 'Raffles Place', mode: 'transit' },
  { origin: 'Bishan', destination: 'Tampines', mode: 'transit' },
  { origin: 'Clementi', destination: 'Dhoby Ghaut', mode: 'transit' },
  { origin: 'HarbourFront', destination: 'Serangoon', mode: 'transit' },
  { origin: 'Clementi', destination: 'one-north', mode: 'cycle' },
  { origin: 'Punggol', destination: 'one-north', mode: 'multimodal' },
];

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function routeUrl(spec: JourneySpec, departureOffsetMin = 0): string | null {
  const origin = resolveStationCoords(spec.origin);
  const destination = resolveStationCoords(spec.destination);
  if (!origin || !destination) return null;
  const endpoint = spec.mode === 'multimodal' ? '/api/multimodal-route-plan' : '/api/route-plan';
  const params = new URLSearchParams({
    originLat: String(origin.lat),
    originLng: String(origin.lng),
    destLat: String(destination.lat),
    destLng: String(destination.lng),
    departureOffsetMin: String(departureOffsetMin),
  });
  if (spec.mode === 'multimodal') params.set('bikeAtStation', 'park');
  else params.set('routeMode', spec.mode);
  return `${BASE_URL}${endpoint}?${params}`;
}

function modes(route: RouteOption): string[] {
  return Array.from(new Set(route.steps.map((step) => step.type)));
}

function routeSummary(route: RouteOption | undefined, score?: number) {
  if (!route) return null;
  return {
    routeId: route.id,
    modes: modes(route),
    durationMin: route.totalDurationMin,
    existingScore: score ?? route.calculatedScore,
  };
}

function addFlag(flags: Set<Flag>, flag: Flag): void {
  flags.add(flag);
}

function checkLineMapping(route: RouteOption, flags: Set<Flag>): void {
  for (const step of route.steps) {
    if (step.type !== 'train' || !step.lineOrService) continue;
    const line = normalizeLineToCode(step.lineOrService);
    for (const [name, code] of [
      [step.startPoint?.name, step.boardingStationCode],
      [step.targetPoint?.name, step.alightingStationCode],
    ] as const) {
      if (!name?.toLowerCase().includes('serangoon') || !code || !line) continue;
      const expected = line === 'NEL' ? 'NE12' : line === 'CCL' ? 'CC13' : null;
      if (expected && code !== expected) addFlag(flags, 'FLAG_WRONG_LINE');
    }
  }
}

function checkModeMapping(route: RouteOption, flags: Set<Flag>): void {
  const adapted = adaptTransitCompanionRoute(route);
  const hasCycle = route.steps.some((step) => step.type === 'cycle');
  const hasTransit = route.steps.some((step) => step.type === 'bus' || step.type === 'train');
  if (hasCycle && !preferences.transportModes.cycling) addFlag(flags, 'FLAG_DISABLED_MODE');
  if (hasCycle && !hasTransit && adapted.resources.length > 0) addFlag(flags, 'FLAG_MAPPING');
  if (hasCycle && hasTransit && adapted.resources.some((resource) => resource.resourceId.includes('CYCLE'))) {
    addFlag(flags, 'FLAG_MAPPING');
  }
  const hasRecognisedHeavyRail = route.steps.some(
    (step) => step.type === 'train' && Boolean(step.lineOrService && normalizeLineToCode(step.lineOrService))
  );
  if (hasRecognisedHeavyRail && adapted.resources.some((resource) => resource.resourceId.startsWith('RAIL_UNKNOWN_'))) {
    addFlag(flags, 'FLAG_MAPPING');
  }
}

function observationsFromShadow(response: ShadowResponse, nowMs: number): ResourceObservation[] {
  const byId = new Map<string, ResourceObservation>();
  for (const route of response.rankedRoutes) {
    for (const resource of route.resources) {
      if (resource.provenance.includes('UNKNOWN') || !resource.resourceType) continue;
      byId.set(resource.resourceId, {
        resourceId: resource.resourceId,
        type: resource.resourceType,
        name: resource.resourceName,
        observedAtMs: nowMs,
        currentCrowd: resource.currentCrowd,
        backgroundDemand15Min: resource.normalizedBackgroundDemand15Min ?? 0,
        capacity15Min: resource.normalizedCapacity15Min ?? 100,
        disrupted: resource.disrupted,
        forecastCrowd: resource.forecastCrowd,
        forecastAtMs: resource.forecastAtMs,
      });
    }
  }
  return Array.from(byId.values());
}

function pressureProgression(
  routes: RouteOption[],
  costs: Record<string, number>,
  response: ShadowResponse,
  nowMs: number
) {
  const adapted = routes.map((route) => adaptTransitCompanionRoute(route, { nowMs }));
  const initialRouteId = response.recommendedRouteId;
  const initialRoute = adapted.find((route) => route.id === initialRouteId);
  if (!initialRoute) return [];
  const observations = observationsFromShadow(response, nowMs);
  const ledger = new RecommendationLedger();
  const engine = new NetworkAwareEngine<RouteOption>({
    networkState: new NetworkState({ observations }),
    recommendationLedger: ledger,
  });
  const baseline = engine.evaluate(adapted, {
    nowMs,
    personalCost: (route) => costs[route.id],
  });
  const baselineSeeded = baseline.rankedRoutes.find((route) => route.route.id === initialRoute.id);
  const summarize = (result: typeof baseline) => result.rankedRoutes.map((item) => ({
    routeId: item.route.id,
    departureTime: new Date(item.route.departureTimeMs).toISOString(),
    source: item.route.payload?.networkAwareCandidateSource,
    departureDelayMin: item.route.payload?.networkAwareDepartureDelayMin ?? 0,
    routeSummary: item.route.payload?.summary,
    durationMin: item.route.durationMin,
    personalCost: item.personalCost,
    networkCost: item.networkCost,
    fairnessPenalty: item.fairness.penalty,
    switchingCost: item.switchingCost,
    totalCost: item.totalCost,
    bottleneckResourceId: item.prediction.bottleneckResourceId,
    crowdRisk: item.prediction.crowdRisk,
    decisionReasonCode: item.decisionReasonCode,
  }));
  const trace = (item: typeof baselineSeeded) => item?.prediction.resourcePredictions.map((resource) => ({
    resourceId: resource.resourceId,
    targetTime: new Date(resource.targetTimeMs).toISOString(),
    capacity: resource.capacity,
    components: resource.components,
    totalDemand: resource.totalDemand,
    utilization: resource.loadRatio,
    risk: resource.crowdRisk,
  }));
  const progression: any[] = [{
    representedCommuters: 0,
    expectedCompliantDemand: 0,
    seededRouteId: initialRoute.id,
    initialNetworkCost: baselineSeeded?.networkCost ?? null,
    currentNetworkCost: baselineSeeded?.networkCost ?? null,
    winnerRouteId: baseline.recommended?.route.id ?? null,
    personalBaselineRouteId: baseline.personalBaselineRouteId,
    bottleneckResourceId: baselineSeeded?.prediction.bottleneckResourceId,
    crowdRisk: baselineSeeded?.prediction.crowdRisk,
    fairnessPenalty: baselineSeeded?.fairness.penalty,
    hysteresisRetainedPreviousWinner: true,
    routeNetworkCosts: Object.fromEntries(baseline.rankedRoutes.map((route) => [route.route.id, route.networkCost])),
    candidates: summarize(baseline),
    calculationTrace: trace(baselineSeeded),
  }];
  let previousWinner = baseline.recommended?.route.id;
  let previousTarget = 0;

  for (const represented of [25, 50, 100]) {
    const additionalUsers = represented - previousTarget;
    engine.issueRecommendation({
      journeyRequestId: `live-pressure-${initialRoute.id}-${represented}`,
      route: initialRoute,
      issuedAtMs: nowMs,
      userCountRepresented: additionalUsers,
      complianceProbability: 0.7,
    });
    const after = engine.evaluate(adapted, {
      nowMs,
      incumbentRouteId: previousWinner,
      personalCost: (route) => costs[route.id],
    });
    const seededAfter = after.rankedRoutes.find((route) => route.route.id === initialRoute.id);
    progression.push({
      representedCommuters: represented,
      expectedCompliantDemand: ledger.getEntries().reduce((sum, entry) => sum + entry.expectedPassengerContribution, 0),
      seededRouteId: initialRoute.id,
      initialNetworkCost: baselineSeeded?.networkCost ?? null,
      currentNetworkCost: seededAfter?.networkCost ?? null,
      winnerRouteId: after.recommended?.route.id ?? null,
      personalBaselineRouteId: after.personalBaselineRouteId,
      bottleneckResourceId: seededAfter?.prediction.bottleneckResourceId,
      crowdRisk: seededAfter?.prediction.crowdRisk,
      fairnessPenalty: seededAfter?.fairness.penalty,
      hysteresisRetainedPreviousWinner: after.recommended?.route.id === previousWinner,
      routeNetworkCosts: Object.fromEntries(after.rankedRoutes.map((route) => [route.route.id, route.networkCost])),
      candidates: summarize(after),
      calculationTrace: trace(seededAfter),
    });
    previousWinner = after.recommended?.route.id;
    previousTarget = represented;
  }
  return progression;
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const report: any = {
    generatedAt: startedAt,
    mode: 'LIVE_SHADOW_TEST',
    note: 'Normalized demand/capacity values are proxies, not actual passenger counts or official LTA capacities.',
    server: BASE_URL,
    lta: null,
    journeysAttempted: journeys.length,
    journeyResults: [],
    skipped: [],
    pressureTests: [],
  };

  let ltaStatus: any;
  try {
    ltaStatus = await jsonFetch<any>(`${BASE_URL}/api/lta-status`);
    report.lta = {
      liveMode: Boolean(ltaStatus.liveMode),
      provider: ltaStatus.provider,
      accountKeyConfigured: Boolean(ltaStatus.accountKeyConfigured),
    };
  } catch (error) {
    const reason = `local server unavailable at ${BASE_URL}: ${error instanceof Error ? error.message : String(error)}`;
    console.log(`SKIPPED: ${reason}`);
    report.skipped.push({ scope: 'all', reason });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    return;
  }

  if (!ltaStatus.liveMode) {
    console.log('SKIPPED LTA observations: server reports LTA live mode unavailable. Route tests will retain UNKNOWN observations.');
  } else {
    console.log(`LTA verification: LIVE (${ltaStatus.provider})`);
  }

  for (const spec of journeys) {
    const label = `${spec.origin} → ${spec.destination} [${spec.mode}]`;
    const url = routeUrl(spec);
    if (!url) {
      report.skipped.push({ journey: label, reason: 'station coordinates unresolved' });
      console.log(`SKIPPED ${label}: station coordinates unresolved`);
      continue;
    }

    try {
      const first = await jsonFetch<any>(url);
      if (first.source !== 'onemap_live' || !Array.isArray(first.itineraries) || first.itineraries.length === 0) {
        const reason = first.reason || `routing source was ${first.source || 'unknown'}`;
        report.skipped.push({ journey: label, reason });
        console.log(`SKIPPED ${label}: ${reason}`);
        continue;
      }
      const routes = first.itineraries as RouteOption[];
      const repeat = await jsonFetch<any>(url);
      const flags = new Set<Flag>();
      const firstIds = routes.map((route) => route.id).sort().join(',');
      const repeatIds = (repeat.itineraries || []).map((route: RouteOption) => route.id).sort().join(',');
      if (firstIds !== repeatIds) addFlag(flags, 'FLAG_UNSTABLE_ID');
      if (new Set(routes.map((route) => route.id)).size !== routes.length) addFlag(flags, 'FLAG_UNSTABLE_ID');
      if (String(first.source).includes('mock') || routes.some((route) => route.dataSource === 'mock')) {
        addFlag(flags, 'FLAG_REPLAY_LIVE_MIX');
      }

      routes.forEach((route) => {
        checkLineMapping(route, flags);
        checkModeMapping(route, flags);
      });
      let eligible = filterNetworkAwareEligibleRoutes(routes, preferences);
      if (spec.origin === 'Punggol' && spec.destination === 'one-north' && spec.mode === 'transit') {
        const batches: CandidateRouteBatch[] = [{ routes, source: 'immediate-transit' }];
        for (const offset of [20, 40]) {
          const laterUrl = routeUrl(spec, offset);
          if (!laterUrl) continue;
          const later = await jsonFetch<any>(laterUrl);
          if (later.source === 'onemap_live' && Array.isArray(later.itineraries) && later.itineraries.length > 0) {
            batches.push({ routes: later.itineraries, source: 'later-transit' });
          }
        }
        const multimodalUrl = routeUrl({ ...spec, mode: 'multimodal' });
        if (multimodalUrl) {
          const multimodal = await jsonFetch<any>(multimodalUrl);
          if (multimodal.source === 'onemap_live' && Array.isArray(multimodal.itineraries) && multimodal.itineraries.length > 0) {
            batches.push({ routes: multimodal.itineraries, source: 'bike-and-ride' });
          }
        }
        eligible = buildNetworkAwareCandidateSet(batches, preferences);
      }
      const ranked = rankRoutes(routes, preferences, {
        ewlDisruptionActive: false,
        roadTrafficHeavy: false,
        isRaining: false,
      });
      const existingWinner = ranked[0];
      const personalCostByRouteId = Object.fromEntries(
        eligible.map((route) => [route.id, scorePersonalCostForNetworkAware(route, preferences).totalCost])
      );
      const nowMs = Date.now();
      const requestBody = {
        routes: toNetworkAwareEvaluationRoutes(eligible),
        personalCostByRouteId,
        incumbentRouteId: eligible.find((route) => (route.networkAwareBaseRouteId || route.id) === existingWinner?.id)?.id,
        nowMs,
        mode: 'live',
      };
      const shadowRuns: ShadowResponse[] = [];
      for (let run = 0; run < 3; run += 1) {
        shadowRuns.push(await jsonFetch<ShadowResponse>(`${BASE_URL}/api/network-aware/evaluate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        }));
      }
      const shadow = shadowRuns[0];
      if (new Set(shadowRuns.map((run) => run.recommendedRouteId)).size > 1) addFlag(flags, 'FLAG_OSCILLATION');
      if (shadow.provenance.mode !== 'live') addFlag(flags, 'FLAG_REPLAY_LIVE_MIX');
      const networkWinnerRoute = eligible.find((route) => route.id === shadow.recommendedRouteId);
      const networkWinner = shadow.rankedRoutes.find((route) => route.routeId === shadow.recommendedRouteId);
      const presented = promoteNetworkAwareRoutes(ranked, eligible, shadow);
      const existingEvaluation = shadow.rankedRoutes.find((route) => route.routeId === existingWinner?.id);
      const durationDifference = (networkWinnerRoute?.totalDurationMin ?? 0) - (existingWinner?.totalDurationMin ?? 0);
      if (durationDifference > 10) addFlag(flags, 'FLAG_LARGE_DETOUR');
      if ((networkWinner?.networkCost ?? 0) >= MAX_NETWORK_COST) addFlag(flags, 'FLAG_COST_CAP');
      if (durationDifference > 25 && networkWinner?.fairnessPenalty === 0) addFlag(flags, 'FLAG_EXTREME_FAIRNESS');
      const winnerUnknown = networkWinner?.resources.filter((resource) => resource.provenance.includes('UNKNOWN')).length || 0;
      if (
        networkWinner && networkWinner.resources.length > 0 &&
        winnerUnknown / networkWinner.resources.length > 0.5 &&
        shadow.recommendedRouteId !== existingWinner?.id &&
        networkWinner.networkCost <= (existingEvaluation?.networkCost ?? 0)
      ) addFlag(flags, 'FLAG_UNKNOWN_DOMINANCE');
      const adaptedWinnerIds = new Set(
        networkWinnerRoute ? adaptTransitCompanionRoute(networkWinnerRoute).resources.map((resource) => resource.resourceId) : []
      );
      if (
        networkWinner?.bottleneckResourceId &&
        !adaptedWinnerIds.has(networkWinner.bottleneckResourceId)
      ) addFlag(flags, 'FLAG_MAPPING');

      const journeyResult = {
        origin: spec.origin,
        destination: spec.destination,
        mode: spec.mode,
        testTimestamp: new Date(nowMs).toISOString(),
        departureTime: routes[0]?.departureTimeMs ? new Date(routes[0].departureTimeMs!).toISOString() : null,
        routeCount: routes.length,
        shadowCandidateCount: eligible.length,
        shadowCandidates: eligible.map((route) => ({
          routeId: route.id,
          baseRouteId: route.networkAwareBaseRouteId || route.id,
          source: route.networkAwareCandidateSource || spec.mode,
          departureTime: route.departureTimeMs ? new Date(route.departureTimeMs).toISOString() : null,
          departureDelayMin: route.networkAwareDepartureDelayMin ?? 0,
          durationMin: route.totalDurationMin,
          modes: modes(route),
        })),
        existingWinner: routeSummary(existingWinner, existingWinner?.calculatedScore),
        personalBaselineRouteId: shadow.personalBaselineRouteId,
        userFacingBestMatchRouteId: presented.bestMatch?.id ?? null,
        userFacingSource: presented.networkAware ? 'network-aware' : 'legacy-fallback',
        networkAwareWinner: networkWinnerRoute && networkWinner ? {
          ...routeSummary(networkWinnerRoute),
          personalCost: networkWinner.personalCost,
          networkCost: networkWinner.networkCost,
          fairnessPenalty: networkWinner.fairnessPenalty,
          switchingCost: networkWinner.switchingCost,
          totalCost: networkWinner.totalCost,
          bottleneckResourceId: networkWinner.bottleneckResourceId,
          bottleneckResourceName: networkWinner.bottleneckResourceName,
          crowdRisk: networkWinner.crowdRisk,
          reason: networkWinner.reason,
          decisionReasonCode: networkWinner.decisionReasonCode,
          candidateSource: networkWinnerRoute.networkAwareCandidateSource,
          departureDelayMin: networkWinnerRoute.networkAwareDepartureDelayMin ?? 0,
        } : null,
        sameWinner: existingWinner?.id === (networkWinnerRoute?.networkAwareBaseRouteId || shadow.recommendedRouteId),
        travelTimeDifferenceMin: durationDifference,
        routes: shadow.rankedRoutes,
        flags: Array.from(flags),
      };
      report.journeyResults.push(journeyResult);

      if (spec.origin === 'Punggol' && spec.destination === 'one-north' && spec.mode === 'transit') {
        const progression = pressureProgression(eligible, personalCostByRouteId, shadow, nowMs);
        report.pressureTests.push({ journey: label, progression });
        console.log('\nPUNGGOL → ONE-NORTH PRESSURE PROGRESSION');
        for (const stage of progression) {
          console.log(`${stage.representedCommuters} USERS (expected ${stage.expectedCompliantDemand}) winner=${stage.winnerRouteId}`);
          for (const candidate of stage.candidates) {
            console.log(`  ${candidate.source} +${candidate.departureDelayMin}m duration=${candidate.durationMin} personal=${candidate.personalCost} network=${candidate.networkCost} fairness=${candidate.fairnessPenalty} hysteresis=${candidate.switchingCost} total=${candidate.totalCost} risk=${candidate.crowdRisk}`);
          }
        }
        if (progression.some((step: any) => step.currentNetworkCost >= MAX_NETWORK_COST)) {
          addFlag(flags, 'FLAG_COST_CAP');
        }
        if (progression.some((step: any) => step.representedCommuters > 0 && step.representedCommuters <= 50 && step.currentNetworkCost >= MAX_NETWORK_COST)) {
          addFlag(flags, 'FLAG_EARLY_SATURATION');
        }
        journeyResult.flags = Array.from(flags);
      }
      console.log(`PASS ${label}: routes=${routes.length} sameWinner=${journeyResult.sameWinner} flags=${journeyResult.flags.join(',') || 'none'}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      report.skipped.push({ journey: label, reason });
      console.log(`SKIPPED ${label}: ${reason}`);
    }
  }

  const allFlags: Flag[] = [
    'FLAG_LARGE_DETOUR', 'FLAG_COST_CAP', 'FLAG_EARLY_SATURATION',
    'FLAG_UNKNOWN_DOMINANCE', 'FLAG_MAPPING', 'FLAG_WRONG_LINE',
    'FLAG_DISABLED_MODE', 'FLAG_OSCILLATION', 'FLAG_UNSTABLE_ID',
    'FLAG_REPLAY_LIVE_MIX', 'FLAG_EXTREME_FAIRNESS',
  ];
  const flagCounts: Record<string, number> = Object.fromEntries(allFlags.map((flag) => [flag, 0]));
  for (const journey of report.journeyResults) {
    for (const flag of journey.flags) flagCounts[flag] = (flagCounts[flag] || 0) + 1;
  }
  report.summary = {
    journeysAttempted: journeys.length,
    journeysSuccessfullyRouted: report.journeyResults.length,
    skippedOrFailedExternalCalls: report.skipped.length,
    sameWinner: report.journeyResults.filter((journey: any) => journey.sameWinner).length,
    differentWinner: report.journeyResults.filter((journey: any) => !journey.sameWinner).length,
    flagCounts,
    manualReviewJourneys: report.journeyResults
      .filter((journey: any) => journey.flags.length > 0)
      .map((journey: any) => `${journey.origin} → ${journey.destination} [${journey.mode}]`),
  };
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log('\nLIVE SHADOW TEST SUMMARY');
  console.log(`Journeys attempted: ${report.summary.journeysAttempted}`);
  console.log(`Journeys successfully routed: ${report.summary.journeysSuccessfullyRouted}`);
  console.log(`Skipped/failed external calls: ${report.summary.skippedOrFailedExternalCalls}`);
  console.log(`Existing/network-aware same winner: ${report.summary.sameWinner}`);
  console.log(`Different winner: ${report.summary.differentWinner}`);
  for (const [flag, count] of Object.entries(flagCounts)) console.log(`${flag}: ${count}`);
  console.log(`Report: ${REPORT_PATH}`);
}

await main();
