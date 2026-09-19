import fs from 'node:fs';
import path from 'node:path';
import { NetworkAwareEngine } from '../src/networkAware/NetworkAwareEngine';
import { NetworkState } from '../src/networkAware/NetworkState';
import { RecommendationLedger } from '../src/networkAware/RecommendationLedger';
import type { NetworkAwareRoute, ResourceObservation } from '../src/networkAware/types';
import { adaptTransitCompanionRoute } from '../src/networkAware/adapters/transitCompanionAdapter';
import { filterNetworkAwareEligibleRoutes } from '../src/networkAware/eligibility';
import { createNetworkAwareRuntime } from '../src/networkAware/server/networkAwareRuntime';
import { mapPcdCode } from '../src/networkAware/server/networkProxyConfig';
import { NETWORK_PROXY_CAPACITY_15_MIN, proxyDemandForCrowd } from '../src/networkAware/server/networkProxyConfig';
import { createStableRouteId } from '../src/networkAware/server/stableRouteId';
import { buildNetworkAwareCandidateSet } from '../src/networkAware/candidateSet';
import { rankRoutes, scorePersonalCostForNetworkAware } from '../src/services/routeScoring';
import { collectCompleteOffsetPages } from '../src/services/busStopPagination';
import {
  arrivalOffsetMinutes,
  commuterExplanation,
  createJourneyRequestId,
  departureLabel,
  journeyDecisionKey,
  promoteNetworkAwareRoutes,
  RecommendationIssuanceTracker,
} from '../src/networkAware/presentation';
import type { RouteOption, UserPreferences } from '../src/types';
import { resolveStationByNameAndLine } from '../src/utils/stationLookup';
import { normalizeLineToCode } from '../src/utils/lineCodes';

const BASE = Date.UTC(2026, 8, 19, 0, 0, 0, 0);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}

const preferences: UserPreferences = {
  lessWalking: false,
  fewerTransfers: false,
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
    suggestWhen: {
      busesCrowded: true,
      crowdedInterchange: true,
      longBusWait: true,
      disruptionReliability: true,
    },
    maxExtraMinutes: 15,
    avoidWhen: {
      heavyRain: true,
      poorInfrastructure: true,
      noBikeParking: true,
      routeTooLong: true,
    },
    bikeAtStation: 'park',
  },
};

function routeOption(id: string, duration = 30, steps: RouteOption['steps'] = []): RouteOption {
  return {
    id,
    title: id,
    summary: id,
    lines: steps.map((step) => step.lineOrService).filter((line): line is string => Boolean(line)),
    totalDurationMin: duration,
    departureTimeMs: BASE,
    walkingMinutes: steps.filter((step) => step.type === 'walk').reduce((sum, step) => sum + step.durationMin, 0),
    transfers: Math.max(0, steps.filter((step) => step.type === 'bus' || step.type === 'train').length - 1),
    crowdRating: 'Moderate',
    reliabilityRating: 'Moderate',
    stepFreeAccessible: true,
    whyRecommended: 'fixture',
    steps,
    routeMode: steps.some((step) => step.type === 'cycle')
      ? steps.some((step) => step.type === 'bus' || step.type === 'train') ? 'multimodal' : 'cycle'
      : 'transit',
  };
}

function networkRoute(id: string, duration: number, resourceId?: string): NetworkAwareRoute {
  return {
    id,
    durationMin: duration,
    departureTimeMs: BASE,
    resources: resourceId
      ? [{ resourceId, type: 'STATION', arrivalOffsetMinutes: 10, name: resourceId }]
      : [],
  };
}

function obs(
  resourceId: string,
  crowd: ResourceObservation['currentCrowd'] = 'LOW',
  overrides: Partial<ResourceObservation> = {}
): ResourceObservation {
  return {
    resourceId,
    type: 'STATION',
    name: resourceId,
    observedAtMs: BASE,
    currentCrowd: crowd,
    backgroundDemand15Min: 20,
    capacity15Min: 100,
    ...overrides,
  };
}

function engineWith(observations: ResourceObservation[] = [obs('A'), obs('B')]) {
  const ledger = new RecommendationLedger({ defaultComplianceProbability: 1 });
  const state = new NetworkState({ observations });
  const engine = new NetworkAwareEngine({ networkState: state, recommendationLedger: ledger });
  return { ledger, state, engine };
}

function evaluate(
  engine: NetworkAwareEngine,
  routes: NetworkAwareRoute[],
  costs: Record<string, number> = {},
  incumbentRouteId?: string
) {
  return engine.evaluate(routes, {
    nowMs: BASE,
    incumbentRouteId,
    personalCost: (route) => costs[route.id] ?? route.durationMin,
  });
}

