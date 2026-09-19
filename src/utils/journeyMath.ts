import { RouteOption } from '../types';
import { resolveStationCoords } from './stationLookup';
import { LINE_META } from './lineCodes';

// Clock times on the persona home screens are minutes past midnight, SGT.
export function sgtMinutesNow(): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Singapore',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

export function formatClock(totalMin: number): string {
  const m = ((Math.round(totalMin) % 1440) + 1440) % 1440;
  const hour24 = Math.floor(m / 60);
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(m % 60).padStart(2, '0')}`;
}

// OneMap route codes ("EW", "NE", "PW"...) to the app's line codes.
export function lineLabel(service?: string): string {
  if (!service) return 'Train';
  const namedLines: [RegExp, string][] = [
    [/east[\s-]*west/i, 'EWL'],
    [/north[\s-]*south/i, 'NSL'],
    [/circle/i, 'CCL'],
    [/downtown/i, 'DTL'],
    [/north[\s-]*east/i, 'NEL'],
    [/thomson[\s-]*east[\s-]*coast/i, 'TEL'],
    [/\blrt\b/i, 'LRT'],
  ];
  const namedMatch = namedLines.find(([pattern]) => pattern.test(service));
  if (namedMatch) return namedMatch[1];
  const prefixes: [RegExp, string][] = [
    [/^(PE|PW|SE|SW|BP)/i, 'LRT'],
    [/^EW/i, 'EWL'],
    [/^NS/i, 'NSL'],
    [/^(CC|CE)/i, 'CCL'],
    [/^DT/i, 'DTL'],
    [/^NE/i, 'NEL'],
    [/^TE/i, 'TEL'],
  ];
  const match = prefixes.find(([pattern]) => pattern.test(service));
  return match ? match[1] : service;
}

export const lineName = (service?: string) =>
  LINE_META[lineLabel(service)]?.name.replace('-', '–') ?? lineLabel(service);

export const LRT_COLOR = '#748477';
export const lineColor = (service?: string): string | undefined => {
  const code = lineLabel(service);
  return code === 'LRT' ? LRT_COLOR : LINE_META[code]?.color;
};

// "SENGKANG MRT A1" -> "Sengkang", "HARBOURFRONT MRT STATION" -> "HarbourFront".
export function prettifyStop(name?: string): string {
  if (!name) return '';
  const cleaned = name
    .replace(/\s+(mrt|lrt)\b.*$/i, '')
    .replace(/\s+station\b.*$/i, '')
    .trim();
  const known = resolveStationCoords(cleaned);
  if (known && known.name.toLowerCase() === cleaned.toLowerCase()) return known.name;
  return cleaned.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export const isTransitStep = (type: string) => type === 'train' || type === 'bus';

export const stepsTotal = (route: RouteOption) =>
  route.steps.reduce((total, s) => total + (s.durationMin || 0), 0);

// OneMap rounds each leg up to a whole minute, so the legs can sum past its
// own total; use the larger so timelines and arrival times always agree.
export const routeMinutes = (route: RouteOption) => Math.max(route.totalDurationMin, stepsTotal(route));

// Start time of every step. Platform waiting (OneMap's total minus the leg
// times) is placed before the first boarding, so each step flows into the next.
export function stepStartTimes(route: RouteOption, leaveMin: number): number[] {
  const firstTransit = route.steps.findIndex((s) => isTransitStep(s.type));
  const wait = Math.max(0, route.totalDurationMin - stepsTotal(route));
  let t = leaveMin;
  return route.steps.map((s, i) => {
    if (i === firstTransit) t += wait;
    const start = t;
    t += s.durationMin || 0;
    return start;
  });
}

// Straight-line distance in metres between two coordinates (haversine).
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
