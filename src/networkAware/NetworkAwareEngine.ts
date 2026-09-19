import { RecommendationLedger, IssueRecommendationInput } from './RecommendationLedger';
import { NetworkState } from './NetworkState';
import { crowdRank, evaluateFairness, FairnessConfig } from './Fairness';
import {
  CrowdRisk,
  DecisionReasonCode,
  EvaluatedRoute,
  EvaluationResult,
  NetworkAwareRoute,
  ResourcePrediction,
  RouteNetworkPrediction,
} from './types';

export interface NetworkAwareEngineOptions {
  networkState: NetworkState;
  recommendationLedger: RecommendationLedger;
  fairnessConfig?: Partial<FairnessConfig>;
  maxNetworkCost?: number;
  /** Default cost a challenger must overcome before switching away from an incumbent route. */
  switchThreshold?: number;
  /** Conservative penalty for a route resource with no network observation. */
  unknownResourceBasePenalty?: number;
  /** Extra uncertainty penalty per expected recommended passenger on an unknown resource. */
  unknownRecommendationPenaltyPerPassenger?: number;
  /** Cap on the demand-derived uncertainty penalty for one unknown resource. */
  maxUnknownRecommendationPenalty?: number;
}

export interface EvaluateOptions<TPayload> {
  nowMs: number;
  /** Host-provided personal/generalised route cost. Must not mutate the route. */
  personalCost: (
    route: NetworkAwareRoute<TPayload>,
    prediction: RouteNetworkPrediction
  ) => number;
  /**
   * Optional route currently being recommended. If it is still available, a
   * challenger must beat it by the switch threshold before the engine changes
   * recommendation. This prevents A/B/A/B oscillation while keeping evaluate() pure.
   */
  incumbentRouteId?: string;
  /** Overrides the engine's default hysteresis threshold for this evaluation. */
  switchThreshold?: number;
}

/**
 * Portable network-aware route evaluator.
 * `evaluate()` is pure with respect to RecommendationLedger: it only reads state.
 */
export class NetworkAwareEngine<TPayload = unknown> {
  private networkState: NetworkState;
  private readonly ledger: RecommendationLedger;
  private readonly fairnessConfig?: Partial<FairnessConfig>;
  private readonly maxNetworkCost: number;
  private readonly switchThreshold: number;
  private readonly unknownResourceBasePenalty: number;
  private readonly unknownRecommendationPenaltyPerPassenger: number;
  private readonly maxUnknownRecommendationPenalty: number;

  constructor(options: NetworkAwareEngineOptions) {
    this.networkState = options.networkState;
    this.ledger = options.recommendationLedger;
    this.fairnessConfig = options.fairnessConfig;
    this.maxNetworkCost = finiteNonNegative(options.maxNetworkCost ?? 80);
    this.switchThreshold = finiteNonNegative(options.switchThreshold ?? 3);
    this.unknownResourceBasePenalty = finiteNonNegative(
      options.unknownResourceBasePenalty ?? 2
    );
    this.unknownRecommendationPenaltyPerPassenger = finiteNonNegative(
      options.unknownRecommendationPenaltyPerPassenger ?? 0.05
    );
    this.maxUnknownRecommendationPenalty = finiteNonNegative(
      options.maxUnknownRecommendationPenalty ?? 20
    );
  }

  public setNetworkState(networkState: NetworkState): void {
    this.networkState = networkState;
  }

  public getRecommendationLedger(): RecommendationLedger {
    return this.ledger;
  }