function punggolToOneNorthFixtures(): [RouteOption, RouteOption] {
  const viaSerangoon = routeOption('punggol-onenorth-via-serangoon', 51, [
    { stepNumber: 1, type: 'walk', instruction: 'Walk to Punggol MRT', subText: '5 min', durationMin: 5 },
    {
      stepNumber: 2, type: 'train', instruction: 'Take the North East Line', subText: 'Punggol to Serangoon', durationMin: 20,
      lineOrService: 'NEL', boardingStationCode: 'NE17', alightingStationCode: 'NE12',
      startPoint: { lat: 1.4052, lng: 103.9023, name: 'Punggol' },
      targetPoint: { lat: 1.3497, lng: 103.8737, name: 'Serangoon' },
    },
    {
      stepNumber: 3, type: 'transfer', instruction: 'Transfer at Serangoon', subText: 'NEL to CCL', durationMin: 4,
      startPoint: { lat: 1.3497, lng: 103.8737, name: 'Serangoon NEL' },
      targetPoint: { lat: 1.3497, lng: 103.8737, name: 'Serangoon CCL' },
    },
    {
      stepNumber: 4, type: 'train', instruction: 'Take the Circle Line', subText: 'Serangoon to one-north', durationMin: 18,
      lineOrService: 'CCL', boardingStationCode: 'CC13', alightingStationCode: 'CC23',
      startPoint: { lat: 1.3497, lng: 103.8737, name: 'Serangoon' },
      targetPoint: { lat: 1.2995, lng: 103.7873, name: 'one-north' },
    },
    { stepNumber: 5, type: 'walk', instruction: 'Walk to destination', subText: '4 min', durationMin: 4 },
  ]);
  viaSerangoon.title = 'NEL + CCL via Serangoon';
  viaSerangoon.summary = 'NEL → CCL';

  const viaTampines = routeOption('punggol-onenorth-via-tampines', 58, [
    { stepNumber: 1, type: 'walk', instruction: 'Walk to Punggol interchange', subText: '4 min', durationMin: 4 },
    {
      stepNumber: 2, type: 'bus', instruction: 'Take Bus 118', subText: 'Punggol to Tampines West', durationMin: 18,
      lineOrService: '118', boardingStopCode: '65009', alightingStopCode: '75359',
      startPoint: { lat: 1.4045, lng: 103.902, name: 'Punggol Temporary Bus Interchange' },
      targetPoint: { lat: 1.3457, lng: 103.9384, name: 'Tampines West Station' },
    },
    { stepNumber: 3, type: 'transfer', instruction: 'Enter Tampines West MRT', subText: '3 min', durationMin: 3 },
    {
      stepNumber: 4, type: 'train', instruction: 'Take the Downtown Line', subText: 'Tampines West to MacPherson', durationMin: 12,
      lineOrService: 'DTL', boardingStationCode: 'DT31', alightingStationCode: 'DT26',
      startPoint: { lat: 1.3457, lng: 103.9384, name: 'Tampines West' },
      targetPoint: { lat: 1.3262, lng: 103.8899, name: 'MacPherson' },
    },
    { stepNumber: 5, type: 'transfer', instruction: 'Transfer at MacPherson', subText: 'DTL to CCL', durationMin: 4 },
    {
      stepNumber: 6, type: 'train', instruction: 'Take the Circle Line', subText: 'MacPherson to one-north', durationMin: 13,
      lineOrService: 'CCL', boardingStationCode: 'CC10', alightingStationCode: 'CC23',
      startPoint: { lat: 1.3262, lng: 103.8899, name: 'MacPherson' },
      targetPoint: { lat: 1.2995, lng: 103.7873, name: 'one-north' },
    },
    { stepNumber: 7, type: 'walk', instruction: 'Walk to destination', subText: '4 min', durationMin: 4 },
  ]);
  viaTampines.title = 'Bus 118 + DTL + CCL';
  viaTampines.summary = '118 → DTL → CCL';
  return [viaSerangoon, viaTampines];
}

function printRouteEvaluation(
  label: string,
  result: ReturnType<NetworkAwareEngine<unknown>['evaluate']>
): void {
  console.log(label);
  for (const item of result.rankedRoutes) {
    console.log(
      `${item.route.id}: duration=${item.route.durationMin} personal=${item.personalCost} ` +
      `network=${item.networkCost} fairness=${item.fairness.penalty} total=${item.totalCost} ` +
      `bottleneck=${item.prediction.bottleneckResourceId || 'none'} crowd=${item.prediction.crowdRisk}`
    );
  }
}

const tests: Array<[string, () => void | Promise<void>]> = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push([name, fn]);

test('1 evaluate is pure with respect to ledger', () => {
  const { ledger, engine } = engineWith();
  const route = networkRoute('A', 20, 'A');
  const demandBefore = ledger.getDemand('A', BASE + 10 * 60_000);
  for (let iteration = 0; iteration < 100; iteration += 1) evaluate(engine, [route]);
  equal(ledger.size(), 0, 'evaluate must not issue demand');
  equal(ledger.getDemand('A', BASE + 10 * 60_000), demandBefore, 'evaluate must not change demand');
});

test('2 issueRecommendation records once', () => {
  const { ledger, engine } = engineWith();
  assert(engine.issueRecommendation({ journeyRequestId: 'one', route: networkRoute('A', 20, 'A'), issuedAtMs: BASE, userCountRepresented: 10, complianceProbability: 0.7 }).recorded, 'first issue should record');
  equal(ledger.size(), 1, 'ledger size');
  equal(ledger.getDemand('A', BASE + 10 * 60_000), 7, 'explicit expected demand');
});

test('3 journeyRequestId is idempotent', () => {
  const { ledger, engine } = engineWith();
  const route = networkRoute('A', 20, 'A');
  engine.issueRecommendation({ journeyRequestId: 'same', route, issuedAtMs: BASE });
  assert(!engine.issueRecommendation({ journeyRequestId: 'same', route, issuedAtMs: BASE }).recorded, 'second issue should deduplicate');
  equal(ledger.size(), 1, 'duplicate request must not add entry');
});

test('4 stable OneMap signatures distinguish itinerary variants', () => {
  const transit = { routeMode: 'transit', startId: 'NE17', endId: 'CC23', legs: [{ mode: 'train', lineOrService: 'NEL', fromId: 'NE17', toId: 'NE12' }] };
  const first = createStableRouteId(transit);
  equal(first, createStableRouteId({ ...transit, legs: transit.legs.map((leg) => ({ ...leg })) }), 'same itinerary stable ID');
  assert(first !== createStableRouteId({ ...transit, legs: [{ ...transit.legs[0], toId: 'NE6' }] }), 'different itinerary must differ');
  assert(createStableRouteId({ ...transit, routeMode: 'cycle' }) !== createStableRouteId({ ...transit, routeMode: 'bike-transit' }), 'cycle and bike-and-ride must differ');
  const bus96 = createStableRouteId({ ...transit, legs: [{ mode: 'bus', lineOrService: '96', fromId: '18331', toId: '01059' }] });
  const bus151 = createStableRouteId({ ...transit, legs: [{ mode: 'bus', lineOrService: '151', fromId: '18331', toId: '01059' }] });
  assert(bus96 !== bus151, 'different bus services must differ');
});

test('5 Punggol/Serangoon interchange remains line-aware', () => {
  equal(normalizeLineToCode('NE'), 'NEL', 'OneMap NE alias');
  equal(normalizeLineToCode('CC'), 'CCL', 'OneMap CC alias');
  equal(resolveStationByNameAndLine('Serangoon', 'NEL')?.code, 'NE12', 'NEL Serangoon');
  equal(resolveStationByNameAndLine('Serangoon', 'CCL')?.code, 'CC13', 'CCL Serangoon');
  const [route] = punggolToOneNorthFixtures();
  const adapted = adaptTransitCompanionRoute(route);
  const ids = adapted.resources.map((resource) => resource.resourceId);
  assert(ids.includes('STATION_NE17') && ids.includes('RAIL_NEL_NE17_NE12'), 'NEL resources missing');
  assert(ids.includes('STATION_NE12') && ids.includes('STATION_CC13'), 'line-specific interchange resources missing');
  assert(ids.includes('RAIL_CCL_CC13_CC23') && ids.includes('STATION_CC23'), 'CCL resources missing');
  assert(!ids.includes('RAIL_NEL_NE17_CC13'), 'adapter guessed the wrong Serangoon platform');
});

