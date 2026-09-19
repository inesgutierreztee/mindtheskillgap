import React, { useState, useEffect } from 'react';
import {
  TabType,
  UserPreferences,
  TravelNeeds,
  LearningPreferences,
  NotificationPreferences,
  CommuteRoutine,
  RouteOption,
  DisruptionAlert,
  LiveTransportCondition,
  BusStop,
  TrainStation,
  LineSummary,
  CommuterPersona,
  RachelScenario,
  ArjunScenario,
  MdmLimScenario,
} from './types';
import {
  DEFAULT_TRAVEL_NEEDS,
  DEFAULT_USER_PREFERENCES,
  DEFAULT_LEARNING_PREFERENCES,
  DEFAULT_NOTIFICATION_PREFERENCES,
  DEFAULT_DETECTED_ROUTINE,
  MOCK_BUS_STOPS,
  MOCK_TRAIN_STATIONS,
  MOCK_LIVE_CONDITIONS,
  MOCK_ROUTES_KENT_RIDGE_TO_BUGIS,
} from './data/mockTransportData';
import {
  fetchBusStops,
  fetchTrainStatusFull,
  fetchNearbyLiveConditions,
  fetchDisruptions,
  fetchLtaStatus,
  getSingaporeTime,
} from './services/ltaService';
import { fetchWeather, WeatherInfo } from './services/weatherService';
import { TopAppBar } from './components/TopAppBar';
import { DominantHandProvider } from './context/DominantHandContext';
import { BottomNavigation } from './components/BottomNavigation';
import { OnboardingQuizScreen } from './screens/OnboardingQuizScreen';
import { HomeScreen } from './screens/HomeScreen';
import { RachelHomeScreen, RachelNotification } from './screens/RachelHomeScreen';
import { ArjunHomeScreen } from './screens/ArjunHomeScreen';
import { MdmLimHomeScreen } from './screens/MdmLimHomeScreen';
import { PersonaJudgingPanel } from './components/PersonaJudgingPanel';
import { PlanSearchCard } from './components/PlanSearchCard';
import { NearbyLiveTransit } from './components/NearbyLiveTransit';
import { MapScreen } from './screens/MapScreen';
import { AlertsScreen } from './screens/AlertsScreen';
import { MoreScreen } from './screens/MoreScreen';
import { JourneyPlannerScreen } from './screens/JourneyPlannerScreen';
import { JourneyGuidanceScreen } from './screens/JourneyGuidanceScreen';
import { RoutineConfirmationModal } from './screens/RoutineConfirmationModal';
import { EditRoutineModal } from './screens/EditRoutineModal';
import { recordFamiliarRoute } from './utils/routeFamiliarity';

type AppView = 'onboarding' | 'main' | 'planner' | 'guidance';

const PERSONA_JOURNEY_START_COORDINATES: Record<CommuterPersona, { lat: number; lng: number }> = {
  // Nearby Transit follows the place each person actually begins their usual
  // journey, rather than a broad neighbourhood centroid.
  rachel: { lat: 1.3526, lng: 103.9452 }, // Tampines MRT
  arjun: { lat: 1.405413, lng: 103.89682 }, // Blk 261 Punggol Way / Soo Teck LRT
  mdmlim: { lat: 1.331313, lng: 103.9253 }, // Blk 539 Bedok North St 3
};

// Saved routine defaults match the regular trip shown for each persona.
const PERSONA_ROUTINES: Record<CommuterPersona, CommuteRoutine[]> = {
  rachel: [{
    id: 'rachel-tampines-raffles-place', boardingName: 'Tampines MRT',
    boardingDesc: 'East-West Line · towards Tuas Link', serviceName: 'EWL',
    serviceRoute: 'Tampines → Raffles Place → Marina Bay Financial Centre',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], fromTime: '7:40 am', toTime: '8:45 am', isConfirmed: true, isDismissed: false,
  }],
  arjun: [{
    id: 'arjun-soo-teck-one-north', boardingName: 'Soo Teck LRT',
    boardingDesc: 'Beside Blk 261 Punggol Way', serviceName: 'LRT + NEL + CCL',
    serviceRoute: 'Soo Teck → Sengkang → HarbourFront → one-north',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], fromTime: '8:00 am', toTime: '9:00 am', isConfirmed: true, isDismissed: false,
  }],
  mdmlim: [{
    id: 'mdmlim-bedok-sgh', boardingName: 'Bedok MRT',
    boardingDesc: 'From Blk 539 Bedok North Street 3', serviceName: 'EWL',
    serviceRoute: 'Bedok → Outram Park → Singapore General Hospital',
    days: ['Thu'], fromTime: '9:15 am', toTime: '10:00 am', isConfirmed: true, isDismissed: false,
  }],
};

