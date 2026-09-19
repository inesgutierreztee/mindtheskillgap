import { RecommendationLedger } from './RecommendationLedger';
import {
  CrowdRisk,
  ResourceObservation,
  ResourcePrediction,
} from './types';
import {
  bucketStartMs,
  exponentialDecay,
  minutesBetween,
} from './time';

export interface NetworkModelConfig {
  bucketSizeMin: number;
  currentCrowdHalfLifeMin: number;
  disruptionHalfLifeMin: number;
  currentCrowdWeight: number;
  externalForecastWeight: number;
  defaultDisruptionDemandFactor: number;
  crowdFactors: Record<CrowdRisk, number>;
  thresholds: {
    moderate: number;
    high: number;
    critical: number;
  };
}

export type BackgroundDemandMultiplier = (
  targetTimeMs: number,
  observation: ResourceObservation
) => number;

const DEFAULT_CONFIG: NetworkModelConfig = {
  bucketSizeMin: 5,
  currentCrowdHalfLifeMin: 15,
  disruptionHalfLifeMin: 25,
  currentCrowdWeight: 0.45,
  externalForecastWeight: 0.25,
  defaultDisruptionDemandFactor: 0.35,
  crowdFactors: {
    UNKNOWN: 0,
    LOW: 0.2,
    MODERATE: 0.45,
    HIGH: 0.75,
    CRITICAL: 0.95,
  },
  thresholds: {
    moderate: 0.45,
    high: 0.8,
    critical: 1.05,
  },
};

/**
 * Host-agnostic current network snapshot and short-horizon predictor.
 * Recommendation demand is passed in explicitly; there is no global ledger.
 */
export class NetworkState {
  private observations = new Map<string, ResourceObservation>();
  private readonly config: NetworkModelConfig;
  private readonly backgroundDemandMultiplier: BackgroundDemandMultiplier;

  constructor(options: {
    observations?: ResourceObservation[];
    config?: Partial<NetworkModelConfig> & {
      thresholds?: Partial<NetworkModelConfig['thresholds']>;
      crowdFactors?: Partial<Record<CrowdRisk, number>>;
    };
    backgroundDemandMultiplier?: BackgroundDemandMultiplier;
  } = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...options.config,
      thresholds: {
        ...DEFAULT_CONFIG.thresholds,
        ...(options.config?.thresholds ?? {}),
      },
      crowdFactors: {
        ...DEFAULT_CONFIG.crowdFactors,
        ...(options.config?.crowdFactors ?? {}),
      },
    };
    this.backgroundDemandMultiplier =
      options.backgroundDemandMultiplier ?? (() => 1);