test('6 bus adapter emits service and boarding stop resources', () => {
  const adapted = adaptTransitCompanionRoute(routeOption('bus', 15, [{
    stepNumber: 1, type: 'bus', instruction: 'Human text intentionally says Bus 151', subText: '', durationMin: 15,
    lineOrService: '96', boardingStopCode: '18331', alightingStopCode: '01059',
  }]));
  const ids = adapted.resources.map((resource) => resource.resourceId);
  assert(ids.includes('BUS_SERVICE_96') && ids.includes('BUS_STOP_18331'), 'bus resources missing');
  assert(!ids.includes('BUS_SERVICE_151'), 'adapter must not parse instruction text over structured fields');
});

test('7 cycling-only route invents no transit resources', () => {
  const route = routeOption('cycle', 20, [{ stepNumber: 1, type: 'cycle', instruction: '', subText: '', durationMin: 20 }]);
  equal(adaptTransitCompanionRoute(route).resources.length, 0, 'cycle resource count');
});

test('8 bike-and-ride includes only later transit resources', () => {
  const route = routeOption('bike-ride', 35, [
    { stepNumber: 1, type: 'cycle', instruction: '', subText: '', durationMin: 10 },
    { stepNumber: 2, type: 'transfer', instruction: '', subText: '', durationMin: 3 },
    { stepNumber: 3, type: 'train', instruction: '', subText: '', durationMin: 22, lineOrService: 'NEL', boardingStationCode: 'NE12', alightingStationCode: 'NE6' },
  ]);
  const resources = adaptTransitCompanionRoute(route).resources;
  assert(resources.some((resource) => resource.resourceId === 'RAIL_NEL_NE12_NE6'), 'transit portion missing');
  assert(resources.every((resource) => !resource.resourceId.includes('CYCLE')), 'cycle must not be a transit resource');
});

test('9 duplicate resource and bucket counts one passenger', () => {
  const ledger = new RecommendationLedger({ defaultComplianceProbability: 1 });
  ledger.issueRecommendation({ journeyRequestId: 'dup', issuedAtMs: BASE, route: {
    id: 'dup', durationMin: 20, departureTimeMs: BASE, resources: [
      { resourceId: 'A', type: 'STATION', arrivalOffsetMinutes: 10 },
      { resourceId: 'a', type: 'STATION', arrivalOffsetMinutes: 11 },
    ],
  }});
  equal(ledger.getEntries()[0].resourceDemands.length, 1, 'resource bucket dedup');
});

test('10 unresolved station remains line-specific UNKNOWN', () => {
  equal(resolveStationByNameAndLine('Serangoon', 'Sengkang LRT'), null, 'unsupported LRT should not resolve');
  const route = routeOption('unknown-train', 10, [{ stepNumber: 1, type: 'train', instruction: '', subText: '', durationMin: 10, lineOrService: 'Sengkang LRT', startPoint: { lat: 1, lng: 1, name: 'Serangoon' }, targetPoint: { lat: 1, lng: 1, name: 'Unknown' } }]);
  assert(adaptTransitCompanionRoute(route).resources.some((resource) => resource.resourceId.startsWith('STATION_UNKNOWN_')), 'unknown resource expected');
});

test('11 LTA PCD l/m/h mapping is exact', () => {
  equal(mapPcdCode('l'), 'LOW', 'l'); equal(mapPcdCode('m'), 'MODERATE', 'm'); equal(mapPcdCode('h'), 'HIGH', 'h');
});

test('12 missing PCD remains UNKNOWN', () => equal(mapPcdCode(undefined), 'UNKNOWN', 'missing PCD'));

test('13 current crowd decays over horizon', () => {
  const { ledger, state } = engineWith([obs('A', 'HIGH', { backgroundDemand15Min: 0 })]);
  const near = state.predictResource('A', BASE + 5 * 60_000, ledger, BASE);
  const far = state.predictResource('A', BASE + 45 * 60_000, ledger, BASE);
  assert(near.components.currentCrowdCarryover > far.components.currentCrowdCarryover, 'carryover must decay');
});

test('14 issued demand raises network cost', () => {
  const { engine } = engineWith([obs('A', 'LOW', { backgroundDemand15Min: 0 })]);
  const route = networkRoute('A', 20, 'A');
  const before = evaluate(engine, [route]).recommended?.networkCost || 0;
  engine.issueRecommendation({ journeyRequestId: 'load', route, userCountRepresented: 100, complianceProbability: 1, issuedAtMs: BASE });
  const after = evaluate(engine, [route]).recommended?.networkCost || 0;
  assert(after > before, 'network cost should rise');
});

test('15 controlled feedback can shift winner', () => {
  const { engine } = engineWith([obs('A', 'LOW', { backgroundDemand15Min: 0 }), obs('B', 'LOW', { backgroundDemand15Min: 0 })]);
  const a = networkRoute('A', 20, 'A'); const b = networkRoute('B', 24, 'B');
  equal(evaluate(engine, [a, b]).recommended?.route.id, 'A', 'initial winner');
  engine.issueRecommendation({ journeyRequestId: 'crowd-a', route: a, userCountRepresented: 100, complianceProbability: 1, issuedAtMs: BASE });
  equal(evaluate(engine, [a, b]).recommended?.route.id, 'B', 'shifted winner');
});

test('15b shared bottleneck affects sharing routes but not Route C', () => {
  const { engine } = engineWith([
    obs('SHARED', 'LOW', { backgroundDemand15Min: 0 }),
    obs('CLEAR', 'LOW', { backgroundDemand15Min: 0 }),
  ]);
  const routeA = networkRoute('shared-a', 30, 'SHARED');
  const routeB = networkRoute('shared-b', 32, 'SHARED');
  const routeC = networkRoute('clear-c', 34, 'CLEAR');
  const before = evaluate(engine, [routeA, routeB, routeC]);
  engine.issueRecommendation({ journeyRequestId: 'shared-load', route: routeA, issuedAtMs: BASE, userCountRepresented: 70, complianceProbability: 1 });
  const after = evaluate(engine, [routeA, routeB, routeC]);
  const cost = (result: typeof before, id: string) => result.rankedRoutes.find((item) => item.route.id === id)?.networkCost || 0;
  assert(cost(after, 'shared-a') > cost(before, 'shared-a'), 'Route A shared pressure missing');
  assert(cost(after, 'shared-b') > cost(before, 'shared-b'), 'Route B shared pressure missing');
  equal(cost(after, 'clear-c'), cost(before, 'clear-c'), 'unrelated Route C should be unaffected');
});

