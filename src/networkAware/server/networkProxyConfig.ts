import { CrowdRisk } from '../types';

/**
 * Normalised prototype scale. These are not passenger counts or official LTA
 * station capacities; keep assumptions centralised for later calibration.
 */
export const NETWORK_PROXY_CAPACITY_15_MIN = 100;

export const NETWORK_PROXY_BACKGROUND_DEMAND_15_MIN: Record<CrowdRisk, number> = {
  UNKNOWN: 0,
  LOW: 20,
  MODERATE: 45,
  HIGH: 65,
  CRITICAL: 85,
};

/** LTA PCD uses l/m/h. HIGH remains HIGH, never CRITICAL. */
export function mapPcdCode(code: unknown): CrowdRisk {
  switch (String(code || '').trim().toLowerCase()) {
    case 'l':
      return 'LOW';
    case 'm':
      return 'MODERATE';
    case 'h':
      return 'HIGH';
    default:
      return 'UNKNOWN';
  }
}

export function proxyDemandForCrowd(crowd: CrowdRisk): number {
  return NETWORK_PROXY_BACKGROUND_DEMAND_15_MIN[crowd];
}
