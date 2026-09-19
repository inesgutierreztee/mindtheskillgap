import React from 'react';
import {
  Sliders,
  Shield,
  Bell,
  Navigation,
  RotateCcw,
  Check,
  ChevronRight,
  ChevronDown,
  Bus,
  Train,
  Database,
  Info,
  Edit3,
  Plus,
  Trash2,
  Bike,
  Footprints,
} from 'lucide-react';
import {
  UserPreferences,
  TravelNeeds,
  LearningPreferences,
  NotificationPreferences,
  CommuteRoutine,
  CommuterPersona,
} from '../types';
import { PreferenceToggle } from '../components/PreferenceToggle';

const PERSONA_LABELS: Record<CommuterPersona, string> = {
  rachel: 'Fixed-schedule professional',
  arjun: 'Flexible multi-modal worker',
  mdmlim: 'Accessibility-focused traveler',
};

interface MoreScreenProps {
  userPreferences: UserPreferences;
  travelNeeds: TravelNeeds;
  learningPreferences: LearningPreferences;
  notificationPreferences: NotificationPreferences;
  routines: CommuteRoutine[];
  selectedPersona?: CommuterPersona | null;
  onRetakeQuiz: () => void;
  onEditRoutine: (routine: CommuteRoutine) => void;
  onAddRoutine: () => void;
  onDeleteRoutine: (id: string) => void;
  onOpenRoutineConfirmation: (routine: CommuteRoutine) => void;
  onToggleNeed: (key: keyof Omit<TravelNeeds, 'noSpecificNeeds'>) => void;
  onToggleLearning: (key: keyof LearningPreferences) => void;
  onToggleNotification: (key: keyof NotificationPreferences) => void;
  onChangeMode: (mode: UserPreferences['travelMode']) => void;
  onChangeDominantHand: (hand: NonNullable<UserPreferences['dominantHand']>) => void;
  onResetPreferences: () => void;
  ltaMode?: boolean;
  simulateOffline?: boolean;
  onToggleSimulateOffline?: () => void;
}