test('16 hysteresis blocks trivial switching', () => {
  const { engine } = engineWith([obs('A', 'LOW', { backgroundDemand15Min: 0 }), obs('B', 'LOW', { backgroundDemand15Min: 0 })]);
  equal(evaluate(engine, [networkRoute('A', 20, 'A'), networkRoute('B', 20, 'B')], { A: 20, B: 19 }, 'A').recommended?.route.id, 'A', 'incumbent should hold');
});

test('16b repeated hysteresis sequence has bounded switching', () => {
  const { engine } = engineWith([
    obs('A', 'LOW', { backgroundDemand15Min: 0, capacity15Min: 450 }),
    obs('B', 'LOW', { backgroundDemand15Min: 0, capacity15Min: 450 }),
  ]);
  const a = networkRoute('A', 50, 'A');
  const b = networkRoute('B', 51, 'B');
  let incumbent: string | undefined = 'A';
  let switches = 0;
  for (let iteration = 0; iteration < 120; iteration += 1) {
    const result = evaluate(engine, [a, b], {}, incumbent);
    const chosen = result.recommended?.route.id;
    assert(chosen === 'A' || chosen === 'B', 'near-tie must produce a route');
    if (chosen !== incumbent) switches += 1;
    incumbent = chosen;
    engine.issueRecommendation({ journeyRequestId: `hysteresis-${iteration}`, route: chosen === 'A' ? a : b, issuedAtMs: BASE, userCountRepresented: 1, complianceProbability: 1 });
  }
  assert(switches < 30, `hysteresis switching was not bounded: ${switches}`);
});

test('17 extreme detour fails fairness', () => {
  const { engine } = engineWith([obs('A'), obs('B')]);
  const result = evaluate(engine, [networkRoute('fast', 20, 'A'), networkRoute('detour', 60, 'B')], { fast: 20, detour: 0 });
  const detour = result.rankedRoutes.find((item) => item.route.id === 'detour');
  assert(detour && !detour.fairness.isFair, 'extreme detour should be unfair');
  equal(result.recommended?.route.id, 'fast', 'fair route must win');
});

test('17b reasonable 4–8 minute detour may win under pressure', () => {
  const { engine } = engineWith([
    obs('PRESSURED', 'HIGH', { backgroundDemand15Min: 65, capacity15Min: 100 }),
    obs('RELIEF', 'LOW', { backgroundDemand15Min: 0, capacity15Min: 100 }),
  ]);
  const result = evaluate(
    engine,
    [networkRoute('fast-50', 50, 'PRESSURED'), networkRoute('relief-56', 56, 'RELIEF')],
    { 'fast-50': 50, 'relief-56': 56 }
  );
  const relief = result.rankedRoutes.find((item) => item.route.id === 'relief-56');
  assert(relief?.fairness.isFair, 'six-minute detour should remain within fairness allowance');
  equal(result.recommended?.route.id, 'relief-56', 'reasonable lower-pressure detour may win');
});

test('fairness A uses the slower personal preference as baseline', () => {
  const { engine } = engineWith([obs('A'), obs('B')]);
  const preferred = networkRoute('preferred-40', 40, 'A');
  const faster = networkRoute('faster-30', 30, 'B');
  const result = evaluate(engine, [preferred, faster], { 'preferred-40': 50, 'faster-30': 55 });
  equal(result.personalBaselineRouteId, preferred.id, 'personal baseline');
  equal(result.rankedRoutes.find((item) => item.route.id === preferred.id)?.fairness.sacrificeMin, 0, 'preferred route sacrifice');
  equal(result.recommended?.route.id, preferred.id, 'faster route must not displace personal choice through fairness');
});

test('fairness B measures a five-minute network sacrifice', () => {
  const { engine } = engineWith([obs('A'), obs('B')]);
  const baseline = networkRoute('baseline-50', 50, 'A');
  const alternative = networkRoute('alternative-55', 55, 'B');
  const result = evaluate(engine, [baseline, alternative], { 'baseline-50': 50, 'alternative-55': 55 });
  const fairness = result.rankedRoutes.find((item) => item.route.id === alternative.id)!.fairness;
  equal(fairness.sacrificeMin, 5, 'five-minute sacrifice');
  assert(fairness.isFair, 'five-minute sacrifice should use existing free margin');
});

test('fairness C gives a faster alternative zero sacrifice', () => {
  const { engine } = engineWith([obs('A'), obs('B')]);
  const baseline = networkRoute('baseline-50', 50, 'A');
  const alternative = networkRoute('alternative-45', 45, 'B');
  const result = evaluate(engine, [baseline, alternative], { 'baseline-50': 50, 'alternative-45': 55 });
  equal(result.rankedRoutes.find((item) => item.route.id === alternative.id)?.fairness.sacrificeMin, 0, 'faster alternative sacrifice');
});

test('fairness D preserves the absolute extreme-detour guardrail', () => {
  const { engine } = engineWith([obs('A'), obs('B')]);
  const baseline = networkRoute('baseline-50', 50, 'A');
  const alternative = networkRoute('alternative-90', 90, 'B');
  const result = evaluate(engine, [baseline, alternative], { 'baseline-50': 50, 'alternative-90': 55 });
  const fairness = result.rankedRoutes.find((item) => item.route.id === alternative.id)!.fairness;
  assert(!fairness.isFair && (fairness.absoluteSacrificeMin || 0) > 25, 'absolute guardrail');
});

test('fairness E leave 20 minutes later has 20-minute arrival sacrifice', () => {
  const { engine } = engineWith([obs('A'), obs('B')]);
  const baseline = networkRoute('now', 50, 'A');
  const later = { ...networkRoute('later', 50, 'B'), departureTimeMs: BASE + 20 * 60_000 };
  const result = evaluate(engine, [baseline, later], { now: 50, later: 70 });
  equal(result.rankedRoutes.find((item) => item.route.id === later.id)?.fairness.sacrificeMin, 20, 'later arrival sacrifice');
});

