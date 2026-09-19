import { CrowdRisk, FairnessResult, RouteNetworkPrediction } from './types';

export interface FairnessConfig {
  /** Network-imposed minutes beyond the personal baseline with no penalty. */
  freeSacrificeMin: number;
  /** Largest detour still considered fair in normal conditions. */
  softLimitMin: number;
  /** Extra free margin when the personal baseline is disrupted or critically crowded. */
  severeFreeSacrificeMin: number;
  /** Largest detour considered fair even under severe conditions. */
  severeSoftLimitMin: number;
  /** Absolute guardrail: detours beyond this are always unfair. */
  absoluteMaxSacrificeMin: number;
  minorPenaltyPerMin: number;
  excessPenaltyPerMin: number;
  excessBasePenalty: number;
  absoluteExcessBasePenalty: number;
}

export const DEFAULT_FAIRNESS_CONFIG: FairnessConfig = {
  freeSacrificeMin: 5,
  softLimitMin: 10,
  severeFreeSacrificeMin: 10,
  severeSoftLimitMin: 20,
  absoluteMaxSacrificeMin: 25,
  minorPenaltyPerMin: 3,
  excessPenaltyPerMin: 12,
  excessBasePenalty: 15,
  absoluteExcessBasePenalty: 200,
};

export function evaluateFairness(
  sacrificeMinInput: number,
  personalBaselinePrediction: RouteNetworkPrediction,
  personalBaselineDisrupted = false,
  configOverrides: Partial<FairnessConfig> = {},
  absoluteSacrificeMinInput = sacrificeMinInput
): FairnessResult {
  const config = { ...DEFAULT_FAIRNESS_CONFIG, ...configOverrides };
  const sacrificeMin = Math.max(0, sacrificeMinInput);
  const absoluteSacrificeMin = Math.max(0, absoluteSacrificeMinInput);
  const severeBaseline =
    personalBaselineDisrupted ||
    crowdRank(personalBaselinePrediction.crowdRisk) >= crowdRank('CRITICAL');

  if (absoluteSacrificeMin > config.absoluteMaxSacrificeMin) {
    return {
      sacrificeMin,
      absoluteSacrificeMin,
      isFair: false,
      penalty: Math.round(
        config.absoluteExcessBasePenalty +
          (absoluteSacrificeMin - config.absoluteMaxSacrificeMin) *
            config.excessPenaltyPerMin
      ),
      explanation:
        'Travel-time sacrifice exceeds the absolute fairness guardrail, even under severe network conditions.',
    };
  }

  const freeLimit = severeBaseline
    ? config.severeFreeSacrificeMin
    : config.freeSacrificeMin;
  const softLimit = severeBaseline
    ? config.severeSoftLimitMin
    : config.softLimitMin;

  if (sacrificeMin <= freeLimit) {
    return {
      sacrificeMin,
      absoluteSacrificeMin,
      isFair: true,
      penalty: 0,
      explanation: severeBaseline
        ? 'The personal baseline is severely affected; this network-imposed sacrifice is within the emergency fairness margin.'
        : 'Travel-time sacrifice is within the free fairness margin.',
    };
  }

  if (sacrificeMin <= softLimit) {
    return {
      sacrificeMin,
      absoluteSacrificeMin,
      isFair: true,
      penalty: Math.round(
        (sacrificeMin - freeLimit) * config.minorPenaltyPerMin
      ),
      explanation: severeBaseline
        ? 'The personal baseline is severely affected; a limited sacrifice is allowed with a modest fairness penalty.'
        : 'Small travel-time sacrifice; a modest fairness penalty applies.',
    };
  }

  return {
    sacrificeMin,
    absoluteSacrificeMin,
    isFair: false,
    penalty: Math.round(
      config.excessBasePenalty +
        (sacrificeMin - softLimit) * config.excessPenaltyPerMin
    ),
    explanation: severeBaseline
      ? 'Travel-time sacrifice exceeds the severe-condition fairness limit.'
      : 'Travel-time sacrifice exceeds the normal fairness limit.',
  };
}

export function crowdRank(level: CrowdRisk): number {
  switch (level) {
    case 'CRITICAL':
      return 4;
    case 'HIGH':
      return 3;
    case 'MODERATE':
      return 2;
    case 'LOW':
      return 1;
    default:
      return 0;
  }
}
