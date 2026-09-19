import React, { useState } from 'react';
import {
  Check,
  ArrowRight,
  ArrowLeft,
  Clock,
  Footprints,
  Shuffle,
  CreditCard,
  Users,
  Info,
  Shield,
  Briefcase,
  Bike,
  Accessibility,
  BusFront,
  TrainFront,
  ChevronDown,
} from 'lucide-react';
import {
  TravelNeeds,
  TravelModePreference,
  RoutePriority,
  LearningPreferences,
  UserPreferences,
  CommuterPersona,
  TransportModePreferences,
  CyclingPreferences,
} from '../types';
import { DEFAULT_LEARNING_PREFERENCES } from '../data/mockTransportData';
interface OnboardingQuizScreenProps {
  initialPersona?: CommuterPersona | null;
  initialNeeds?: TravelNeeds;
  initialMode?: TravelModePreference | null;
  initialPriorities?: RoutePriority[];
  initialLearning?: LearningPreferences;
  initialTransportModes?: TransportModePreferences;
  initialCyclingPreferences?: CyclingPreferences;
  onComplete: (preferences: {
    persona: CommuterPersona;
    needs: TravelNeeds;
    travelMode: TravelModePreference;
    priorities: RoutePriority[];
    priority: UserPreferences['priority'];
    transportModes: TransportModePreferences;
    cyclingPreferences: CyclingPreferences;
    learning: LearningPreferences;
  }) => void;
}

const PERSONA_DEFAULTS: Record<
  CommuterPersona,
  { needs: TravelNeeds; mode: TravelModePreference; priorities: RoutePriority[]; priority: UserPreferences['priority'] }
> = {
  rachel: {
    needs: { stepFreeAccess: false, shortWalkingDistances: false, avoidCrowdedServices: false, noSpecificNeeds: true },
    mode: 'prefer_trains',
    priorities: ['time'],
    priority: 'time',
  },
  arjun: {
    needs: { stepFreeAccess: false, shortWalkingDistances: false, avoidCrowdedServices: true, noSpecificNeeds: false },
    mode: 'no_preference',
    priorities: ['crowd'],
    priority: 'comfort',
  },
  mdmlim: {
    needs: { stepFreeAccess: true, shortWalkingDistances: true, avoidCrowdedServices: false, noSpecificNeeds: false },
    mode: 'no_preference',
    priorities: ['walk'],
    priority: 'walking',
  },
};

const DEFAULT_CYCLING_PREFERENCES: CyclingPreferences = {
  enabled: false,
  suggestWhen: {
    busesCrowded: true,
    crowdedInterchange: true,
    longBusWait: true,
    disruptionReliability: true,
  },
  maxExtraMinutes: 15,
  avoidWhen: {
    heavyRain: true,
    poorInfrastructure: true,
    noBikeParking: true,
    routeTooLong: true,
  },
  bikeAtStation: 'park',
};

