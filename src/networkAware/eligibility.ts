import { RouteOption, UserPreferences } from '../types';

export function isNetworkAwareEligible(
  route: RouteOption,
  preferences: UserPreferences
): boolean {
  const hasCycling = route.steps.some((step) => step.type === 'cycle');
  if (
    hasCycling &&
    (!preferences.transportModes.cycling || !preferences.cyclingPreferences.enabled)
  ) {
    return false;
  }
  if (preferences.stepFreeAccess && route.stepFreeAccessible === false) return false;
  return true;
}

export function filterNetworkAwareEligibleRoutes(
  routes: RouteOption[],
  preferences: UserPreferences
): RouteOption[] {
  return routes.filter((route) => isNetworkAwareEligible(route, preferences));
}