  public evaluate(
    routes: NetworkAwareRoute<TPayload>[],
    options: EvaluateOptions<TPayload>
  ): EvaluationResult<TPayload> {
    if (routes.length === 0) {
      return { recommended: null, rankedRoutes: [], personalBaselineRouteId: null };
    }

    const validRoutes = routes.filter(isEvaluableRoute);
    if (validRoutes.length === 0) {
      return { recommended: null, rankedRoutes: [], personalBaselineRouteId: null };
    }

    const predicted = validRoutes.map((route) => {
      const prediction = this.predictRoute(route, options.nowMs);
      const networkCost = this.calculateNetworkCost(prediction.resourcePredictions);
      const personalCost = finiteCost(options.personalCost(route, prediction));
      return { route, prediction, networkCost, personalCost };
    });

    const personalBaseline = [...predicted].sort(
      (a, b) =>
        a.personalCost - b.personalCost ||
        effectiveArrivalTimeMs(a.route) - effectiveArrivalTimeMs(b.route) ||
        a.route.id.localeCompare(b.route.id)
    )[0];
    const personalBaselineArrivalMs = effectiveArrivalTimeMs(personalBaseline.route);
    const earliestEligibleArrivalMs = Math.min(
      ...predicted.map((item) => effectiveArrivalTimeMs(item.route))
    );

    const incumbentId = options.incumbentRouteId?.trim();
    const incumbentExists = Boolean(
      incumbentId && predicted.some((item) => item.route.id === incumbentId)
    );
    const switchThreshold = finiteNonNegative(
      options.switchThreshold ?? this.switchThreshold
    );

    const rankedRoutes: EvaluatedRoute<TPayload>[] = predicted
      .map(({ route, prediction, networkCost, personalCost }) => {
        const fairness = evaluateFairness(
          Math.max(0, (effectiveArrivalTimeMs(route) - personalBaselineArrivalMs) / 60_000),
          personalBaseline.prediction,
          personalBaseline.route.disrupted ?? false,
          this.fairnessConfig,
          Math.max(0, (effectiveArrivalTimeMs(route) - earliestEligibleArrivalMs) / 60_000)
        );
        const switchingCost =
          incumbentExists && incumbentId !== route.id ? switchThreshold : 0;
        const totalCost = round2(
          personalCost + networkCost + fairness.penalty + switchingCost
        );

        const decisionReasonCode = this.initialReasonCode(route, prediction, fairness.isFair);
        return {
          route,
          personalCost: round2(personalCost),
          networkCost: round2(networkCost),
          switchingCost: round2(switchingCost),
          fairness,
          totalCost,
          prediction,
          reason: this.buildReason(
            route,
            prediction,
            networkCost,
            fairness.sacrificeMin,
            switchingCost
          ),
          decisionReasonCode,
        };
      })
      .sort((a, b) => {
        // Fair routes always rank ahead of unfair routes. This turns fairness
        // from a soft suggestion into a real guardrail.
        if (a.fairness.isFair !== b.fairness.isFair) {
          return a.fairness.isFair ? -1 : 1;
        }
        return (
          a.totalCost - b.totalCost ||
          a.route.durationMin - b.route.durationMin ||
          a.route.id.localeCompare(b.route.id)
        );
      });

    const contextual = this.applyDecisionContext(rankedRoutes, personalBaseline.route.id, incumbentId);
    return {
      recommended: contextual[0] ?? null,
      rankedRoutes: contextual,
      personalBaselineRouteId: personalBaseline.route.id,
    };
  }

  /** The only method that writes recommendation demand. */
  public issueRecommendation(
    input: IssueRecommendationInput<TPayload>
  ): { recorded: boolean } {
    return {
      recorded: this.ledger.issueRecommendation(input).recorded,
    };
  }

  private predictRoute(
    route: NetworkAwareRoute<TPayload>,
    nowMs: number
  ): RouteNetworkPrediction {
    const resourcePredictions = route.resources
      .filter(
        (resource) =>
          resource.resourceId.trim().length > 0 &&
          Number.isFinite(resource.arrivalOffsetMinutes)
      )
      .map((resource) => {
        const targetTimeMs =
          route.departureTimeMs + resource.arrivalOffsetMinutes * 60_000;
        const prediction = this.networkState.predictResource(
          resource.resourceId,
          targetTimeMs,
          this.ledger,
          nowMs
        );
        return {
          ...prediction,
          resourceName: prediction.resourceName ?? resource.name,
          resourceType: prediction.resourceType ?? resource.type,
        };
      });

    let crowdRisk: CrowdRisk = 'UNKNOWN';

    for (const prediction of resourcePredictions) {
      if (crowdRank(prediction.crowdRisk) > crowdRank(crowdRisk)) {
        crowdRisk = prediction.crowdRisk;
      }
    }
    const bottleneck = this.selectExplanationBottleneck(resourcePredictions);

    return {
      crowdRisk,
      bottleneckResourceId: bottleneck?.resourceId,
      bottleneckResourceName: bottleneck?.resourceName,
      maxLoadRatio: bottleneck?.loadRatio ?? 0,
      resourcePredictions,
    };
  }

