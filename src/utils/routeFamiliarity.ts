import { RouteOption } from '../types';
import { lineLabel } from './journeyMath';

const STORAGE_KEY = 'sg_transit_familiar_route_history';

type FamiliarRouteHistory = Record<string, number>;

// A route's travel modes and line/service sequence is a durable signature even
// when a live provider gives that same trip a different itinerary ID tomorrow.
export const routeFamiliarityKey = (route: RouteOption): string =>
  route.steps
    .filter((step) => step.type === 'bus' || step.type === 'train' || step.type === 'cycle')
    .map((step) => `${step.type}:${step.type === 'train' ? lineLabel(step.lineOrService) : step.lineOrService || step.type}`)
    .join('|');

export const familiarRouteHistory = (): FamiliarRouteHistory => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as FamiliarRouteHistory;
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch {
    return {};
  }
};

export const recordFamiliarRoute = (route: RouteOption): FamiliarRouteHistory => {
  const history = familiarRouteHistory();
  const key = routeFamiliarityKey(route);
  if (!key) return history;
  const updated = { ...history, [key]: (history[key] || 0) + 1 };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // A private browser session can still use the route for this journey.
  }
  return updated;
};
