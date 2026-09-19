import React, { useState } from 'react';
import { ArrowRight, Footprints, Shuffle, Users, Check, DollarSign, ShieldAlert, Map, ChevronUp, Bike, BusFront, TrainFront, Clock } from 'lucide-react';
import { RouteOption, UserPreferences, TravelNeeds, DisruptionAlert } from '../types';
import { StatusChip } from './StatusChip';
import {
  getRoutePersonalisedHighlights,
  hasAccessibilityNeedsSelected,
} from '../utils/personalisation';
import { getEtaFromNow } from '../services/ltaService';
import { RouteOverviewMap } from './RouteOverviewMap';
import { departureLabel } from '../networkAware/presentation';
import { lineColor, lineLabel, prettifyStop } from '../utils/journeyMath';

interface RouteCardProps {
  route: RouteOption;
  isSelected?: boolean;
  userPreferences?: UserPreferences;
  travelNeeds?: TravelNeeds;
  disruption?: DisruptionAlert | null;
  // The recommended "original" route to show as a faint reference path when
  // previewing an alternative, so the two can be compared on one map.
  compareRoute?: RouteOption | null;
  // Minutes from now this route is being planned to depart (flexible departure
  // window) - the ETA shown must account for this, not just the ride duration.
  departureOffsetMin?: number;
  onSelect: (route: RouteOption) => void;
}