    for (const observation of options.observations ?? []) {
      this.upsertObservation(observation);
    }
  }

  public upsertObservation(observation: ResourceObservation): void {
    const normalized = normalize(observation.resourceId);
    this.observations.set(normalized, {
      ...observation,
      resourceId: normalized,
      backgroundDemand15Min: Math.max(0, observation.backgroundDemand15Min),
      capacity15Min: Math.max(1, observation.capacity15Min),
    });
  }

  public removeObservation(resourceId: string): boolean {
    return this.observations.delete(normalize(resourceId));
  }

  public getObservation(resourceId: string): ResourceObservation | undefined {
    const value = this.observations.get(normalize(resourceId));
    return value ? { ...value } : undefined;
  }

  public getObservations(): ResourceObservation[] {
    return Array.from(this.observations.values()).map((o) => ({ ...o }));
  }

  public getConfig(): NetworkModelConfig {
    return {
      ...this.config,
      thresholds: { ...this.config.thresholds },
      crowdFactors: { ...this.config.crowdFactors },
    };
  }

  public predictResource(
    resourceId: string,
    targetTimeMs: number,
    ledger: RecommendationLedger,
    nowMs: number
  ): ResourcePrediction {
    const normalizedId = normalize(resourceId);
    const observation = this.observations.get(normalizedId);
    const bucketStart = bucketStartMs(targetTimeMs, this.config.bucketSizeMin);

    if (!observation) {
      const recommendationDemand = ledger.getActiveDemand(
        normalizedId,
        targetTimeMs,
        nowMs
      );
      return {
        resourceId: normalizedId,
        targetTimeMs,
        bucketStartMs: bucketStart,
        crowdRisk: 'UNKNOWN',
        loadRatio: 0,
        totalDemand: round1(recommendationDemand),
        capacity: 0,
        components: {
          backgroundDemand: 0,
          currentCrowdCarryover: 0,
          externalForecastContribution: 0,
          disruptionDemand: 0,
          recommendationDemand: round1(recommendationDemand),
        },
        provenance: {
          observationAvailable: false,
          usesCapacityProxy: false,
        },
      };
    }

    const capacity =
      observation.capacity15Min * (this.config.bucketSizeMin / 15);
    const timeMultiplier = Math.max(
      0,
      this.backgroundDemandMultiplier(targetTimeMs, observation)
    );
    const backgroundDemand =
      observation.backgroundDemand15Min *
      (this.config.bucketSizeMin / 15) *
      timeMultiplier;

    const observationHorizon = Math.max(
      0,
      minutesBetween(observation.observedAtMs, targetTimeMs)
    );
    const currentCrowdCarryover =
      capacity *
      this.config.crowdFactors[observation.currentCrowd] *
      this.config.currentCrowdWeight *
      exponentialDecay(
        observationHorizon,
        this.config.currentCrowdHalfLifeMin
      );

    let externalForecastContribution = 0;
    if (observation.forecastCrowd && observation.forecastAtMs !== undefined) {
      const forecastDistanceMin = Math.abs(
        minutesBetween(observation.forecastAtMs, targetTimeMs)
      );
      externalForecastContribution =
        capacity *
        this.config.crowdFactors[observation.forecastCrowd] *
        this.config.externalForecastWeight *
        exponentialDecay(forecastDistanceMin, 20);
    }

    const disruptionHorizon = Math.max(0, minutesBetween(nowMs, targetTimeMs));
    const disruptionDemand = observation.disrupted
      ? capacity *
        (observation.disruptionDemandFactor ??
          this.config.defaultDisruptionDemandFactor) *
        exponentialDecay(
          disruptionHorizon,
          this.config.disruptionHalfLifeMin
        )
      : 0;

    const recommendationDemand = ledger.getActiveDemand(
      normalizedId,
      targetTimeMs,
      nowMs
    );

    const totalDemand =
      backgroundDemand +
      currentCrowdCarryover +
      externalForecastContribution +
      disruptionDemand +
      recommendationDemand;
    const loadRatio = capacity > 0 ? totalDemand / capacity : 0;
    const crowdRisk = this.crowdRiskForRatio(loadRatio);

    return {
      resourceId: normalizedId,
      resourceName: observation.name,
      resourceType: observation.type,
      targetTimeMs,
      bucketStartMs: bucketStart,
      crowdRisk,
      loadRatio: round2(loadRatio),
      totalDemand: round1(totalDemand),
      capacity: round1(capacity),
      components: {
        backgroundDemand: round1(backgroundDemand),
        currentCrowdCarryover: round1(currentCrowdCarryover),
        externalForecastContribution: round1(externalForecastContribution),
        disruptionDemand: round1(disruptionDemand),
        recommendationDemand: round1(recommendationDemand),
      },
      provenance: {
        observationAvailable: true,
        usesCapacityProxy: true,
      },
    };
  }

  private crowdRiskForRatio(loadRatio: number): CrowdRisk {
    if (loadRatio >= this.config.thresholds.critical) return 'CRITICAL';
    if (loadRatio >= this.config.thresholds.high) return 'HIGH';
    if (loadRatio >= this.config.thresholds.moderate) return 'MODERATE';
    return 'LOW';
  }
}

function normalize(value: string): string {
  return value.trim().toUpperCase();
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
