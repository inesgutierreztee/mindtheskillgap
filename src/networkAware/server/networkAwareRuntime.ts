import { RouteOption } from '../../types';
import {
  adaptTransitCompanionRoute,
  TransitCompanionAdapterOptions,
} from '../adapters/transitCompanionAdapter';
import { NetworkAwareEngine } from '../NetworkAwareEngine';
import { NetworkState } from '../NetworkState';
import { RecommendationLedger } from '../RecommendationLedger';
import { EvaluationResult, ResourceObservation } from '../types';

export interface ShadowEvaluationInput {
  routes: RouteOption[];
  personalCostByRouteId: Record<string, number>;
  nowMs: number;
  incumbentRouteId?: string;
  observations?: ResourceObservation[];
  adapterOptions?: TransitCompanionAdapterOptions;
}

export interface NetworkAwareRuntime {
  ledger: RecommendationLedger;
  networkState: NetworkState;
  engine: NetworkAwareEngine<RouteOption>;
  evaluate(input: ShadowEvaluationInput): EvaluationResult<RouteOption>;
  issue(input: {
    journeyRequestId: string;
    route: RouteOption;
    issuedAtMs?: number;
    complianceProbability?: number;
    userCountRepresented?: number;
    adapterOptions?: TransitCompanionAdapterOptions;
  }): { recorded: boolean };
}

export function createNetworkAwareRuntime(): NetworkAwareRuntime {
  const ledger = new RecommendationLedger();
  const networkState = new NetworkState();
  const engine = new NetworkAwareEngine<RouteOption>({
    recommendationLedger: ledger,
    networkState,
  });

  return {
    ledger,
    networkState,
    engine,
    evaluate(input) {
      const snapshot = new NetworkState({ observations: input.observations || [] });
      engine.setNetworkState(snapshot);
      const routes = input.routes.map((route) =>
        adaptTransitCompanionRoute(route, {
          nowMs: input.nowMs,
          ...input.adapterOptions,
        })
      );
      return engine.evaluate(routes, {
        nowMs: input.nowMs,
        incumbentRouteId: input.incumbentRouteId,
        personalCost: (route) => input.personalCostByRouteId[route.id] ?? 1_000_000,
      });
    },
    issue(input) {
      return engine.issueRecommendation({
        journeyRequestId: input.journeyRequestId,
        route: adaptTransitCompanionRoute(input.route, input.adapterOptions),
        issuedAtMs: input.issuedAtMs,
        complianceProbability: input.complianceProbability,
        userCountRepresented: input.userCountRepresented,
      });
    },
  };
}

/**
 * Process-local prototype runtime. Its ledger resets when this server restarts.
 * A multi-instance deployment must replace it with shared persistence such as
 * Redis, Firestore, or a database before recommendations are issued at scale.
 */
export const networkAwareRuntime = createNetworkAwareRuntime();
