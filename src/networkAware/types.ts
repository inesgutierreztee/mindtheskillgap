export type CrowdRisk = 'UNKNOWN' | 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
export type DecisionReasonCode =
  | 'NETWORK_PRESSURE'
  | 'PERSONAL_PREFERENCE'
  | 'FASTER_ROUTE'
  | 'FLEXIBLE_DEPARTURE'
  | 'FAIRNESS_GUARDRAIL'
  | 'HYSTERESIS_RETAINED'
  | 'UNKNOWN_DATA_CAUTION'
  | 'DISRUPTION_AVOIDANCE';

export type NetworkResourceType =
  | 'STATION'
  | 'RAIL_SEGMENT'
  | 'BUS_SERVICE'
  | 'BUS_STOP'
  | 'CORRIDOR';

export interface NetworkResourceUse {
  resourceId: string;
  type: NetworkResourceType;
  /** Minutes after departure when the passenger is expected to use this resource. */
  arrivalOffsetMinutes: number;
  name?: string;
}

/**
 * Host-agnostic route shape consumed by the network-aware engine.
 * The host application keeps its own route object in `payload`.
 */
export interface NetworkAwareRoute<TPayload = unknown> {
  id: string;
  durationMin: number;
  departureTimeMs: number;
  /** Optional absolute arrival; useful when durationMin includes pre-departure waiting. */
  arrivalTimeMs?: number;
  resources: NetworkResourceUse[];
  disrupted?: boolean;
  payload?: TPayload;
}

export interface ResourceObservation {
  resourceId: string;
  type: NetworkResourceType;
  name?: string;
  observedAtMs: number;
  currentCrowd: CrowdRisk;
  /** Typical incoming passenger demand for a 15-minute period. */
  backgroundDemand15Min: number;
  /** Proxy/estimated passenger throughput for a 15-minute period. */
  capacity15Min: number;
  disrupted?: boolean;
  /** Optional extra disruption demand as a fraction of one bucket's capacity. */
  disruptionDemandFactor?: number;
  /** Optional external forecast signal. Kept separate from current crowd. */
  forecastCrowd?: CrowdRisk;
  forecastAtMs?: number;
}

export interface RecommendationResourceDemand {
  resourceId: string;
  resourceType: NetworkResourceType;
  resourceName?: string;
  expectedArrivalMs: number;
  bucketStartMs: number;
  bucketEndMs: number;
  expectedPassengers: number;
}

export interface RecommendationEntry {
  journeyRequestId: string;
  routeId: string;
  issuedAtMs: number;
  departureTimeMs: number;
  userCountRepresented: number;
  complianceProbability: number;
  expectedPassengerContribution: number;
  resourceDemands: RecommendationResourceDemand[];
}

export interface ResourcePrediction {
  resourceId: string;
  resourceName?: string;
  resourceType?: NetworkResourceType;
  targetTimeMs: number;
  bucketStartMs: number;
  crowdRisk: CrowdRisk;
  loadRatio: number;
  totalDemand: number;
  capacity: number;
  components: {
    backgroundDemand: number;
    currentCrowdCarryover: number;
    externalForecastContribution: number;
    disruptionDemand: number;
    recommendationDemand: number;
  };
  provenance: {
    observationAvailable: boolean;
    usesCapacityProxy: boolean;
  };
}

export interface RouteNetworkPrediction {
  crowdRisk: CrowdRisk;
  bottleneckResourceId?: string;
  bottleneckResourceName?: string;
  maxLoadRatio: number;
  resourcePredictions: ResourcePrediction[];
}

export interface FairnessResult {
  sacrificeMin: number;
  /** Detour from the earliest eligible arrival, used only by the hard guardrail. */
  absoluteSacrificeMin?: number;
  isFair: boolean;
  penalty: number;
  explanation: string;
}

export interface EvaluatedRoute<TPayload = unknown> {
  route: NetworkAwareRoute<TPayload>;
  personalCost: number;
  networkCost: number;
  /** Hysteresis cost applied only when switching away from a supplied incumbent route. */
  switchingCost: number;
  fairness: FairnessResult;
  totalCost: number;
  prediction: RouteNetworkPrediction;
  reason: string;
  decisionReasonCode: DecisionReasonCode;
}

export interface EvaluationResult<TPayload = unknown> {
  recommended: EvaluatedRoute<TPayload> | null;
  rankedRoutes: EvaluatedRoute<TPayload>[];
  personalBaselineRouteId: string | null;
}
