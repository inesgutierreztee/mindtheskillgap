import { RouteOption, UserPreferences } from '../types';
import { routeFamiliarityKey } from '../utils/routeFamiliarity';

export interface ScoringFactors {
  timeCost: number;
  walkCost: number;
  transferCost: number;
  crowdCost: number;
  fareCost: number;
  reliabilityCost: number;
  accessibilityCost: number;
  modeCost: number;
  weatherCost: number;
  cyclingDecisionCost: number;
  familiarityCost: number;
  cyclingRecommended: boolean;
  totalCost: number;
  explanation: string;
}

export interface RouteLiveConditions {
  ewlDisruptionActive: boolean;
  roadTrafficHeavy: boolean;
  isRaining?: boolean;
  busCrowdHigh?: boolean;
  crowdedInterchange?: boolean;
  longBusWait?: boolean;
  disruptionActive?: boolean;
  preferFamiliarRoutesDuringDisruptions?: boolean;
  familiarRouteHistory?: Record<string, number>;
}

export interface NetworkAwarePersonalCostFactors {
  timeCost: number;
  walkCost: number;
  transferCost: number;
  fareCost: number;
  reliabilityCost: number;
  accessibilityCost: number;
  modeCost: number;
  weatherCost: number;
  cyclingSuitabilityCost: number;
  totalCost: number;
}

interface PersonalBaseOptions {
  durationMin?: number;
  isRaining?: boolean;
}

/** Shared non-network preference foundation. It deliberately contains no live
 * crowd, route-specific disruption, ledger, fairness, or hysteresis terms. */
function scorePersonalBase(
  route: RouteOption,
  preferences: UserPreferences,
  options: PersonalBaseOptions = {}
) {
  const comfortFirst = preferences.priority === 'comfort';
  const timeWeight = preferences.fastestJourney || preferences.priorities?.includes('time') ? 1.4 : 1;
  const timeCost = (options.durationMin ?? route.totalDurationMin) * timeWeight;
  const walkCost = route.walkingMinutes *
    (preferences.lessWalking || preferences.priorities?.includes('walk') ? 2.8 : 1);
  const transferCost = route.transfers *
    (comfortFirst || preferences.fewerTransfers || preferences.priorities?.includes('transfer') ? 20 : 6);
  const fareCost = (preferences.lowerFare || preferences.priorities?.includes('fare')) && route.estimatedFare !== undefined
    ? route.estimatedFare * 14
    : 0;
  const accessibilityCost = preferences.stepFreeAccess && route.stepFreeAccessible === false ? 1000 : 0;
  const isBusOnly = route.lines.every(
    (line) => line.toLowerCase().includes('bus') || !Number.isNaN(Number(line))
  );
  const hasTrain = route.lines.some((line) =>
    ['ccl', 'dtl', 'ewl', 'nsl', 'nel', 'tel'].includes(line.toLowerCase())
  );
  let modeCost = 0;
  if (preferences.travelMode === 'prefer_buses') {
    modeCost = isBusOnly ? -12 : hasTrain ? 8 : -6;
  } else if (preferences.travelMode === 'prefer_trains') {
    modeCost = hasTrain ? -10 : 12;
  }
  const reliabilityCost = route.reliabilityRating === 'Low' ? 20 : route.reliabilityRating === 'Moderate' ? 8 : 0;
  const hasCycling = route.steps.some((step) => step.type === 'cycle');
  const hasUnshelteredWalk = route.steps.some((step) => step.type === 'walk' && step.sheltered === false);
  const weatherCost = options.isRaining ? (hasCycling ? 35 : hasUnshelteredWalk ? 22 : 0) : 0;
  return { timeCost, walkCost, transferCost, fareCost, accessibilityCost, modeCost, reliabilityCost, weatherCost };
}

/**
 * Host personal/generalised cost for the network-aware engine. This is kept
 * separate from scoreRoute(): it intentionally excludes current crowding,
 * RecommendationLedger demand, live public-transport congestion, and
 * route-specific live disruption penalties, all of which NetworkState owns.
 */