const routinesForPersona = (persona: CommuterPersona | null) => persona ? PERSONA_ROUTINES[persona] : [];

export default function App() {
  // PERSISTENT STORAGE KEYS
  const STORAGE_KEY_PREFS = 'sg_transit_user_preferences';
  const STORAGE_KEY_NEEDS = 'sg_transit_travel_needs';
  const STORAGE_KEY_LEARN = 'sg_transit_learning_preferences';
  const STORAGE_KEY_NOTIF = 'sg_transit_notification_preferences';
  const STORAGE_KEY_ROUTINE = 'sg_transit_commute_routine';
  const STORAGE_KEY_QUIZ_DONE = 'sg_transit_quiz_done';
  const STORAGE_KEY_PERSONA = 'sg_transit_persona';
  const STORAGE_KEY_ACTIVE_JOURNEY = 'sg_transit_active_journey';

  // 1. Initial State from localStorage or Defaults
  const [hasCompletedQuiz, setHasCompletedQuiz] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_QUIZ_DONE) === 'true';
    } catch {
      return false;
    }
  });

  const [travelNeeds, setTravelNeeds] = useState<TravelNeeds>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_NEEDS);
      return saved ? JSON.parse(saved) : DEFAULT_TRAVEL_NEEDS;
    } catch {
      return DEFAULT_TRAVEL_NEEDS;
    }
  });

  const [userPreferences, setUserPreferences] = useState<UserPreferences>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_PREFS);
      if (!saved) return DEFAULT_USER_PREFERENCES;
      const parsed = JSON.parse(saved) as Partial<UserPreferences>;
      const savedPersona = localStorage.getItem(STORAGE_KEY_PERSONA);
      const isExistingArjun = savedPersona ? JSON.parse(savedPersona) === 'arjun' : false;
      return {
        ...DEFAULT_USER_PREFERENCES,
        ...parsed,
        priority: parsed.priority || (isExistingArjun ? 'comfort' : DEFAULT_USER_PREFERENCES.priority),
        transportModes: {
          ...DEFAULT_USER_PREFERENCES.transportModes,
          ...(parsed.transportModes || {}),
          cycling: parsed.transportModes?.cycling ?? isExistingArjun,
        },
        cyclingPreferences: {
          ...DEFAULT_USER_PREFERENCES.cyclingPreferences,
          ...(parsed.cyclingPreferences || {}),
          enabled: parsed.cyclingPreferences?.enabled ?? isExistingArjun,
          suggestWhen: {
            ...DEFAULT_USER_PREFERENCES.cyclingPreferences.suggestWhen,
            ...(parsed.cyclingPreferences?.suggestWhen || {}),
          },
          avoidWhen: {
            ...DEFAULT_USER_PREFERENCES.cyclingPreferences.avoidWhen,
            ...(parsed.cyclingPreferences?.avoidWhen || {}),
          },
        },
      };
    } catch {
      return DEFAULT_USER_PREFERENCES;
    }
  });

  const [learningPreferences, setLearningPreferences] = useState<LearningPreferences>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_LEARN);
      return saved ? JSON.parse(saved) : DEFAULT_LEARNING_PREFERENCES;
    } catch {
      return DEFAULT_LEARNING_PREFERENCES;
    }
  });

  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>(
    () => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY_NOTIF);
        return saved ? JSON.parse(saved) : DEFAULT_NOTIFICATION_PREFERENCES;
      } catch {
        return DEFAULT_NOTIFICATION_PREFERENCES;
      }
    }
  );

  const [routines, setRoutines] = useState<CommuteRoutine[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_ROUTINE);
      const savedPersona = localStorage.getItem(STORAGE_KEY_PERSONA);
      const persona = savedPersona ? JSON.parse(savedPersona) as CommuterPersona : null;
      if (!saved) return routinesForPersona(persona);
      const parsed = JSON.parse(saved);
      // Migrate a routine saved before multi-routine support (a single object).
      const savedRoutines = Array.isArray(parsed) ? parsed : [parsed];
      return savedRoutines.some((routine) => routine.id === DEFAULT_DETECTED_ROUTINE.id)
        ? routinesForPersona(persona)
        : savedRoutines;
    } catch {
      return [];
    }
  });

  const [selectedPersona, setSelectedPersona] = useState<CommuterPersona | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_PERSONA);
      return saved ? (JSON.parse(saved) as CommuterPersona) : null;
    } catch {
      return null;
    }
  });

  // Offline resilience: if the app reloads mid-journey with no signal (e.g. the
  // tab was killed underground), resume the same route/step rather than
  // stranding the user back at onboarding or the home tab.
  const savedActiveJourney = (() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_ACTIVE_JOURNEY);
      return saved ? (JSON.parse(saved) as RouteOption) : null;
    } catch {
      return null;
    }
  })();

  // 2. Navigation & View State
  const [currentView, setCurrentView] = useState<AppView>(() => {
    if (!hasCompletedQuiz) return 'onboarding';
    return savedActiveJourney ? 'guidance' : 'main';
  });
  const [activeTab, setActiveTab] = useState<TabType>('home');

  // Active Journey Planning & Guidance State
  const [selectedRoute, setSelectedRoute] = useState<RouteOption>(
    savedActiveJourney || MOCK_ROUTES_KENT_RIDGE_TO_BUGIS[0]
  );
  // Carries Arjun's flexible-departure offset from the planner into guidance,
  // so the ETA shown there stays consistent with what was shown before.
  const [guidanceDepartureOffsetMin, setGuidanceDepartureOffsetMin] = useState(0);
  const [plannerOrigin, setPlannerOrigin] = useState<string>('Kent Ridge MRT');
  const [plannerDestination, setPlannerDestination] = useState<string>('Bugis MRT');

  // Modals
  const [showRoutineConfirmation, setShowRoutineConfirmation] = useState<boolean>(false);
  const [showEditRoutineModal, setShowEditRoutineModal] = useState<boolean>(false);

  // 3. Live Transit Data State
  const [busStops, setBusStops] = useState<BusStop[]>(MOCK_BUS_STOPS);
  const [trainStations, setTrainStations] = useState<TrainStation[]>(MOCK_TRAIN_STATIONS);
  const [liveConditions, setLiveConditions] = useState<LiveTransportCondition[]>(MOCK_LIVE_CONDITIONS);
  // True when LTA confirms real connectivity but genuinely zero active bus
  // services right now (e.g. very late night) - distinct from a data outage.
  const [busesOffService, setBusesOffService] = useState<boolean>(false);
  const [disruption, setDisruption] = useState<DisruptionAlert | null>(null);
  const [singaporeTime, setSingaporeTime] = useState<string>(getSingaporeTime(false));
  const [isRefreshingLive, setIsRefreshingLive] = useState<boolean>(false);
  const [isLiveMode, setIsLiveMode] = useState<boolean>(false);
  const [liveStatusKnown, setLiveStatusKnown] = useState<boolean>(false);
  const [weather, setWeather] = useState<WeatherInfo | null>(null);
  const [lineSummaries, setLineSummaries] = useState<LineSummary[]>([]);

  // Judging-demo scenarios for the redesigned persona homes, and the one-line
  // notification the active home derives for the off-phone preview.
  const [rachelScenario, setRachelScenario] = useState<RachelScenario>('live');
  const [arjunScenario, setArjunScenario] = useState<ArjunScenario>('live');
  const [mdmLimScenario, setMdmLimScenario] = useState<MdmLimScenario>('live');
  const [personaNotification, setPersonaNotification] = useState<RachelNotification | null>(null);

  // Save changes to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_NEEDS, JSON.stringify(travelNeeds));
      localStorage.setItem(STORAGE_KEY_PREFS, JSON.stringify(userPreferences));
      localStorage.setItem(STORAGE_KEY_LEARN, JSON.stringify(learningPreferences));
      localStorage.setItem(STORAGE_KEY_NOTIF, JSON.stringify(notificationPreferences));
      localStorage.setItem(STORAGE_KEY_ROUTINE, JSON.stringify(routines));
      localStorage.setItem(STORAGE_KEY_QUIZ_DONE, String(hasCompletedQuiz));
      localStorage.setItem(STORAGE_KEY_PERSONA, JSON.stringify(selectedPersona));
    } catch (e) {
      console.warn('Could not save to localStorage:', e);
    }
  }, [
    travelNeeds,
    userPreferences,
    learningPreferences,
    notificationPreferences,
    routines,
    hasCompletedQuiz,
    selectedPersona,
  ]);

  // Periodic Singapore Time Clock
  useEffect(() => {
    const timer = setInterval(() => {
      setSingaporeTime(getSingaporeTime(false));
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  // Offline / no-signal strategy: every fetch in this app already falls back to
  // cached or bundled data on failure (see ltaService/weatherService/routingService),
  // so the "degrade gracefully" half of the brief's requirement already holds.
  // What's added here is the other explicitly-permitted half: state the staleness
  // to the user rather than let them think a stale screen is current, and don't
  // strand them mid-journey if the app reloads underground with no signal.
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Judging demo: force the offline state on demand, since real connectivity
  // may well be fine when this gets tested. Session-only, clearly labeled
  // wherever it's toggled - never presented as a real network condition.
  const [simulateOffline, setSimulateOffline] = useState(false);
  const effectiveIsOnline = isOnline && !simulateOffline;
  useEffect(() => {
    if (!isOnline) setSimulateOffline(false);
  }, [isOnline]);

  // Mdm Lim: a real type-scale increase via the root font-size (every Tailwind
  // rem-based size responds to this, including spacing/touch-targets, not just
  // text), rather than the `zoom` CSS property, which has no Firefox support
  // and inconsistent Safari support.
  useEffect(() => {
    document.documentElement.style.fontSize = userPreferences.largeText ? '115%' : '';
    return () => {
      document.documentElement.style.fontSize = '';
    };
  }, [userPreferences.largeText]);

  // Persist (or clear) the in-progress journey so a reload can resume it.
  useEffect(() => {
    try {
      if (currentView === 'guidance') {
        localStorage.setItem(STORAGE_KEY_ACTIVE_JOURNEY, JSON.stringify(selectedRoute));
      } else {
        localStorage.removeItem(STORAGE_KEY_ACTIVE_JOURNEY);
      }
    } catch (e) {
      console.warn('Could not persist active journey:', e);
    }
  }, [currentView, selectedRoute]);

  // Fetch initial live data
  const loadLiveData = async () => {
    setIsRefreshingLive(true);
    try {
      const journeyStart = selectedPersona ? PERSONA_JOURNEY_START_COORDINATES[selectedPersona] : undefined;
      const [status, stops, trainStatus, live, disr, weatherInfo] = await Promise.all([
        fetchLtaStatus(),
        fetchBusStops(),
        fetchTrainStatusFull(),
        fetchNearbyLiveConditions(journeyStart?.lat, journeyStart?.lng),
        fetchDisruptions(false),
        fetchWeather(),
      ]);
      setIsLiveMode(status.liveMode);
      setLiveStatusKnown(true);
      if (stops?.length) setBusStops(stops);
      if (trainStatus?.stations?.length) setTrainStations(trainStatus.stations);
      if (trainStatus?.lines?.length) setLineSummaries(trainStatus.lines);
      if (live) {
        setLiveConditions(live.items || []);
        setBusesOffService(Boolean(live.busesOffService));
      }
      // A successful live refresh must also clear a previously active alert.
      // Demo/replay scenarios are controlled separately by the labelled persona controls.
      setDisruption(disr?.disruptions?.[0] ?? null);
      setWeather(weatherInfo);
    } catch (err) {
      console.warn('Error loading live transit feeds:', err);
    } finally {
      setIsRefreshingLive(false);
    }
  };

  useEffect(() => {
    loadLiveData();
  }, [selectedPersona]);

  // Onboarding Handlers
  const handleCompleteQuiz = (results: {
    persona: CommuterPersona;
    needs: TravelNeeds;
    travelMode: UserPreferences['travelMode'];
    priorities: UserPreferences['priorities'];
    priority: UserPreferences['priority'];
    transportModes: UserPreferences['transportModes'];
    cyclingPreferences: UserPreferences['cyclingPreferences'];
    learning: LearningPreferences;
  }) => {
    setTravelNeeds(results.needs);
    // Persona-specific behavior that isn't captured by the visible quiz steps:
    // Rachel only wants interruption for significant delays; Mdm Lim needs larger
    // type; Arjun has a flexible ~60 min departure window rather than "now only".
    const alertThresholdMin = results.persona === 'rachel' ? 15 : undefined;
    const largeText = results.persona === 'mdmlim';
    const flexibleDeparture = results.persona === 'arjun';

    const updatedPrefs: UserPreferences = {
      ...userPreferences,
      travelMode: results.travelMode,
      priorities: results.priorities,
      priority: results.priority,
      transportModes: results.transportModes,
      cyclingPreferences: results.cyclingPreferences,
      stepFreeAccess: results.needs.stepFreeAccess,
      lessWalking: results.needs.shortWalkingDistances,
      lessCrowded: results.needs.avoidCrowdedServices,
      alertThresholdMin,
      largeText,
      flexibleDeparture,
    };
    setUserPreferences(updatedPrefs);
    setLearningPreferences(results.learning);
    setRoutines(routinesForPersona(results.persona));
    setSelectedPersona(results.persona);
    setHasCompletedQuiz(true);
    setCurrentView('main');

    try {
      localStorage.setItem(STORAGE_KEY_NEEDS, JSON.stringify(results.needs));
      localStorage.setItem(STORAGE_KEY_PREFS, JSON.stringify(updatedPrefs));
      localStorage.setItem(STORAGE_KEY_LEARN, JSON.stringify(results.learning));
      localStorage.setItem(STORAGE_KEY_QUIZ_DONE, 'true');
      localStorage.setItem(STORAGE_KEY_PERSONA, JSON.stringify(results.persona));
    } catch (e) {
      console.warn('Could not save quiz answers to localStorage:', e);
    }
  };

  // Routine Handlers - supports any number of saved routines, not just one.
  const handleConfirmRoutine = (confirmedRoutine: CommuteRoutine) => {
    setRoutines((prev) =>
      prev.map((r) =>
        r.id === confirmedRoutine.id ? { ...confirmedRoutine, isConfirmed: true, isDismissed: false } : r
      )
    );
    setShowRoutineConfirmation(false);
  };

  const handleDismissRoutine = (dismissedRoutine: CommuteRoutine) => {
    setRoutines((prev) =>
      prev.map((r) =>
        r.id === dismissedRoutine.id ? { ...dismissedRoutine, isConfirmed: false, isDismissed: true } : r
      )
    );
    setShowRoutineConfirmation(false);
  };

  // Appends a new routine if its id isn't already saved, otherwise replaces
  // the matching one - so this one handler covers both "add" and "edit".
  const handleUpdateRoutine = (updatedRoutine: CommuteRoutine) => {
    setRoutines((prev) => {
      const exists = prev.some((r) => r.id === updatedRoutine.id);
      return exists ? prev.map((r) => (r.id === updatedRoutine.id ? updatedRoutine : r)) : [...prev, updatedRoutine];
    });
  };

  const handleDeleteRoutine = (id: string) => {
    setRoutines((prev) => prev.filter((r) => r.id !== id));
  };

  const createBlankRoutine = (): CommuteRoutine => ({
    id: `routine-${Date.now()}`,
    boardingName: '',
    boardingDesc: '',
    serviceName: '',
    serviceRoute: '',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    fromTime: '8:00 am',
    toTime: '8:30 am',
    isConfirmed: false,
    isDismissed: false,
  });

  // Which routine the confirmation/edit modals are currently acting on.
  const [confirmingRoutine, setConfirmingRoutine] = useState<CommuteRoutine | null>(null);
  const [editingRoutine, setEditingRoutine] = useState<CommuteRoutine | null>(null);

  const handleOpenRoutineConfirmation = (r: CommuteRoutine) => {
    setConfirmingRoutine(r);
    setShowRoutineConfirmation(true);
  };

  const handleOpenEditRoutine = (r: CommuteRoutine) => {
    setEditingRoutine(r);
    setShowEditRoutineModal(true);
  };

  const handleAddRoutine = () => {
    setEditingRoutine(createBlankRoutine());
    setShowEditRoutineModal(true);
  };

  // Rachel: only surface the proactive disruption banner for delays at/above her
  // threshold; below it, the disruption still exists and still informs routing,
  // it's just not worth interrupting her for. Other personas see every alert.
  const visibleDisruption = React.useMemo(() => {
    if (!disruption) return null;
    const threshold = userPreferences.alertThresholdMin;
    if (threshold && disruption.delayEstimateMin < threshold) return null;
    return disruption;
  }, [disruption, userPreferences.alertThresholdMin]);

  // Navigation Handlers
  const handlePlanTrip = (orig = 'Kent Ridge MRT', dest = 'Bugis MRT') => {
    setPlannerOrigin(orig);
    setPlannerDestination(dest);
    setCurrentView('planner');
  };

  const handleStartGuidance = (routeToGuide?: RouteOption, departureOffsetMin = 0) => {
    if (routeToGuide) {
      setSelectedRoute(routeToGuide);
      recordFamiliarRoute(routeToGuide);
    }
    setGuidanceDepartureOffsetMin(departureOffsetMin);
    setCurrentView('guidance');
  };

  const handleResetAll = () => {
    setTravelNeeds(DEFAULT_TRAVEL_NEEDS);
    setUserPreferences(DEFAULT_USER_PREFERENCES);
    setLearningPreferences(DEFAULT_LEARNING_PREFERENCES);
    setNotificationPreferences(DEFAULT_NOTIFICATION_PREFERENCES);
    setRoutines([DEFAULT_DETECTED_ROUTINE]);
    setHasCompletedQuiz(false);
    setCurrentView('onboarding');
    localStorage.clear();
  };

  // ROUTE 1: ONBOARDING QUIZ VIEW (Navigation hidden during quiz)
  if (currentView === 'onboarding') {
    return (
      <DominantHandProvider value={userPreferences.dominantHand ?? 'off'}>
      <div className={`flex justify-center bg-surface-container-high h-[100dvh] h-screen text-on-surface antialiased font-sans overflow-hidden theme-teal`}>
        <main
          id="app-mobile-frame"
          className="w-full max-w-[430px] h-full bg-surface flex flex-col shadow-2xl overflow-hidden relative"
        >
          {!effectiveIsOnline && (
            <div className="w-full bg-amber-600 text-white text-[11px] font-semibold text-center py-1.5 shrink-0">
              {isOnline ? 'Simulated offline (demo)' : "You're offline"} — showing last-known data
            </div>
          )}
          <OnboardingQuizScreen
            initialPersona={selectedPersona}
            initialNeeds={hasCompletedQuiz ? travelNeeds : undefined}
            initialMode={hasCompletedQuiz ? userPreferences.travelMode : null}
            initialPriorities={hasCompletedQuiz ? userPreferences.priorities : []}
            initialLearning={learningPreferences}
            initialTransportModes={userPreferences.transportModes}
            initialCyclingPreferences={userPreferences.cyclingPreferences}
            onComplete={handleCompleteQuiz}
          />
        </main>
      </div>
      </DominantHandProvider>
    );
  }

  const isRachel = selectedPersona === 'rachel';
  const isArjun = selectedPersona === 'arjun';
  const isMdmLim = selectedPersona === 'mdmlim';
  const hasRedesignedHome = isRachel || isArjun || isMdmLim;
  const showPersonaNotification = activeTab === 'home' && currentView === 'main' ? personaNotification : null;
  const openPersonaHome = () => {
    setActiveTab('home');
    setCurrentView('main');
  };

  // ALL OTHER VIEWS: Render within the main shell with the global pinned BottomNavigation bar
  return (
    <DominantHandProvider value={userPreferences.dominantHand ?? 'off'}>
    <div className={`flex justify-center bg-surface-container-high h-[100dvh] h-screen overflow-hidden text-on-surface antialiased font-sans theme-teal`}>
      {isRachel && (
        <PersonaJudgingPanel<RachelScenario>
          scenarios={[
            { id: 'live', label: 'Live now' },
            { id: 'routine', label: 'Routine morning' },
            { id: 'active', label: 'Active journey' },
            { id: 'rain', label: 'Rain disruption' },
            { id: 'reroute', label: 'Recommended reroute' },
          ]}
          scenario={rachelScenario}
          onChangeScenario={(next) => {
            setRachelScenario(next);
            openPersonaHome();
          }}
          caption="Scenarios pin a demo clock (7:20 am, or her 7:40 departure for an active journey) and, for rain, simulated weather. Both are labelled inside the app."
          notification={showPersonaNotification}
          notificationTime={rachelScenario === 'live' ? singaporeTime : rachelScenario === 'active' ? '7:40 am' : '7:20 am'}
        />
      )}
      {isArjun && (
        <PersonaJudgingPanel<ArjunScenario>
          scenarios={[
            { id: 'live', label: 'Live now' },
            { id: 'normal', label: 'Normal day' },
            { id: 'crowd', label: 'Crowd increasing' },
            { id: 'rain', label: 'Heavy rain' },
          ]}
          scenario={arjunScenario}
          onChangeScenario={(next) => {
            setArjunScenario(next);
            openPersonaHome();
          }}
          caption="Scenarios pin an 8:02 am demo clock and simulate crowding or heavy rain. Each is labelled inside the app."
          notification={showPersonaNotification}
          notificationTime={arjunScenario === 'live' ? singaporeTime : 'now'}
        />
      )}
      {isMdmLim && (
        <PersonaJudgingPanel<MdmLimScenario>
          scenarios={[
            { id: 'live', label: 'Live now' },
            { id: 'usual', label: 'Usual journey' },
            { id: 'lift', label: 'Lift unavailable' },
            { id: 'rain', label: 'Heavy rain' },
          ]}
          scenario={mdmLimScenario}
          onChangeScenario={(next) => {
            setMdmLimScenario(next);
            openPersonaHome();
          }}
          caption="Usual journey pins a demo clock to the moment she leaves home on appointment day; the lift and rain scenarios are the night before (8:05 pm). Each is labelled inside the app."
          notification={showPersonaNotification}
          notificationTime={mdmLimScenario === 'live' ? singaporeTime : mdmLimScenario === 'usual' ? 'now' : '8:05 pm'}
        />
      )}
      <main
        id="app-mobile-frame"
        className="w-full max-w-[430px] h-full bg-surface flex flex-col shadow-2xl overflow-hidden relative"
      >
        {!effectiveIsOnline && (
          <div className="w-full bg-amber-600 text-white text-[11px] font-semibold text-center py-1.5 shrink-0 z-40">
            {isOnline ? 'Simulated offline (demo)' : "You're offline"} — showing last-known data
          </div>
        )}
        {/* Active Screen Area */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
          {currentView === 'guidance' && (
            <JourneyGuidanceScreen
              route={selectedRoute}
              userPreferences={userPreferences}
              travelNeeds={travelNeeds}
              disruption={disruption}
              departureOffsetMin={guidanceDepartureOffsetMin}
              audioGuidance={learningPreferences.audioGuidance}
              onExit={() => setCurrentView('main')}
              onFinishJourney={() => setCurrentView('main')}
            />
          )}

          {currentView === 'planner' && (
            <JourneyPlannerScreen
              initialOrigin={plannerOrigin}
              initialDestination={plannerDestination}
              userPreferences={userPreferences}
              travelNeeds={travelNeeds}
              disruption={disruption}
              weather={weather}
              liveConditions={liveConditions}
              liveConditionsAreLive={isLiveMode}
              learningPreferences={learningPreferences}
              onBack={() => setCurrentView('main')}
              onSelectRouteForGuidance={(route, offsetMin) => handleStartGuidance(route, offsetMin)}
            />
          )}

          {currentView === 'main' && (
            <div className="h-full flex flex-col overflow-hidden">
              {/* Top App Bar (redesigned Journey tabs carry their own header and data badges) */}
              {!(hasRedesignedHome && activeTab === 'home') && (
                <TopAppBar
                  title="Transit Companion"
                  showBack={false}
                  showSkip={false}
                  subtitle="Singapore Public Transport"
                  isLive={isLiveMode}
                  liveStatusKnown={liveStatusKnown}
                />
              )}

              {/* Scrollable Tab Content Container */}
              <div className="flex-1 overflow-y-auto px-4 py-2 relative">
                {activeTab === 'home' && isRachel && (
                  <RachelHomeScreen
                    lineSummaries={lineSummaries}
                    scenario={rachelScenario}
                    onStartJourney={(route) => handleStartGuidance(route)}
                    onPlanFallback={() => handlePlanTrip('Tampines', 'Raffles Place')}
                    onOpenProfile={() => setActiveTab('more')}
                    onNotificationChange={setPersonaNotification}
                  />
                )}

                {activeTab === 'home' && isArjun && (
                  <ArjunHomeScreen
                    userPreferences={userPreferences}
                    scenario={arjunScenario}
                    onStartJourney={(route, offsetMin) => handleStartGuidance(route, offsetMin)}
                    onPlanFallback={() => handlePlanTrip('Punggol', 'one-north')}
                    onOpenProfile={() => setActiveTab('more')}
                    onNotificationChange={setPersonaNotification}
                  />
                )}

                {activeTab === 'home' && isMdmLim && (
                  <MdmLimHomeScreen
                    scenario={mdmLimScenario}
                    onStartJourney={(route, offsetMin) => handleStartGuidance(route, offsetMin)}
                    onPlanFallback={() => handlePlanTrip('Bedok', 'Outram Park')}
                    onNotificationChange={setPersonaNotification}
                  />
                )}

                {activeTab === 'home' && !hasRedesignedHome && (
                  <HomeScreen
                    routines={routines}
                    disruption={visibleDisruption}
                    liveConditions={liveConditions}
                    busesOffService={busesOffService}
                    liveConditionsAreLive={isLiveMode}
                    userPreferences={userPreferences}
                    travelNeeds={travelNeeds}
                    singaporeTime={singaporeTime}
                    onOpenRoutineConfirmation={handleOpenRoutineConfirmation}
                    onDismissRoutine={handleDismissRoutine}
                    onStartRoutineGuidance={() => handleStartGuidance(MOCK_ROUTES_KENT_RIDGE_TO_BUGIS[0])}
                    onViewDisruptionReroute={() => handlePlanTrip('Kent Ridge MRT', 'Bugis MRT')}
                    onPlanTrip={(orig, dest) => handlePlanTrip(orig, dest)}
                    onOpenPreferences={() => setActiveTab('more')}
                    onSwitchToMap={() => setActiveTab('map')}
                    onRefreshLive={loadLiveData}
                    isRefreshingLive={isRefreshingLive}
                  />
                )}

                {activeTab === 'map' && (
                  <div className="space-y-4 pb-6">
                    {hasRedesignedHome && (
                      <>
                        <PlanSearchCard singaporeTime={singaporeTime} onPlanTrip={(orig, dest) => handlePlanTrip(orig, dest)} />
                        <NearbyLiveTransit
                          liveConditions={liveConditions}
                          busesOffService={busesOffService}
                          isRefreshingLive={isRefreshingLive}
                          onRefreshLive={loadLiveData}
                          onPlanTrip={(orig, dest) => handlePlanTrip(orig, dest)}
                        />
                      </>
                    )}
                    <AlertsScreen
                      disruption={visibleDisruption}
                      trainStations={trainStations}
                      lineSummaries={lineSummaries}
                      isLiveMode={isLiveMode}
                      liveStatusKnown={liveStatusKnown}
                      userPreferences={userPreferences}
                      onViewReroute={() => handlePlanTrip('Kent Ridge MRT', 'Bugis MRT')}
                      onRefresh={loadLiveData}
                      isRefreshing={isRefreshingLive}
                    />
                    <MapScreen
                      busStops={busStops}
                      trainStations={trainStations}
                      onPlanTripFromStop={(stopName) => handlePlanTrip(stopName, 'Bugis MRT')}
                    />
                  </div>
                )}

                {activeTab === 'more' && (
                  <MoreScreen
                    userPreferences={userPreferences}
                    travelNeeds={travelNeeds}
                    learningPreferences={learningPreferences}
                    notificationPreferences={notificationPreferences}
                    routines={routines}
                    selectedPersona={selectedPersona}
                    simulateOffline={simulateOffline}
                    onToggleSimulateOffline={() => setSimulateOffline((v) => !v)}
                    onRetakeQuiz={() => setCurrentView('onboarding')}
                    onEditRoutine={handleOpenEditRoutine}
                    onAddRoutine={handleAddRoutine}
                    onDeleteRoutine={handleDeleteRoutine}
                    onOpenRoutineConfirmation={handleOpenRoutineConfirmation}
                    onToggleNeed={(key) =>
                      setTravelNeeds((prev) => ({
                        ...prev,
                        noSpecificNeeds: false,
                        [key]: !prev[key],
                      }))
                    }
                    onToggleLearning={(key) =>
                      setLearningPreferences((prev) => ({
                        ...prev,
                        [key]: !prev[key],
                      }))
                    }
                    onToggleNotification={(key) =>
                      setNotificationPreferences((prev) => ({
                        ...prev,
                        [key]: !prev[key],
                      }))
                    }
                    onChangeMode={(mode) =>
                      setUserPreferences((prev) => ({ ...prev, travelMode: mode }))
                    }
                    onChangeDominantHand={(hand) =>
                      setUserPreferences((prev) => ({ ...prev, dominantHand: hand }))
                    }
                    onResetPreferences={handleResetAll}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Global Pinned Bottom Navigation */}
        <BottomNavigation
          activeTab={activeTab}
          onChangeTab={(tab) => {
            setActiveTab(tab);
            if (currentView !== 'main') {
              setCurrentView('main');
            }
          }}
          hasActiveAlert={Boolean(disruption?.active)}
        />

        {/* Routine Confirmation Modal */}
        {showRoutineConfirmation && confirmingRoutine && (
          <RoutineConfirmationModal
            routine={confirmingRoutine}
            isOpen={showRoutineConfirmation}
            onClose={() => setShowRoutineConfirmation(false)}
            onConfirm={handleConfirmRoutine}
            onDismissRoutine={handleDismissRoutine}
            onUpdateRoutine={handleUpdateRoutine}
          />
        )}

        {/* Standalone Edit Routine Modal (also used to add a new routine) */}
        {showEditRoutineModal && editingRoutine && (
          <EditRoutineModal
            routine={editingRoutine}
            isOpen={showEditRoutineModal}
            onClose={() => setShowEditRoutineModal(false)}
            onSave={(updated) => {
              handleUpdateRoutine(updated);
              setShowEditRoutineModal(false);
            }}
          />
        )}
      </main>
    </div>
    </DominantHandProvider>
  );
}
