export const MINUTE_MS = 60_000;

export function bucketStartMs(timestampMs: number, bucketSizeMin = 5): number {
  const sizeMs = bucketSizeMin * MINUTE_MS;
  return Math.floor(timestampMs / sizeMs) * sizeMs;
}

export function bucketEndMs(timestampMs: number, bucketSizeMin = 5): number {
  return bucketStartMs(timestampMs, bucketSizeMin) + bucketSizeMin * MINUTE_MS;
}

export function minutesBetween(fromMs: number, toMs: number): number {
  return (toMs - fromMs) / MINUTE_MS;
}

export function exponentialDecay(horizonMin: number, halfLifeMin: number): number {
  if (halfLifeMin <= 0) return horizonMin <= 0 ? 1 : 0;
  if (horizonMin <= 0) return 1;
  return Math.pow(0.5, horizonMin / halfLifeMin);
}

/**
 * Resolves an HH:MM clock time onto the UTC date containing referenceMs.
 * This is an adapter helper only; production hosts should normally pass epoch times directly.
 */
export function clockTimeToReferenceDayMs(clockTime: string, referenceMs: number): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clockTime.trim());
  if (!match) throw new Error(`Invalid clock time: ${clockTime}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid clock time: ${clockTime}`);
  }

  const ref = new Date(referenceMs);
  return Date.UTC(
    ref.getUTCFullYear(),
    ref.getUTCMonth(),
    ref.getUTCDate(),
    hour,
    minute,
    0,
    0
  );
}
