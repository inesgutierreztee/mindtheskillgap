import React from 'react';
import { AlertTriangle, ArrowRight, Train, Sliders, Bike } from 'lucide-react';
import {
  CommuteRoutine,
  DisruptionAlert,
  LiveTransportCondition,
  UserPreferences,
  TravelNeeds,
} from '../types';
import { PlanSearchCard } from '../components/PlanSearchCard';
import { NearbyLiveTransit } from '../components/NearbyLiveTransit';

interface HomeScreenProps {
  routines: CommuteRoutine[];
  disruption: DisruptionAlert | null;
  liveConditions: LiveTransportCondition[];
  userPreferences: UserPreferences;
  travelNeeds: TravelNeeds;
  singaporeTime: string;
  onOpenRoutineConfirmation: (routine: CommuteRoutine) => void;
  onDismissRoutine: (routine: CommuteRoutine) => void;
  onStartRoutineGuidance: () => void;
  onViewDisruptionReroute: () => void;
  onPlanTrip: (origin?: string, destination?: string) => void;
  onOpenPreferences: () => void;
  onSwitchToMap: () => void;
  onRefreshLive: () => void;
  isRefreshingLive?: boolean;
  busesOffService?: boolean;
  liveConditionsAreLive?: boolean;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  routines,
  disruption,
  liveConditions,
  userPreferences,
  travelNeeds,
  singaporeTime,
  onOpenRoutineConfirmation,
  onDismissRoutine,
  onStartRoutineGuidance,
  onViewDisruptionReroute,
  onPlanTrip,
  onOpenPreferences,
  onSwitchToMap,
  onRefreshLive,
  isRefreshingLive = false,
  busesOffService = false,
  liveConditionsAreLive = false,
}) => {
  // Only one detection prompt is surfaced at a time so it isn't overwhelming;
  // every confirmed routine gets its own card below (any number of them).
  const pendingRoutine = routines.find((r) => !r.isConfirmed && !r.isDismissed);
  const confirmedRoutines = routines.filter((r) => r.isConfirmed);
  const hasCrowdedBusPrediction = liveConditions.some(
    (condition) => condition.type === 'bus' && condition.crowdLevel === 'Crowded'
  );
  const showCyclingComfortPrompt = Boolean(
    userPreferences.priority === 'comfort' &&
      userPreferences.cyclingPreferences.enabled &&
      userPreferences.cyclingPreferences.suggestWhen.busesCrowded &&
      hasCrowdedBusPrediction
  );

  return (
    <div id="home-screen-content" className="space-y-4 pb-8 animate-in fade-in duration-200">
      <PlanSearchCard singaporeTime={singaporeTime} onPlanTrip={onPlanTrip} />

      {/* DETECTED COMMUTE ROUTINE BANNER (Pending Review) */}
      {pendingRoutine && (
        <div
          id="detected-routine-banner"
          className="bg-secondary-fixed/40 border border-secondary-container rounded-2xl p-4 card-shadow space-y-3 animate-in slide-in-from-top-2 duration-300"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="text-[11px] font-bold text-primary uppercase tracking-wider">
                COMMUTE PATTERN DETECTED
              </span>
            </div>
            <button
              type="button"
              onClick={() => onDismissRoutine(pendingRoutine)}
              className="text-xs text-on-surface-variant hover:text-on-surface cursor-pointer"
            >
              Dismiss
            </button>
          </div>

          <div>
            <h3 className="text-base font-bold text-on-surface">
              {pendingRoutine.serviceName} from {pendingRoutine.boardingName}
            </h3>
            <p className="text-xs text-on-surface-variant mt-0.5 leading-relaxed">
              We noticed you usually board around {pendingRoutine.fromTime} on weekday mornings. Review to enable departure alerts and 1-tap live arrival access.
            </p>
          </div>

          <div className="flex items-center gap-2.5 pt-1">
            <button
              id="btn-review-routine-banner"
              type="button"
              onClick={() => onOpenRoutineConfirmation(pendingRoutine)}
              className="flex-1 py-2.5 px-4 bg-primary-container hover:bg-primary text-on-primary rounded-full text-xs font-semibold flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer"
            >
              <span>Review routine</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onDismissRoutine(pendingRoutine)}
              className="py-2.5 px-3.5 bg-surface-container-lowest text-on-surface rounded-full text-xs font-semibold hover:bg-surface-container transition-all cursor-pointer"
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {/* CONFIRMED ROUTINE WIDGETS - one card per saved routine */}
      {confirmedRoutines.map((routine) => (
        <div
          key={routine.id}
          id={`confirmed-routine-card-${routine.id}`}
          className="bg-surface-container-lowest border border-primary-container/30 rounded-2xl p-4 card-shadow space-y-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider bg-on-tertiary-container text-tertiary px-2 py-0.5 rounded-full flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-tertiary animate-pulse" />
                MY ROUTINE
              </span>
              <span className="text-xs font-semibold text-on-surface-variant">
                {routine.fromTime}–{routine.toTime}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onOpenRoutineConfirmation(routine)}
              className="text-xs font-semibold text-primary hover:underline cursor-pointer"
            >
              Edit
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-primary-container text-on-primary flex items-center justify-center font-bold text-lg shrink-0">
                {routine.serviceName.startsWith('Bus ') ? (
                  routine.serviceName.replace('Bus ', '')
                ) : (
                  <Train className="w-5 h-5" />
                )}
              </div>
              <div>
                <h4 className="text-sm font-bold text-on-surface">{routine.boardingName}</h4>
                <p className="text-xs text-on-surface-variant">{routine.serviceRoute}</p>
              </div>
            </div>

            <div className="text-right">
              <div className="text-2xl font-bold text-on-surface">2 min</div>
              <div className="text-[11px] text-tertiary font-bold uppercase">Seats avail</div>
            </div>
          </div>

          <button
            id={`btn-start-routine-guidance-${routine.id}`}
            type="button"
            onClick={onStartRoutineGuidance}
            className="w-full py-3 bg-primary-container hover:bg-primary text-on-primary rounded-full text-xs font-semibold flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
          >
            <span>Start guidance</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      ))}

      {/* DISRUPTION NOTICE BANNER */}
      {disruption && disruption.active && (
        userPreferences.alertThresholdMin !== undefined ? (
          // Compact one-line variant: for a user who only wants to be interrupted
          // for significant delays (e.g. Rachel), the interruption itself should
          // also be minimal - one line, one clear action, not three paragraphs.
          <button
            id="home-disruption-alert-compact"
            type="button"
            onClick={onViewDisruptionReroute}
            className="w-full bg-error-container/40 border border-error/30 rounded-2xl px-4 py-3 card-shadow flex items-center justify-between gap-2 cursor-pointer hover:bg-error-container/55 transition-colors text-left"
          >
            <span className="flex items-center gap-2 min-w-0 text-xs text-on-surface">
              <AlertTriangle className="w-4 h-4 text-error shrink-0" />
              <span className="truncate">
                <span className="font-bold">{disruption.line}</span> +{disruption.delayEstimateMin}m — reroute available
              </span>
            </span>
            <span className="flex items-center gap-1 text-xs font-semibold text-primary shrink-0">
              Go
              <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </button>
        ) : (
          <div
            id="home-disruption-alert-card"
            className="bg-error-container/40 border border-error/30 rounded-2xl p-4 card-shadow space-y-2.5"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-error font-bold text-xs uppercase tracking-wider">
                <AlertTriangle className="w-4 h-4" />
                <span>{disruption.line} Alert</span>
              </div>
              <span className="text-[11px] font-semibold bg-error text-white px-2 py-0.5 rounded-full">
                ~{disruption.delayEstimateMin}m delay
              </span>
            </div>

            <div>
              <h4 className="text-sm font-bold text-on-surface leading-snug">
                {disruption.headline}
              </h4>
              <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
                {disruption.subText}
              </p>
            </div>

            <button
              id="btn-view-disruption-reroute"
              type="button"
              onClick={onViewDisruptionReroute}
              className="w-full py-2.5 bg-surface-container-lowest hover:bg-surface-container border border-outline-variant/40 rounded-xl text-xs font-semibold text-primary flex items-center justify-center gap-1.5 transition-all cursor-pointer"
            >
              <span>View recommended alternate route</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )
      )}

      {showCyclingComfortPrompt && (
        <button
          id="home-predictive-cycling-prompt"
          type="button"
          onClick={() => onPlanTrip()}
          className="w-full bg-primary-fixed/40 border border-primary-container/30 rounded-2xl p-4 card-shadow flex items-start gap-3 text-left cursor-pointer hover:bg-primary-fixed/55 transition-colors"
        >
          <span className="w-9 h-9 rounded-xl bg-primary-container text-on-primary flex items-center justify-center shrink-0">
            <Bike className="w-5 h-5" />
          </span>
          <span className="flex-1">
            <span className="block text-xs font-bold text-primary uppercase tracking-wide">
              Comfort suggestion{liveConditionsAreLive ? '' : ' · prototype crowd estimate'}
            </span>
            <span className="block text-sm font-semibold text-on-surface mt-1">
              Your usual bus is expected to be crowded. Cycling may be more comfortable today.
            </span>
            <span className="block text-xs text-primary font-semibold mt-1.5">Compare routes →</span>
          </span>
        </button>
      )}

      {/* ACTIVE PREFERENCES SUMMARY CHIP */}
      <div className="bg-surface-container-low border border-outline-variant/30 rounded-2xl p-3 flex items-center justify-between">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          <span className="text-xs font-bold text-outline shrink-0">Preferences:</span>
          {travelNeeds.stepFreeAccess && (
            <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
              Step-free active
            </span>
          )}
          {userPreferences.travelMode === 'prefer_buses' && (
            <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-secondary-fixed text-on-secondary-fixed-variant shrink-0">
              Prefer buses
            </span>
          )}
          {userPreferences.travelMode === 'prefer_trains' && (
            <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-secondary-fixed text-on-secondary-fixed-variant shrink-0">
              Prefer trains
            </span>
          )}
          {userPreferences.priorities?.map((pri) => (
            <span
              key={pri}
              className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-surface-container-high text-on-surface shrink-0 capitalize"
            >
              {pri}
            </span>
          ))}
          {userPreferences.cyclingPreferences.enabled && (
            <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 shrink-0">
              Conditional cycling
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onOpenPreferences}
          className="text-xs font-semibold text-primary hover:underline ml-2 shrink-0 cursor-pointer"
        >
          <Sliders className="w-4 h-4 inline mr-1" />
          Edit
        </button>
      </div>

      <NearbyLiveTransit
        liveConditions={liveConditions}
        busesOffService={busesOffService}
        isRefreshingLive={isRefreshingLive}
        onRefreshLive={onRefreshLive}
        onSwitchToMap={onSwitchToMap}
        onPlanTrip={onPlanTrip}
      />
    </div>
  );
};
