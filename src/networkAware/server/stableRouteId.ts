import { createHash } from 'node:crypto';

export interface StableRouteLegSignature {
  mode?: string;
  lineOrService?: string;
  fromId?: string;
  toId?: string;
}

export interface StableRouteIdInput {
  routeMode: string;
  startId: string;
  endId: string;
  legs: StableRouteLegSignature[];
}

function normalise(value: string | undefined): string {
  return String(value || 'unknown').trim().toUpperCase().replace(/\s+/g, '_');
}

/** Stable across repeated mappings of the same logical OneMap itinerary. */
export function createStableRouteId(input: StableRouteIdInput): string {
  const signature = [
    normalise(input.routeMode),
    normalise(input.startId),
    normalise(input.endId),
    ...input.legs.map((leg) =>
      [leg.mode, leg.lineOrService, leg.fromId, leg.toId].map(normalise).join(':')
    ),
  ].join('|');
  const digest = createHash('sha256').update(signature).digest('hex').slice(0, 16);
  return `onemap-${normalise(input.routeMode).toLowerCase()}-${digest}`;
}

export function coordinateLocationId(lat: number, lng: number): string {
  return `${lat.toFixed(6)},${lng.toFixed(6)}`;
}
