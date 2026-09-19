import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bus,
  Train,
  Footprints,
  MapPin,
  Check,
  ShieldCheck,
  Navigation,
  Clock,
  Shuffle,
  ThumbsUp,
  ThumbsDown,
  X,
  AlertTriangle,
  Sparkles,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Users,
  Bike,
} from 'lucide-react';
import { RouteOption, RouteStep, UserPreferences, TravelNeeds, DisruptionAlert } from '../types';
import { TopAppBar } from '../components/TopAppBar';
import { StatusChip } from '../components/StatusChip';
import { WayfindingMap, LocationStatus } from '../components/WayfindingMap';
import {
  getRoutePersonalisedHighlights,
  hasAccessibilityNeedsSelected,
} from '../utils/personalisation';
import { getEtaFromNow } from '../services/ltaService';
import { RouteOverviewMap } from '../components/RouteOverviewMap';
import { lineColor, distanceMeters } from '../utils/journeyMath';

interface JourneyGuidanceScreenProps {
  route: RouteOption;
  userPreferences?: UserPreferences;
  travelNeeds?: TravelNeeds;
  disruption?: DisruptionAlert | null;
  // Minutes from now this journey was planned to depart (Arjun's flexible
  // departure window) - carried over from the planner so the ETA shown here
  // stays consistent with what was shown before guidance started.
  departureOffsetMin?: number;
  // Speak each turn-by-turn step aloud as it becomes current.
  audioGuidance?: boolean;
  onExit: () => void;
  onFinishJourney: () => void;
}

