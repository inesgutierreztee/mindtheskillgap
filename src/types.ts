export type TabType = 'home' | 'map' | 'more';

// Judging-demo overrides for Rachel's home. 'live' applies none; the others pin
// a demo clock (7:20 am, or her 7:40 departure for 'active') and, for
// rain/reroute, simulated rain. All labelled in-app.
export type RachelScenario = 'live' | 'routine' | 'active' | 'rain' | 'reroute';

// Judging-demo overrides for Arjun's home: an 8:02 am demo clock, plus
// simulated crowding or heavy rain. 'live' applies none.
export type ArjunScenario = 'live' | 'normal' | 'crowd' | 'rain';

// Judging-demo overrides for Mdm Lim's home: her usual journey in progress on
// appointment day, or the night before with a simulated lift outage or heavy
// rain. 'live' applies none.
export type MdmLimScenario = 'live' | 'usual' | 'lift' | 'rain';

export type CrowdLevel = 'Unknown' | 'Seats available' | 'Standing available' | 'Moderate crowd' | 'Crowded';
export type TrafficLevel = 'Smooth' | 'Moderate' | 'Slow traffic' | 'Heavy traffic';
export type TrainStatusLevel = 'Normal service' | 'Minor delay' | 'Disruption';

export interface BusStop {
  code: string;
  road: string;
  desc: string;
  lat: number;
  lng: number;
  distanceMeters?: number;
  walkMinutes?: number;
}

export interface BusArrival {
  serviceNo: string;
  destination: string;
  nextBusMin: number;
  subsequentBusMin?: number;
  thirdBusMin?: number;
  crowdLevel: CrowdLevel;
  traffic: TrafficLevel;
  wheelchair: boolean;
  type: 'SD' | 'DD' | 'BD';
}

export interface TrainStation {
  code: string;
  name: string;
  line: string;
  lat: number;
  lng: number;
  status: string;
  crowdLevel: CrowdLevel;
  nextTrainMin: number;
  frequencyMin: number;
  disruptionNote?: string;
  rawCrowdCode?: 'l' | 'm' | 'h';
  transferCodes?: string[];
}

export interface LineSummary {
  line: string;
  name: string;
  color: string;
  status: string;
  isNormal: boolean;
  stationCount: number;
  crowdSummary: string;
}

export interface TravelNeeds {
  stepFreeAccess: boolean;
  shortWalkingDistances: boolean;
  avoidCrowdedServices: boolean;
  noSpecificNeeds: boolean;
}

export type TravelModePreference = 'no_preference' | 'prefer_buses' | 'prefer_trains';

export type RoutePriority = 'time' | 'walk' | 'transfer' | 'fare' | 'crowd' | 'no_preference';

export interface TransportModePreferences {
  rail: boolean;
  bus: boolean;
  walking: boolean;
  cycling: boolean;
}

export interface CyclingPreferences {
  enabled: boolean;
  suggestWhen: {
    busesCrowded: boolean;
    crowdedInterchange: boolean;
    longBusWait: boolean;
    disruptionReliability: boolean;
  };
  maxExtraMinutes: 5 | 10 | 15 | 20 | null;
  avoidWhen: {
    heavyRain: boolean;
    poorInfrastructure: boolean;
    noBikeParking: boolean;
    routeTooLong: boolean;
  };
  bikeAtStation: 'park' | 'foldable';
}

// The three commuter personas from the hackathon brief. Selected during onboarding
// so the app can target one explicitly, per persona-specific fit being a named
// scoring factor (rather than serving one generic experience to everyone).
export type CommuterPersona = 'rachel' | 'arjun' | 'mdmlim';

export interface LearningPreferences {
  learnRouteChoices: boolean;
  suggestRoutines: boolean;
  // During an active disruption, keep an already-familiar legacy best match
  // instead of letting the network-aware promotion layer displace it.
  preferFamiliarRoutesDuringDisruptions: boolean;
  // Speak each turn-by-turn step aloud during journey guidance.
  audioGuidance: boolean;
}

export interface UserPreferences {
  lessWalking: boolean;
  fewerTransfers: boolean;
  lessCrowded: boolean;
  fastestJourney: boolean;
  lowerFare?: boolean;
  stepFreeAccess?: boolean;
  travelMode?: TravelModePreference;
  priorities?: RoutePriority[];
  priority?: 'comfort' | 'time' | 'walking' | 'transfers' | 'fare' | 'balanced';
  transportModes: TransportModePreferences;
  cyclingPreferences: CyclingPreferences;
  // Rachel: only interrupt for delays at or above this many minutes. Undefined = show every alert.
  alertThresholdMin?: number;
  // Mdm Lim: scale up type sizes across the app.
  largeText?: boolean;
  // Arjun: compare routing across a flexible ~60 min departure window, not just "now".
  flexibleDeparture?: boolean;
  // One-handed accessibility: which thumb reaches the screen. 'off' keeps the
  // default layout; 'left'/'right' moves back buttons, close controls, floating
  // map buttons and the origin/destination swap button to that side.
  dominantHand?: 'off' | 'left' | 'right';
}