export const OnboardingQuizScreen: React.FC<OnboardingQuizScreenProps> = ({
  initialPersona = null,
  initialNeeds = {
    stepFreeAccess: false,
    shortWalkingDistances: false,
    avoidCrowdedServices: false,
    noSpecificNeeds: false,
  },
  initialMode = null,
  initialPriorities = [],
  initialLearning,
  initialTransportModes = { rail: true, bus: true, walking: true, cycling: false },
  initialCyclingPreferences = DEFAULT_CYCLING_PREFERENCES,
  onComplete,
}) => {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Step 1: Commuter persona (which of the three the app should target for this user)
  const [persona, setPersona] = useState<CommuterPersona | null>(initialPersona);

  // Step 2: Travel Needs (starts with no answer selected)
  const [travelNeeds, setTravelNeeds] = useState<TravelNeeds>(initialNeeds);

  // Step 2: Travel Mode Preference (starts with no answer selected)
  const [travelMode, setTravelMode] = useState<TravelModePreference>(initialMode || 'no_preference');
  const [transportModes, setTransportModes] = useState<TransportModePreferences>(initialTransportModes);
  const [cyclingPreferences, setCyclingPreferences] = useState<CyclingPreferences>(initialCyclingPreferences);
  const [cyclingExpanded, setCyclingExpanded] = useState(initialTransportModes.cycling);
  const [primaryPriority, setPrimaryPriority] = useState<UserPreferences['priority']>(
    initialPersona ? PERSONA_DEFAULTS[initialPersona].priority : 'balanced'
  );

  // Step 3: Route priorities (starts with no answer selected, choose up to 2)
  const [priorities, setPriorities] = useState<RoutePriority[]>(initialPriorities);
  const [showLimitWarning, setShowLimitWarning] = useState<boolean>(false);

  // Step 4: Learning controls (default to ON for new users; preserve previously saved choice)
  const [learningPrefs, setLearningPrefs] = useState<LearningPreferences>(() => {
    if (initialLearning) {
      return { ...DEFAULT_LEARNING_PREFERENCES, ...initialLearning };
    }
    return {
      ...DEFAULT_LEARNING_PREFERENCES,
      learnRouteChoices: true,
      suggestRoutines: true,
    };
  });

  // Step 1: persona selection pre-fills sensible defaults for the steps that
  // follow, which the user can still change themselves on those steps.
  const handleSelectPersona = (p: CommuterPersona) => {
    setPersona(p);
    const defaults = PERSONA_DEFAULTS[p];
    setTravelNeeds(defaults.needs);
    setTravelMode(defaults.mode);
    setPriorities(defaults.priorities);
    setPrimaryPriority(defaults.priority);
    if (p === 'arjun') {
      setTransportModes({ rail: true, bus: true, walking: true, cycling: true });
      setCyclingPreferences({ ...DEFAULT_CYCLING_PREFERENCES, enabled: true });
      setCyclingExpanded(true);
    }
  };

  // Step 1 toggling - neutral option is mutually exclusive with specific needs
  const toggleNeed = (key: keyof Omit<TravelNeeds, 'noSpecificNeeds'>) => {
    setTravelNeeds((prev) => ({
      ...prev,
      noSpecificNeeds: false,
      [key]: !prev[key],
    }));
  };

  const selectNoSpecificNeeds = () => {
    setTravelNeeds((prev) => {
      const nextState = !prev.noSpecificNeeds;
      return {
        stepFreeAccess: false,
        shortWalkingDistances: false,
        avoidCrowdedServices: false,
        noSpecificNeeds: nextState,
      };
    });
  };

  // Step 2 mode selection - clicking selected mode deselects it
  const toggleTransportMode = (mode: keyof TransportModePreferences) => {
    setTransportModes((prev) => {
      const next = { ...prev, [mode]: !prev[mode] };
      if (mode === 'cycling') {
        setCyclingPreferences((cycling) => ({ ...cycling, enabled: next.cycling }));
        if (next.cycling) setCyclingExpanded(true);
      }
      const enabledMotorModes = [next.bus, next.rail].filter(Boolean).length;
      setTravelMode(enabledMotorModes !== 1 ? 'no_preference' : next.bus ? 'prefer_buses' : 'prefer_trains');
      return next;
    });
  };

  const toggleCyclingSuggestWhen = (key: keyof CyclingPreferences['suggestWhen']) => {
    setCyclingPreferences((prev) => ({
      ...prev,
      suggestWhen: { ...prev.suggestWhen, [key]: !prev.suggestWhen[key] },
    }));
  };

  const toggleCyclingAvoidWhen = (key: keyof CyclingPreferences['avoidWhen']) => {
    setCyclingPreferences((prev) => ({
      ...prev,
      avoidWhen: { ...prev.avoidWhen, [key]: !prev.avoidWhen[key] },
    }));
  };

  // Step 3 priority toggle (at least 1 required, max 2; "No preference" is mutually exclusive)
  const togglePriority = (p: RoutePriority) => {
    setPriorities((prev) => {
      if (p === 'no_preference') {
        setShowLimitWarning(false);
        return prev.includes('no_preference') ? [] : ['no_preference'];
      }

      // If selecting a specific priority, strip out 'no_preference'
      const withoutNeutral = prev.filter((item) => item !== 'no_preference');
      if (withoutNeutral.includes(p)) {
        setShowLimitWarning(false);
        return withoutNeutral.filter((item) => item !== p);
      }
      if (withoutNeutral.length >= 2) {
        setShowLimitWarning(true);
        setTimeout(() => setShowLimitWarning(false), 2400);
        return withoutNeutral;
      }
      setShowLimitWarning(false);
      return [...withoutNeutral, p];
    });
  };

  // Validation before advancing
  const isCurrentStepValid = (): boolean => {
    if (step === 1) {
      return persona !== null;
    }
    if (step === 2) {
      return Boolean(
        travelNeeds.stepFreeAccess ||
        travelNeeds.shortWalkingDistances ||
        travelNeeds.avoidCrowdedServices ||
        travelNeeds.noSpecificNeeds
      );
    }
    if (step === 3) {
      return Object.values(transportModes).some(Boolean);
    }
    if (step === 4) {
      return (
        priorities.includes('no_preference') ||
        (priorities.length >= 1 && priorities.length <= 2)
      );
    }
    if (step === 5) {
      return true;
    }
    return false;
  };

  const handleContinue = () => {
    if (!isCurrentStepValid()) return;
    setStep((s) => (s + 1) as 1 | 2 | 3 | 4 | 5);
  };

  const handleFinish = () => {
    if (!isCurrentStepValid() || !persona) return;
    onComplete({
      persona,
      needs: travelNeeds,
      travelMode,
      priorities,
      priority: primaryPriority,
      transportModes,
      cyclingPreferences: { ...cyclingPreferences, enabled: transportModes.cycling },
      learning: learningPrefs,
    });
  };

  return (
    <div
      id="onboarding-quiz-container"
      className="min-h-full flex flex-col justify-between bg-surface"
    >
      {/* Custom quiz header with step progress */}
      <div>
        <div className="h-14 px-2 flex items-center">
          {step > 1 ? (
            <button
              id="onboarding-back-button"
              type="button"
              onClick={() => setStep((s) => (Math.max(1, s - 1) as 1 | 2 | 3 | 4 | 5))}
              className="w-10 h-10 rounded-full flex items-center justify-center text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          ) : (
            <span className="px-2 text-[1.0625rem] font-semibold text-on-surface">Transit Companion</span>
          )}
        </div>

        {/* Linear Step Progress Bar */}
        <div className="px-4 pt-1 pb-3">
          <div className="w-full bg-surface-container-high h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-primary h-full rounded-full transition-all duration-300 ease-out"
              style={{ width: `${step * 20}%` }}
            />
          </div>
          <div className="flex justify-between items-center mt-1.5">
            <span className="text-[13px] text-on-surface-variant font-semibold tracking-wider uppercase">
              Step {step} of 5
            </span>
            <span className="text-[13px] text-primary font-semibold">
              {step === 1
                ? 'Your Profile'
                : step === 2
                ? 'Travel Needs'
                : step === 3
                ? 'Travel Mode'
                : step === 4
                ? 'Route Priorities'
                : 'Personalisation'}
            </span>
          </div>
        </div>
      </div>

      {/* Main Scrollable Content */}
      <div className="flex-1 px-4 py-2 overflow-y-auto">
        {/* STEP 1: COMMUTER PERSONA */}
        {step === 1 && (
          <section className="space-y-4 animate-in fade-in duration-200">
            <div>
              <h1 className="text-[2rem] leading-[1.1] font-bold tracking-[-0.025em] text-on-surface text-balance">
                Which of these sounds like you?
              </h1>
              <p className="text-[1.0625rem] text-on-surface-variant mt-2">
                We'll tailor routing, alerts and accessibility to fit your commute.
              </p>
            </div>

            <div className="space-y-3 pt-1">
              <div
                id="persona-card-rachel"
                onClick={() => handleSelectPersona('rachel')}
                className={`p-5 rounded-[24px] cursor-pointer transition-colors border select-none ${
                  persona === 'rachel'
                    ? 'border-2 border-primary-container bg-primary-fixed'
                    : 'bg-surface-container-lowest border-outline-variant hover:border-primary/50'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 pr-2">
                    <div className="w-12 h-12 rounded-2xl bg-surface-container-lowest border border-outline-variant/60 text-primary flex items-center justify-center shrink-0">
                      <Briefcase className="w-5 h-5" />
                    </div>
                    <div className="space-y-1">
                      <h2 className="text-[1.125rem] font-semibold text-on-surface">Fixed-schedule professional</h2>
                      <p className="text-sm text-on-surface-variant leading-relaxed">
                        Same commute every day, tight arrival deadline. Only interrupt me for serious delays.
                      </p>
                    </div>
                  </div>
                  <div
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                      persona === 'rachel'
                        ? 'border-primary-container bg-primary-container text-on-primary'
                        : 'border-outline-variant'
                    }`}
                  >
                    {persona === 'rachel' && <Check className="w-4 h-4 stroke-[3]" />}
                  </div>
                </div>
              </div>

              <div
                id="persona-card-arjun"
                onClick={() => handleSelectPersona('arjun')}
                className={`p-5 rounded-[24px] cursor-pointer transition-colors border select-none ${
                  persona === 'arjun'
                    ? 'border-2 border-primary-container bg-primary-fixed'
                    : 'bg-surface-container-lowest border-outline-variant hover:border-primary/50'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 pr-2">
                    <div className="w-12 h-12 rounded-2xl bg-surface-container-lowest border border-outline-variant/60 text-primary flex items-center justify-center shrink-0">
                      <Bike className="w-5 h-5" />
                    </div>
                    <div className="space-y-1">
                      <h2 className="text-[1.125rem] font-semibold text-on-surface">Flexible multi-modal worker</h2>
                      <p className="text-sm text-on-surface-variant leading-relaxed">
                        Mix cycling, LRT and bus. Flexible start time — I care more about comfort and shelter than raw speed.
                      </p>
                    </div>
                  </div>
                  <div
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                      persona === 'arjun'
                        ? 'border-primary-container bg-primary-container text-on-primary'
                        : 'border-outline-variant'
                    }`}
                  >
                    {persona === 'arjun' && <Check className="w-4 h-4 stroke-[3]" />}
                  </div>
                </div>
              </div>

              <div
                id="persona-card-mdmlim"
                onClick={() => handleSelectPersona('mdmlim')}
                className={`p-5 rounded-[24px] cursor-pointer transition-colors border select-none ${
                  persona === 'mdmlim'
                    ? 'border-2 border-primary-container bg-primary-fixed'
                    : 'bg-surface-container-lowest border-outline-variant hover:border-primary/50'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 pr-2">
                    <div className="w-12 h-12 rounded-2xl bg-surface-container-lowest border border-outline-variant/60 text-primary flex items-center justify-center shrink-0">
                      <Accessibility className="w-5 h-5" />
                    </div>
                    <div className="space-y-1">
                      <h2 className="text-[1.125rem] font-semibold text-on-surface">Accessibility-focused occasional traveler</h2>
                      <p className="text-sm text-on-surface-variant leading-relaxed">
                        I need step-free routes and short walks, and I plan trips in advance rather than improvising.
                      </p>
                    </div>
                  </div>
                  <div
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                      persona === 'mdmlim'
                        ? 'border-primary-container bg-primary-container text-on-primary'
                        : 'border-outline-variant'
                    }`}
                  >
                    {persona === 'mdmlim' && <Check className="w-4 h-4 stroke-[3]" />}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* STEP 2: TRAVEL NEEDS */}
        {step === 2 && (
          <section className="space-y-4 animate-in fade-in duration-200">
            <div>
              <h1 className="text-[2rem] leading-[1.1] font-bold tracking-[-0.025em] text-on-surface text-balance">
                What would make your journey easier?
              </h1>
              <p className="text-[1.0625rem] text-on-surface-variant mt-2">
                Select any travel needs we should consider.
              </p>
            </div>

            <div className="space-y-3 pt-1">
              {/* Card 1: Step-free access */}
              <div
                id="pref-card-step-free"
                onClick={() => toggleNeed('stepFreeAccess')}
                className={`p-5 rounded-[24px] cursor-pointer transition-colors border select-none ${
                  travelNeeds.stepFreeAccess
                    ? 'border-2 border-primary-container bg-primary-fixed'
                    : 'bg-surface-container-lowest border-outline-variant hover:border-primary/50'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 pr-2">
                    <h2 className="text-[1.125rem] font-semibold text-on-surface">Step-free access</h2>
                    <p className="text-sm text-on-surface-variant leading-relaxed">
                      Lifts, ramps and wide gates at MRT stations & bus interchanges
                    </p>
                  </div>
                  <div
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                      travelNeeds.stepFreeAccess
                        ? 'border-primary-container bg-primary-container text-on-primary'
                        : 'border-outline-variant'
                    }`}
                  >
                    {travelNeeds.stepFreeAccess && <Check className="w-4 h-4 stroke-[3]" />}
                  </div>
                </div>
              </div>

              {/* Card 2: Short walking distances */}
              <div
                id="pref-card-short-walking"
                onClick={() => toggleNeed('shortWalkingDistances')}
                className={`p-5 rounded-[24px] cursor-pointer transition-colors border select-none ${
                  travelNeeds.shortWalkingDistances
                    ? 'border-2 border-primary-container bg-primary-fixed'
                    : 'bg-surface-container-lowest border-outline-variant hover:border-primary/50'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 pr-2">
                    <h2 className="text-[1.125rem] font-semibold text-on-surface">Short walking distances</h2>
                    <p className="text-sm text-on-surface-variant leading-relaxed">
                      Minimise walking between stops, platforms and exits
                    </p>
                  </div>
                  <div
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                      travelNeeds.shortWalkingDistances
                        ? 'border-primary-container bg-primary-container text-on-primary'
                        : 'border-outline-variant'
                    }`}
                  >
                    {travelNeeds.shortWalkingDistances && <Check className="w-4 h-4 stroke-[3]" />}
                  </div>
                </div>
              </div>

              {/* Card 3: Avoid crowded services */}
              <div
                id="pref-card-avoid-crowded"
                onClick={() => toggleNeed('avoidCrowdedServices')}
                className={`p-5 rounded-[24px] cursor-pointer transition-colors border select-none ${
                  travelNeeds.avoidCrowdedServices
                    ? 'border-2 border-primary-container bg-primary-fixed'
                    : 'bg-surface-container-lowest border-outline-variant hover:border-primary/50'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 pr-2">
                    <h2 className="text-[1.125rem] font-semibold text-on-surface">
                      Avoid crowded services where possible
                    </h2>
                    <p className="text-sm text-on-surface-variant leading-relaxed">
                      Suggest slightly less packed buses or trains when available
                    </p>
                  </div>
                  <div
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                      travelNeeds.avoidCrowdedServices
                        ? 'border-primary-container bg-primary-container text-on-primary'
                        : 'border-outline-variant'
                    }`}
                  >
                    {travelNeeds.avoidCrowdedServices && <Check className="w-4 h-4 stroke-[3]" />}
                  </div>
                </div>
              </div>

              {/* Clean Subtle Separator */}
              <div className="py-1 flex items-center">
                <div className="w-full border-t border-outline-variant/40" />
              </div>

              {/* Card 4: Exclusive Option */}
              <div
                id="pref-card-none"
                onClick={selectNoSpecificNeeds}
                className={`p-5 rounded-[24px] cursor-pointer transition-colors border select-none ${
                  travelNeeds.noSpecificNeeds
                    ? 'border-2 border-primary-container bg-primary-fixed'
                    : 'bg-surface-container-lowest border-outline-variant hover:border-primary/50'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 pr-2">
                    <h2 className="text-[1.125rem] font-semibold text-on-surface">No specific needs</h2>
                    <p className="text-sm text-on-surface-variant leading-relaxed">
                      Standard route options are fine
                    </p>
                  </div>
                  <div
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                      travelNeeds.noSpecificNeeds
                        ? 'border-primary-container bg-primary-container text-on-primary'
                        : 'border-outline-variant'
                    }`}
                  >
                    {travelNeeds.noSpecificNeeds && <Check className="w-4 h-4 stroke-[3]" />}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* STEP 2: TRAVEL MODE */}
        {step === 3 && (
          <section className="space-y-4 animate-in fade-in duration-200">
            <div>
              <h1 className="text-[2rem] leading-[1.1] font-bold tracking-[-0.025em] text-on-surface text-balance">
                How do you prefer to travel?
              </h1>
              <p className="text-[1.0625rem] text-on-surface-variant mt-2">
                We can still suggest another mode when your preferred option is disrupted.
              </p>
            </div>

            <div className="space-y-3 pt-1">
              <p className="text-xs font-semibold text-on-surface-variant">Select all modes you are comfortable using.</p>
              {([
                { key: 'rail' as const, label: 'MRT / LRT', description: 'Rail for longer and high-frequency sections', Icon: TrainFront },
                { key: 'bus' as const, label: 'Bus', description: 'Street-level services and neighbourhood links', Icon: BusFront },
                { key: 'walking' as const, label: 'Walking', description: 'Walking connections between stops and stations', Icon: Footprints },
                { key: 'cycling' as const, label: 'Cycling', description: 'Suggest bike-and-ride only when conditions make it worthwhile', Icon: Bike },
              ]).map(({ key, label, description, Icon }) => (
                <button
                  id={`mode-option-${key}`}
                  key={key}
                  type="button"
                  onClick={() => toggleTransportMode(key)}
                  className={`w-full p-3.5 rounded-2xl card-shadow border cursor-pointer select-none transition-all flex items-center justify-between text-left ${
                    transportModes[key]
                      ? 'border-2 border-primary-container bg-primary-fixed'
                      : 'bg-surface-container-lowest border-outline-variant hover:border-primary/50'
                  }`}
                >
                  <span className="flex items-start gap-3 pr-3">
                    <span className="w-12 h-12 rounded-2xl bg-surface-container-lowest border border-outline-variant/60 text-primary flex items-center justify-center shrink-0">
                      <Icon className="w-5 h-5" />
                    </span>
                    <span>
                      <span className="block text-[1.0625rem] font-semibold text-on-surface">{label}</span>
                      <span className="block text-sm text-on-surface-variant mt-0.5">{description}</span>
                    </span>
                  </span>
                  <span className={`w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 ${
                    transportModes[key]
                      ? 'border-primary-container bg-primary-container text-on-primary'
                      : 'border-outline-variant'
                  }`}>
                    {transportModes[key] && <Check className="w-4 h-4 stroke-[3]" />}
                  </span>
                </button>
              ))}

              {transportModes.cycling && (
                <div className="rounded-2xl border border-primary-container/35 bg-surface-container-lowest overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setCyclingExpanded((value) => !value)}
                    className="w-full p-4 flex items-center justify-between text-left cursor-pointer"
                  >
                    <span>
                      <span className="block text-sm font-bold text-on-surface">Cycling preferences</span>
                      <span className="block text-[13px] text-on-surface-variant mt-0.5">Controls when cycling becomes a recommendation</span>
                    </span>
                    <ChevronDown className={`w-4 h-4 text-primary transition-transform ${cyclingExpanded ? 'rotate-180' : ''}`} />
                  </button>

                  {cyclingExpanded && (
                    <div className="px-4 pb-4 space-y-4 border-t border-outline-variant/25 pt-3">
                      <div>
                        <div className="text-xs font-bold text-on-surface mb-2">Suggest cycling when</div>
                        <div className="space-y-2">
                          {([
                            ['busesCrowded', 'Buses are crowded'],
                            ['crowdedInterchange', 'It avoids a crowded interchange'],
                            ['longBusWait', 'Bus waiting time is unusually long'],
                            ['disruptionReliability', 'Cycling is more reliable during disruption'],
                          ] as const).map(([key, label]) => (
                            <label key={key} className="flex items-center gap-2.5 text-xs text-on-surface cursor-pointer">
                              <input type="checkbox" checked={cyclingPreferences.suggestWhen[key]} onChange={() => toggleCyclingSuggestWhen(key)} className="accent-primary w-5 h-5" />
                              {label}
                            </label>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs font-bold text-on-surface mb-2">Maximum extra travel time</div>
                        <div className="grid grid-cols-3 gap-1.5">
                          {([5, 10, 15, 20, null] as const).map((minutes) => (
                            <button key={minutes ?? 'none'} type="button" onClick={() => setCyclingPreferences((prev) => ({ ...prev, maxExtraMinutes: minutes }))} className={`py-2 rounded-lg text-[13px] font-semibold cursor-pointer ${cyclingPreferences.maxExtraMinutes === minutes ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>
                              {minutes === null ? 'No limit' : `${minutes} min`}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs font-bold text-on-surface mb-2">Avoid cycling when</div>
                        <div className="space-y-2">
                          {([
                            ['heavyRain', 'Heavy rain / poor weather'],
                            ['poorInfrastructure', 'Poor cycling infrastructure'],
                            ['noBikeParking', 'No suitable bicycle parking'],
                            ['routeTooLong', 'Route is too long'],
                          ] as const).map(([key, label]) => (
                            <label key={key} className="flex items-center gap-2.5 text-xs text-on-surface cursor-pointer">
                              <input type="checkbox" checked={cyclingPreferences.avoidWhen[key]} onChange={() => toggleCyclingAvoidWhen(key)} className="accent-primary w-5 h-5" />
                              {label}
                            </label>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs font-bold text-on-surface mb-2">Bike behaviour</div>
                        <div className="grid grid-cols-2 gap-2">
                          {([
                            ['park', 'Park at station'],
                            ['foldable', 'Bring foldable bicycle'],
                          ] as const).map(([value, label]) => (
                            <button key={value} type="button" onClick={() => setCyclingPreferences((prev) => ({ ...prev, bikeAtStation: value }))} className={`py-2.5 px-2 rounded-xl text-xs font-semibold cursor-pointer ${cyclingPreferences.bikeAtStation === value ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Reassurance Info Banner */}
              <div className="mt-4 p-3.5 rounded-2xl bg-secondary-fixed/40 border border-secondary-container/40 flex items-start gap-3">
                <div className="w-7 h-7 rounded-xl bg-secondary-fixed flex items-center justify-center shrink-0 text-on-secondary-fixed-variant mt-0.5">
                  <Info className="w-4 h-4" />
                </div>
                <p className="text-xs text-on-secondary-fixed-variant leading-relaxed">
                  Cycling stays conditional: selecting it makes bike-and-ride eligible, but comfort and live conditions decide whether it is recommended.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* STEP 3: ROUTE PRIORITIES */}
        {step === 4 && (
          <section className="space-y-4 animate-in fade-in duration-200">
            <div>
              <div className="flex items-center justify-end mb-1">
                <span
                  className={`text-[13px] font-semibold px-2.5 py-0.5 rounded-full ${
                    priorities.includes('no_preference')
                      ? 'bg-secondary-fixed text-on-secondary-fixed-variant ring-1 ring-primary-container/20'
                      : priorities.length === 2
                      ? 'bg-secondary-fixed text-on-secondary-fixed-variant ring-1 ring-primary-container/20'
                      : 'bg-surface-container-high text-on-surface-variant'
                  }`}
                >
                  {priorities.includes('no_preference')
                    ? 'No preference selected'
                    : `${priorities.length} of 2 selected`}
                </span>
              </div>
              <h1 className="text-[2rem] leading-[1.1] font-bold tracking-[-0.025em] text-on-surface text-balance">
                What matters most when choosing a route?
              </h1>
              <div className="flex items-center justify-between mt-1">
                <p className="text-[1.0625rem] text-on-surface-variant">Choose up to two.</p>
                {showLimitWarning && (
                  <span className="text-xs font-semibold text-error animate-pulse">
                    Maximum 2 options selected
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-2.5 pt-1">
              {/* Option 1: Shorter travel time */}
              <div
                id="priority-card-time"
                onClick={() => togglePriority('time')}
                className={`p-3.5 rounded-2xl card-shadow border cursor-pointer select-none transition-all flex items-center justify-between ${
                  priorities.includes('time')
                    ? 'border-2 border-primary-container bg-primary-fixed'
                    : 'bg-surface-container-lowest border-outline-variant hover:border-primary/50'
                }`}
              >
                <div className="flex items-start gap-3 pr-2">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                      priorities.includes('time')
                        ? 'bg-secondary-fixed text-primary-container'
                        : 'bg-surface-container text-on-surface-variant'
                    }`}
                  >
                    <Clock className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-[1.0625rem] font-semibold text-on-surface">Shorter travel time</h3>
                    <p className="text-sm text-on-surface-variant mt-0.5">Get there as fast as possible</p>
                  </div>
                </div>
                <div
                  className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    priorities.includes('time')
                      ? 'border-primary-container bg-primary-container text-on-primary'
                      : 'border-outline-variant'
                  }`}
                >
                  {priorities.includes('time') && <Check className="w-4 h-4 stroke-[3]" />}
                </div>
              </div>

              {/* Option 2: Less walking */}
              <div
                id="priority-card-walk"
                onClick={() => togglePriority('walk')}
                className={`p-3.5 rounded-2xl card-shadow border cursor-pointer select-none transition-all flex items-center justify-between ${
                  priorities.includes('walk')
                    ? 'border-2 border-primary-container bg-primary-fixed'
                    : 'bg-surface-container-lowest border-outline-variant hover:border-primary/50'
                }`}
              >
                <div className="flex items-start gap-3 pr-2">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                      priorities.includes('walk')
                        ? 'bg-secondary-fixed text-primary-container'
                        : 'bg-surface-container text-on-surface-variant'
                    }`}
                  >
                    <Footprints className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-[1.0625rem] font-semibold text-on-surface">Less walking</h3>
                    <p className="text-sm text-on-surface-variant mt-0.5">
                      Fewer metres between transfers and exits
                    </p>
                  </div>
                </div>
                <div
                  className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    priorities.includes('walk')
                      ? 'border-primary-container bg-primary-container text-on-primary'
                      : 'border-outline-variant'
                  }`}
                >
                  {priorities.includes('walk') && <Check className="w-4 h-4 stroke-[3]" />}
                </div>
              </div>

              {/* Option 3: Fewer transfers */}
              <div
                id="priority-card-transfer"
                onClick={() => togglePriority('transfer')}
                className={`p-3.5 rounded-2xl card-shadow border cursor-pointer select-none transition-all flex items-center justify-between ${
                  priorities.includes('transfer')
                    ? 'border-2 border-primary-container bg-primary-fixed'
                    : 'bg-surface-container-lowest border-outline-variant hover:border-primary/50'
                }`}
              >
                <div className="flex items-start gap-3 pr-2">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                      priorities.includes('transfer')
                        ? 'bg-secondary-fixed text-primary-container'
                        : 'bg-surface-container text-on-surface-variant'
                    }`}
                  >
                    <Shuffle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-[1.0625rem] font-semibold text-on-surface">Fewer transfers</h3>
                    <p className="text-sm text-on-surface-variant mt-0.5">
                      Direct journeys with minimal line changes
                    </p>
                  </div>
                </div>
                <div
                  className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    priorities.includes('transfer')
                      ? 'border-primary-container bg-primary-container text-on-primary'
                      : 'border-outline-variant'
                  }`}
                >
                  {priorities.includes('transfer') && <Check className="w-4 h-4 stroke-[3]" />}
                </div>
              </div>

              {/* Option 4: Lower fare */}
              <div
                id="priority-card-fare"
                onClick={() => togglePriority('fare')}
                className={`p-3.5 rounded-2xl card-shadow border cursor-pointer select-none transition-all flex items-center justify-between ${
                  priorities.includes('fare')
                    ? 'border-2 border-primary-container bg-primary-fixed'
                    : 'bg-surface-container-lowest border-outline-variant hover:border-primary/50'
                }`}
              >
                <div className="flex items-start gap-3 pr-2">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                      priorities.includes('fare')
                        ? 'bg-secondary-fixed text-primary-container'
                        : 'bg-surface-container text-on-surface-variant'
                    }`}
                  >
                    <CreditCard className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-[1.0625rem] font-semibold text-on-surface">Lower fare</h3>
                    <p className="text-sm text-on-surface-variant mt-0.5">
                      Economical route combinations
                    </p>
                  </div>
                </div>
                <div
                  className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    priorities.includes('fare')
                      ? 'border-primary-container bg-primary-container text-on-primary'
                      : 'border-outline-variant'
                  }`}
                >
                  {priorities.includes('fare') && <Check className="w-4 h-4 stroke-[3]" />}
                </div>
              </div>

              {/* Option 5: Less crowding */}
              <div
                id="priority-card-crowd"
                onClick={() => togglePriority('crowd')}
                className={`p-3.5 rounded-2xl card-shadow border cursor-pointer select-none transition-all flex items-center justify-between ${
                  priorities.includes('crowd')
                    ? 'border-2 border-primary-container bg-primary-fixed'
                    : 'bg-surface-container-lowest border-outline-variant hover:border-primary/50'
                }`}
              >
                <div className="flex items-start gap-3 pr-2">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                      priorities.includes('crowd')
                        ? 'bg-secondary-fixed text-primary-container'
                        : 'bg-surface-container text-on-surface-variant'
                    }`}
                  >
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-[1.0625rem] font-semibold text-on-surface">Less crowding</h3>
                    <p className="text-sm text-on-surface-variant mt-0.5">
                      Comfortable seating or lighter cabins
                    </p>
                  </div>
                </div>
                <div
                  className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    priorities.includes('crowd')
                      ? 'border-primary-container bg-primary-container text-on-primary'
                      : 'border-outline-variant'
                  }`}
                >
                  {priorities.includes('crowd') && <Check className="w-4 h-4 stroke-[3]" />}
                </div>
              </div>

              {/* Option 6: No preference (mutually exclusive with specific priorities) */}
              <div
                id="priority-card-no-preference"
                onClick={() => togglePriority('no_preference')}
                className={`p-3.5 rounded-2xl card-shadow border cursor-pointer select-none transition-all flex items-center justify-between ${
                  priorities.includes('no_preference')
                    ? 'border-2 border-primary-container bg-primary-fixed'
                    : 'bg-surface-container-lowest border-outline-variant hover:border-primary/50'
                }`}
              >
                <div className="flex items-start gap-3 pr-2">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                      priorities.includes('no_preference')
                        ? 'bg-secondary-fixed text-primary-container'
                        : 'bg-surface-container text-on-surface-variant'
                    }`}
                  >
                    <Shuffle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-[1.0625rem] font-semibold text-on-surface">No preference</h3>
                    <p className="text-sm text-on-surface-variant mt-0.5">
                      Balanced recommendations based on standard network conditions
                    </p>
                  </div>
                </div>
                <div
                  className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    priorities.includes('no_preference')
                      ? 'border-primary-container bg-primary-container text-on-primary'
                      : 'border-outline-variant'
                  }`}
                >
                  {priorities.includes('no_preference') && <Check className="w-4 h-4 stroke-[3]" />}
                </div>
              </div>

              {/* Information Callout */}
              <div className="mt-3 p-3 bg-secondary-fixed/40 rounded-xl flex items-start gap-2.5">
                <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <p className="text-xs text-on-secondary-fixed-variant leading-relaxed">
                  You can update routing priorities anytime in <strong>Profile &gt; Route preferences</strong>.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* STEP 4: PERSONALISATION & LEARNING CONTROLS */}
        {step === 5 && (
          <section className="space-y-4 animate-in fade-in duration-200">
            <div>
              <h1 className="text-[2rem] leading-[1.1] font-bold tracking-[-0.025em] text-on-surface text-balance">
                Keep your journeys personalised
              </h1>
              <p className="text-[1.0625rem] text-on-surface-variant mt-2 leading-relaxed">
                Your suggestions can improve as you use the app. You can change or reset this anytime.
              </p>
            </div>

            <div className="space-y-3 pt-1">
              {/* Toggle Card 1: Route choices */}
              <div
                id="toggle-card-learning-routes"
                onClick={() =>
                  setLearningPrefs((prev) => ({
                    ...prev,
                    learnRouteChoices: !prev.learnRouteChoices,
                  }))
                }
                className="bg-surface-container-lowest card-shadow rounded-2xl p-4 border border-outline-variant/30 flex items-start justify-between gap-4 cursor-pointer select-none active:scale-[0.99] transition-all"
              >
                <div className="space-y-1 flex-1 pr-1">
                  <h3 className="text-[1.0625rem] font-semibold text-on-surface leading-snug">
                    Learn from my route choices and arrival checks
                  </h3>
                  <p className="text-sm text-on-surface-variant leading-relaxed">
                    Adapts recommendations based on transit options you frequently select.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={learningPrefs.learnRouteChoices}
                  className={`w-[51px] h-[31px] rounded-full p-[2px] transition-colors duration-200 ease-in-out relative shrink-0 focus:outline-none focus:ring-2 focus:ring-primary-container ${
                    learningPrefs.learnRouteChoices ? 'bg-primary-container' : 'bg-outline-variant'
                  }`}
                >
                  <span
                    className={`w-[27px] h-[27px] bg-surface-container-lowest rounded-full block shadow-md transform transition-transform duration-200 ease-in-out pointer-events-none ${
                      learningPrefs.learnRouteChoices ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Toggle Card 2: Suggest routines */}
              <div
                id="toggle-card-learning-routines"
                onClick={() =>
                  setLearningPrefs((prev) => ({
                    ...prev,
                    suggestRoutines: !prev.suggestRoutines,
                  }))
                }
                className="bg-surface-container-lowest card-shadow rounded-2xl p-4 border border-outline-variant/30 flex items-start justify-between gap-4 cursor-pointer select-none active:scale-[0.99] transition-all"
              >
                <div className="space-y-1 flex-1 pr-1">
                  <h3 className="text-[1.0625rem] font-semibold text-on-surface leading-snug">
                    Suggest routines when a pattern appears
                  </h3>
                  <p className="text-sm text-on-surface-variant leading-relaxed">
                    Surfaces arrival times and disruption alerts for your regular morning or evening commutes.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={learningPrefs.suggestRoutines}
                  className={`w-[51px] h-[31px] rounded-full p-[2px] transition-colors duration-200 ease-in-out relative shrink-0 focus:outline-none focus:ring-2 focus:ring-primary-container ${
                    learningPrefs.suggestRoutines ? 'bg-primary-container' : 'bg-outline-variant'
                  }`}
                >
                  <span
                    className={`w-[27px] h-[27px] bg-surface-container-lowest rounded-full block shadow-md transform transition-transform duration-200 ease-in-out pointer-events-none ${
                      learningPrefs.suggestRoutines ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Privacy Note Container */}
              <div className="bg-surface-container rounded-2xl p-4 flex items-start gap-3 border border-outline-variant/30 mt-3">
                <div className="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center shrink-0 text-secondary mt-0.5">
                  <Shield className="w-4 h-4" />
                </div>
                <p className="text-sm text-on-surface-variant leading-relaxed">
                  Stored securely on your device. We never sell your location or commute patterns. Not tied to system tracking.
                </p>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* Bottom Sticky Action Footer */}
      <footer className="w-full bg-surface px-5 pt-3 pb-6 shrink-0 border-t border-outline-variant/30 flex flex-col items-center gap-2 z-30">
        <p className="text-[0.9375rem] text-on-surface-variant text-center">
          {step === 5
            ? 'You can adjust learning settings anytime in Profile.'
            : 'You can change these anytime in Profile & Settings.'}
        </p>

        {step < 5 ? (
          <button
            id="onboarding-continue-button"
            type="button"
            disabled={!isCurrentStepValid()}
            onClick={handleContinue}
            className={`w-full min-h-14 rounded-2xl text-[1.125rem] font-semibold transition-all flex items-center justify-center gap-2 ${
              isCurrentStepValid()
                ? 'bg-primary-container text-on-primary hover:bg-primary active:scale-[0.98] cursor-pointer'
                : 'bg-surface-container-high text-outline cursor-not-allowed opacity-60 shadow-none'
            }`}
          >
            <span>Continue</span>
            <ArrowRight className="w-5 h-5" />
          </button>
        ) : (
          <button
            id="onboarding-start-exploring-button"
            type="button"
            onClick={handleFinish}
            className="w-full min-h-14 rounded-2xl bg-primary-container text-on-primary text-[1.125rem] font-semibold hover:bg-primary active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <span>Start exploring</span>
            <ArrowRight className="w-5 h-5" />
          </button>
        )}

        {/* iOS Home Indicator */}
        <div className="w-32 h-1 bg-on-surface/20 rounded-full mt-1" />
      </footer>
    </div>
  );
};
