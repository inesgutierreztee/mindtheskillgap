import { RouteOption, RouteStep } from '../../types';
import { normalizeLineToCode } from '../../utils/lineCodes';
import { NetworkAwareRoute, NetworkResourceUse } from '../types';

export interface TransitCompanionAdapterOptions {
  nowMs?: number;
  disruptedLineCodes?: string[];
}

function token(value: string | undefined, fallback = 'UNKNOWN'): string {
  const normalised = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalised || fallback;
}

function stationResource(
  code: string | undefined,
  name: string | undefined,
  lineCode: string | null,
  offset: number
): NetworkResourceUse {
  const id = code
    ? `STATION_${token(code)}`
    : `STATION_UNKNOWN_${token(lineCode || undefined)}_${token(name)}`;
  return { resourceId: id, type: 'STATION', arrivalOffsetMinutes: offset, name };
}

function trainResources(step: RouteStep, offset: number): NetworkResourceUse[] {
  const lineCode = step.lineOrService ? normalizeLineToCode(step.lineOrService) : null;
  const startName = step.startPoint?.name;
  const endName = step.targetPoint?.name || step.alightStationOrStop;
  const endOffset = offset + step.durationMin;
  const from = token(step.boardingStationCode, `UNKNOWN_${token(startName)}`);
  const to = token(step.alightingStationCode, `UNKNOWN_${token(endName)}`);
  const corridorId = lineCode
    ? `RAIL_${lineCode}_${from}_${to}`
    : `RAIL_UNKNOWN_${token(step.lineOrService)}_${token(startName)}_${token(endName)}`;

  return [
    stationResource(step.boardingStationCode, startName, lineCode, offset),
    {
      resourceId: corridorId,
      type: 'RAIL_SEGMENT',
      arrivalOffsetMinutes: offset + step.durationMin / 2,
      name: lineCode ? `${lineCode} ${startName || 'unknown'} to ${endName || 'unknown'}` : step.lineOrService,
    },
    stationResource(step.alightingStationCode, endName, lineCode, endOffset),
  ];
}

function busResources(step: RouteStep, offset: number): NetworkResourceUse[] {
  const service = token(step.lineOrService);
  const startName = step.startPoint?.name;
  const endName = step.targetPoint?.name || step.alightStationOrStop;
  const serviceId = step.lineOrService
    ? `BUS_SERVICE_${service}`
    : `BUS_SERVICE_UNKNOWN_${token(startName)}_${token(endName)}`;
  const resources: NetworkResourceUse[] = [
    {
      resourceId: serviceId,
      type: 'BUS_SERVICE',
      arrivalOffsetMinutes: offset,
      name: step.lineOrService ? `Bus ${step.lineOrService}` : 'Unknown bus service',
    },
  ];

  resources.push({
    resourceId: step.boardingStopCode
      ? `BUS_STOP_${token(step.boardingStopCode)}`
      : `BUS_STOP_UNKNOWN_${token(startName)}`,
    type: 'BUS_STOP',
    arrivalOffsetMinutes: offset,
    name: startName,
  });
  resources.push({
    resourceId: step.alightingStopCode
      ? `BUS_STOP_${token(step.alightingStopCode)}`
      : `BUS_STOP_UNKNOWN_${token(endName)}`,
    type: 'BUS_STOP',
    arrivalOffsetMinutes: offset + step.durationMin,
    name: endName,
  });
  return resources;
}

/**
 * Converts GYG routes without leaking host-specific types into the portable
 * engine. Cycling and ordinary walking consume no public-transport resource;
 * bike-and-ride starts contributing resources at its later bus/train legs.
 */
export function adaptTransitCompanionRoute(
  route: RouteOption,
  options: TransitCompanionAdapterOptions = {}
): NetworkAwareRoute<RouteOption> {
  const resources: NetworkResourceUse[] = [];
  let cumulativeMinutes = 0;

  for (const step of route.steps) {
    if (step.type === 'train') resources.push(...trainResources(step, cumulativeMinutes));
    if (step.type === 'bus') resources.push(...busResources(step, cumulativeMinutes));
    cumulativeMinutes += Math.max(0, step.durationMin);
  }

  // Avoid evaluating an identical resource twice in the same five-minute
  // window (common at interchanges), while retaining later uses of it.
  const unique = new Map<string, NetworkResourceUse>();
  for (const resource of resources) {
    const bucket = Math.floor(resource.arrivalOffsetMinutes / 5);
    const key = `${resource.resourceId.toUpperCase()}::${bucket}`;
    if (!unique.has(key)) unique.set(key, resource);
  }

  const disruptedLines = new Set(
    (options.disruptedLineCodes || []).map((line) => line.trim().toUpperCase())
  );
  const disrupted = route.steps.some((step) => {
    if (step.type !== 'train' || !step.lineOrService) return false;
    const line = normalizeLineToCode(step.lineOrService);
    return Boolean(line && disruptedLines.has(line));
  });

  const departureTimeMs = route.departureTimeMs ?? options.nowMs ?? Date.now();
  const tripDurationMin = Math.max(0, route.totalDurationMin);
  return {
    id: route.id,
    durationMin: route.totalDurationMin,
    departureTimeMs,
    arrivalTimeMs: departureTimeMs + tripDurationMin * 60_000,
    resources: Array.from(unique.values()),
    disrupted,
    payload: route,
  };
}

export function adaptTransitCompanionRoutes(
  routes: RouteOption[],
  options: TransitCompanionAdapterOptions = {}
): NetworkAwareRoute<RouteOption>[] {
  return routes.map((route) => adaptTransitCompanionRoute(route, options));
}