  private selectExplanationBottleneck(predictions: ResourcePrediction[]): ResourcePrediction | undefined {
    if (predictions.length === 0) return undefined;
    const maxLoad = Math.max(...predictions.map((item) => item.loadRatio));
    const names = new Map<string, number>();
    predictions.forEach((item) => {
      const key = String(item.resourceName || '').trim().toLowerCase();
      if (key) names.set(key, (names.get(key) || 0) + 1);
    });
    const priority = (item: ResourcePrediction): number => {
      if (item.components.disruptionDemand > 0) return 0;
      const name = String(item.resourceName || '').trim().toLowerCase();
      if ((name && (names.get(name) || 0) > 1) || /transfer|interchange/.test(name)) return 1;
      if (item.resourceType === 'RAIL_SEGMENT') return 2;
      if (item.resourceType === 'BUS_SERVICE') return 3;
      if (item.resourceType === 'STATION' || item.resourceType === 'BUS_STOP') return 4;
      return 5;
    };
    return [...predictions]
      .filter((item) => Math.abs(item.loadRatio - maxLoad) <= 0.01)
      .sort((a, b) => priority(a) - priority(b) || a.resourceId.localeCompare(b.resourceId))[0];
  }

  private initialReasonCode(
    route: NetworkAwareRoute<TPayload>,
    prediction: RouteNetworkPrediction,
    isFair: boolean
  ): DecisionReasonCode {
    if (!isFair) return 'FAIRNESS_GUARDRAIL';
    if (route.disrupted) return 'DISRUPTION_AVOIDANCE';
    if (prediction.resourcePredictions.some((item) => !item.provenance.observationAvailable)) {
      return 'UNKNOWN_DATA_CAUTION';
    }
    if (prediction.crowdRisk === 'HIGH' || prediction.crowdRisk === 'CRITICAL') return 'NETWORK_PRESSURE';
    return 'PERSONAL_PREFERENCE';
  }

  private applyDecisionContext(
    ranked: EvaluatedRoute<TPayload>[],
    personalBaselineRouteId: string,
    incumbentId?: string
  ): EvaluatedRoute<TPayload>[] {
    if (ranked.length === 0) return ranked;
    const winner = ranked[0];
    let code = winner.decisionReasonCode;
    const incumbent = incumbentId ? ranked.find((item) => item.route.id === incumbentId) : undefined;
    if (incumbent && winner.route.id === incumbent.route.id) {
      const retainedAgainst = ranked.find(
        (item) => item.route.id !== incumbent.route.id && item.fairness.isFair &&
          item.totalCost - item.switchingCost < incumbent.totalCost && item.totalCost >= incumbent.totalCost
      );
      if (retainedAgainst) code = 'HYSTERESIS_RETAINED';
    }
    if (code !== 'HYSTERESIS_RETAINED') {
      const fairnessBlocked = ranked.some(
        (item) => !item.fairness.isFair &&
          item.totalCost - item.fairness.penalty < winner.totalCost
      );
      const earliestDeparture = Math.min(...ranked.map((item) => item.route.departureTimeMs));
      const isLater = winner.route.departureTimeMs - earliestDeparture >= 10 * 60_000;
      const pressureChangedOutcome = ranked.some(
        (item) => item.route.id !== winner.route.id && item.fairness.isFair &&
          item.personalCost < winner.personalCost && item.totalCost > winner.totalCost &&
          item.networkCost > winner.networkCost
      );
      if (fairnessBlocked) code = 'FAIRNESS_GUARDRAIL';
      else if (isLater && pressureChangedOutcome) code = 'FLEXIBLE_DEPARTURE';
      else if (pressureChangedOutcome) code = 'NETWORK_PRESSURE';
      else if (
        winner.route.id !== personalBaselineRouteId &&
        effectiveArrivalTimeMs(winner.route) < effectiveArrivalTimeMs(
          ranked.find((item) => item.route.id === personalBaselineRouteId)?.route ?? winner.route
        )
      ) code = 'FASTER_ROUTE';
      else if (code !== 'UNKNOWN_DATA_CAUTION' && code !== 'DISRUPTION_AVOIDANCE') code = 'PERSONAL_PREFERENCE';
    }
    return ranked.map((item, index) => index === 0 ? {
      ...item,
      decisionReasonCode: code,
      reason: this.reasonForCode(code, item),
    } : item);
  }