export const JourneyGuidanceScreen: React.FC<JourneyGuidanceScreenProps> = ({
  route,
  userPreferences,
  travelNeeds,
  disruption,
  departureOffsetMin = 0,
  audioGuidance = false,
  onExit,
  onFinishJourney,
}) => {
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [showFullRouteModal, setShowFullRouteModal] = useState<boolean>(false);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [feedbackGiven, setFeedbackGiven] = useState<'up' | 'down' | null>(null);
  const [showTransitMap, setShowTransitMap] = useState<boolean>(false);

  // Live-location-driven turn guidance for cycling steps: which instruction is
  // "current" right now, tracked from the same GPS fix WayfindingMap already
  // watches. Index only ever moves forward, so GPS jitter can't bounce it
  // between turns. Resets whenever the current step changes.
  const [turnIndex, setTurnIndex] = useState<number>(0);
  const [liveLocation, setLiveLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('checking');

  const steps = route.steps || [];
  const totalSteps = steps.length;
  const currentStep: RouteStep | undefined = steps[currentStepIndex];
  const turns = currentStep?.type === 'cycle' ? currentStep.navigationInstructions ?? [] : [];

  // Speaks the current step aloud when the rider has opted in — useful hands-free,
  // and especially for the cycling safety case this screen already optimises for.
  useEffect(() => {
    if (!audioGuidance || !currentStep || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(`${currentStep.stageLabel || 'Next step'}. ${currentStep.instruction}. ${currentStep.subText || ''}`);
    utterance.lang = 'en-SG';
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
    return () => window.speechSynthesis.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioGuidance, currentStepIndex, currentStep?.instruction, currentStep?.stageLabel, currentStep?.subText]);

  // Reset to the first turn whenever the rider moves onto a different step.
  useEffect(() => {
    setTurnIndex(0);
  }, [currentStepIndex]);

  // Advance to the next turn once the live GPS fix is close to the current
  // one's real anchor point - one turn at a time, never backwards, so a noisy
  // fix can't bounce guidance between turns or skip one meant to be seen.
  useEffect(() => {
    if (!liveLocation) return;
    const current = turns[turnIndex];
    if (!current || current.lat === undefined || current.lng === undefined) return;
    const ARRIVAL_RADIUS_M = 30;
    if (distanceMeters(liveLocation, { lat: current.lat, lng: current.lng }) <= ARRIVAL_RADIUS_M) {
      setTurnIndex((i) => Math.min(i + 1, turns.length - 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveLocation]);

  // Derive personalised highlights and accessibility state
  const hasAccessNeeds = hasAccessibilityNeedsSelected(travelNeeds, userPreferences);
  const highlights = getRoutePersonalisedHighlights(route, userPreferences, travelNeeds);

  // Manual step progression controls
  const handleNextStep = () => {
    if (currentStepIndex + 1 < totalSteps) {
      setCurrentStepIndex((prev) => prev + 1);
    } else {
      setIsCompleted(true);
    }
  };

  const handlePreviousStep = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
    } else {
      onExit();
    }
  };

  // Next step preview
  const nextStep: RouteStep | undefined =
    currentStepIndex + 1 < totalSteps ? steps[currentStepIndex + 1] : undefined;

  // If journey is marked complete, render Journey Completed screen
  if (isCompleted) {
    return (
      <div
        id="journey-completed-screen"
        className="h-full flex flex-col justify-between bg-surface overflow-hidden"
      >
        <TopAppBar
          title="Journey Completed"
          showBack={false}
          showSkip={false}
        />

        <div className="flex-1 px-5 py-6 flex flex-col items-center justify-center text-center animate-in zoom-in-95 duration-300 overflow-y-auto">
          {/* Success Badge */}
          <div className="relative mb-5">
            <div className="w-20 h-20 rounded-full bg-emerald-50 border-4 border-emerald-100 flex items-center justify-center shadow-md">
              <Check className="w-10 h-10 text-emerald-600 stroke-[3]" />
            </div>
            <div className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-primary-container text-on-primary flex items-center justify-center shadow-sm">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
          </div>

          <h1 className="text-2xl font-bold text-on-surface tracking-tight">
            You've arrived!
          </h1>
          <p className="text-xs text-on-surface-variant mt-1.5 max-w-xs leading-relaxed">
            Successfully guided to your destination via <strong>{route.summary}</strong>
          </p>

          {/* Personalised Trip Summary Metrics */}
          <div className="w-full max-w-xs bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-4 card-shadow mt-5 space-y-2.5 text-left">
            <div className="flex items-center justify-between text-xs text-on-surface-variant border-b border-outline-variant/20 pb-2">
              <span>Total Travel Time</span>
              <span className="text-sm font-bold text-on-surface">{route.totalDurationMin} mins</span>
            </div>
            {route.steps.some((step) => step.type === 'cycle') && (
              <div className="flex items-center justify-between text-xs text-on-surface-variant border-b border-outline-variant/20 pb-2">
                <span>Cycling Distance</span>
                <span className="font-semibold text-on-surface">
                  {((route.cyclingDistanceMeters || 0) / 1000).toFixed(1)} km
                </span>
              </div>
            )}
            {route.routeMode !== 'cycle' && (
              <div className="flex items-center justify-between text-xs text-on-surface-variant border-b border-outline-variant/20 pb-2">
                <span>Walking Time</span>
                <span className="font-semibold text-on-surface">{route.walkingMinutes} mins</span>
              </div>
            )}
            <div className="flex items-center justify-between text-xs text-on-surface-variant border-b border-outline-variant/20 pb-2">
              <span>Transfers</span>
              <span className="font-semibold text-on-surface">
                {route.transfers === 0 ? 'Direct ride (0 transfers)' : `${route.transfers} transfer`}
              </span>
            </div>

            {/* Estimated Fare row (when available and relevant) */}
            {route.estimatedFare !== undefined && (
              <div className="flex items-center justify-between text-xs text-on-surface-variant border-b border-outline-variant/20 pb-2">
                <span>Estimated Fare</span>
                <span className="font-semibold text-on-surface">
                  ${route.estimatedFare.toFixed(2)} (Contactless/EZ-Link)
                </span>
              </div>
            )}

            {/* Accessibility: ONLY shown when user selected accessibility needs */}
            {hasAccessNeeds && (
              <div className="flex items-center justify-between text-xs text-on-surface-variant">
                <span>Accessibility</span>
                <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                  <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                  {route.stepFreeAccessible ? 'Step-free route confirmed' : 'Requires stairs'}
                </span>
              </div>
            )}
          </div>

          {/* Guidance Feedback Section */}
          <div className="w-full max-w-xs mt-5 pt-1">
            <p className="text-xs font-semibold text-on-surface-variant mb-2.5">
              How was this route guidance?
            </p>
            <div className="flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => setFeedbackGiven('up')}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                  feedbackGiven === 'up'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-surface-container hover:bg-surface-container-high text-on-surface'
                }`}
              >
                <ThumbsUp className="w-4 h-4" />
                <span>Accurate</span>
              </button>
              <button
                type="button"
                onClick={() => setFeedbackGiven('down')}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                  feedbackGiven === 'down'
                    ? 'bg-error text-white shadow-sm'
                    : 'bg-surface-container hover:bg-surface-container-high text-on-surface'
                }`}
              >
                <ThumbsDown className="w-4 h-4" />
                <span>Issues faced</span>
              </button>
            </div>
            {feedbackGiven && (
              <p className="text-[11px] text-tertiary font-semibold mt-2 animate-in fade-in">
                Thank you! Your feedback helps refine future route guidance.
              </p>
            )}
          </div>
        </div>

        {/* Completed Footer */}
        <footer className="w-full bg-white bg-surface-container-lowest px-4 pt-3 pb-3 shrink-0 border-t border-outline-variant/30 flex flex-col items-center gap-2">
          <button
            id="btn-return-home-after-journey"
            type="button"
            onClick={onFinishJourney}
            className="w-full py-3.5 rounded-full bg-primary-container text-on-primary text-sm font-semibold shadow-sm hover:opacity-95 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <span>Done · Return to Home</span>
            <ArrowRight className="w-4 h-4 stroke-[2.5]" />
          </button>
        </footer>
      </div>
    );
  }

  // Active Guidance Step View
  const progressPercent = Math.round(((currentStepIndex + 1) / totalSteps) * 100);
  const isWalkingStep = currentStep?.type === 'walk' || currentStep?.type === 'transfer';
  const isCyclingStep = currentStep?.type === 'cycle';
  const isTransitStep = currentStep?.type === 'bus' || currentStep?.type === 'train';

  return (
    <div
      id="journey-guidance-container"
      className="h-full flex flex-col justify-between bg-surface relative overflow-hidden"
    >
      {/* Top Bar with LIVE badge and Full Route button */}
      <div className="shrink-0 bg-surface">
        <TopAppBar
          title="Active Guidance"
          isLive={true}
          showBack={true}
          onBack={handlePreviousStep}
          rightAction={
            <button
              id="btn-view-full-route"
              type="button"
              onClick={() => setShowFullRouteModal(true)}
              className="text-xs font-semibold text-primary hover:opacity-80 px-2 py-1 rounded cursor-pointer whitespace-nowrap"
            >
              View full route
            </button>
          }
        />

        {/* Progress header bar */}
        <div className="px-4 pt-1 pb-2">
          <div className="w-full bg-surface-container-high h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-primary-container h-full rounded-full transition-all duration-300 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="flex justify-between items-center mt-1.5 text-[11px] font-semibold">
            <span className="text-on-surface-variant uppercase tracking-wider">
              Step {currentStepIndex + 1} of {totalSteps}
            </span>
            <span className="text-primary">
              {currentStep?.stageLabel || (isCyclingStep ? 'Cycling segment' : isWalkingStep ? 'Walking segment' : 'Transit segment')}
            </span>
          </div>
        </div>

        {/* Personalised Highlights Pill / Banner */}
        <div className="px-4 pb-2">
          {!highlights.isNeutral ? (
            <div className="px-3 py-1.5 rounded-xl bg-secondary-fixed/40 border border-secondary-container/40 flex items-center justify-between text-xs">
              <span className="font-semibold text-primary">
                {highlights.primaryHighlight.label}: {highlights.primaryHighlight.value}
              </span>
              {hasAccessNeeds && (
                <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Check className="w-3 h-3" /> Step-free
                </span>
              )}
            </div>
          ) : (
            <div className="px-3 py-1 rounded-xl bg-surface-container-low border border-outline-variant/20 flex items-center justify-between text-[11px] text-on-surface-variant">
              <span>{highlights.primaryHighlight.value}</span>
              {hasAccessNeeds && (
                <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Check className="w-3 h-3" /> Step-free
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main Guidance Scroll Area */}
      <div className="flex-1 min-h-0 px-4 py-1 overflow-y-auto space-y-3.5">
        {currentStep && (
          <div className="space-y-3.5 animate-in fade-in duration-200">
            {/* 1. Prominent Current Instruction Card */}
            <div className="bg-surface-container-lowest rounded-2xl p-4 card-shadow border border-outline-variant/30">
              <div className="flex items-start gap-3.5">
                <div
                  className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-xs ${
                    currentStep.type === 'walk'
                      ? 'bg-secondary-fixed text-primary-container'
                      : currentStep.type === 'cycle'
                      ? 'bg-primary-container text-on-primary'
                      : currentStep.type === 'transfer'
                      ? 'bg-secondary-container text-on-secondary-container'
                      : currentStep.type === 'bus'
                      ? 'bg-primary-container text-on-primary font-bold text-lg'
                      : 'text-white font-bold text-sm'
                  }`}
                  style={currentStep.type === 'train' ? { backgroundColor: lineColor(currentStep.lineOrService) ?? '#748477' } : undefined}
                >
                  {currentStep.type === 'walk' ? (
                    <Footprints className="w-6 h-6" />
                  ) : currentStep.type === 'cycle' ? (
                    <Bike className="w-6 h-6" />
                  ) : currentStep.type === 'transfer' ? (
                    <Shuffle className="w-6 h-6" />
                  ) : currentStep.type === 'bus' ? (
                    <span>{currentStep.lineOrService ? currentStep.lineOrService.replace('Bus ', '') : '96'}</span>
                  ) : (
                    <Train className="w-6 h-6" />
                  )}
                </div>

                <div className="flex-1 pr-1">
                  <span className="text-[11px] font-bold tracking-wider uppercase text-outline block mb-0.5">
                    {currentStep.stageLabel || (isCyclingStep ? 'Cycling route' : isWalkingStep ? 'Pedestrian connection' : 'Transit travel')}
                  </span>
                  {/* One prominent current instruction */}
                  <h1 className="text-lg sm:text-xl font-bold text-on-surface leading-tight tracking-tight">
                    {currentStep.instruction}
                  </h1>
                  <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
                    {currentStep.subText}
                  </p>

                  {/* Walking distance and estimated duration prominent callout */}
                  {(isWalkingStep || isCyclingStep) && (
                    <div className="flex items-center gap-2 mt-2 text-xs font-semibold text-primary">
                      {isCyclingStep ? <Bike className="w-4 h-4 shrink-0" /> : <Footprints className="w-4 h-4 shrink-0" />}
                      <span>
                        {currentStep.distanceMeters ? `${currentStep.distanceMeters} m` : 'Short connection'} · ~{currentStep.durationMin} mins
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Badges: Sheltered walkway, Bay/Berth, Accessibility (conditional) */}
              <div className="flex flex-wrap items-center gap-2 mt-3 pt-2.5 border-t border-outline-variant/20">
                {/* Accessibility badge ONLY when user selected accessibility needs */}
                {hasAccessNeeds && currentStep.stepFree && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-50 text-emerald-700 px-2.5 py-0.5 rounded-full">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Step-free access
                  </span>
                )}
                {currentStep.sheltered && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-secondary-fixed text-on-secondary-fixed-variant px-2.5 py-0.5 rounded-full">
                    Covered linkway
                  </span>
                )}
                {currentStep.bayOrBerth && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-surface-container-high text-on-surface px-2.5 py-0.5 rounded-full">
                    {currentStep.bayOrBerth}
                  </span>
                )}
              </div>
            </div>

            {/* 2. THE WORKING MAP: For walking steps (walk to stop, transfer, walk to destination) */}
            {(isWalkingStep || isCyclingStep) && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between px-1">
                  <h2 className="text-xs font-bold text-outline uppercase tracking-wider flex items-center gap-1.5">
                    <Navigation className="w-3.5 h-3.5 text-primary" />
                    <span>{isCyclingStep ? 'Cycling Route & Turns' : 'Walking Route & Targets'}</span>
                  </h2>
                  <span className="text-[11px] font-semibold text-primary">
                    Interactive Map
                  </span>
                </div>

                <WayfindingMap
                  step={currentStep}
                  route={route}
                  stepIndex={currentStepIndex}
                  heightClass="h-64 sm:h-72"
                  allowExpand={true}
                  onLocationUpdate={isCyclingStep ? (loc, status) => {
                    setLiveLocation(loc);
                    setLocationStatus(status);
                  } : undefined}
                />

                {isCyclingStep && turns.length > 0 && (
                  <div className="bg-surface-container-lowest rounded-2xl p-4 border border-outline-variant/30 space-y-3">
                    <div className="flex items-center justify-between">
                      <h2 className="text-[11px] font-bold text-outline uppercase tracking-wider">
                        Turn {Math.min(turnIndex + 1, turns.length)} of {turns.length}
                      </h2>
                      {locationStatus === 'active' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                          Tracking your location
                        </span>
                      ) : (
                        <span className="text-[11px] font-semibold text-on-surface-variant">
                          {locationStatus === 'checking' ? 'Finding your location…' : 'Location unavailable'}
                        </span>
                      )}
                    </div>

                    {/* One turn at a time, large enough to read at a glance while riding. */}
                    <div className="flex items-start gap-3">
                      <span className="w-9 h-9 rounded-full bg-primary-container text-on-primary flex items-center justify-center font-bold text-base shrink-0">
                        {turnIndex + 1}
                      </span>
                      <p className="text-xl font-bold text-on-surface leading-snug pt-0.5">
                        {turns[turnIndex]?.text}
                      </p>
                    </div>

                    {turns[turnIndex + 1] && (
                      <p className="text-sm text-on-surface-variant pl-12">
                        Then: {turns[turnIndex + 1].text}
                      </p>
                    )}

                    {locationStatus !== 'active' && turnIndex < turns.length - 1 && (
                      <button
                        type="button"
                        onClick={() => setTurnIndex((i) => Math.min(i + 1, turns.length - 1))}
                        className="w-full py-2.5 rounded-xl bg-surface-container text-on-surface text-xs font-semibold cursor-pointer hover:bg-surface-container-high"
                      >
                        {locationStatus === 'denied'
                          ? "Location access denied - tap when you've made this turn"
                          : "Can't get a location fix - tap when you've made this turn"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 3. BUS / TRAIN ON-BOARD PRIORITISED INFORMATION */}
            {isTransitStep && (
              <div className="space-y-3">
                {/* Service, Direction & Alighting Stop */}
                <div className="bg-surface-container-lowest rounded-2xl p-4 card-shadow border border-outline-variant/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 rounded-lg bg-primary-container text-on-primary font-bold text-sm">
                        {currentStep.lineOrService || 'Transit'}
                      </span>
                      <span className="text-xs font-bold text-on-surface">
                        {currentStep.direction ? `Towards ${currentStep.direction}` : 'Service on route'}
                      </span>
                    </div>
                    <StatusChip type="live" value="LIVE" />
                  </div>

                  {/* Prominent Alighting Callout */}
                  <div className="p-3 bg-secondary-fixed/30 rounded-xl border border-secondary-container/40">
                    <div className="text-[11px] font-bold text-primary uppercase tracking-wider">
                      Alight at station / stop
                    </div>
                    <div className="text-sm font-bold text-on-surface mt-0.5">
                      {currentStep.alightStationOrStop || currentStep.instruction}
                    </div>
                    {currentStep.stopsRemaining !== undefined && (
                      <div className="text-xs font-semibold text-on-surface-variant mt-1">
                        {currentStep.stopsRemaining} stops remaining (~{currentStep.durationMin} mins)
                      </div>
                    )}
                  </div>

                  {/* Real-time progression list */}
                  {currentStep.progressionStops && currentStep.progressionStops.length > 0 && (
                    <div className="space-y-2 pt-1">
                      <div className="text-[11px] font-bold text-outline uppercase tracking-wider">
                        Stops Progression
                      </div>
                      <div className="space-y-2">
                        {currentStep.progressionStops.map((stop, sIdx) => {
                          const isAlight = stop.status === 'alight';
                          const isPassed = stop.status === 'passed';
                          const isNext = stop.status === 'next';

                          return (
                            <div
                              key={stop.name}
                              className={`flex items-start gap-2.5 text-xs p-2 rounded-xl transition-all ${
                                isAlight
                                  ? 'bg-amber-500/10 border border-amber-500/30 font-bold'
                                  : isNext
                                  ? 'bg-primary-container/10 font-semibold'
                                  : 'text-on-surface-variant'
                              }`}
                            >
                              <div
                                className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                                  isAlight
                                    ? 'bg-amber-600 ring-4 ring-amber-500/20'
                                    : isNext
                                    ? 'bg-primary ring-4 ring-primary/20'
                                    : isPassed
                                    ? 'bg-outline/50'
                                    : 'bg-outline-variant'
                                }`}
                              />
                              <div className="flex-1">
                                <div className="text-on-surface flex items-center justify-between">
                                  <span>{stop.name}</span>
                                  {isAlight && (
                                    <span className="text-[11px] uppercase font-bold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">
                                      Alight here
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-on-surface-variant">
                                  {stop.subText}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Expandable Transit Map Toggle */}
                  <div className="pt-2 border-t border-outline-variant/20">
                    <button
                      type="button"
                      onClick={() => setShowTransitMap((prev) => !prev)}
                      className="w-full flex items-center justify-between text-xs font-semibold text-primary py-1.5 cursor-pointer hover:underline"
                    >
                      <span className="flex items-center gap-1.5">
                        <Navigation className="w-3.5 h-3.5" />
                        {showTransitMap ? 'Hide transit map' : 'View transit route on map'}
                      </span>
                      {showTransitMap ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>

                    {showTransitMap && (
                      <div className="mt-2 animate-in fade-in duration-200">
                        <WayfindingMap
                          step={currentStep}
                          route={route}
                          stepIndex={currentStepIndex}
                          heightClass="h-48 sm:h-56"
                          allowExpand={false}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 4. Brief Preview of Next Step */}
            <div className="bg-surface-container-low rounded-2xl p-3.5 border border-outline-variant/30 flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold uppercase tracking-wider text-outline">
                  Up next
                </div>
                <div className="text-xs font-bold text-on-surface truncate mt-0.5">
                  {nextStep
                    ? nextStep.instruction
                    : 'Arrive at destination'}
                </div>
                <div className="text-[11px] text-on-surface-variant truncate">
                  {nextStep
                    ? nextStep.subText || nextStep.upcomingStepTitle || `${nextStep.durationMin} min duration`
                    : 'End of route'}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 5. Fixed Guidance Action Controls (Above Bottom Navigation) */}
      <footer className="w-full bg-white bg-surface-container-lowest px-4 pt-3 pb-3 shrink-0 border-t border-outline-variant/30 flex items-center justify-between gap-2.5 z-20">
        {/* Previous Step Button */}
        <button
          id="btn-guidance-prev-step"
          type="button"
          onClick={handlePreviousStep}
          className="py-3 px-3.5 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface-variant font-semibold text-xs cursor-pointer active:scale-95 transition-all flex items-center gap-1 shrink-0"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>{currentStepIndex > 0 ? 'Previous' : 'Exit'}</span>
        </button>

        {/* Next Step Button (Manual Progression) */}
        <button
          id="btn-guidance-next-step"
          type="button"
          onClick={handleNextStep}
          className="flex-1 py-3.5 rounded-full bg-primary-container hover:bg-primary text-on-primary font-semibold text-xs sm:text-sm shadow-sm active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <span className="truncate">
            {currentStepIndex + 1 === totalSteps
              ? 'Complete journey ✓'
              : isWalkingStep
              ? "I've arrived at the stop →"
              : isCyclingStep
              ? 'Continue cycling →'
              : currentStep?.type === 'bus'
              ? "I've boarded the bus →"
              : currentStep?.type === 'train'
              ? "I've boarded the train →"
              : 'Next step →'}
          </span>
          <ArrowRight className="w-4 h-4 stroke-[2.5] shrink-0" />
        </button>
      </footer>

      {/* FULL ROUTE OVERVIEW MODAL */}
      {showFullRouteModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-end justify-center">
          <div className="w-full max-w-[430px] bg-surface-container-lowest rounded-t-[28px] custom-sheet-shadow flex flex-col max-h-[85vh] overflow-hidden animate-in slide-in-from-bottom duration-250">
            <div className="w-full flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 bg-outline-variant rounded-full" />
            </div>

            <div className="px-5 pb-3 pt-1 border-b border-outline-variant/30 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-on-surface">Full Route Steps</h3>
                <p className="text-xs text-on-surface-variant">
                  {route.title} · {route.totalDurationMin} mins · Arrive ~
                  {getEtaFromNow(departureOffsetMin + route.totalDurationMin)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowFullRouteModal(false)}
                className="w-8 h-8 rounded-full bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 overflow-y-auto space-y-3 flex-1 no-scrollbar">
              <RouteOverviewMap route={route} disruption={disruption} />

              {steps.map((step, idx) => {
                const isCurrent = idx === currentStepIndex;
                const isPassed = idx < currentStepIndex;

                return (
                  <div
                    key={step.stepNumber}
                    onClick={() => {
                      setCurrentStepIndex(idx);
                      setShowFullRouteModal(false);
                    }}
                    className={`p-3 rounded-2xl border transition-all cursor-pointer ${
                      isCurrent
                        ? 'border-2 border-primary-container bg-primary-container/[0.04]'
                        : isPassed
                        ? 'border-outline-variant/30 bg-surface-container-low opacity-75'
                        : 'border-outline-variant/40 hover:border-outline'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                            isCurrent
                              ? 'bg-primary-container text-on-primary'
                              : isPassed
                              ? 'bg-emerald-600 text-white'
                              : 'bg-surface-container-high text-on-surface-variant'
                          }`}
                        >
                          {isPassed ? <Check className="w-3.5 h-3.5" /> : step.stepNumber}
                        </span>
                        <span className="text-xs font-bold text-on-surface">
                          {step.instruction}
                        </span>
                      </div>
                      <span className="text-xs text-outline">{step.durationMin}m</span>
                    </div>
                    <p className="text-[11px] text-on-surface-variant mt-1 ml-8">
                      {step.subText}
                    </p>
                  </div>
                );
              })}
            </div>

            <footer className="p-4 border-t border-outline-variant/30">
              <button
                type="button"
                onClick={() => setShowFullRouteModal(false)}
                className="w-full py-3 bg-surface-container hover:bg-surface-container-high rounded-full text-xs font-semibold text-on-surface cursor-pointer"
              >
                Close overview
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
};