test('fairness F later departure with earlier arrival has zero sacrifice', () => {
  const { engine } = engineWith([obs('A'), obs('B')]);
  const baseline = networkRoute('now', 50, 'A');
  const laterFast = { ...networkRoute('later-fast', 25, 'B'), departureTimeMs: BASE + 20 * 60_000 };
  const result = evaluate(engine, [baseline, laterFast], { now: 50, 'later-fast': 55 });
  equal(result.rankedRoutes.find((item) => item.route.id === laterFast.id)?.fairness.sacrificeMin, 0, 'earlier arrival sacrifice');
});

test('Clementi regression keeps slower personally preferred bus unpenalized', () => {
  const { engine } = engineWith([obs('BUS'), obs('TRAIN')]);
  const bus = networkRoute('clementi-bus-40', 40, 'BUS');
  const train = networkRoute('clementi-train-27', 27, 'TRAIN');
  const result = evaluate(engine, [bus, train], { 'clementi-bus-40': 52, 'clementi-train-27': 56 });
  equal(result.personalBaselineRouteId, bus.id, 'Clementi personal baseline');
  equal(result.rankedRoutes.find((item) => item.route.id === bus.id)?.fairness.penalty, 0, 'bus fairness penalty');
  equal(result.recommended?.route.id, bus.id, 'equal-pressure winner');
});

test('18 disabled cycling cannot define fairness baseline', () => {
  const cycling = routeOption('cycle-fast', 5, [{ stepNumber: 1, type: 'cycle', instruction: '', subText: '', durationMin: 5 }]);
  const transit = routeOption('transit', 20, [{ stepNumber: 1, type: 'train', instruction: '', subText: '', durationMin: 20, lineOrService: 'CCL' }]);
  const disabled = { ...preferences, transportModes: { ...preferences.transportModes, cycling: false } };
  const eligible = filterNetworkAwareEligibleRoutes([cycling, transit], disabled);
  equal(eligible.length, 1, 'eligible count'); equal(eligible[0].id, 'transit', 'eligible route');
});

test('19 inaccessible route is ineligible when step-free is required', () => {
  const route = { ...routeOption('stairs'), stepFreeAccessible: false };
  equal(filterNetworkAwareEligibleRoutes([route], { ...preferences, stepFreeAccess: true }).length, 0, 'accessibility eligibility');
});

test('20 engine evaluation keeps legacy ranking pure before presentation promotion', () => {
  const routes = [routeOption('visible-a', 20), routeOption('visible-b', 25)];
  const visibleBefore = rankRoutes(routes, preferences)[0].id;
  const runtime = createNetworkAwareRuntime();
  runtime.evaluate({ routes, nowMs: BASE, personalCostByRouteId: { 'visible-a': 20, 'visible-b': 0 } });
  const visibleAfter = rankRoutes(routes, preferences)[0].id;
  equal(visibleAfter, visibleBefore, 'visible rank must be independent');
});

test('21 shadow runtime evaluation issues no ledger demand', () => {
  const runtime = createNetworkAwareRuntime();
  runtime.evaluate({ routes: [routeOption('a')], nowMs: BASE, personalCostByRouteId: { a: 30 } });
  equal(runtime.ledger.size(), 0, 'shadow ledger');
});

test('22 non-demo routing failure does not substitute demo routes', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/screens/JourneyPlannerScreen.tsx'), 'utf8');
  assert(source.includes('routes = isDefaultCorridor ? MOCK_ROUTES_KENT_RIDGE_TO_BUGIS : [];'), 'safe fallback missing');
});

test('23 live startup does not inject mock disruption', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8');
  assert(source.includes('useState<DisruptionAlert | null>(null)') && source.includes('fetchDisruptions(false)'), 'live startup safety missing');
  assert(!source.includes('useState<DisruptionAlert | null>(MOCK_DISRUPTION_ALERT)'), 'mock disruption still injected');
});

test('24 cleared live disruption clears stale state', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8');
  assert(source.includes('setDisruption(disr?.disruptions?.[0] ?? null)'), 'stale disruption clear missing');
});

test('25 unknown resource receives conservative treatment', () => {
  const { engine } = engineWith([]);
  const result = evaluate(engine, [networkRoute('unknown', 20, 'NOT_OBSERVED')]);
  equal(result.recommended?.prediction.crowdRisk, 'UNKNOWN', 'unknown crowd risk');
  assert((result.recommended?.networkCost || 0) > 0, 'unknown uncertainty penalty missing');
});

test('network-aware personal score excludes route crowdRating', () => {
  const low = routeOption('low'); low.crowdRating = 'Low';
  const high = { ...low, id: 'high', crowdRating: 'High' as const };
  equal(scorePersonalCostForNetworkAware(low, preferences).totalCost, scorePersonalCostForNetworkAware(high, preferences).totalCost, 'crowd must not be double-counted');
});

test('shared personal foundation explains zero-pressure ranking', () => {
  const a = routeOption('personal-fast', 27, [{ stepNumber: 1, type: 'train', instruction: '', subText: '', durationMin: 27, lineOrService: 'CCL' }]);
  const b = routeOption('personal-slow', 40, [{ stepNumber: 1, type: 'bus', instruction: '', subText: '', durationMin: 40, lineOrService: '96' }]);
  a.crowdRating = b.crowdRating = 'Moderate';
  const visible = rankRoutes([a, b], preferences)[0].id;
  const personal = [a, b].sort((x, y) => scorePersonalCostForNetworkAware(x, preferences).totalCost - scorePersonalCostForNetworkAware(y, preferences).totalCost)[0].id;
  equal(personal, visible, 'neutral-network personal winner should be explainable from shared base');
});

test('promotion makes a valid network-aware winner visible BEST MATCH', () => {
  const legacy = [routeOption('legacy', 30), routeOption('network', 35)];
  const promoted = promoteNetworkAwareRoutes(legacy, legacy, {
    recommendedRouteId: 'network',
    rankedRoutes: [{ routeId: 'network', decisionReasonCode: 'NETWORK_PRESSURE', bottleneckResourceName: 'Serangoon' }],
  });
  assert(promoted.networkAware, 'promotion expected');
  equal(promoted.bestMatch?.id, 'network', 'promoted winner');
  equal(promoted.routes[0].badge, 'BEST MATCH', 'best badge');
});