export function scorePersonalCostForNetworkAware(
  route: RouteOption,
  preferences: UserPreferences,
  liveConditions: Pick<RouteLiveConditions, 'isRaining'> = {}
): NetworkAwarePersonalCostFactors {
  const base = scorePersonalBase(route, preferences, {
    isRaining: liveConditions.isRaining,
    durationMin: route.totalDurationMin + (route.networkAwareDepartureDelayMin ?? 0),
  });
  const { timeCost, walkCost, transferCost, fareCost, accessibilityCost, modeCost, reliabilityCost, weatherCost } = base;
  const hasCycling = route.steps.some((step) => step.type === 'cycle');

  let cyclingSuitabilityCost = 0;
  if (hasCycling) {
    const cycling = preferences.cyclingPreferences;
    // Enabling cycling makes it eligible; it is not itself a recommendation boost.
    cyclingSuitabilityCost += 12;
    if (!cycling.enabled || !preferences.transportModes.cycling) cyclingSuitabilityCost += 1000;
    if (cycling.avoidWhen.heavyRain && liveConditions.isRaining) cyclingSuitabilityCost += 180;
    if (cycling.avoidWhen.poorInfrastructure) {
      if (route.cyclingInfrastructureQuality === 'poor') cyclingSuitabilityCost += 180;
      if (route.cyclingInfrastructureQuality === 'mixed') cyclingSuitabilityCost += 6;
      if (route.cyclingInfrastructureQuality === 'unknown') cyclingSuitabilityCost += 12;
    }
    if (
      cycling.avoidWhen.noBikeParking &&
      cycling.bikeAtStation === 'park' &&
      route.routeMode === 'multimodal' &&
      route.bicycleParkingAvailable !== true
    ) cyclingSuitabilityCost += 180;
    if (cycling.avoidWhen.routeTooLong && (route.cyclingDistanceMeters || 0) > 6000) {
      cyclingSuitabilityCost += 180;
    }
    if (
      cycling.maxExtraMinutes !== null &&
      (route.extraTravelTimeMin || 0) > cycling.maxExtraMinutes
    ) cyclingSuitabilityCost += 180;
  }

  const totalCost = Math.round(
    timeCost + walkCost + transferCost + fareCost + reliabilityCost +
      accessibilityCost + modeCost + weatherCost + cyclingSuitabilityCost
  );
  return {
    timeCost,
    walkCost,
    transferCost,
    fareCost,
    reliabilityCost,
    accessibilityCost,
    modeCost,
    weatherCost,
    cyclingSuitabilityCost,
    totalCost,
  };
}

/**
 * Deterministic Route Personalisation Scoring Engine
 *
 * Strict Rule: Accessibility requirements (stepFreeAccess) are NOT optional ranking preferences.
 * If stepFreeAccess is active, non-accessible routes receive a disqualifying penalty (1000 pts)
 * ensuring only fully step-free accessible routes can be recommended.
 */
