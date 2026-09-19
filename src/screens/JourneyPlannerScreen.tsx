import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  ArrowUpDown,
  Search,
  Sliders,
  Check,
  AlertTriangle,
  Navigation,
  Clock,
  Footprints,
  Shuffle,
  Info,
  CloudRain,
  Satellite,
  Train,
  Bike,
} from 'lucide-react';
import { RouteOption, UserPreferences, TravelNeeds, LearningPreferences, DisruptionAlert, LiveTransportCondition } from '../types';
import { TopAppBar } from '../components/TopAppBar';
import { RouteCard } from '../components/RouteCard';
import { SpeechInputButton } from '../components/SpeechInputButton';
import { rankRoutes, scorePersonalCostForNetworkAware } from '../services/routeScoring';
import { familiarRouteHistory, routeFamiliarityKey } from '../utils/routeFamiliarity';
import { MOCK_ROUTES_KENT_RIDGE_TO_BUGIS } from '../data/mockTransportData';
import { MOCK_BIKE_AND_RIDE_KENT_RIDGE_TO_BUGIS } from '../data/mockCyclingData';
import { WeatherInfo } from '../services/weatherService';
import {
  fetchLiveMultimodalPlan,
  fetchLiveRoutePlan,
  resolvePlace,
  searchPlaces,
  ResolvedPlace,
} from '../services/routingService';
import { resolveStationCoords } from '../utils/stationLookup';
import { normalizeLineToCode } from '../utils/lineCodes';
import { fetchLiftStatus, LiftMaintenanceItem } from '../services/ltaService';
import { buildNetworkAwareCandidateSet, CandidateRouteBatch, toNetworkAwareEvaluationRoutes } from '../networkAware/candidateSet';
import {
  createJourneyRequestId,
  journeyDecisionKey,
  promoteNetworkAwareRoutes,
  RecommendationIssuanceTracker,
} from '../networkAware/presentation';