test('promotion safely falls back on failed or invalid evaluation', () => {
  const legacy = [routeOption('legacy', 30), routeOption('other', 35)];
  equal(promoteNetworkAwareRoutes(legacy, legacy, null).bestMatch?.id, 'legacy', 'failed evaluation fallback');
  const invalid = promoteNetworkAwareRoutes(legacy, legacy, {
    recommendedRouteId: 'stale',
    rankedRoutes: [{ routeId: 'stale', decisionReasonCode: 'FASTER_ROUTE' }],
  });
  assert(!invalid.networkAware, 'invalid winner must not promote');
  equal(invalid.bestMatch?.id, 'legacy', 'invalid winner fallback');
});

test('promoted winner is first without duplication', () => {
  const legacy = [routeOption('a', 30), routeOption('b', 35), routeOption('c', 40)];
  const promoted = promoteNetworkAwareRoutes(legacy, legacy, {
    recommendedRouteId: 'b', rankedRoutes: [{ routeId: 'b', decisionReasonCode: 'PERSONAL_PREFERENCE' }],
  });
  equal(promoted.routes.map((route) => route.id).join(','), 'b,a,c', 'deterministic order');
  equal(new Set(promoted.routes.map((route) => route.id)).size, 3, 'no duplicate');
});

test('leave-now, +20, +40 and arrival timing are explicit', () => {
  equal(departureLabel(0), 'Leave now', 'now label');
  equal(departureLabel(20), 'Leave in 20 min', '+20 label');
  equal(departureLabel(40), 'Leave in 40 min', '+40 label');
  const later = { ...routeOption('later', 51), networkAwareDepartureDelayMin: 20 };
  equal(arrivalOffsetMinutes(later), 71, 'leave-later arrival offset');
});

test('commuter explanations accurately map structured reasons', () => {
  const route = { ...routeOption('reason'), networkAwareDepartureDelayMin: 20 };
  const explain = (decisionReasonCode: Parameters<typeof commuterExplanation>[0]['decisionReasonCode']) =>
    commuterExplanation({ routeId: route.id, decisionReasonCode, bottleneckResourceName: 'Serangoon' }, route);
  assert(/expected network pressure/i.test(explain('NETWORK_PRESSURE')), 'pressure wording');
  assert(!/crowd|pressure/i.test(explain('PERSONAL_PREFERENCE')), 'personal wording must not claim crowding');
  assert(!/crowd|pressure/i.test(explain('FASTER_ROUTE')), 'faster wording must not claim crowding');
  assert(/20 min later/i.test(explain('FLEXIBLE_DEPARTURE')), 'flexible wording');
  assert(!/hysteresis/i.test(explain('HYSTERESIS_RETAINED')), 'technical hysteresis wording leaked');
  assert(/limited crowding data/i.test(explain('UNKNOWN_DATA_CAUTION')), 'unknown caution wording');
  assert(!/uncongested|low crowd/i.test(explain('UNKNOWN_DATA_CAUTION')), 'unknown presented as uncongested');
});

test('recommendation issuance tracker claims once across rerenders', () => {
  const tracker = new RecommendationIssuanceTracker();
  assert(tracker.claim('journey-a'), 'first presentation should issue');
  assert(!tracker.claim('journey-a'), 'rerender must not issue twice');
  assert(tracker.claim('journey-b'), 'new journey can issue');
});

test('journey request IDs are stable per decision and change for new planning input', () => {
  const keyA = journeyDecisionKey('Punggol', 'one-north', 0, true);
  const keyB = journeyDecisionKey('Punggol', 'one-north', 20, true);
  equal(createJourneyRequestId('session', keyA), createJourneyRequestId('session', keyA), 'stable request ID');
  assert(createJourneyRequestId('session', keyA) !== createJourneyRequestId('session', keyB), 'new departure decision ID');
});

test('fallback and nonwinning alternatives are never claimed for issuance', () => {
  const tracker = new RecommendationIssuanceTracker();
  const legacy = [routeOption('legacy'), routeOption('alternative')];
  const fallback = promoteNetworkAwareRoutes(legacy, legacy, null);
  if (fallback.networkAware) tracker.claim('fallback');
  equal(tracker.claim('fallback'), true, 'fallback path must not have issued');
  const promoted = promoteNetworkAwareRoutes(legacy, legacy, {
    recommendedRouteId: 'alternative', rankedRoutes: [{ routeId: 'alternative', decisionReasonCode: 'FASTER_ROUTE' }],
  });
  equal(promoted.routes.filter((route) => route.networkAwareRecommendation).length, 1, 'only winner marked for issuance');
});

test('mock candidate cannot be promoted as live network-aware BEST MATCH', () => {
  const legacy = [routeOption('live')];
  const mock = { ...routeOption('mock'), dataSource: 'mock' as const };
  const promoted = promoteNetworkAwareRoutes(legacy, [mock], {
    recommendedRouteId: mock.id, rankedRoutes: [{ routeId: mock.id, decisionReasonCode: 'FASTER_ROUTE' }],
  });
  assert(!promoted.networkAware && promoted.bestMatch?.id === 'live', 'mock promotion blocked');
});

test('shadow candidate builder preserves topology and distinguishes departure', () => {
  const now = routeOption('stable-topology', 40); now.departureTimeMs = BASE;
  const later = { ...now, departureTimeMs: BASE + 20 * 60_000 };
  const candidates = buildNetworkAwareCandidateSet([
    { routes: [now], source: 'immediate-transit' },
    { routes: [later], source: 'later-transit' },
  ], preferences);
  equal(candidates.length, 2, 'temporal candidate count');
  assert(candidates[0].id !== candidates[1].id, 'departure variants need distinct shadow IDs');
  equal(candidates[1].networkAwareBaseRouteId, 'stable-topology', 'base topology ID retained');
  equal(candidates[1].networkAwareDepartureDelayMin, 20, 'delay metadata');
  equal(candidates[1].totalDurationMin, 40, 'displayed duration remains trip duration');
  equal(scorePersonalCostForNetworkAware(candidates[1], preferences).timeCost, 60, 'wait counts in generalized personal time');
});

