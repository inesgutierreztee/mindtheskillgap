import { RouteOption } from '../types';

export interface ResolvedPlace {
  name: string;
  lat: number;
  lng: number;
  kind: 'station' | 'bus_stop' | 'place';
  detail?: string;
}

export async function searchPlaces(query: string): Promise<ResolvedPlace[]> {
  if (!query.trim()) return [];
  try {
    const response = await fetch(`/api/location-search?q=${encodeURIComponent(query)}`);
    if (response.ok) {
      const data = await response.json();
      return Array.isArray(data.results) ? data.results : [];
    }
  } catch (error) {
    console.warn('searchPlaces error', error);
  }
  return [];
}

export async function resolvePlace(query: string): Promise<ResolvedPlace | null> {
  const results = await searchPlaces(query);
  if (results.length === 0) return null;
  const normalized = query.trim().toLowerCase().replace(/\b(mrt|station)\b/g, '').trim();
  return (
    results.find((place) => place.name.toLowerCase().replace(/\b(mrt|station)\b/g, '').trim() === normalized) ??
    results[0]
  );
}

export interface RoutePlanResult {
  source: 'onemap_live' | 'unavailable' | 'error';
  reason?: string;
  departureOffsetMin?: number;
  itineraries: RouteOption[];
}

export async function fetchLiveRoutePlan(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  departureOffsetMin = 0,
  routeMode: 'transit' | 'cycle' | 'walk' = 'transit'
): Promise<RoutePlanResult> {
  try {
    const params = new URLSearchParams({
      originLat: String(origin.lat),
      originLng: String(origin.lng),
      destLat: String(destination.lat),
      destLng: String(destination.lng),
      departureOffsetMin: String(departureOffsetMin),
      routeMode,
    });
    const res = await fetch(`/api/route-plan?${params.toString()}`);
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    console.warn('fetchLiveRoutePlan error', e);
  }
  return { source: 'unavailable', reason: 'request_failed', departureOffsetMin, itineraries: [] };
}

export async function fetchLiveMultimodalPlan(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  departureOffsetMin = 0,
  bikeAtStation: 'park' | 'foldable' = 'park'
): Promise<RoutePlanResult> {
  try {
    const params = new URLSearchParams({
      originLat: String(origin.lat),
      originLng: String(origin.lng),
      destLat: String(destination.lat),
      destLng: String(destination.lng),
      departureOffsetMin: String(departureOffsetMin),
      bikeAtStation,
    });
    const res = await fetch(`/api/multimodal-route-plan?${params.toString()}`);
    if (res.ok) return await res.json();
  } catch (e) {
    console.warn('fetchLiveMultimodalPlan error', e);
  }
  return { source: 'unavailable', reason: 'request_failed', departureOffsetMin, itineraries: [] };
}
