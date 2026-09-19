import { NetworkAwareEngine, EvaluateOptions } from './NetworkAwareEngine';
import { EvaluatedRoute, NetworkAwareRoute } from './types';

export interface DepartureCandidateSet<TPayload = unknown> {
  departureTimeMs: number;
  routes: NetworkAwareRoute<TPayload>[];
}

export interface EvaluatedDeparture<TPayload = unknown> {
  departureTimeMs: number;
  recommended: EvaluatedRoute<TPayload> | null;
}

/**
 * Evaluates caller-supplied route sets for multiple departure times through the
 * exact same engine. The host remains responsible for generating routes (e.g. OneMap).
 */
export function evaluateDepartureOptions<TPayload>(
  engine: NetworkAwareEngine<TPayload>,
  candidateSets: DepartureCandidateSet<TPayload>[],
  options: EvaluateOptions<TPayload>
): EvaluatedDeparture<TPayload>[] {
  return candidateSets.map((set) => {
    const result = engine.evaluate(set.routes, options);
    return {
      departureTimeMs: set.departureTimeMs,
      recommended: result.recommended,
    };
  });
}