const IS_DEVELOPMENT =
  (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;

const PLANNER_SESSION_NONCE = (() => {
  if (typeof window === 'undefined') return 'server-session';
  const key = 'transit-companion-planner-session';
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const created = `planner-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.sessionStorage.setItem(key, created);
  return created;
})();

interface NetworkAwareShadowResult {
  recommendedRouteId: string | null;
  rankedRoutes: Array<{
    routeId: string;
    personalCost: number;
    networkCost: number;
    fairnessPenalty: number;
    switchingCost: number;
    totalCost: number;
    crowdRisk: string;
    bottleneckResourceId?: string;
    bottleneckResourceName?: string;
    reason: string;
    decisionReasonCode: import('../networkAware/presentation').DecisionReasonCode;
  }>;
  provenance: { mode: 'live' | 'replay'; usesProxyDemandModel: true };
}

interface JourneyPlannerScreenProps {
  initialOrigin?: string;
  initialDestination?: string;
  userPreferences: UserPreferences;
  travelNeeds: TravelNeeds;
  disruption: DisruptionAlert | null;
  weather?: WeatherInfo | null;
  liveConditions?: LiveTransportCondition[];
  liveConditionsAreLive?: boolean;
  learningPreferences: LearningPreferences;
  onBack: () => void;
  onSelectRouteForGuidance: (route: RouteOption, departureOffsetMin: number) => void;
}

export const JourneyPlannerScreen: React.FC<JourneyPlannerScreenProps> = ({
  initialOrigin = 'Kent Ridge MRT',
  initialDestination = 'Bugis MRT',
  userPreferences,
  travelNeeds,
  disruption,
  weather,
  liveConditions = [],
  liveConditionsAreLive = false,
  learningPreferences,
  onBack,
  onSelectRouteForGuidance,
}) => {
  const [origin, setOrigin] = useState(initialOrigin);
  const [destination, setDestination] = useState(initialDestination);
  const [selectedRoute, setSelectedRoute] = useState<RouteOption | null>(null);
  // Which input field (if any) is showing its autocomplete dropdown right now.
  const [activeSuggestionField, setActiveSuggestionField] = useState<'origin' | 'destination' | null>(
    null
  );
  const [placeSuggestions, setPlaceSuggestions] = useState<ResolvedPlace[]>([]);
  const [resolvedOrigin, setResolvedOrigin] = useState<ResolvedPlace | null>(null);
  const [resolvedDestination, setResolvedDestination] = useState<ResolvedPlace | null>(null);

  const [liveRoutes, setLiveRoutes] = useState<RouteOption[]>([]);
  const [cyclingRoutes, setCyclingRoutes] = useState<RouteOption[]>([]);
  const [networkAwareState, setNetworkAwareState] = useState<{
    result: NetworkAwareShadowResult;
    candidates: RouteOption[];
    journeyRequestId: string;
  } | null>(null);
  const lastShadowLogSignature = useRef('');
  const issuanceTracker = useRef(new RecommendationIssuanceTracker());
  const cyclingEnabled = Boolean(
    userPreferences.transportModes.cycling && userPreferences.cyclingPreferences.enabled
  );
  const [liveRoutingStatus, setLiveRoutingStatus] = useState<
    'idle' | 'loading' | 'live' | 'unavailable' | 'unresolved'
  >('idle');
  const [cyclingRoutingStatus, setCyclingRoutingStatus] = useState<
    'idle' | 'loading' | 'live' | 'unavailable' | 'unresolved'
  >('idle');

  // Arjun: flexible ~60 min departure window instead of only "leave right now".
  // Defaults on for his persona but is a plain toggle anyone can use.
  const [showFlexibleDeparture, setShowFlexibleDeparture] = useState(Boolean(userPreferences.flexibleDeparture));
  const [departureOffsetMin, setDepartureOffsetMin] = useState(0);
  const DEPARTURE_OFFSETS = [0, 20, 40];
  const decisionKey = journeyDecisionKey(
    origin,
    destination,
    showFlexibleDeparture ? departureOffsetMin : 0,
    cyclingEnabled
  );
  const journeyRequestId = createJourneyRequestId(PLANNER_SESSION_NONCE, decisionKey);
  const familiarHistory = useMemo(() => familiarRouteHistory(), [journeyRequestId]);

  // Search across MRT, bus stops, addresses and landmarks. Selection is
  // optional: typed places resolve automatically after a brief pause.
  useEffect(() => {
    const query = activeSuggestionField === 'origin' ? origin : activeSuggestionField === 'destination' ? destination : '';
    if (!query.trim()) {
      setPlaceSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchPlaces(query).then((results) => {
        if (!cancelled) setPlaceSuggestions(results);
      });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeSuggestionField, origin, destination]);

  useEffect(() => {
    let cancelled = false;
    setResolvedOrigin(null);
    setResolvedDestination(null);
    const timer = setTimeout(() => {
      Promise.all([resolvePlace(origin), resolvePlace(destination)]).then(([nextOrigin, nextDestination]) => {
        if (!cancelled) {
          setResolvedOrigin(nextOrigin);
          setResolvedDestination(nextDestination);
        }
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [origin, destination]);

  // Routes use resolved coordinates, so any searchable Singapore place works
  // instead of restricting navigation to a predefined MRT station list.
  useEffect(() => {
    if (!resolvedOrigin || !resolvedDestination) {
      setLiveRoutes([]);
      setLiveRoutingStatus('unresolved');
      return;
    }

    let cancelled = false;
    setLiveRoutingStatus('loading');

    const timer = setTimeout(() => {
      fetchLiveRoutePlan(
        resolvedOrigin,
        resolvedDestination,
        showFlexibleDeparture ? departureOffsetMin : 0,
        'transit'
      ).then((result) => {
        if (cancelled) return;
        if (result.source === 'onemap_live' && result.itineraries.length > 0) {
          setLiveRoutes(result.itineraries);
          setLiveRoutingStatus('live');
        } else {
          setLiveRoutes([]);
          setLiveRoutingStatus('unavailable');
        }
      });
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [resolvedOrigin, resolvedDestination, showFlexibleDeparture, departureOffsetMin]);

  useEffect(() => {
    if (!cyclingEnabled) {
      setCyclingRoutes([]);
      setCyclingRoutingStatus('idle');
      return;
    }
    if (!resolvedOrigin || !resolvedDestination) {
      setCyclingRoutes([]);
      setCyclingRoutingStatus('unresolved');
      return;
    }

    let cancelled = false;
    setCyclingRoutingStatus('loading');
    const timer = setTimeout(() => {
      fetchLiveMultimodalPlan(
        resolvedOrigin,
        resolvedDestination,
        showFlexibleDeparture ? departureOffsetMin : 0,
        userPreferences.cyclingPreferences.bikeAtStation
      ).then((result) => {
        if (cancelled) return;
        if (result.source === 'onemap_live' && result.itineraries.length > 0) {
          setCyclingRoutes(result.itineraries);
          setCyclingRoutingStatus('live');
        } else {
          setCyclingRoutes([]);
          setCyclingRoutingStatus('unavailable');
        }
      });
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [resolvedOrigin, resolvedDestination, cyclingEnabled, showFlexibleDeparture, departureOffsetMin, userPreferences.cyclingPreferences.bikeAtStation]);

  const isDefaultCorridor =
    resolveStationCoords(origin)?.name === 'Kent Ridge' && resolveStationCoords(destination)?.name === 'Bugis';

  // Combine travel needs into scoring preferences
  const combinedPreferences: UserPreferences = useMemo(() => {
    return {
      ...userPreferences,
      stepFreeAccess: travelNeeds.stepFreeAccess || userPreferences.stepFreeAccess,
      lessWalking: travelNeeds.shortWalkingDistances || userPreferences.lessWalking,
      lessCrowded: travelNeeds.avoidCrowdedServices || userPreferences.lessCrowded,
    };
  }, [userPreferences, travelNeeds]);

  const isLiveRaining = weather?.isRaining ?? false;
  const isRaining = isLiveRaining;

  // Accessibility persona (Mdm Lim): check lift status at origin/destination up
  // front, since she plans in advance and can't improvise a reroute platform-side.
  // Reflects CURRENT LTA maintenance status, not a forecast - the brief warns
  // against unverifiable claims, so this isn't presented as a day-ahead prediction.
  const [liftWarnings, setLiftWarnings] = useState<LiftMaintenanceItem[]>([]);
  useEffect(() => {
    if (!combinedPreferences.stepFreeAccess) {
      setLiftWarnings([]);
      return;
    }
    const originStation = resolveStationCoords(origin);
    const destStation = resolveStationCoords(destination);
    const codes = [originStation?.code, destStation?.code].filter((c): c is string => Boolean(c));
    if (codes.length === 0) {
      setLiftWarnings([]);
      return;
    }
    let cancelled = false;
    Promise.all(codes.map((code) => fetchLiftStatus(code))).then((results) => {
      if (cancelled) return;
      setLiftWarnings(results.flatMap((r) => r.items));
    });
    return () => {
      cancelled = true;
    };
  }, [combinedPreferences.stepFreeAccess, origin, destination]);

  // Base route set: live OneMap itineraries when available, the bundled demo
  // routes appended only for the Kent Ridge <-> Bugis corridor (they carry
  // richer detail - shelter/step-free flags - OneMap's response doesn't give
  // us). A failure for any other OD must stay empty rather than showing an
  // unrelated Kent Ridge -> Bugis itinerary.
  const baseRoutes = useMemo(() => {
    let routes: RouteOption[];
    if (liveRoutingStatus === 'live' && liveRoutes.length > 0) {
      routes = isDefaultCorridor ? [...liveRoutes, ...MOCK_ROUTES_KENT_RIDGE_TO_BUGIS] : liveRoutes;
    } else {
      routes = isDefaultCorridor ? MOCK_ROUTES_KENT_RIDGE_TO_BUGIS : [];
    }
    if (cyclingEnabled && cyclingRoutingStatus === 'live') {
      routes = [...routes, ...cyclingRoutes];
      if (
        isDefaultCorridor &&
        userPreferences.cyclingPreferences.bikeAtStation === 'park' &&
        !cyclingRoutes.some((route) => route.bicycleParkingAvailable === true)
      ) {
        routes = [...routes, MOCK_BIKE_AND_RIDE_KENT_RIDGE_TO_BUGIS];
      }
    } else if (cyclingEnabled && isDefaultCorridor) {
      routes = [...routes, MOCK_BIKE_AND_RIDE_KENT_RIDGE_TO_BUGIS];
    }
    return routes;
  }, [liveRoutes, liveRoutingStatus, isDefaultCorridor, cyclingEnabled, cyclingRoutes, cyclingRoutingStatus, userPreferences.cyclingPreferences.bikeAtStation]);

  const highBusCrowding = liveConditions.some(
    (condition) => condition.type === 'bus' && condition.crowdLevel === 'Crowded'
  );
  const unusuallyLongBusWait = liveConditions.some(
    (condition) => condition.type === 'bus' && condition.nextArrivalMin >= 10
  );

  // Rank routes dynamically based on live conditions and personal preferences
  const rankedRoutes = useMemo(() => {
    return rankRoutes(baseRoutes, combinedPreferences, {
      ewlDisruptionActive:
        Boolean(disruption?.active) && normalizeLineToCode(disruption?.line || '') === 'EWL',
      roadTrafficHeavy: isRaining,
      isRaining,
      busCrowdHigh: highBusCrowding,
      crowdedInterchange: Boolean(disruption?.active),
      longBusWait: unusuallyLongBusWait,
      disruptionActive: Boolean(disruption?.active),
      preferFamiliarRoutesDuringDisruptions: learningPreferences.preferFamiliarRoutesDuringDisruptions,
      familiarRouteHistory: familiarHistory,
    });
  }, [baseRoutes, combinedPreferences, disruption, isRaining, highBusCrowding, unusuallyLongBusWait, learningPreferences.preferFamiliarRoutesDuringDisruptions, familiarHistory]);

  const legacyBestMatchRoute = rankedRoutes[0] ?? null;

  const promotedRoutes = useMemo(
    () => promoteNetworkAwareRoutes(
      rankedRoutes,
      networkAwareState?.candidates ?? [],
      networkAwareState?.result ?? null
    ),
    [rankedRoutes, networkAwareState]
  );
  const familiarLegacyWinner = Boolean(
    disruption?.active &&
      learningPreferences.preferFamiliarRoutesDuringDisruptions &&
      legacyBestMatchRoute &&
      familiarHistory[routeFamiliarityKey(legacyBestMatchRoute)]
  );
  // During a disruption, a known route that already won the safety and
  // preference scoring remains the displayed recommendation rather than being
  // displaced by a network-only tie-breaker.
  const visibleRoutes = familiarLegacyWinner ? rankedRoutes : promotedRoutes.routes;
  const bestMatchRoute = familiarLegacyWinner ? legacyBestMatchRoute : promotedRoutes.bestMatch;

  // Evaluate network-aware candidates. Until this succeeds and maps to a valid
  // current candidate, the presentation layer keeps the legacy winner.
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setNetworkAwareState(null);
    const evaluateShadow = async () => {
      const batches: CandidateRouteBatch[] = [{
        routes: baseRoutes.filter((route) => route.dataSource !== 'mock'),
        source: 'immediate-transit',
      }];
      if (showFlexibleDeparture && resolvedOrigin && resolvedDestination) {
        const offsets = DEPARTURE_OFFSETS.filter((offset) => offset !== departureOffsetMin);
        const results = await Promise.all(offsets.flatMap((offset) => [
          fetchLiveRoutePlan(resolvedOrigin, resolvedDestination, offset, 'transit').then((result) => ({ result, offset, multimodal: false })),
          ...(cyclingEnabled ? [fetchLiveMultimodalPlan(
            resolvedOrigin,
            resolvedDestination,
            offset,
            combinedPreferences.cyclingPreferences.bikeAtStation
          ).then((result) => ({ result, offset, multimodal: true }))] : []),
        ]));
        for (const { result, offset, multimodal } of results) {
          if (result.source === 'onemap_live' && result.itineraries.length > 0) {
            batches.push({
              routes: result.itineraries,
              source: multimodal ? 'bike-and-ride' : offset === 0 ? 'immediate-transit' : 'later-transit',
            });
          }
        }
      }
      const eligibleRoutes = buildNetworkAwareCandidateSet(batches, combinedPreferences);
      if (eligibleRoutes.length === 0 || cancelled) {
        setNetworkAwareState(null);
        return;
      }
      const personalCostByRouteId = Object.fromEntries(
        eligibleRoutes.map((route) => [
          route.id,
          scorePersonalCostForNetworkAware(route, combinedPreferences, { isRaining }).totalCost,
        ])
      );
      const incumbent = eligibleRoutes.find((route) => route.networkAwareBaseRouteId === legacyBestMatchRoute?.id)?.id;
      const evaluationRoutes = toNetworkAwareEvaluationRoutes(eligibleRoutes);
      const response = await fetch('/api/network-aware/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        routes: evaluationRoutes,
        personalCostByRouteId,
        incumbentRouteId: incumbent,
        nowMs: Date.now(),
        mode: 'live',
      }),
      });
      if (!response.ok) throw new Error(`Shadow evaluation returned ${response.status}`);
      const result = await response.json() as NetworkAwareShadowResult;
      if (!cancelled) {
        const validWinner = eligibleRoutes.some((route) => route.id === result.recommendedRouteId) &&
          result.rankedRoutes.some((route) => route.routeId === result.recommendedRouteId);
        if (!validWinner) {
          setNetworkAwareState(null);
          if (IS_DEVELOPMENT) console.debug('[NetworkAware] Invalid winner; using legacy fallback');
          return;
        }
        setNetworkAwareState({ result, candidates: eligibleRoutes, journeyRequestId });
        if (!IS_DEVELOPMENT) return;
        (window as Window & { __NETWORK_AWARE_SHADOW__?: NetworkAwareShadowResult }).__NETWORK_AWARE_SHADOW__ = result;
        const winner = eligibleRoutes.find((route) => route.id === result.recommendedRouteId);
        const winnerEvaluation = result.rankedRoutes.find(
          (route) => route.routeId === result.recommendedRouteId
        );
        const signature = `${legacyBestMatchRoute?.id || 'none'}::${result.recommendedRouteId || 'none'}::${winnerEvaluation?.totalCost || 0}`;
        if (signature !== lastShadowLogSignature.current) {
          lastShadowLogSignature.current = signature;
          console.debug('[NetworkAware Shadow]', {
            legacyWinner: legacyBestMatchRoute?.id ?? null,
            networkAwareWinner: result.recommendedRouteId,
            reasonCode: winnerEvaluation?.decisionReasonCode,
            existingDuration: legacyBestMatchRoute?.totalDurationMin ?? null,
            networkAwareDuration: winner?.totalDurationMin ?? null,
            personalCost: winnerEvaluation?.personalCost ?? null,
            networkCost: winnerEvaluation?.networkCost ?? null,
            fairness: winnerEvaluation?.fairnessPenalty ?? null,
            hysteresis: winnerEvaluation?.switchingCost ?? null,
            total: winnerEvaluation?.totalCost ?? null,
            bottleneck: winnerEvaluation?.bottleneckResourceName || winnerEvaluation?.bottleneckResourceId || null,
            crowdRisk: winnerEvaluation?.crowdRisk ?? 'UNKNOWN',
            reason: winnerEvaluation?.reason ?? '',
          });
        }
      }
    };
    evaluateShadow().catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (!cancelled) setNetworkAwareState(null);
        if (IS_DEVELOPMENT) console.debug('[NetworkAware] unavailable; using legacy fallback', error);
      });
    return () => { cancelled = true; controller.abort(); };
  }, [baseRoutes, combinedPreferences, isRaining, legacyBestMatchRoute?.id, resolvedOrigin, resolvedDestination, showFlexibleDeparture, departureOffsetMin, cyclingEnabled, journeyRequestId]);

  // Issue only the one valid network-aware recommendation actually presented.
  // The stable journeyRequestId and tracker prevent React rerenders from
  // generating duplicate demand; the server endpoint is independently idempotent.
  useEffect(() => {
    if (!networkAwareState || !promotedRoutes.networkAware || !bestMatchRoute) return;
    if (networkAwareState.result.recommendedRouteId !== bestMatchRoute.id) return;
    if (!issuanceTracker.current.claim(networkAwareState.journeyRequestId)) return;
    const issueRoute = toNetworkAwareEvaluationRoutes([bestMatchRoute])[0];
    fetch('/api/network-aware/issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        journeyRequestId: networkAwareState.journeyRequestId,
        route: issueRoute,
      }),
    }).catch((error) => {
      if (IS_DEVELOPMENT) console.debug('[NetworkAware] recommendation issuance failed', error);
    });
  }, [networkAwareState, promotedRoutes.networkAware, bestMatchRoute]);

  const handleSwap = () => {
    setOrigin(destination);
    setDestination(origin);
  };

  const setSpokenLocation = (field: 'origin' | 'destination', transcript: string) => {
    if (field === 'origin') setOrigin(transcript);
    else setDestination(transcript);
    setActiveSuggestionField(field);
  };

  return (
    <div
      id="journey-planner-container"
      className="h-full flex flex-col justify-between bg-surface"
    >
      {/* Top Bar */}
      <div>
        <TopAppBar
          title="Plan Journey"
          showBack={true}
          onBack={onBack}
        />

        {/* Inputs Box */}
        <div className="px-4 py-1">
          <div className="bg-surface-container-lowest rounded-2xl p-2 border border-outline-variant/30 card-shadow relative">
            <div className="space-y-1">
              <div className="relative">
                <div className="flex items-center gap-2.5 bg-surface-container-low px-3 py-1.5 rounded-xl focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-1">
                  <div className="w-2.5 h-2.5 rounded-full bg-primary shrink-0" />
                  <input
                    type="text"
                    value={origin}
                    onChange={(e) => setOrigin(e.target.value)}
                    onFocus={() => setActiveSuggestionField('origin')}
                    onBlur={() => setActiveSuggestionField((f) => (f === 'origin' ? null : f))}
                    placeholder="Starting point"
                    autoComplete="off"
                    className="w-full bg-transparent text-xs font-semibold text-on-surface focus:outline-none"
                  />
                  <SpeechInputButton label="your starting point" onTranscript={(transcript) => setSpokenLocation('origin', transcript)} />
                </div>
                {activeSuggestionField === 'origin' && placeSuggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-40 bg-surface-container-lowest rounded-xl border border-outline-variant/30 card-shadow max-h-52 overflow-y-auto no-scrollbar divide-y divide-outline-variant/20">
                    {placeSuggestions.map((s) => (
                      <button
                        key={`${s.kind}-${s.name}-${s.lat}-${s.lng}`}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setOrigin(s.name);
                          setActiveSuggestionField(null);
                        }}
                        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-surface-container cursor-pointer"
                      >
                        {s.kind === 'bus_stop' ? (
                          <Navigation className="w-3.5 h-3.5 text-secondary shrink-0" />
                        ) : (
                          <Train className="w-3.5 h-3.5 text-secondary shrink-0" />
                        )}
                        <span className="text-xs font-semibold text-on-surface truncate">{s.name}</span>
                        <span className="text-[11px] text-on-surface-variant ml-auto shrink-0">
                          {s.detail || 'Singapore'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="relative">
                <div className="flex items-center gap-2.5 bg-surface-container-low px-3 py-1.5 rounded-xl focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-1">
                  <div className="w-2.5 h-2.5 rounded-full bg-error shrink-0" />
                  <input
                    type="text"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    onFocus={() => setActiveSuggestionField('destination')}
                    onBlur={() => setActiveSuggestionField((f) => (f === 'destination' ? null : f))}
                    placeholder="Where to?"
                    autoComplete="off"
                    className="w-full bg-transparent text-xs font-semibold text-on-surface focus:outline-none"
                  />
                  <SpeechInputButton label="your destination" onTranscript={(transcript) => setSpokenLocation('destination', transcript)} />
                </div>
                {activeSuggestionField === 'destination' && placeSuggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-40 bg-surface-container-lowest rounded-xl border border-outline-variant/30 card-shadow max-h-52 overflow-y-auto no-scrollbar divide-y divide-outline-variant/20">
                    {placeSuggestions.map((s) => (
                      <button
                        key={`${s.kind}-${s.name}-${s.lat}-${s.lng}`}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setDestination(s.name);
                          setActiveSuggestionField(null);
                        }}
                        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-surface-container cursor-pointer"
                      >
                        {s.kind === 'bus_stop' ? (
                          <Navigation className="w-3.5 h-3.5 text-secondary shrink-0" />
                        ) : (
                          <Train className="w-3.5 h-3.5 text-secondary shrink-0" />
                        )}
                        <span className="text-xs font-semibold text-on-surface truncate">{s.name}</span>
                        <span className="text-[11px] text-on-surface-variant ml-auto shrink-0">
                          {s.detail || 'Singapore'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Swap Button */}
            <button
              type="button"
              onClick={handleSwap}
              aria-label="Swap origin and destination"
              className={`absolute top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-surface-container hover:bg-surface-container-high border border-outline-variant/40 flex items-center justify-center text-on-surface-variant cursor-pointer transition-transform active:rotate-180 ${
                userPreferences.dominantHand === 'left' ? 'left-6' : 'right-6'
              }`}
            >
              <ArrowUpDown className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Cycling is a conditional candidate controlled by the saved profile. */}
        <div className="px-4 pb-1">
          <div className="rounded-lg bg-surface-container-lowest border border-outline-variant/30 px-2.5 py-1 flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-primary-fixed text-primary flex items-center justify-center shrink-0">
              <Bike className="w-3 h-3" />
            </div>
            <div className="min-w-0 flex-1 flex items-baseline gap-1.5">
              <span className="text-[11px] font-bold text-on-surface shrink-0">
                {cyclingEnabled ? 'Cycling enabled' : 'Cycling disabled'}
              </span>
              <span className="text-[10px] text-on-surface-variant truncate">
                {cyclingEnabled
                  ? 'Suggested when conditions justify it'
                  : 'Enable in preference quiz for bike-and-ride'}
              </span>
            </div>
          </div>
        </div>

        {/* Active Personalisation Indicators */}
        <div className="px-4 pt-0.5 flex items-center gap-2 overflow-x-auto no-scrollbar text-[11px]">
          <span className="text-outline font-semibold shrink-0">Scored for you:</span>
          {combinedPreferences.stepFreeAccess && (
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200 shrink-0">
              Step-free access
            </span>
          )}
          {combinedPreferences.travelMode === 'prefer_buses' && (
            <span className="px-2.5 py-0.5 rounded-full bg-secondary-fixed text-on-secondary-fixed-variant font-semibold shrink-0">
              Prefer buses
            </span>
          )}
          {combinedPreferences.travelMode === 'prefer_trains' && (
            <span className="px-2.5 py-0.5 rounded-full bg-secondary-fixed text-on-secondary-fixed-variant font-semibold shrink-0">
              Prefer trains
            </span>
          )}
          {combinedPreferences.priorities?.map((p) => (
            <span
              key={p}
              className="px-2.5 py-0.5 rounded-full bg-surface-container-high text-on-surface font-semibold shrink-0 capitalize"
            >
              {p}
            </span>
          ))}
        </div>

        {/* Flexible departure window (Arjun: comfort/predictability over an exact time) */}
        <div className="px-4 pt-1 flex items-center justify-between">
          <span className="text-[11px] font-bold text-outline uppercase tracking-wide">
            Departure
          </span>
          <button
            id="btn-toggle-flexible-departure"
            type="button"
            role="switch"
            aria-checked={showFlexibleDeparture}
            onClick={() => {
              setShowFlexibleDeparture((v) => !v);
              setDepartureOffsetMin(0);
            }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors cursor-pointer ${
              showFlexibleDeparture
                ? 'bg-primary-container/20 text-primary border-primary-container/40'
                : 'bg-surface-container text-on-surface-variant border-outline-variant/40 hover:bg-surface-container-high'
            }`}
          >
            <Clock className="w-3 h-3" />
            {showFlexibleDeparture ? 'Flexible window: ON' : 'Leave now only'}
          </button>
        </div>

        {showFlexibleDeparture && (
          <div className="px-4 pt-1.5 flex items-center gap-1.5">
            {DEPARTURE_OFFSETS.map((offset) => (
              <button
                key={offset}
                type="button"
                onClick={() => setDepartureOffsetMin(offset)}
                className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-all cursor-pointer ${
                  departureOffsetMin === offset
                    ? 'bg-primary-container text-on-primary'
                    : 'bg-surface-container-lowest text-on-surface-variant border border-outline-variant/40 hover:bg-surface-container'
                }`}
              >
                {offset === 0 ? 'Leave now' : `+${offset} min`}
              </button>
            ))}
          </div>
        )}

      </div>

      {/* Main Routes List */}
      <div className="flex-1 px-4 py-2 overflow-y-auto space-y-3 pb-8">
        {cyclingEnabled && highBusCrowding && userPreferences.cyclingPreferences.suggestWhen.busesCrowded && (
          <div className="p-3 bg-primary-fixed/40 border border-primary-container/30 rounded-xl text-xs flex items-start gap-2.5">
            <Bike className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div className="text-on-surface">
              <span className="font-bold">
                Your usual bus is expected to be crowded{liveConditionsAreLive ? '.' : ' (prototype estimate).'}
              </span>{' '}
              Cycling may be more comfortable today, so qualifying bike-and-ride routes are being compared automatically.
            </div>
          </div>
        )}

        {combinedPreferences.stepFreeAccess && liftWarnings.length > 0 && (
          <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-xs flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="text-on-surface">
              <span className="font-bold">Lift maintenance at {liftWarnings.length > 1 ? 'these stations' : 'this station'}:</span>{' '}
              {liftWarnings.map((w) => `${w.stationName} (${w.liftDesc || w.liftId || 'lift'})`).join('; ')}. Current status
              from LTA — plan an alternate exit before you travel.
            </div>
          </div>
        )}

        {isRaining && (
          <div
            className={`p-3 rounded-xl text-xs flex items-start gap-2.5 border ${
              isLiveRaining
                ? 'bg-secondary-fixed/40 border-secondary-container/40'
                : 'bg-amber-50 border-amber-300 border-dashed'
            }`}
          >
            <CloudRain className="w-4 h-4 text-on-secondary-fixed-variant shrink-0 mt-0.5" />
            <div className="text-on-surface">
              {isLiveRaining ? (
                <>
                  <span className="font-bold">{weather?.forecast} in {weather?.area}:</span>{' '}
                  {cyclingEnabled
                    ? 'Cycling legs are penalised in ranking because paths may be slippery; transit-only routes remain available.'
                    : 'Prioritising routes with covered walkways where possible.'}
                </>
              ) : (
                <>
                  <span className="font-bold">Simulated rain (demo data):</span>{' '}
                  {cyclingEnabled
                    ? 'Cycling legs are penalised in ranking because paths may be slippery; transit-only routes remain available.'
                    : 'Prioritising routes with covered walkways where possible.'}
                </>
              )}
            </div>
          </div>
        )}

        {disruption && disruption.active && (
          <div className="p-3 bg-error-container/30 border border-error/20 rounded-xl text-xs flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-error shrink-0 mt-0.5" />
            <div className="text-on-surface">
              <span className="font-bold">{disruption.headline}:</span> {disruption.subText} Recommended routes avoid this segment.
            </div>
          </div>
        )}

        {liveRoutingStatus === 'unresolved' && !isDefaultCorridor ? (
          <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl text-xs flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="text-on-surface">
              <span className="font-bold">We couldn't find one of those places in Singapore.</span>{' '}
              Try an address, landmark, MRT station, or bus stop name and choose a matching suggestion.
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-1">
              <h2 className="text-xs font-bold text-outline uppercase tracking-wider">
                Suggested multimodal routes ({visibleRoutes.length})
              </h2>
              {liveRoutingStatus === 'loading' && (
                <span className="text-[11px] text-on-surface-variant font-semibold">Finding live routes...</span>
              )}
              {liveRoutingStatus === 'live' && (
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 font-semibold">
                  <Satellite className="w-3 h-3" />
                  Live routing (OneMap)
                </span>
              )}
              {liveRoutingStatus === 'unavailable' && (
                <span className="text-[11px] text-on-surface-variant font-semibold">
                  Live routing unavailable — demo routes
                </span>
              )}
            </div>

            {cyclingEnabled && cyclingRoutingStatus === 'loading' && (
              <div className="p-3 bg-primary-fixed/40 border border-primary-container/20 rounded-xl text-xs text-on-surface flex items-center gap-2">
                <Bike className="w-4 h-4 text-primary shrink-0" />
                Finding bike-and-ride connections to nearby transit hubs…
              </div>
            )}

            {cyclingEnabled && cyclingRoutingStatus === 'unavailable' && isDefaultCorridor && (
              <div className="p-3 bg-amber-50 border border-amber-300 border-dashed rounded-xl text-xs text-on-surface">
                Live cycling or parking data is unavailable. The bike-and-ride comparison below is clearly marked prototype data.
              </div>
            )}

            {cyclingEnabled && cyclingRoutingStatus === 'unavailable' && !isDefaultCorridor && (
              <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-xs text-on-surface">
                Bike-and-ride data is unavailable for this journey, so no cycling route is being invented.
              </div>
            )}

            {visibleRoutes.map((route) => {
              const routeDepartureOffset = route.networkAwareDepartureDelayMin ??
                (showFlexibleDeparture ? departureOffsetMin : 0);
              return (
              <RouteCard
                key={route.id}
                route={route}
                isSelected={selectedRoute?.id === route.id}
                userPreferences={userPreferences}
                travelNeeds={travelNeeds}
                disruption={disruption}
                compareRoute={bestMatchRoute}
                departureOffsetMin={routeDepartureOffset}
                onSelect={(r) => {
                  setSelectedRoute(r);
                  onSelectRouteForGuidance(
                    r,
                    routeDepartureOffset
                  );
                }}
              />
              );
            })}
          </>
        )}
      </div>
    </div>
  );
};