export const MoreScreen: React.FC<MoreScreenProps> = ({
  userPreferences,
  travelNeeds,
  learningPreferences,
  notificationPreferences,
  routines,
  selectedPersona,
  onRetakeQuiz,
  onEditRoutine,
  onAddRoutine,
  onDeleteRoutine,
  onOpenRoutineConfirmation,
  onToggleNeed,
  onToggleLearning,
  onToggleNotification,
  onChangeMode,
  onChangeDominantHand,
  onResetPreferences,
  ltaMode = true,
  simulateOffline = false,
  onToggleSimulateOffline,
}) => {
  return (
    <div id="more-screen-content" className="space-y-4 pb-8 animate-in fade-in duration-200">
      {/* Header */}
      <div className="px-1">
        <h2 className="text-xl font-bold text-on-surface tracking-tight">Profile & Preferences</h2>
        <p className="text-xs text-on-surface-variant">Personalise routing, notifications & privacy</p>
      </div>

      {/* QUIZ RETAKE BANNER */}
      <div className="bg-secondary-fixed/40 border border-secondary-container/40 rounded-2xl p-4 card-shadow flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-on-surface">Personalisation Quiz</h3>
          {selectedPersona && (
            <p className="text-[11px] text-primary font-semibold mt-0.5">
              Commuting as: {PERSONA_LABELS[selectedPersona]}
            </p>
          )}
          <p className="text-xs text-on-surface-variant mt-0.5">
            Update your travel needs, mode preference & priorities.
          </p>
        </div>
        <button
          id="btn-retake-quiz"
          type="button"
          onClick={onRetakeQuiz}
          className="px-3.5 py-2 rounded-full bg-primary-container hover:bg-primary text-on-primary text-xs font-semibold shrink-0 cursor-pointer shadow-2xs"
        >
          Retake quiz
        </button>
      </div>

      {/* TRANSPORT MODES — edited through the single persisted quiz/profile flow */}
      <div className="bg-surface-container-lowest rounded-2xl p-4 card-shadow border border-outline-variant/30 space-y-3">
        <div>
          <h3 className="text-sm font-bold text-on-surface">Transport modes</h3>
          <p className="text-[11px] text-on-surface-variant mt-0.5">Selected in your preference quiz</p>
        </div>
        {(() => {
          const modes = [
            { id: 'rail' as const, label: 'MRT / LRT', Icon: Train },
            { id: 'bus' as const, label: 'Bus', Icon: Bus },
            { id: 'walking' as const, label: 'Walking', Icon: Footprints },
            { id: 'cycling' as const, label: 'Cycling', Icon: Bike },
          ];
          const selected = modes.filter((m) => userPreferences.transportModes[m.id]);
          const unselected = modes.filter((m) => !userPreferences.transportModes[m.id]);
          return (
            <>
              {/* Read-only status, not buttons - editing happens via "Retake quiz" above. */}
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {selected.length === 0 ? (
                  <span className="text-xs text-on-surface-variant">No modes selected yet.</span>
                ) : (
                  selected.map(({ id, label, Icon }) => (
                    <span key={id} className="text-xs font-semibold flex items-center gap-1.5 text-primary">
                      <Icon className="w-3.5 h-3.5" />
                      {label}
                      <Check className="w-3.5 h-3.5" />
                    </span>
                  ))
                )}
              </div>
              {unselected.length > 0 && (
                <p className="text-[11px] text-on-surface-variant">
                  Not selected: {unselected.map((m) => m.label).join(', ')}
                </p>
              )}
            </>
          );
        })()}
        {userPreferences.cyclingPreferences.enabled && (
          <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-[11px] text-blue-900 leading-relaxed">
            <span className="font-bold">Conditional cycling:</span> up to{' '}
            {userPreferences.cyclingPreferences.maxExtraMinutes === null
              ? 'any additional travel time'
              : `${userPreferences.cyclingPreferences.maxExtraMinutes} extra minutes`}
            {' · '}{userPreferences.cyclingPreferences.bikeAtStation === 'park' ? 'park at station' : 'bring foldable bicycle'}
          </div>
        )}
      </div>

      {/* ROUTINE MANAGEMENT */}
      <div className="bg-surface-container-lowest rounded-2xl p-4 card-shadow border border-outline-variant/30 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-on-surface">
            Commute Routines {routines.length > 0 && `(${routines.length})`}
          </h3>
        </div>

        {routines.length === 0 ? (
          <p className="text-[11px] text-on-surface-variant py-1">
            No saved routines yet. Add one for a regular commute you take often.
          </p>
        ) : (
          <div className="space-y-2">
            {routines.map((routine) => (
              <div
                key={routine.id}
                id={`routine-row-${routine.id}`}
                className="bg-surface-container-low p-3 rounded-xl border border-outline-variant/30 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-secondary-fixed text-primary flex items-center justify-center shrink-0">
                      <Bus className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-on-surface truncate">
                        {routine.serviceName || 'Untitled routine'}
                      </div>
                      <div className="text-[11px] text-on-surface-variant truncate">
                        {routine.boardingName || 'No stop set'} · {routine.days.join(', ')} (
                        {routine.fromTime}–{routine.toTime})
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      id={`btn-more-edit-routine-${routine.id}`}
                      type="button"
                      onClick={() => onEditRoutine(routine)}
                      className="p-2 rounded-lg text-primary hover:bg-surface-container cursor-pointer"
                      title="Edit routine"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      id={`btn-more-delete-routine-${routine.id}`}
                      type="button"
                      onClick={() => onDeleteRoutine(routine.id)}
                      className="p-2 rounded-lg text-error hover:bg-error-container/20 cursor-pointer"
                      title="Delete routine"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="text-[11px] text-on-surface-variant leading-relaxed">
                  {routine.isConfirmed ? (
                    <span className="text-emerald-700 font-semibold flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> Confirmed and active on your home screen.
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpenRoutineConfirmation(routine)}
                      className="text-primary font-semibold hover:underline cursor-pointer"
                    >
                      Not yet confirmed - review it
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          id="btn-more-add-routine"
          type="button"
          onClick={onAddRoutine}
          className="w-full py-2.5 rounded-xl border border-dashed border-outline-variant/60 text-xs font-semibold text-primary flex items-center justify-center gap-1.5 hover:bg-surface-container-low cursor-pointer transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add another routine
        </button>
      </div>

      {/* PROACTIVE ALERT SETTINGS */}
      <div className="bg-surface-container-lowest rounded-2xl p-4 card-shadow border border-outline-variant/30 space-y-3">
        <h3 className="text-sm font-bold text-on-surface">Proactive Alert Settings</h3>
        <div className="space-y-2">
          <PreferenceToggle
            id="profile-service-disruptions"
            title="Service Disruptions"
            description="Alerts on lines you commute on"
            enabled={notificationPreferences.serviceDisruptions}
            onToggle={() => onToggleNotification('serviceDisruptions')}
          />
          <PreferenceToggle
            id="profile-personalised-rerouting"
            title="Personalised Rerouting"
            description="Proactive alternative route prompts"
            enabled={notificationPreferences.personalisedSuggestions}
            onToggle={() => onToggleNotification('personalisedSuggestions')}
          />
        </div>
      </div>

      {/* ALL TOGGLEABLE PREFERENCES, GROUPED TOGETHER IN ONE DROPDOWN */}
      <details id="preferences-dropdown" className="group bg-surface-container-lowest rounded-2xl card-shadow border border-outline-variant/30 overflow-hidden">
        <summary className="p-4 flex items-center justify-between cursor-pointer select-none list-none">
          <div>
            <h3 className="text-sm font-bold text-on-surface">Preferences</h3>
            <p className="text-[11px] text-on-surface-variant mt-0.5">Accessibility, travel needs &amp; personalisation</p>
          </div>
          <ChevronDown className="w-4 h-4 text-on-surface-variant shrink-0 transition-transform group-open:rotate-180" />
        </summary>

        <div className="px-4 pb-4 pt-1 border-t border-outline-variant/20 space-y-4">
          <div className="space-y-2.5 pt-3">
            <h4 className="text-xs font-bold text-outline uppercase tracking-wider px-1">
              Accessibility & Travel Needs
            </h4>

            <PreferenceToggle
              id="toggle-step-free"
              title="Step-Free Access"
              description="Strict requirement: prioritises routes with lifts, ramps and wide station gates."
              enabled={travelNeeds.stepFreeAccess}
              onToggle={() => onToggleNeed('stepFreeAccess')}
              badge={travelNeeds.stepFreeAccess ? 'STRICT PRIORITY' : undefined}
            />

            <PreferenceToggle
              id="toggle-short-walking"
              title="Short Walking Distances"
              description="Minimises pedestrian distance between platforms and interchanges."
              enabled={travelNeeds.shortWalkingDistances}
              onToggle={() => onToggleNeed('shortWalkingDistances')}
            />

            <PreferenceToggle
              id="toggle-avoid-crowded"
              title="Avoid Crowded Services"
              description="Suggests slightly less packed services when available."
              enabled={travelNeeds.avoidCrowdedServices}
              onToggle={() => onToggleNeed('avoidCrowdedServices')}
            />
          </div>

          <div className="space-y-2.5">
            <h4 className="text-xs font-bold text-outline uppercase tracking-wider px-1">
              Personalisation & Privacy
            </h4>

            <PreferenceToggle
              id="toggle-learn-routes"
              title="Learn from route choices"
              description="Adapts recommendations based on transit options you frequently select."
              enabled={learningPreferences.learnRouteChoices}
              onToggle={() => onToggleLearning('learnRouteChoices')}
            />

            <PreferenceToggle
              id="toggle-suggest-routines"
              title="Suggest routines when pattern appears"
              description="Surfaces arrival times and proactive alerts for regular commutes."
              enabled={learningPreferences.suggestRoutines}
              onToggle={() => onToggleLearning('suggestRoutines')}
            />

            <PreferenceToggle
              id="toggle-route-familiarity"
              title="Prefer familiar routes during disruptions"
              description="Uses routes you have started before as a tie-breaker when recommending a disruption reroute."
              enabled={learningPreferences.preferFamiliarRoutesDuringDisruptions}
              onToggle={() => onToggleLearning('preferFamiliarRoutesDuringDisruptions')}
            />

            <PreferenceToggle
              id="toggle-audio-guidance"
              title="Audio guidance"
              description="Speaks the next journey instruction after you start a route."
              enabled={learningPreferences.audioGuidance}
              onToggle={() => onToggleLearning('audioGuidance')}
            />
          </div>

          <div className="space-y-2.5">
            <h4 className="text-xs font-bold text-outline uppercase tracking-wider px-1">
              One-Handed Navigation
            </h4>
            <div className="bg-surface-container-low rounded-2xl p-4 border border-outline-variant/30 space-y-3">
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Moves back buttons, close buttons, the map controls and the swap button to the side your thumb reaches, so the whole app is usable with one hand.
              </p>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Dominant hand">
                {(
                  [
                    { id: 'off' as const, label: 'Off' },
                    { id: 'left' as const, label: 'Left' },
                    { id: 'right' as const, label: 'Right' },
                  ]
                ).map(({ id, label }) => {
                  const active = (userPreferences.dominantHand ?? 'off') === id;
                  return (
                    <button
                      key={id}
                      id={`btn-dominant-hand-${id}`}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => onChangeDominantHand(id)}
                      className={`min-h-11 rounded-xl text-sm font-semibold cursor-pointer transition-colors ${
                        active
                          ? 'bg-primary-container text-on-primary'
                          : 'bg-surface-container-lowest text-on-surface-variant border border-outline-variant/40 hover:bg-surface-container'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </details>

      {/* SYSTEM / LTA CONNECTION INFO */}
      <div className="bg-surface-container-low border border-outline-variant/30 rounded-2xl p-4 space-y-2 text-xs">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-primary" />
          <span className="font-bold text-on-surface">Transit Data Source</span>
        </div>
        <p className="text-on-surface-variant leading-relaxed">
          Integrated with LTA DataMall (bus arrivals, train status, crowd &amp; lift maintenance), OneMap (live public-transit routing) and data.gov.sg (weather) - all live, official Singapore government data sources.
        </p>
      </div>

      {/* JUDGING DEMO — collapsed by default so it doesn't sit at the same
          visual weight as real accessibility/privacy settings on this screen. */}
      {onToggleSimulateOffline && (
        <details className="group">
          <summary className="text-xs font-bold text-outline uppercase tracking-wider px-1 cursor-pointer select-none list-none flex items-center gap-1">
            <span className="inline-block transition-transform group-open:rotate-90">›</span>
            Judging tools
          </summary>
          <div className="pt-2.5">
            <PreferenceToggle
              id="toggle-simulate-offline"
              title="Simulate offline / no signal"
              description="Force the offline banner and cached-data fallback, so this is demonstrable even on working wifi."
              enabled={simulateOffline}
              onToggle={onToggleSimulateOffline}
            />
          </div>
        </details>
      )}

      {/* RESET BUTTON */}
      <button
        type="button"
        onClick={onResetPreferences}
        className="w-full py-3 text-center text-xs font-semibold text-error hover:bg-error-container/20 rounded-xl transition-colors cursor-pointer"
      >
        Reset all preferences & routines
      </button>
    </div>
  );
};