export type DominantHand = NonNullable<UserPreferences['dominantHand']>;

export interface NotificationPreferences {
  serviceDisruptions: boolean;
  transferReminders: boolean;
  liveTransitUpdates: boolean;
  personalisedSuggestions: boolean;
}

export interface TransferPreferences {
  stepByStep: boolean;
  platformAlerts: boolean;
  walkingGuidance: boolean;
}

export interface CommuteRoutine {
  id: string;
  boardingName: string;
  boardingDesc: string;
  serviceName: string;
  serviceRoute: string;
  days: string[];
  fromTime: string;
  toTime: string;
  isConfirmed: boolean;
  isDismissed: boolean;
}

export interface RouteProgressionStop {
  name: string;
  subText: string;
  status: 'passed' | 'next' | 'intermediate' | 'alight';
}

export interface StepTargetInfo {
  name: string;
  identifier?: string;
  landmark?: string;
  lat: number;
  lng: number;
  type?: 'bus_stop' | 'mrt_entrance' | 'platform' | 'bike_parking' | 'destination';
}

export interface RouteStep {
  stepNumber: number;
  type: 'walk' | 'cycle' | 'train' | 'bus' | 'transfer';
  instruction: string;
  subText: string;
  durationMin: number;
  distanceMeters?: number;
  lineOrService?: string;
  direction?: string;
  alightStationOrStop?: string;
  transferType?: 'bus-to-train' | 'train-to-train';
  stageLabel?: string;
  sheltered?: boolean;
  stepFree?: boolean;
  stopsRemaining?: number;
  stopsCount?: number;
  progressionStops?: RouteProgressionStop[];
  bayOrBerth?: string;
  upcomingStepTitle?: string;
  upcomingStepSubtitle?: string;
  // Wayfinding Coordinates & Targets
  startPoint?: { lat: number; lng: number; name?: string };
  // LTA bus stop code where a bus leg is boarded, for live occupancy (Load) lookups.
  boardingStopCode?: string;
  alightingStopCode?: string;
  boardingStationCode?: string;
  alightingStationCode?: string;
  targetPoint?: StepTargetInfo;
  pathCoordinates?: [number, number][];
  // Turn-by-turn cycling directions. Each carries the real anchor point OneMap
  // gave that turn (when available) so guidance can advance by live location
  // instead of asking someone to read a full list while riding.
  navigationInstructions?: { text: string; lat?: number; lng?: number }[];
}

export interface RouteOption {
  id: string;
  title: string;
  summary: string;
  lines: string[];
  totalDurationMin: number;
  /** Absolute departure used to request/map this itinerary, including any offset. */
  departureTimeMs?: number;
  walkingMinutes: number;
  transfers: number;
  crowdRating: 'Low' | 'Moderate' | 'High';
  crowdEstimateText?: string;
  estimatedFare?: number;
  reliabilityRating: 'High' | 'Moderate' | 'Low';
  stepFreeAccessible?: boolean;
  badge?: 'BEST MATCH' | 'FASTEST' | 'SIMPLEST' | 'RECOMMENDED' | 'RECOMMENDED FOR YOU';
  whyRecommended: string;
  steps: RouteStep[];
  calculatedScore?: number;
  trafficSensitive?: boolean;
  routeMode?: 'transit' | 'cycle' | 'multimodal';
  cyclingDistanceMeters?: number;
  bicycleParkingVerified?: boolean;
  bicycleParkingAvailable?: boolean;
  cyclingInfrastructureQuality?: 'good' | 'mixed' | 'poor' | 'unknown';
  extraTravelTimeMin?: number;
  weatherSuitable?: boolean;
  dataSource?: 'live' | 'mock';
  /** Shadow-only metadata for legitimate time-shifted route candidates. */
  networkAwareBaseRouteId?: string;
  networkAwareDepartureDelayMin?: number;
  networkAwareCandidateSource?: string;
  networkAwareRecommendation?: boolean;
  networkAwareReasonCode?: string;
  networkAwareExplanation?: string;
}

export interface DisruptionAlert {
  id: string;
  line: string;
  headline: string;
  subText: string;
  confidence: number;
  delayEstimateMin: number;
  active: boolean;
  whatHappened: string;
  howItAffectsYou: string;
  whatYouShouldDo: string;
  recommendedRouteId: string;
}

export interface LiveTransportCondition {
  id: string;
  type: 'bus' | 'train';
  serviceOrLine: string;
  routeTitle: string;
  nextArrivalMin: number;
  crowdLevel: CrowdLevel;
  trafficOrStatus: string;
  operator?: string;
  title?: string;
  subtitle?: string;
  status?: string;
  etaMinutes?: number;
  /** The stop where this bus can be boarded. */
  boardingStopName?: string;
  /** The bus terminus/destination shown to the rider. */
  destination?: string;
  /** Straight-line distance from the active persona's home location. */
  distanceMeters?: number;
}