  private reasonForCode(code: DecisionReasonCode, item: EvaluatedRoute<TPayload>): string {
    switch (code) {
      case 'NETWORK_PRESSURE': return `Lower predicted network pressure made this route preferable; bottleneck: ${item.prediction.bottleneckResourceName || item.prediction.bottleneckResourceId || 'network resource'}.`;
      case 'FLEXIBLE_DEPARTURE': return 'A later departure has lower predicted network pressure after accounting for the wait.';
      case 'HYSTERESIS_RETAINED': return 'The incumbent route was retained because the challenger improvement did not exceed the switching threshold.';
      case 'FASTER_ROUTE': return 'This route won primarily on lower personal generalized cost and journey time, not network pressure.';
      case 'PERSONAL_PREFERENCE': return 'This route won primarily on personal generalized cost, not network pressure.';
      case 'FAIRNESS_GUARDRAIL': return "The network alternative would impose too much arrival-time sacrifice compared with the commuter's personal baseline.";
      case 'DISRUPTION_AVOIDANCE': return 'This route avoids a resource affected by a live service disruption.';
      case 'UNKNOWN_DATA_CAUTION': return 'Some route resources remain unknown, so conservative uncertainty treatment was applied.';
    }
  }

  private calculateNetworkCost(predictions: ResourcePrediction[]): number {
    const penalties = predictions
      .map((prediction) => {
        if (prediction.provenance.observationAvailable) {
          return penaltyForLoadRatio(prediction.loadRatio);
        }

        // Unknown does not mean empty. Apply a small uncertainty cost, and let
        // already-issued recommendation demand increase that cost without
        // pretending we know a crowd level or physical capacity.
        const demandPenalty = Math.min(
          this.maxUnknownRecommendationPenalty,
          prediction.components.recommendationDemand *
            this.unknownRecommendationPenaltyPerPassenger
        );
        return this.unknownResourceBasePenalty + demandPenalty;
      })
      .sort((a, b) => b - a);

    if (penalties.length === 0) return 0;

    // Bottleneck dominates. Secondary resources contribute at lower weight so
    // longer routes are not automatically punished just for containing more legs.
    const [largest, ...rest] = penalties;
    const secondary = rest.reduce((sum, value) => sum + value, 0) * 0.25;
    return Math.min(this.maxNetworkCost, round2(largest + secondary));
  }

  private buildReason(
    route: NetworkAwareRoute<TPayload>,
    prediction: RouteNetworkPrediction,
    networkCost: number,
    sacrificeMin: number,
    switchingCost: number
  ): string {
    const bottleneck =
      prediction.bottleneckResourceName ?? prediction.bottleneckResourceId;
    const unknownPredictions = prediction.resourcePredictions.filter(
      (p) => !p.provenance.observationAvailable
    );

    if (prediction.crowdRisk === 'CRITICAL' || prediction.crowdRisk === 'HIGH') {
      return bottleneck
        ? `Expected ${prediction.crowdRisk.toLowerCase()} crowding around ${bottleneck}; network cost ${Math.round(networkCost)}.`
        : `Expected ${prediction.crowdRisk.toLowerCase()} crowding on this route.`;
    }
    if (unknownPredictions.length > 0) {
      return 'Some network resources lack observations, so a conservative uncertainty penalty was applied.';
    }
    if (switchingCost > 0) {
      return 'This alternative must be meaningfully better before replacing the current recommendation.';
    }
    if (sacrificeMin > 0 && networkCost <= 5) {
      return `Adds about ${Math.round(sacrificeMin)} min while avoiding most forecast network pressure.`;
    }
    if (route.resources.length === 0) {
      return 'No structured network resources were available; network penalty was kept neutral.';
    }
    return 'Low forecast network pressure relative to the available alternatives.';
  }
}

function penaltyForLoadRatio(loadRatio: number): number {
  if (loadRatio <= 0.45) return 0;
  if (loadRatio <= 0.8) return (loadRatio - 0.45) * 28;
  if (loadRatio <= 1.05) return 9.8 + (loadRatio - 0.8) * 80;
  return 29.8 + (loadRatio - 1.05) * 120;
}

function finiteCost(value: number): number {
  if (!Number.isFinite(value)) return 1_000_000;
  return value;
}

function finiteNonNegative(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

function isEvaluableRoute<TPayload>(route: NetworkAwareRoute<TPayload>): boolean {
  return (
    route.id.trim().length > 0 &&
    Number.isFinite(route.durationMin) &&
    route.durationMin >= 0 &&
    Number.isFinite(route.departureTimeMs)
  );
}

function effectiveArrivalTimeMs<TPayload>(route: NetworkAwareRoute<TPayload>): number {
  if (Number.isFinite(route.arrivalTimeMs)) return route.arrivalTimeMs as number;
  return route.departureTimeMs + route.durationMin * 60_000;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
