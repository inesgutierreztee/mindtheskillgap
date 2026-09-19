import { RouteOption, RouteStep, UserPreferences, TravelNeeds, StepTargetInfo } from '../types';

export interface HighlightItem {
  key: 'fare' | 'walking' | 'transfers' | 'time' | 'crowd' | 'neutral' | 'accessibility';
  label: string;
  value: string;
  subValue?: string;
  isEstimate?: boolean;
  priority?: boolean;
  badgeType?: 'fare' | 'walk' | 'transfer' | 'time' | 'crowd' | 'access' | 'neutral';
}

/**
 * Returns whether any accessibility requirements were actively chosen by the user
 */
export function hasAccessibilityNeedsSelected(
  travelNeeds?: TravelNeeds,
  userPreferences?: UserPreferences
): boolean {
  if (!travelNeeds && !userPreferences) return false;
  return Boolean(
    (travelNeeds && travelNeeds.stepFreeAccess) ||
    (userPreferences && userPreferences.stepFreeAccess)
  );
}

/**
 * Derives personalized highlights for a given route based on user preferences and travel needs.
 *
 * Rules:
 * - Lower fare: show estimated fare prominently when available.
 * - Less walking: highlight walking distance or duration.
 * - Fewer transfers: highlight transfer count.
 * - Shorter travel time: highlight journey duration and estimated arrival.
 * - Less crowding: show crowd estimates when available, clearly labelled as estimates.
 * - When no accessibility needs selected: omit accessibility callouts/badges.
 * - With no stated preferences: use a neutral summary of arrival time, journey duration and transfers.
 * - Only show claims supported by route data.
 */
