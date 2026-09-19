import { SINGAPORE_MRT_STATIONS } from '../data/mrtStationsData';
import { normalizeLineToCode } from './lineCodes';

export interface ResolvedCoords {
  lat: number;
  lng: number;
  name: string;
  code: string;
}

function normalize(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\bmrt\b/g, '')
    .replace(/\bstation\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Resolves free-text station input (e.g. "Kent Ridge MRT", "bugis") to
// coordinates by matching against the known MRT station list. Case-insensitive,
// tolerant of a trailing "MRT"/"Station" and partial name matches. Returns null
// when nothing matches closely enough to route from/to confidently.
export function resolveStationCoords(input: string): ResolvedCoords | null {
  const query = normalize(input);
  if (!query) return null;

  const toResult = (s: (typeof SINGAPORE_MRT_STATIONS)[number]): ResolvedCoords => ({
    lat: s.lat,
    lng: s.lng,
    name: s.name,
    code: s.code,
  });

  const exact = SINGAPORE_MRT_STATIONS.find((s) => s.name.toLowerCase() === query);
  if (exact) return toResult(exact);

  const startsWith = SINGAPORE_MRT_STATIONS.find((s) => s.name.toLowerCase().startsWith(query));
  if (startsWith) return toResult(startsWith);

  const contains = SINGAPORE_MRT_STATIONS.find((s) => s.name.toLowerCase().includes(query));
  if (contains) return toResult(contains);

  return null;
}

/**
 * Resolve an interchange platform using both its public name and the train
 * service/line. This deliberately returns null when the line is not one of the
 * supported heavy-rail lines: LRT coverage is incomplete and a guessed code is
 * worse than an UNKNOWN network resource.
 */
export function resolveStationByNameAndLine(
  input: string,
  lineOrService: string | undefined
): ResolvedCoords | null {
  const query = normalize(input);
  const lineCode = lineOrService ? normalizeLineToCode(lineOrService) : null;
  if (!query || !lineCode) return null;

  const candidates = SINGAPORE_MRT_STATIONS.filter(
    (station) => normalize(station.name) === query && station.line === lineCode
  );
  if (candidates.length !== 1) return null;
  const station = candidates[0];
  return {
    lat: station.lat,
    lng: station.lng,
    name: station.name,
    code: station.code,
  };
}

export interface StationSuggestion {
  name: string;
  lines: string[];
}

// Letter-by-letter suggestions for an autocomplete dropdown. Interchange
// stations appear multiple times in the source data (once per line), so
// results are de-duplicated by name with every serving line attached.
export function getStationSuggestions(input: string, limit = 6): StationSuggestion[] {
  const query = normalize(input);
  if (!query) return [];

  const byName = new Map<string, string[]>();
  for (const s of SINGAPORE_MRT_STATIONS) {
    if (!s.name.toLowerCase().includes(query)) continue;
    const lines = byName.get(s.name) || [];
    if (!lines.includes(s.line)) lines.push(s.line);
    byName.set(s.name, lines);
  }

  return Array.from(byName.entries())
    .map(([name, lines]) => ({ name, lines }))
    .sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(query) ? 0 : 1;
      const bStarts = b.name.toLowerCase().startsWith(query) ? 0 : 1;
      return aStarts - bStarts || a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}
