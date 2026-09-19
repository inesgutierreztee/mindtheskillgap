import {
  NetworkAwareRoute,
  RecommendationEntry,
  RecommendationResourceDemand,
} from './types';
import { bucketEndMs, bucketStartMs } from './time';

export interface RecommendationLedgerOptions {
  bucketSizeMin?: number;
  defaultComplianceProbability?: number;
  maxEntries?: number;
}

export interface IssueRecommendationInput<TPayload = unknown> {
  journeyRequestId: string;
  route: NetworkAwareRoute<TPayload>;
  issuedAtMs?: number;
  userCountRepresented?: number;
  complianceProbability?: number;
}

/**
 * Records issued recommendations only. Evaluation never writes to this class.
 * Entries are idempotent by journeyRequestId.
 */
export class RecommendationLedger {
  private entries: RecommendationEntry[] = [];
  private issuedJourneyIds = new Set<string>();
  private readonly bucketSizeMin: number;
  private defaultComplianceProbability: number;
  private readonly maxEntries: number;

  constructor(options: RecommendationLedgerOptions = {}) {
    this.bucketSizeMin = Math.max(1, options.bucketSizeMin ?? 5);
    this.defaultComplianceProbability = clamp01(
      options.defaultComplianceProbability ?? 0.7
    );
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries ?? 10_000));
  }

  public setDefaultComplianceProbability(probability: number): void {
    this.defaultComplianceProbability = clamp01(probability);
  }

  public getDefaultComplianceProbability(): number {
    return this.defaultComplianceProbability;
  }

  public issueRecommendation<TPayload = unknown>(
    input: IssueRecommendationInput<TPayload>
  ): { recorded: boolean; entry: RecommendationEntry | null } {
    const requestId = input.journeyRequestId.trim();
    if (!requestId) throw new Error('journeyRequestId is required');

    if (this.issuedJourneyIds.has(requestId)) {
      return { recorded: false, entry: null };
    }

    const userCount = finiteNonNegative(input.userCountRepresented ?? 1);
    const compliance = clamp01(
      input.complianceProbability ?? this.defaultComplianceProbability
    );
    const expectedPassengers = round1(userCount * compliance);
    const issuedAtMs = Number.isFinite(input.issuedAtMs)
      ? (input.issuedAtMs as number)
      : Date.now();

    // A route adapter may represent the same interchange both as the end of one
    // leg and the start of another. One passenger must only count once on the
    // same resource in the same time bucket.
    const byResourceBucket = new Map<string, RecommendationResourceDemand>();

    for (const resource of input.route.resources) {
      const resourceId = normalizeResourceId(resource.resourceId);
      if (!resourceId || !Number.isFinite(resource.arrivalOffsetMinutes)) continue;

      const expectedArrivalMs =
        input.route.departureTimeMs + resource.arrivalOffsetMinutes * 60_000;
      if (!Number.isFinite(expectedArrivalMs)) continue;

      const start = bucketStartMs(expectedArrivalMs, this.bucketSizeMin);
      const end = bucketEndMs(expectedArrivalMs, this.bucketSizeMin);
      const key = `${resourceId}::${start}`;
      const existing = byResourceBucket.get(key);

      if (!existing) {
        byResourceBucket.set(key, {
          resourceId,
          resourceType: resource.type,
          resourceName: resource.name,
          expectedArrivalMs,
          bucketStartMs: start,
          bucketEndMs: end,
          expectedPassengers,
        });
      } else if (expectedArrivalMs < existing.expectedArrivalMs) {
        // Keep the earliest use time inside the bucket for deterministic output.
        existing.expectedArrivalMs = expectedArrivalMs;
      }
    }

    const resourceDemands = Array.from(byResourceBucket.values()).sort(
      (a, b) =>
        a.bucketStartMs - b.bucketStartMs ||
        a.resourceId.localeCompare(b.resourceId)
    );

    const entry: RecommendationEntry = {
      journeyRequestId: requestId,
      routeId: input.route.id,
      issuedAtMs,
      departureTimeMs: input.route.departureTimeMs,
      userCountRepresented: userCount,
      complianceProbability: compliance,
      expectedPassengerContribution: expectedPassengers,
      resourceDemands,
    };

    this.entries.push(entry);
    this.issuedJourneyIds.add(requestId);

    while (this.entries.length > this.maxEntries) {
      const removed = this.entries.shift();
      if (removed) this.issuedJourneyIds.delete(removed.journeyRequestId);
    }

    return { recorded: true, entry: cloneEntry(entry) };
  }

  /** Demand expected on a resource in the time bucket containing targetTimeMs. */
  public getDemand(resourceId: string, targetTimeMs: number): number {
    const normalizedId = normalizeResourceId(resourceId);
    if (!normalizedId || !Number.isFinite(targetTimeMs)) return 0;
    const targetBucket = bucketStartMs(targetTimeMs, this.bucketSizeMin);
    let total = 0;

    for (const entry of this.entries) {
      for (const demand of entry.resourceDemands) {
        if (
          demand.resourceId === normalizedId &&
          demand.bucketStartMs === targetBucket
        ) {
          total += demand.expectedPassengers;
        }
      }
    }

    return round1(total);
  }

  /**
   * Same as getDemand, but past time buckets no longer count as active future demand.
   */
  public getActiveDemand(
    resourceId: string,
    targetTimeMs: number,
    nowMs: number
  ): number {
    if (!Number.isFinite(targetTimeMs) || !Number.isFinite(nowMs)) return 0;
    if (bucketEndMs(targetTimeMs, this.bucketSizeMin) <= nowMs) return 0;
    return this.getDemand(resourceId, targetTimeMs);
  }

  /** Removes entries whose final resource-use bucket ended before beforeMs. */
  public pruneExpired(beforeMs: number): number {
    if (!Number.isFinite(beforeMs)) return 0;
    const beforeCount = this.entries.length;
    this.entries = this.entries.filter((entry) => {
      if (entry.resourceDemands.length === 0) return entry.issuedAtMs >= beforeMs;
      const lastEnd = Math.max(...entry.resourceDemands.map((d) => d.bucketEndMs));
      return lastEnd >= beforeMs;
    });
    this.issuedJourneyIds = new Set(this.entries.map((e) => e.journeyRequestId));
    return beforeCount - this.entries.length;
  }

  public clear(): void {
    this.entries = [];
    this.issuedJourneyIds.clear();
  }

  public size(): number {
    return this.entries.length;
  }

  public hasJourneyRequest(journeyRequestId: string): boolean {
    return this.issuedJourneyIds.has(journeyRequestId.trim());
  }

  public getEntries(): RecommendationEntry[] {
    return this.entries.map(cloneEntry);
  }

  public clone(): RecommendationLedger {
    const copy = new RecommendationLedger({
      bucketSizeMin: this.bucketSizeMin,
      defaultComplianceProbability: this.defaultComplianceProbability,
      maxEntries: this.maxEntries,
    });
    for (const entry of this.entries) {
      copy.entries.push(cloneEntry(entry));
      copy.issuedJourneyIds.add(entry.journeyRequestId);
    }
    return copy;
  }
}

export function normalizeResourceId(resourceId: string): string {
  return resourceId.trim().toUpperCase();
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function finiteNonNegative(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function cloneEntry(entry: RecommendationEntry): RecommendationEntry {
  return {
    ...entry,
    resourceDemands: entry.resourceDemands.map((d) => ({ ...d })),
  };
}