export function scoreRoute(
  route: RouteOption,
  preferences: UserPreferences,
  liveConditions: RouteLiveConditions = { ewlDisruptionActive: false, roadTrafficHeavy: false, isRaining: false }
): { scoredRoute: RouteOption; factors: ScoringFactors } {
  let dynamicTravelTime = route.totalDurationMin;
  if (route.trafficSensitive && liveConditions.roadTrafficHeavy) {
    dynamicTravelTime += 6;
  }
  const base = scorePersonalBase(route, preferences, { durationMin: dynamicTravelTime, isRaining: liveConditions.isRaining });
  const { timeCost, walkCost, transferCost, fareCost, accessibilityCost, modeCost, weatherCost } = base;
  const prefersLessWalk = preferences.lessWalking || preferences.priorities?.includes('walk');
  const comfortFirst = preferences.priority === 'comfort';
  const prefersFewerTransfers = comfortFirst || preferences.fewerTransfers || preferences.priorities?.includes('transfer');

  // 5. Crowding component
  const prefersLessCrowd = comfortFirst || preferences.lessCrowded || preferences.priorities?.includes('crowd');
  let crowdCost = 0;
  if (prefersLessCrowd) {
    crowdCost = route.crowdRating === 'High' ? 44 : route.crowdRating === 'Moderate' ? 15 : 2;
  } else {
    crowdCost = route.crowdRating === 'High' ? 18 : route.crowdRating === 'Moderate' ? 8 : 2;
  }

  const prefersLowerFare = preferences.lowerFare || preferences.priorities?.includes('fare');

  // 8. Reliability / Disruption component
  let reliabilityCost = base.reliabilityCost;
  const usesEwl = route.lines.includes('EWL');
  if (usesEwl && liveConditions.ewlDisruptionActive) {
    reliabilityCost = 38;
  }

  // 9. Weather component — an uncovered walking segment costs more when it's raining
  const hasUnshelteredWalk = route.steps.some((s) => s.type === 'walk' && s.sheltered === false);
  const hasCyclingLeg = route.steps.some((s) => s.type === 'cycle');
  const isCyclingOnly = route.routeMode === 'cycle';

  // 10. Conditional cycling decision. Enabling cycling only makes the route a
  // candidate: at least one selected trigger must be active, and avoidance/time
  // constraints must pass before comfort-first scoring gives it a boost.
  let cyclingDecisionCost = 0;
  let cyclingRecommended = false;
  let cyclingDecisionExplanation = '';
  if (hasCyclingLeg) {
    const cycling = preferences.cyclingPreferences;
    const triggerLabels: string[] = [];
    if (cycling.suggestWhen.busesCrowded && liveConditions.busCrowdHigh) triggerLabels.push('the next buses are heavily crowded');
    if (cycling.suggestWhen.crowdedInterchange && liveConditions.crowdedInterchange) triggerLabels.push('it avoids a crowded interchange');
    if (cycling.suggestWhen.longBusWait && liveConditions.longBusWait) triggerLabels.push('the bus wait is unusually long');
    if (cycling.suggestWhen.disruptionReliability && liveConditions.disruptionActive) triggerLabels.push('cycling is more reliable during the disruption');

    const blockers: string[] = [];
    if (!cycling.enabled || !preferences.transportModes.cycling) blockers.push('cycling is disabled in your profile');
    if (cycling.avoidWhen.heavyRain && liveConditions.isRaining) blockers.push('heavy rain makes the transit route more comfortable');
    if (cycling.avoidWhen.poorInfrastructure && route.cyclingInfrastructureQuality === 'poor') blockers.push('cycling infrastructure is unsuitable');
    if (
      cycling.avoidWhen.noBikeParking &&
      cycling.bikeAtStation === 'park' &&
      route.bicycleParkingAvailable !== true
    ) blockers.push('suitable bicycle parking is not confirmed');
    if (cycling.avoidWhen.routeTooLong && (route.cyclingDistanceMeters || 0) > 6000) blockers.push('the cycling section is too long');
    if (
      cycling.maxExtraMinutes !== null &&
      (route.extraTravelTimeMin || 0) > cycling.maxExtraMinutes
    ) blockers.push(`it adds more than your ${cycling.maxExtraMinutes}-minute limit`);

    if (blockers.length > 0) {
      cyclingDecisionCost += 180;
      cyclingDecisionExplanation = liveConditions.isRaining && blockers.some((reason) => reason.includes('rain'))
        ? 'Cycling would avoid crowding, but heavy rain makes the bus route more comfortable.'
        : `Cycling is not recommended now because ${blockers[0]}.`;
    } else if (triggerLabels.length === 0) {
      cyclingDecisionCost += 28;
      cyclingDecisionExplanation = 'Cycling is available, but current crowding, waits and disruptions do not make it more comfortable than transit.';
    } else {
      cyclingRecommended = true;
      cyclingDecisionCost -= comfortFirst ? 55 : 28;
      if (route.cyclingInfrastructureQuality === 'mixed') cyclingDecisionCost += 6;
      if (route.cyclingInfrastructureQuality === 'unknown') cyclingDecisionCost += 12;
      const extra = route.extraTravelTimeMin || 0;
      cyclingDecisionExplanation = `You prioritise comfort, and ${triggerLabels[0]}. Cycling ${extra > 0 ? `adds about ${extra} minutes but ` : ''}avoids the busiest part of your journey.`;
    }
  }

  const familiarityCount = liveConditions.disruptionActive && liveConditions.preferFamiliarRoutesDuringDisruptions
    ? liveConditions.familiarRouteHistory?.[routeFamiliarityKey(route)] || 0
    : 0;
  // Familiarity is a tie-breaker rather than an override: unsafe or severely
  // delayed routes still lose to safer alternatives.
  const familiarityCost = familiarityCount > 0 ? -Math.min(18, 8 + familiarityCount * 3) : 0;

  const totalCost = Math.round(
    timeCost +
      walkCost +
      transferCost +
      crowdCost +
      fareCost +
      reliabilityCost +
      accessibilityCost +
      modeCost +
      weatherCost +
      cyclingDecisionCost +
      familiarityCost
  );

  // Generate dynamic commuter explanation
  let explanation = '';
  if (preferences.stepFreeAccess && route.stepFreeAccessible === false) {
    explanation = 'Not recommended: does not meet your required step-free access needs.';
  } else if (route.id === 'bus-96-ccl') {
    if (prefersLowerFare) {
      explanation = `Lowest fare option ($${route.estimatedFare?.toFixed(2)}) with step-free direct boarding.`;
    } else if (preferences.travelMode === 'prefer_buses') {
      explanation = 'Recommended: direct street-level boarding on Bus 96 with step-free sheltered linkways.';
    } else {
      explanation = 'High frequency, step-free access and seats available right now.';
    }
  } else if (route.id === 'ccl-dtl') {
    if (prefersLessCrowd && liveConditions.ewlDisruptionActive) {
      explanation = 'Recommended: bypasses City Hall delay with 1 smooth transfer and lower crowding.';
    } else if (prefersLessWalk) {
      explanation = 'Recommended: sheltered platform transfers and reliable timings.';
    } else {
      explanation = 'Balances speed with fewer risky transfers and high schedule reliability.';
    }
  } else if (route.id === 'ccl-ewl') {
    if (preferences.fastestJourney && !prefersLessCrowd) {
      explanation = 'Fastest theoretical journey, but City Hall bottleneck currently adds crowd delay risk.';
    } else {
      explanation = 'Higher crowding and multiple transfers make this less optimal under current evening conditions.';
    }
  } else if (route.id === 'bus-33') {
    if (prefersFewerTransfers && !preferences.fastestJourney) {
      explanation = 'Zero-transfer direct journey, though subject to moderate peak road congestion.';
    } else {
      explanation = 'Convenient direct bus, but travel time is longer due to arterial road congestion.';
    }
  } else if (route.routeMode === 'multimodal' && hasCyclingLeg) {
    const distanceKm = ((route.cyclingDistanceMeters || 0) / 1000).toFixed(1);
    explanation = cyclingDecisionExplanation || `Bike-and-ride option: cycle ${distanceKm} km to a public transport connection, then continue by bus or train.`;
  } else if (isCyclingOnly) {
    const distanceKm = ((route.cyclingDistanceMeters || 0) / 1000).toFixed(1);
    explanation = `Direct ${distanceKm} km cycling route with no transfers or fare.`;
  } else {
    explanation = 'Calculated based on current live conditions and your active commute preferences.';
  }

  // Append a rain-specific note (skip when the route is already disqualified on accessibility grounds)
  if (liveConditions.isRaining && !(preferences.stepFreeAccess && route.stepFreeAccessible === false)) {
    if (hasCyclingLeg) {
      if (!cyclingDecisionExplanation.toLowerCase().includes('rain')) {
        explanation += ' Rain is expected — consider a route without cycling or delay departure.';
      }
    } else {
      explanation += hasUnshelteredWalk
        ? ' Rain forecast in your area — this route has an uncovered walking segment.'
        : ' Rain forecast in your area — this route stays under cover.';
    }
  }

  if (familiarityCount > 0) {
    explanation = `${explanation} Familiar route: you have used this journey before.`;
  }

  return {
    scoredRoute: {
      ...route,
      totalDurationMin: dynamicTravelTime,
      calculatedScore: totalCost,
    },
    factors: {
      timeCost,
      walkCost,
      transferCost,
      crowdCost,
      fareCost,
      reliabilityCost,
      accessibilityCost,
      modeCost,
      weatherCost,
      cyclingDecisionCost,
      familiarityCost,
      cyclingRecommended,
      totalCost,
      explanation,
    },
  };
}