export const RouteCard: React.FC<RouteCardProps> = ({
  route,
  isSelected,
  userPreferences,
  travelNeeds,
  disruption,
  compareRoute,
  departureOffsetMin = 0,
  onSelect,
}) => {
  const isBestMatch = route.badge === 'BEST MATCH' || route.badge === 'RECOMMENDED FOR YOU';
  const hasAccessNeeds = hasAccessibilityNeedsSelected(travelNeeds, userPreferences);
  const highlights = getRoutePersonalisedHighlights(route, userPreferences, travelNeeds);
  const [showPreview, setShowPreview] = useState(false);
  const isCyclingOnly = route.routeMode === 'cycle';
  const hasCyclingLeg = route.steps.some((step) => step.type === 'cycle');
  const isBikeAndRide = route.routeMode === 'multimodal';
  const cyclingDistanceKm = ((route.cyclingDistanceMeters || 0) / 1000).toFixed(1);
  // Every route suggested by the planner is presented as a glanceable,
  // personalised recommendation. The badge distinguishes the top pick from
  // the other viable choices without reverting those choices to dense cards.
  const useShowcaseLayout = Boolean(route);

  // A recommendation is a decision, not a dense technical route card. Its
  // headline and two supporting tiles change with the traveller's real
  // priority, while the same live route data remains available below.
  if (useShowcaseLayout) {
    const comfortFirst = userPreferences?.priority === 'comfort' || userPreferences?.lessCrowded || travelNeeds?.avoidCrowdedServices;
    const walkingFirst = userPreferences?.lessWalking || travelNeeds?.shortWalkingDistances;
    const transferFirst = userPreferences?.fewerTransfers || userPreferences?.priorities?.includes('transfer');
    const timeFirst = userPreferences?.fastestJourney || userPreferences?.priorities?.includes('time');
    const bestTitle = hasAccessNeeds
      ? 'Step-free trip'
      : comfortFirst
      ? 'Quietest trip'
      : walkingFirst
      ? 'Easiest walk'
      : transferFirst
      ? 'Simplest trip'
      : timeFirst
      ? 'Fastest trip'
      : 'Best trip for you';
    const recommendationTitle = isBestMatch
      ? bestTitle
      : hasAccessNeeds
      ? 'Access-aware option'
      : comfortFirst
      ? 'Comfort-focused option'
      : walkingFirst
      ? 'Lower-walking option'
      : transferFirst
      ? 'Simpler alternative'
      : timeFirst
      ? 'Time-saving option'
      : 'Recommended option';
    const bestSubtitle = hasAccessNeeds
      ? route.stepFreeAccessible === true
        ? 'Step-free access confirmed'
        : 'Check step-free access before leaving'
      : comfortFirst
      ? route.crowdRating === 'Low'
        ? 'Crowds are low right now'
        : `${route.crowdRating} crowding on this route`
      : walkingFirst
      ? `${route.walkingMinutes} min walking`
      : transferFirst
      ? route.transfers === 0
        ? 'No changes needed'
        : `${route.transfers} change${route.transfers > 1 ? 's' : ''} only`
      : `${route.totalDurationMin} min journey`;
    const priorityTile = hasAccessNeeds
      ? { label: 'Access', value: route.stepFreeAccessible === true ? 'Step-free' : 'Check access', Icon: ShieldAlert }
      : comfortFirst
      ? { label: 'Crowding', value: `${route.crowdRating} crowding`, Icon: Users }
      : walkingFirst
      ? { label: 'Walking', value: `${route.walkingMinutes} min`, Icon: Footprints }
      : transferFirst
      ? { label: 'Changes', value: route.transfers === 0 ? 'Direct ride' : `${route.transfers} transfer${route.transfers > 1 ? 's' : ''}`, Icon: Shuffle }
      : { label: 'Fastest', value: `${route.totalDurationMin} min`, Icon: Clock };
    const journeySteps = route.steps.filter((step) => step.type === 'bus' || step.type === 'train' || step.type === 'cycle').slice(0, 3);

    return (
      <section
        id={`route-card-${route.id}`}
        className={`rounded-[28px] bg-[#e1f2ee] p-4 border border-primary-container/20 transition-all ${isSelected ? 'ring-2 ring-primary-container' : ''}`}
        aria-label={isBestMatch ? 'Best match' : 'Recommended route'}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-primary">{isBestMatch ? 'Best match' : 'Recommended route'}</p>
            <h3 className="mt-1 text-[23px] leading-tight font-bold tracking-[-0.025em] text-on-surface">{recommendationTitle}</h3>
            <p className="text-[13px] mt-1 leading-snug text-on-surface-variant">{bestSubtitle}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[28px] leading-none font-bold tracking-[-0.04em] text-on-surface">{departureOffsetMin > 0 ? departureLabel(departureOffsetMin).replace('Leave in ', '+') : 'Now'}</p>
            <p className="text-[12px] mt-1 text-on-surface-variant">{departureOffsetMin > 0 ? 'leave' : 'leave home'}</p>
          </div>
        </div>

        <div className="mt-3 flex items-start justify-between gap-1" aria-label="Journey route">
          {journeySteps.length > 0 ? journeySteps.map((step, index) => {
            const isBus = step.type === 'bus';
            const isCycle = step.type === 'cycle';
            const Icon = isCycle ? Bike : isBus ? BusFront : TrainFront;
            const label = isCycle ? 'Cycle' : isBus ? `Bus ${step.lineOrService || ''}`.trim() : lineLabel(step.lineOrService);
            const railColor = step.type === 'train' ? lineColor(step.lineOrService) : undefined;
            const iconClass = isBus || isCycle
              ? 'bg-surface-container-lowest text-primary'
              : railColor
                ? 'text-white'
                : 'bg-secondary text-white';
            const detail = isBus
              ? prettifyStop(step.startPoint?.name) || 'Board nearby'
              : step.type === 'train'
              ? `to ${prettifyStop(step.targetPoint?.name) || 'next stop'}`
              : `to ${prettifyStop(step.targetPoint?.name) || 'transit'}`;
            return (
              <React.Fragment key={`${label}-${index}`}>
                {index > 0 && <ArrowRight aria-hidden="true" className="w-5 h-5 mt-4 shrink-0 text-on-surface-variant" />}
                <div className="min-w-0 flex-1 text-center">
                  <span
                    className={`mx-auto w-11 h-11 rounded-full flex items-center justify-center ${iconClass}`}
                    style={railColor ? { backgroundColor: railColor } : undefined}
                  >
                    <Icon className="w-5 h-5" />
                  </span>
                  <span className="mt-1 text-[14px] block leading-tight font-bold text-on-surface truncate">{label}</span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-on-surface-variant truncate">{detail}</span>
                </div>
              </React.Fragment>
            );
          }) : (
            <p className="text-sm text-on-surface-variant">{route.summary}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 mt-3">
          <div className="bg-surface-container-lowest rounded-[20px] px-3 py-2.5">
            <priorityTile.Icon className="w-5 h-5 text-on-surface" />
            <p className="mt-1 text-[11px] text-on-surface-variant">{priorityTile.label}</p>
            <p className="text-[15px] font-bold leading-tight text-on-surface">{priorityTile.value}</p>
          </div>
          <div className="bg-surface-container-lowest rounded-[20px] px-3 py-2.5">
            <Clock className="w-5 h-5 text-on-surface" />
            <p className="mt-1 text-[11px] text-on-surface-variant">Expected arrival</p>
            <p className="text-[15px] font-bold leading-tight text-on-surface">{getEtaFromNow(departureOffsetMin + route.totalDurationMin)}</p>
          </div>
        </div>

        <p className="mt-3 text-[13px] leading-relaxed text-on-surface-variant line-clamp-2">{route.whyRecommended}</p>

        <button
          type="button"
          onClick={() => onSelect(route)}
          className="w-full min-h-12 mt-3 rounded-[18px] text-[16px] bg-primary-container hover:bg-primary text-on-primary font-bold transition-colors cursor-pointer"
        >
          {isBestMatch ? 'Start this journey' : 'Choose this route'}
        </button>

        <div onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            onClick={() => setShowPreview((value) => !value)}
            className="w-full mt-1.5 text-[12px] font-semibold text-primary hover:underline cursor-pointer"
          >
            {showPreview ? 'Hide map preview' : 'Preview full route'}
          </button>
          {showPreview && <RouteOverviewMap route={route} disruption={disruption} heightClass="h-48 mt-3" />}
        </div>
      </section>
    );
  }

  return (
    <div
      id={`route-card-${route.id}`}
      className={`rounded-2xl p-4 transition-all border card-shadow ${
        isSelected
          ? 'ring-2 ring-primary-container border-primary-container bg-primary-container/[0.04]'
          : isBestMatch
          ? 'bg-surface-container-lowest border-primary-container/40'
          : 'bg-surface-container-lowest border-outline-variant/30 hover:border-outline-variant'
      }`}
    >
      {/* Header row with badges & duration */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {route.badge && <StatusChip type="badge" value={route.badge} />}
          {route.dataSource === 'mock' && (
            <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wide bg-amber-50 text-amber-800 border border-amber-300 border-dashed px-2 py-0.5 rounded-full">
              Prototype data
            </span>
          )}
          <span className="text-xs font-semibold text-on-surface tracking-wide">
            {route.summary}
          </span>
          {/* Accessibility badge ONLY shown when user selected accessibility needs */}
          {hasAccessNeeds && (
            route.stepFreeAccessible === true ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                <Check className="w-3 h-3" />
                Step-free
              </span>
            ) : route.stepFreeAccessible === false ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                <ShieldAlert className="w-3 h-3" />
                Stairs required
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">
                <ShieldAlert className="w-3 h-3" />
                Access unverified
              </span>
            )
          )}
          {isBikeAndRide && (
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
              route.bicycleParkingAvailable === true
                ? 'bg-blue-100 text-blue-800'
                : 'bg-slate-100 text-slate-700'
            }`}>
              <Bike className="w-3 h-3" />
              {route.bicycleParkingAvailable === true
                ? 'Bike parking available'
                : route.bicycleParkingVerified
                ? 'LTA bicycle parking'
                : 'Parking unverified'}
            </span>
          )}
        </div>

        <div className="flex flex-col items-end shrink-0">
          {departureOffsetMin > 0 && (
            <span className="text-xs font-bold text-primary mb-0.5">{departureLabel(departureOffsetMin)}</span>
          )}
          <div className="flex items-baseline gap-1 text-on-surface">
            <span className="text-2xl font-bold tracking-tight">{route.totalDurationMin}</span>
            <span className="text-xs font-semibold text-on-surface-variant">min</span>
          </div>
          <span className="text-[11px] text-on-surface-variant">
            {departureOffsetMin > 0 ? 'Arrive' : 'Arrive'} ~
            {getEtaFromNow(departureOffsetMin + route.totalDurationMin)}
          </span>
          {isBikeAndRide && route.extraTravelTimeMin !== undefined && (
            <span className={`text-[11px] font-semibold ${route.extraTravelTimeMin > 0 ? 'text-on-surface-variant' : 'text-tertiary'}`}>
              {route.extraTravelTimeMin > 0 ? `+${route.extraTravelTimeMin} min vs fastest` : 'No extra time'}
            </span>
          )}
        </div>
      </div>

      {route.networkAwareRecommendation && route.networkAwareExplanation && (
        <div className="mt-2.5 px-3 py-2 rounded-xl bg-primary-fixed/35 border border-primary-container/35 text-xs text-on-surface">
          <div className="font-bold text-primary">Why this route?</div>
          <div className="mt-0.5">{route.networkAwareExplanation}</div>
          <div className="mt-1 text-[10px] text-on-surface-variant">Based on available transport conditions · Estimated crowding</div>
        </div>
      )}

      {isBikeAndRide && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${route.weatherSuitable ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
            {route.weatherSuitable ? 'Suitable weather' : 'Poor cycling weather'}
          </span>
          <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${route.cyclingInfrastructureQuality === 'good' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700'}`}>
            {route.cyclingInfrastructureQuality === 'good'
              ? 'Suitable cycling infrastructure'
              : route.cyclingInfrastructureQuality === 'mixed'
              ? 'Mixed cycling infrastructure'
              : route.cyclingInfrastructureQuality === 'poor'
              ? 'Poor cycling infrastructure'
              : 'Infrastructure unverified'}
          </span>
        </div>
      )}

      {/* Prominent Personalised Highlight Banner (if not neutral or when highlighted) */}
      {!highlights.isNeutral ? (
        <div className="mt-2.5 px-3 py-1.5 rounded-xl bg-secondary-fixed/30 border border-secondary-container/40 flex items-center justify-between text-xs">
          <span className="font-semibold text-primary">
            {highlights.primaryHighlight.label}: {highlights.primaryHighlight.value}
          </span>
          {highlights.primaryHighlight.subValue && (
            <span className="text-[11px] text-on-surface-variant">
              {highlights.primaryHighlight.subValue}
            </span>
          )}
        </div>
      ) : (
        <div className="mt-2.5 px-3 py-1.5 rounded-xl bg-surface-container-low border border-outline-variant/20 flex items-center justify-between text-xs text-on-surface-variant">
          <span>{highlights.primaryHighlight.value}</span>
          <span>{highlights.primaryHighlight.subValue}</span>
        </div>
      )}

      {/* Mode-specific journey metrics */}
      <div className="flex flex-wrap items-center gap-3 mt-2.5 text-xs text-on-surface-variant">
        {hasCyclingLeg && (
          <>
            <div className="flex items-center gap-1">
              <Bike className="w-3.5 h-3.5 text-primary" />
              <span>{cyclingDistanceKm} km cycling</span>
            </div>
            <span className="text-outline-variant">•</span>
          </>
        )}
        {isCyclingOnly ? (
          <span>No transfers · no fare</span>
        ) : <><div className="flex items-center gap-1">
          <Shuffle className="w-3.5 h-3.5 text-outline" />
          <span>
            {route.transfers === 0 ? 'Direct ride' : `${route.transfers} transfer${route.transfers > 1 ? 's' : ''}`}
          </span>
        </div>

        <span className="text-outline-variant">•</span>

        <div className="flex items-center gap-1">
          <Footprints className="w-3.5 h-3.5 text-outline" />
          <span>{route.walkingMinutes} min walking</span>
        </div>

        <span className="text-outline-variant">•</span>

        <div className="flex items-center gap-1">
          <Users className="w-3.5 h-3.5 text-outline" />
          <span
            className={
              route.crowdRating === 'Low'
                ? 'text-tertiary font-medium'
                : route.crowdRating === 'Moderate'
                ? 'text-on-secondary-container font-medium'
                : 'text-error font-medium'
            }
          >
            {route.crowdRating} crowding {route.crowdEstimateText ? `(${route.crowdEstimateText.replace(' (Estimate)', '')})` : ''}
          </span>
        </div>
        </>}

        {!isCyclingOnly && route.estimatedFare !== undefined && (
          <>
            <span className="text-outline-variant">•</span>
            <div className="flex items-center gap-0.5">
              <DollarSign className="w-3.5 h-3.5 text-outline" />
              <span>${route.estimatedFare.toFixed(2)} est.</span>
            </div>
          </>
        )}
      </div>

      {/* Explanation Banner */}
      <div
        className={`mt-3 p-2.5 rounded-xl text-xs leading-relaxed ${
          isBestMatch
            ? 'bg-secondary-fixed/40 border border-secondary-container/40 text-on-secondary-fixed-variant'
            : 'bg-surface-container-low border border-outline-variant/30 text-on-surface-variant'
        }`}
      >
        <span className="font-semibold text-on-surface mr-1">
          {isBestMatch ? 'Why recommended:' : 'Commuter factor:'}
        </span>
        {route.whyRecommended}
      </div>

      {/* Map Preview Toggle */}
      <div onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="w-full mt-2.5 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-semibold text-on-surface-variant hover:bg-surface-container-low cursor-pointer transition-colors"
        >
          {showPreview ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" />
              Hide map preview
            </>
          ) : (
            <>
              <Map className="w-3.5 h-3.5" />
              Preview on map{!isBestMatch && compareRoute ? ' vs. recommended' : ''}
            </>
          )}
        </button>

        {showPreview && (
          <RouteOverviewMap
            route={route}
            disruption={disruption}
            compareRoute={!isBestMatch ? compareRoute : undefined}
            heightClass="h-48"
          />
        )}
      </div>

      {/* Action Footer — the one tap target that actually commits to guidance */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSelect(route);
        }}
        className="w-full mt-3 flex items-center justify-between pt-2.5 border-t border-outline-variant/20 text-xs font-semibold text-primary cursor-pointer hover:opacity-80 active:scale-[0.99] transition-all"
      >
        <span>
          {isCyclingOnly
            ? 'Start cycling guidance'
            : isBikeAndRide
            ? 'Start multimodal guidance'
            : 'Start step-by-step guidance'}
        </span>
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
};