test('leave-later uses shifted ledger buckets in the same engine', () => {
  const now = routeOption('temporal', 40, [{ stepNumber: 1, type: 'train', instruction: '', subText: '', durationMin: 20, lineOrService: 'CCL', boardingStationCode: 'CC13', alightingStationCode: 'CC23' }]);
  const later = { ...now, departureTimeMs: BASE + 20 * 60_000 };
  const candidates = buildNetworkAwareCandidateSet([
    { routes: [now], source: 'immediate-transit' },
    { routes: [later], source: 'later-transit' },
  ], preferences);
  const adapted = candidates.map((route) => adaptTransitCompanionRoute(route));
  const observations = adapted.flatMap((route) => route.resources).map((resource) => obs(resource.resourceId, 'LOW', { backgroundDemand15Min: 0 }));
  const { engine } = engineWith(observations);
  engine.issueRecommendation({ journeyRequestId: 'now-pressure', route: adapted[0], issuedAtMs: BASE, userCountRepresented: 25, complianceProbability: 0.7 });
  const result = evaluate(engine, adapted, Object.fromEntries(candidates.map((route) => [route.id, scorePersonalCostForNetworkAware(route, preferences).totalCost])));
  const nowCost = result.rankedRoutes.find((item) => item.route.id === adapted[0].id)?.networkCost ?? 0;
  const laterCost = result.rankedRoutes.find((item) => item.route.id === adapted[1].id)?.networkCost ?? 0;
  assert(nowCost > laterCost, 'earlier bucket pressure must not leak into +20 minute candidate');
});

test('bus-stop pagination is atomic and deduplicated', async () => {
  const complete = await collectCompleteOffsetPages({
    pageSize: 2,
    maxPages: 5,
    keyOf: (item: { code: string }) => item.code,
    fetchPage: async (skip) => skip === 0 ? [{ code: '1' }, { code: '2' }] : skip === 2 ? [{ code: '2' }, { code: '3' }] : [],
  });
  assert(complete.complete, 'terminal short page expected');
  equal(complete.items.length, 3, 'duplicates removed');
  const partial = await collectCompleteOffsetPages({
    pageSize: 2,
    maxPages: 5,
    keyOf: (item: { code: string }) => item.code,
    fetchPage: async (skip) => { if (skip === 2) throw new Error('transient'); return [{ code: '1' }, { code: '2' }]; },
  });
  assert(!partial.complete && partial.items.length === 0, 'partial pages must never replace cache');
});

test('decision reason distinguishes pressure, speed, and hysteresis', () => {
  const { engine } = engineWith([obs('A', 'LOW', { backgroundDemand15Min: 0 }), obs('B', 'LOW', { backgroundDemand15Min: 0 })]);
  const a = networkRoute('A', 20, 'A'); const b = networkRoute('B', 21, 'B');
  equal(evaluate(engine, [a, b]).recommended?.decisionReasonCode, 'PERSONAL_PREFERENCE', 'personal baseline reason');
  equal(evaluate(engine, [a, b], { A: 20, B: 19 }, 'A').recommended?.decisionReasonCode, 'HYSTERESIS_RETAINED', 'hysteresis reason');
  engine.issueRecommendation({ journeyRequestId: 'reason-pressure', route: a, issuedAtMs: BASE, userCountRepresented: 30, complianceProbability: 1 });
  equal(evaluate(engine, [a, b]).recommended?.decisionReasonCode, 'NETWORK_PRESSURE', 'pressure reason');
});

test('normalized proxy sensitivity is monotonic and documented', () => {
  console.log('\nNORMALIZED PROXY SENSITIVITY (not passenger-count calibration)');
  for (const baseline of ['LOW', 'MODERATE', 'HIGH'] as const) {
    console.log(`${baseline} BASELINE`);
    let previousCost = -1;
    for (const represented of [0, 10, 25, 50, 75, 100]) {
      const route = networkRoute(`${baseline}-${represented}`, 30, 'SENSITIVITY');
      const ledger = new RecommendationLedger();
      const state = new NetworkState({ observations: [obs('SENSITIVITY', baseline, {
        backgroundDemand15Min: proxyDemandForCrowd(baseline),
        capacity15Min: NETWORK_PROXY_CAPACITY_15_MIN,
      })] });
      const engine = new NetworkAwareEngine({ networkState: state, recommendationLedger: ledger });
      if (represented > 0) engine.issueRecommendation({ journeyRequestId: `s-${baseline}-${represented}`, route, issuedAtMs: BASE, userCountRepresented: represented });
      const item = evaluate(engine, [route]).recommended!;
      const resource = item.prediction.resourcePredictions[0];
      assert(item.networkCost >= previousCost, 'network cost must be monotonic');
      previousCost = item.networkCost;
      console.log(`${represented.toString().padStart(3)} users -> expected ${(represented * 0.7).toFixed(1).padStart(4)} -> utilization ${resource.loadRatio.toFixed(2)} -> ${resource.crowdRisk.padEnd(8)} -> cost ${item.networkCost}`);
    }
  }
});