/**
 * Ranks all available routes and assigns dynamic badges based on score
 */
export function rankRoutes(
  routes: RouteOption[],
  preferences: UserPreferences,
  liveConditions?: RouteLiveConditions
): RouteOption[] {
  const transitDurations = routes
    .filter((route) => !route.steps.some((step) => step.type === 'cycle'))
    .map((route) => route.totalDurationMin);
  const fastestTransitDuration = transitDurations.length > 0 ? Math.min(...transitDurations) : 0;
  const comparedRoutes = routes.map((route) => ({
    ...route,
    extraTravelTimeMin: route.steps.some((step) => step.type === 'cycle')
      ? Math.max(0, route.totalDurationMin - fastestTransitDuration)
      : undefined,
    weatherSuitable: route.steps.some((step) => step.type === 'cycle')
      ? !liveConditions?.isRaining
      : route.weatherSuitable,
  }));
  const scored = comparedRoutes.map((r) => scoreRoute(r, preferences, liveConditions));

  // Sort ascending by totalCost (lowest cost is best match)
  scored.sort((a, b) => a.factors.totalCost - b.factors.totalCost);

  return scored.map((item, index) => {
    let badge: RouteOption['badge'] = undefined;

    if (item.factors.cyclingRecommended) {
      badge = 'RECOMMENDED FOR YOU';
    } else if (index === 0 && item.factors.accessibilityCost < 500) {
      badge = 'BEST MATCH';
    } else if (item.scoredRoute.id === 'ccl-ewl') {
      badge = 'FASTEST';
    } else if (item.scoredRoute.transfers === 0) {
      badge = 'SIMPLEST';
    }

    return {
      ...item.scoredRoute,
      badge,
      whyRecommended: item.factors.explanation,
    };
  });
}