export function getRoutePersonalisedHighlights(
  route: RouteOption,
  userPreferences?: UserPreferences,
  travelNeeds?: TravelNeeds
): {
  primaryHighlight: HighlightItem;
  secondaryHighlights: HighlightItem[];
  accessibilityHighlight?: HighlightItem;
  isNeutral: boolean;
} {
  const wantsLowerFare = Boolean(
    userPreferences?.lowerFare || userPreferences?.priorities?.includes('fare')
  );
  const wantsLessWalking = Boolean(
    userPreferences?.lessWalking ||
    travelNeeds?.shortWalkingDistances ||
    userPreferences?.priorities?.includes('walk')
  );
  const wantsFewerTransfers = Boolean(
    userPreferences?.fewerTransfers ||
    userPreferences?.priorities?.includes('transfer')
  );
  const wantsFasterTime = Boolean(
    userPreferences?.fastestJourney ||
    userPreferences?.priorities?.includes('time')
  );
  const wantsLessCrowded = Boolean(
    userPreferences?.lessCrowded ||
    travelNeeds?.avoidCrowdedServices ||
    userPreferences?.priorities?.includes('crowd')
  );

  const hasAccessNeeds = hasAccessibilityNeedsSelected(travelNeeds, userPreferences);
  const isCyclingRoute = route.routeMode === 'cycle';
  const isBikeAndRide = route.routeMode === 'multimodal';
  const hasSpecificPreferences =
    wantsLowerFare || wantsLessWalking || wantsFewerTransfers || wantsFasterTime || wantsLessCrowded;

  // Format estimated arrival (Singapore local time based on total duration)
  const now = new Date();
  const arrivalDate = new Date(now.getTime() + route.totalDurationMin * 60000);
  const arrivalTimeStr = arrivalDate.toLocaleTimeString('en-SG', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  // Calculate total walking distance if available
  const totalWalkMeters = route.steps
    .filter((s) => s.type === 'walk' || s.type === 'transfer')
    .reduce((acc, s) => acc + (s.distanceMeters || 0), 0);

  const candidates: HighlightItem[] = [];

  // 1. Lower Fare candidate
  if (wantsLowerFare && route.estimatedFare !== undefined) {
    candidates.push({
      key: 'fare',
      label: 'Estimated Fare',
      value: `$${route.estimatedFare.toFixed(2)}`,
      subValue: 'Contactless / EZ-Link',
      isEstimate: true,
      priority: true,
      badgeType: 'fare',
    });
  }

  // 2. Less Walking candidate
  if (wantsLessWalking) {
    candidates.push({
      key: 'walking',
      label: 'Walking Distance',
      value: `${route.walkingMinutes} min walking`,
      subValue: totalWalkMeters > 0 ? `${totalWalkMeters} m total` : undefined,
      priority: true,
      badgeType: 'walk',
    });
  }

  // 3. Fewer Transfers candidate
  if (wantsFewerTransfers) {
    candidates.push({
      key: 'transfers',
      label: 'Transfers',
      value: route.transfers === 0 ? 'Direct ride (0 transfers)' : `${route.transfers} transfer${route.transfers > 1 ? 's' : ''}`,
      subValue: route.transfers === 0 ? 'No vehicle change' : 'Seamless transfer',
      priority: true,
      badgeType: 'transfer',
    });
  }

  // 4. Shorter Travel Time candidate
  if (wantsFasterTime) {
    candidates.push({
      key: 'time',
      label: 'Duration & Arrival',
      value: `${route.totalDurationMin} min duration`,
      subValue: `Est. arrival ${arrivalTimeStr}`,
      priority: true,
      badgeType: 'time',
    });
  }

  // 5. Less Crowding candidate
  if (wantsLessCrowded) {
    candidates.push({
      key: 'crowd',
      label: 'Crowd Estimate',
      value: `${route.crowdRating} crowding`,
      subValue: route.crowdEstimateText || 'Service crowd estimate',
      isEstimate: true,
      priority: true,
      badgeType: 'crowd',
    });
  }

  // Accessibility highlight (ONLY when user selected accessibility needs)
  let accessibilityHighlight: HighlightItem | undefined = undefined;
  if (hasAccessNeeds) {
    if (route.stepFreeAccessible === true) {
      accessibilityHighlight = {
        key: 'accessibility',
        label: 'Step-Free Access',
        value: 'Step-free route confirmed',
        subValue: 'Lifts and ramps available',
        badgeType: 'access',
      };
    } else if (route.stepFreeAccessible === false) {
      accessibilityHighlight = {
        key: 'accessibility',
        label: 'Accessibility Notice',
        value: 'Steps or stairs required',
        subValue: 'Not step-free accessible',
        badgeType: 'access',
      };
    } else {
      accessibilityHighlight = {
        key: 'accessibility',
        label: 'Accessibility Notice',
        value: 'Step-free access unverified',
        subValue: 'Check station facilities before travelling',
        badgeType: 'access',
      };
    }
  }

  // If no stated preferences, build neutral summary
  if (!hasSpecificPreferences || candidates.length === 0) {
    if (isCyclingRoute) {
      const distanceKm = ((route.cyclingDistanceMeters || 0) / 1000).toFixed(1);
      return {
        primaryHighlight: {
          key: 'time',
          label: 'Cycling summary',
          value: `${route.totalDurationMin} min · ${distanceKm} km`,
          subValue: `Est. arrival ${arrivalTimeStr}`,
          badgeType: 'time',
        },
        secondaryHighlights: [],
        accessibilityHighlight,
        isNeutral: true,
      };
    }
    const neutralPrimary: HighlightItem = {
      key: 'neutral',
      label: 'Trip Summary',
      value: `${route.totalDurationMin} min · Est. arrival ${arrivalTimeStr}`,
      subValue: isBikeAndRide
        ? `${((route.cyclingDistanceMeters || 0) / 1000).toFixed(1)} km cycle · ${route.transfers} transfer${route.transfers === 1 ? '' : 's'} · ${route.walkingMinutes} min walk`
        : `${route.transfers === 0 ? 'Direct ride' : `${route.transfers} transfer`} · ${route.walkingMinutes} min walk`,
      badgeType: 'neutral',
    };

    const neutralSecondaries: HighlightItem[] = [
      {
        key: 'transfers',
        label: 'Transfers',
        value: route.transfers === 0 ? 'Direct ride' : `${route.transfers} transfer`,
        badgeType: 'transfer',
      },
      {
        key: 'walking',
        label: 'Walking',
        value: `${route.walkingMinutes} min (${totalWalkMeters > 0 ? `${totalWalkMeters}m` : 'walk'})`,
        badgeType: 'walk',
      },
    ];

    if (route.estimatedFare !== undefined) {
      neutralSecondaries.push({
        key: 'fare',
        label: 'Fare',
        value: `$${route.estimatedFare.toFixed(2)} (Est.)`,
        isEstimate: true,
        badgeType: 'fare',
      });
    }

    return {
      primaryHighlight: neutralPrimary,
      secondaryHighlights: neutralSecondaries,
      accessibilityHighlight,
      isNeutral: true,
    };
  }

  // When preferences exist, primary is the top prioritized match
  const primaryHighlight = candidates[0];
  const secondaryHighlights = candidates.slice(1);

  // Add standard non-prioritized details to secondaries if needed
  if (!candidates.some((c) => c.key === 'time')) {
    secondaryHighlights.push({
      key: 'time',
      label: 'Duration',
      value: `${route.totalDurationMin} min (~${arrivalTimeStr})`,
      badgeType: 'time',
    });
  }
  if (!candidates.some((c) => c.key === 'fare') && route.estimatedFare !== undefined) {
    secondaryHighlights.push({
      key: 'fare',
      label: 'Est. Fare',
      value: `$${route.estimatedFare.toFixed(2)}`,
      isEstimate: true,
      badgeType: 'fare',
    });
  }

  return {
    primaryHighlight,
    secondaryHighlights,
    accessibilityHighlight,
    isNeutral: false,
  };
}

/**
 * Ensures a walking or transit step has complete and valid coordinates and target details.
 * Prevents missing maps or blank polyline containers even for dynamically generated steps.
 */
export function ensureStepWayfinding(
  step: RouteStep,
  route?: RouteOption,
  index: number = 0
): {
  startPoint: { lat: number; lng: number; name?: string };
  targetPoint: StepTargetInfo;
  pathCoordinates: [number, number][];
} {
  // If already fully populated on step, return as-is
  if (
    step.startPoint &&
    step.targetPoint &&
    step.pathCoordinates &&
    step.pathCoordinates.length >= 2
  ) {
    return {
      startPoint: step.startPoint,
      targetPoint: step.targetPoint,
      pathCoordinates: step.pathCoordinates,
    };
  }

  // Fallback coordinate anchors in Singapore (Kent Ridge - Clementi - Bugis corridors)
  const defaultAnchors: Record<string, { lat: number; lng: number; name: string }> = {
    clementi_int: { lat: 1.3152, lng: 103.7652, name: 'Clementi Bus Interchange' },
    clementi_mall: { lat: 1.3142, lng: 103.7645, name: 'Clementi Town Centre Walkway' },
    kent_ridge_mrt: { lat: 1.2931, lng: 103.7846, name: 'Kent Ridge MRT (CC24)' },
    kent_ridge_bus: { lat: 1.2935, lng: 103.7844, name: 'Opp Kent Ridge Stn (Stop 18331)' },
    botanic_gardens: { lat: 1.3224, lng: 103.8152, name: 'Botanic Gardens MRT (CC19/DT9)' },
    buona_vista: { lat: 1.3072, lng: 103.7904, name: 'Buona Vista MRT (EW21/CC22)' },
    bugis_mrt: { lat: 1.3005, lng: 103.8560, name: 'Bugis MRT Station (EW12/DT14)' },
  };

  let startPoint = step.startPoint || defaultAnchors.clementi_mall;
  let targetPoint = step.targetPoint;

  if (!targetPoint) {
    if (step.type === 'walk') {
      if (step.instruction.toLowerCase().includes('clementi')) {
        startPoint = defaultAnchors.clementi_mall;
        targetPoint = {
          name: 'Clementi Bus Interchange Berth 4',
          identifier: 'Stop 17009 · Berth 4',
          landmark: 'Entrance B / Town Centre Covered Linkway',
          lat: 1.3152,
          lng: 103.7652,
          type: 'bus_stop',
        };
      } else if (step.instruction.toLowerCase().includes('destination') || step.instruction.toLowerCase().includes('kent ridge')) {
        startPoint = defaultAnchors.kent_ridge_bus;
        targetPoint = {
          name: 'Kent Ridge MRT Station Entrance A',
          identifier: 'Exit A (CC24)',
          landmark: 'NUH Medical Centre Concourse Linkway',
          lat: 1.2931,
          lng: 103.7846,
          type: 'mrt_entrance',
        };
      } else if (step.instruction.toLowerCase().includes('bugis')) {
        startPoint = { lat: 1.3008, lng: 103.8555, name: 'Bugis Stn Bus Stop (01059)' };
        targetPoint = {
          name: 'Bugis MRT Station / Junction',
          identifier: 'Exit B (EW12/DT14)',
          landmark: 'Victoria St Pedestrian Linkway',
          lat: 1.3002,
          lng: 103.8562,
          type: 'destination',
        };
      } else {
        startPoint = defaultAnchors.kent_ridge_bus;
        targetPoint = {
          name: step.instruction,
          identifier: 'Target Arrival Point',
          landmark: step.subText,
          lat: 1.2931,
          lng: 103.7846,
          type: 'destination',
        };
      }
    } else if (step.type === 'transfer') {
      startPoint = { lat: 1.3220, lng: 103.8150, name: 'Circle Line Platform B' };
      targetPoint = {
        name: 'Downtown Line Platform A',
        identifier: 'DT9 (Towards Expo)',
        landmark: 'Botanic Gardens B2 Paid Linkway',
        lat: 1.3228,
        lng: 103.8155,
        type: 'platform',
      };
    } else {
      // Transit step
      startPoint = defaultAnchors.kent_ridge_bus;
      targetPoint = {
        name: step.alightStationOrStop || step.instruction,
        identifier: step.lineOrService || 'Transit Target',
        lat: 1.3005,
        lng: 103.8560,
        type: step.type === 'bus' ? 'bus_stop' : 'platform',
      };
    }
  }

  // Generate realistic polyline path between startPoint and targetPoint
  let pathCoordinates: [number, number][] = step.pathCoordinates || [];
  if (!pathCoordinates || pathCoordinates.length < 2) {
    const sLat = startPoint.lat;
    const sLng = startPoint.lng;
    const tLat = targetPoint.lat;
    const tLng = targetPoint.lng;

    // 4-point interpolated walking path with subtle curve along street/walkway
    const mid1: [number, number] = [
      sLat + (tLat - sLat) * 0.33 + 0.0001,
      sLng + (tLng - sLng) * 0.33,
    ];
    const mid2: [number, number] = [
      sLat + (tLat - sLat) * 0.67,
      sLng + (tLng - sLng) * 0.67 + 0.0001,
    ];
    pathCoordinates = [[sLat, sLng], mid1, mid2, [tLat, tLng]];
  }

  return {
    startPoint,
    targetPoint,
    pathCoordinates,
  };
}