test('Punggol to one-north RouteOption shadow feedback scenario', () => {
  const [routeA, routeB] = punggolToOneNorthFixtures();
  const existingWinnerBefore = rankRoutes([routeA, routeB], preferences)[0].id;
  const adaptedA = adaptTransitCompanionRoute(routeA);
  const adaptedB = adaptTransitCompanionRoute(routeB);
  const observationsById = new Map<string, ResourceObservation>();
  for (const resource of [...adaptedA.resources, ...adaptedB.resources]) {
    observationsById.set(resource.resourceId, {
      resourceId: resource.resourceId,
      type: resource.type,
      name: resource.name,
      observedAtMs: BASE,
      currentCrowd: 'LOW',
      backgroundDemand15Min: 0,
      capacity15Min: 100,
    });
  }
  const { ledger, engine } = engineWith(Array.from(observationsById.values()));
  const personalCosts = {
    [routeA.id]: scorePersonalCostForNetworkAware(routeA, preferences).totalCost,
    [routeB.id]: scorePersonalCostForNetworkAware(routeB, preferences).totalCost,
  };
  const before = evaluate(engine, [adaptedA, adaptedB], personalCosts);
  equal(before.recommended?.route.id, routeA.id, 'Route A should initially be preferred');
  const routeABefore = before.rankedRoutes.find((item) => item.route.id === routeA.id);
  const routeBBefore = before.rankedRoutes.find((item) => item.route.id === routeB.id);
  assert(routeABefore && routeBBefore, 'both Punggol alternatives must be evaluated');

  console.log('\nPUNGGOL → ONE-NORTH SHADOW TEST');
  console.log('\nBEFORE');
  console.log(`Existing winner: ${existingWinnerBefore}`);
  console.log(`Network-aware winner: ${before.recommended?.route.id}`);
  printRouteEvaluation('Route comparison:', before);

  const issued = engine.issueRecommendation({
    journeyRequestId: 'punggol-shadow-pressure',
    route: before.recommended!.route,
    issuedAtMs: BASE,
    userCountRepresented: 100,
    complianceProbability: 0.7,
  });
  assert(issued.recorded, 'Punggol pressure issuance must record');
  const entry = ledger.getEntries()[0];
  equal(entry.expectedPassengerContribution, 70, 'expected compliant demand');

  console.log('\nSEEDED');
  console.log('Represented commuters: 100');
  console.log(`Expected compliant demand: ${entry.expectedPassengerContribution}`);

  const after = evaluate(engine, [adaptedA, adaptedB], personalCosts);
  const routeAAfter = after.rankedRoutes.find((item) => item.route.id === routeA.id);
  const routeBAfter = after.rankedRoutes.find((item) => item.route.id === routeB.id);
  assert(routeAAfter && routeBAfter, 'both routes must remain evaluated after pressure');
  assert(routeAAfter.networkCost > routeABefore.networkCost, 'seeded route network cost must increase');
  equal(routeBAfter.networkCost, routeBBefore.networkCost, 'route avoiding seeded time/resource buckets must remain unaffected');
  const existingWinnerAfter = rankRoutes([routeA, routeB], preferences)[0].id;
  equal(existingWinnerAfter, existingWinnerBefore, 'legacy rankRoutes output must remain pure');
  equal(ledger.size(), 1, 'evaluation after issuance must not mutate ledger');
  const promoted = promoteNetworkAwareRoutes(rankRoutes([routeA, routeB], preferences), [routeA, routeB], {
    recommendedRouteId: after.recommended?.route.id ?? null,
    rankedRoutes: after.rankedRoutes.map((item) => ({
      routeId: item.route.id,
      decisionReasonCode: item.decisionReasonCode,
      bottleneckResourceId: item.prediction.bottleneckResourceId,
      bottleneckResourceName: item.prediction.bottleneckResourceName,
    })),
  });
  equal(promoted.bestMatch?.id, after.recommended?.route.id, 'user-facing BEST MATCH follows network-aware winner');

  console.log('\nAFTER');
  console.log(`Route A network cost: ${routeAAfter.networkCost} (was ${routeABefore.networkCost})`);
  console.log(`Route B network cost: ${routeBAfter.networkCost} (was ${routeBBefore.networkCost})`);
  console.log(`Old network-aware winner: ${before.recommended?.route.id}`);
  console.log(`New network-aware winner: ${after.recommended?.route.id}`);
  console.log(`Legacy fallback remains: ${existingWinnerAfter}`);
  console.log(`Promoted visible winner: ${promoted.bestMatch?.id}`);
  console.log(`Reason: ${after.recommended?.reason || 'none'}`);
});

test('1,000-evaluation deterministic stress/fuzz', () => {
  let seed = 0x5eed1234;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  const observations = Array.from({ length: 12 }, (_, index) =>
    obs(`R${index}`, (['LOW', 'MODERATE', 'HIGH'] as const)[index % 3], {
      backgroundDemand15Min: index * 4,
      capacity15Min: 80 + index,
    })
  );
  const { ledger, engine } = engineWith(observations);

  for (let iteration = 0; iteration < 1000; iteration += 1) {
    const count = iteration % 23 === 0 ? 1 : 2 + Math.floor(random() * 4);
    const routes: NetworkAwareRoute[] = Array.from({ length: count }, (_, index) => ({
      id: `F${iteration}-${index}`,
      durationMin: 5 + Math.floor(random() * 70),
      departureTimeMs: BASE + Math.floor(random() * 55) * 60_000,
      resources: index === 0 && iteration % 19 === 0 ? [] : Array.from(
        { length: Math.floor(random() * 5) },
        () => ({
          resourceId: random() < 0.12 ? `UNKNOWN_${Math.floor(random() * 5)}` : `R${Math.floor(random() * 12)}`,
          type: 'STATION' as const,
          arrivalOffsetMinutes: Math.floor(random() * 60),
        })
      ),
    }));
    const costs = Object.fromEntries(routes.map((route) => [route.id, Math.floor(random() * 100)]));
    const first = evaluate(engine, routes, costs);
    const second = evaluate(engine, [...routes].reverse(), costs);
    equal(first.rankedRoutes.map((item) => item.route.id).join(','), second.rankedRoutes.map((item) => item.route.id).join(','), `stable sort iteration ${iteration}`);
    for (const item of first.rankedRoutes) {
      assert(Number.isFinite(item.totalCost) && Number.isFinite(item.networkCost), `finite score iteration ${iteration}`);
      assert(item.networkCost >= 0 && item.networkCost <= 80, `bounded network cost iteration ${iteration}`);
      const earliestArrival = Math.min(...routes.map((route) =>
        route.arrivalTimeMs ?? route.departureTimeMs + route.durationMin * 60_000
      ));
      const itemArrival = item.route.arrivalTimeMs ?? item.route.departureTimeMs + item.route.durationMin * 60_000;
      if ((itemArrival - earliestArrival) / 60_000 > 25) {
        assert(!item.fairness.isFair, `absolute arrival fairness invariant iteration ${iteration}`);
      }
    }
    if (iteration % 10 === 0) {
      const id = `fuzz-issue-${iteration}`;
      const before = ledger.size();
      const input = { journeyRequestId: id, route: routes[0], issuedAtMs: BASE, userCountRepresented: Math.floor(random() * 20), complianceProbability: random() };
      engine.issueRecommendation(input);
      engine.issueRecommendation(input);
      equal(ledger.size(), before + 1, `ledger idempotency iteration ${iteration}`);
    }
  }
  for (const entry of ledger.getEntries()) {
    assert(entry.expectedPassengerContribution >= 0, 'negative recommendation demand');
    assert(entry.resourceDemands.every((demand) => demand.expectedPassengers >= 0), 'negative resource demand');
  }
  console.log('STRESS SUMMARY: 1,000 deterministic evaluations; finite/bounded scores, stable ties, fairness, and idempotency passed.');
});

let passed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}
console.log(`\n${passed}/${tests.length} network-aware integration tests passed.`);
