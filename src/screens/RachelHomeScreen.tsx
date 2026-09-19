import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Briefcase,
  CheckCircle2,
  ShieldCheck,
  TrainFront,
  User,
} from 'lucide-react';
import { LineSummary, RachelScenario, RouteOption } from '../types';
import { fetchLiveRoutePlan } from '../services/routingService';
import { resolveStationCoords } from '../utils/stationLookup';
import {
  formatClock,
  isTransitStep,
  lineColor,
  lineLabel,
  lineName,
  prettifyStop,
  routeMinutes,
  sgtMinutesNow,
  stepStartTimes,
} from '../utils/journeyMath';
import { DataBadge } from '../components/DataBadge';
import { buildProgressCards, currentCardKey, JourneyProgress, progressNotification } from '../components/JourneyProgress';

// Rachel's commute, as stated in the brief: Tampines -> Raffles Place on the
// EWL, leaves 07:40, must be at her desk by 08:45. Times are minutes past midnight SGT.
const USUAL_DEPARTURE_MIN = 7 * 60 + 40;
const ARRIVAL_TARGET_MIN = 8 * 60 + 45;
const DEMO_CLOCK_MIN = 7 * 60 + 20;
const LATER_DEPARTURE_STEP_MIN = 10;
// Scheduled end-to-end estimate, used only when live OneMap routing is
// unavailable and always shown with a DEMO DATA label when it is.
const ESTIMATED_DURATION_MIN = 45;
const ORIGIN = resolveStationCoords('Tampines');
const RAFFLES_PLACE = resolveStationCoords('Raffles Place');
// Persona assumption (the brief only says "Raffles Place"): her desk is at
// Marina Bay Financial Centre Tower 3. Her usual EWL route leaves an exposed
// street walk from Raffles Place; OneMap also returns the EWL + one NSL stop to
// Marina Bay, whose final walk runs through the underground Marina Bay Link Mall.
const DESTINATION = { lat: 1.2791, lng: 103.8543, name: 'Marina Bay Financial Centre' };

export interface RachelNotification {
  title: string;
  body: string;
}

interface RachelHomeScreenProps {
  lineSummaries: LineSummary[];
  scenario: RachelScenario;
  onStartJourney: (route: RouteOption) => void;
  onPlanFallback: () => void;
  onOpenProfile: () => void;
  onNotificationChange?: (notification: RachelNotification | null) => void;
}

const journeyMinutes = (route: RouteOption | null): number =>
  route ? routeMinutes(route) : ESTIMATED_DURATION_MIN;

// Walking after the last train/bus leg: the stretch from the station to her desk.
function finalWalkMinutes(route: RouteOption | null): number {
  if (!route) return 0;
  let lastTransit = -1;
  route.steps.forEach((s, i) => {
    if (isTransitStep(s.type)) lastTransit = i;
  });
  return route.steps.slice(lastTransit + 1).reduce((total, s) => total + (s.durationMin || 0), 0);
}

const isDirectEwlRoute = (route: RouteOption) =>
  route.transfers === 0 && route.lines.length > 0 && route.lines.every((l) => lineLabel(l) === 'EWL');

// A genuine alternative to an East-West Line disruption can't use the EWL
// for any leg, not just avoid being an all-EWL direct ride.
const usesEwl = (route: RouteOption) => route.lines.some((l) => lineLabel(l) === 'EWL');

// Her usual route per the brief: the live EWL ride to Raffles Place, then the
// live OneMap walk from the station to her desk. Built from two requests
// because OneMap's top three itineraries to the office don't always include it.
function composeUsualRoute(ewlRoute: RouteOption, walk: RouteOption | null): RouteOption {
  if (!walk || walk.steps.length === 0) return ewlRoute;
  let lastTransit = -1;
  ewlRoute.steps.forEach((s, i) => {
    if (isTransitStep(s.type)) lastTransit = i;
  });
  if (lastTransit === -1) return ewlRoute;
  const kept = ewlRoute.steps.slice(0, lastTransit + 1);
  const droppedWalk = ewlRoute.steps.slice(lastTransit + 1).reduce((total, s) => total + (s.durationMin || 0), 0);
  const alightPoint = kept[lastTransit].targetPoint;
  const walkStep = {
    ...walk.steps[0],
    stepNumber: kept.length + 1,
    type: 'walk' as const,
    instruction: 'Walk to work',
    startPoint: { lat: alightPoint.lat, lng: alightPoint.lng, name: alightPoint.name },
  };
  const steps = [...kept, walkStep];
  return {
    ...ewlRoute,
    id: `${ewlRoute.id}-to-work`,
    steps,
    totalDurationMin: Math.max(0, ewlRoute.totalDurationMin - droppedWalk) + walk.totalDurationMin,
    walkingMinutes: steps
      .filter((s) => s.type === 'walk' || s.type === 'transfer')
      .reduce((total, s) => total + (s.durationMin || 0), 0),
  };
}

interface JourneyTimeline {
  boardMin: number;
  alightMin: number;
  arriveMin: number;
  boardName: string;
  alightName: string;
  firstLine: string;
  rideMin: number;
}

function buildTimeline(route: RouteOption | null, leaveMin: number): JourneyTimeline {
  const fallback: JourneyTimeline = {
    boardMin: leaveMin,
    alightMin: leaveMin + ESTIMATED_DURATION_MIN,
    arriveMin: leaveMin + ESTIMATED_DURATION_MIN,
    boardName: 'Tampines',
    alightName: 'Raffles Place',
    firstLine: 'EWL',
    rideMin: ESTIMATED_DURATION_MIN,
  };
  if (!route) return fallback;

  const firstIdx = route.steps.findIndex((s) => isTransitStep(s.type));
  const arriveMin = leaveMin + journeyMinutes(route);
  if (firstIdx === -1) return { ...fallback, alightMin: arriveMin, arriveMin };

  let lastIdx = firstIdx;
  route.steps.forEach((s, i) => {
    if (isTransitStep(s.type)) lastIdx = i;
  });
  const starts = stepStartTimes(route, leaveMin);
  const alightMin = starts[lastIdx] + (route.steps[lastIdx].durationMin || 0);

  return {
    boardMin: starts[firstIdx],
    alightMin,
    arriveMin,
    boardName: prettifyStop(route.steps[firstIdx].startPoint?.name) || 'Tampines',
    alightName: prettifyStop(route.steps[lastIdx].targetPoint?.name) || 'Raffles Place',
    firstLine: lineLabel(route.steps[firstIdx].lineOrService),
    rideMin: alightMin - starts[firstIdx],
  };
}

interface ItineraryRow {
  time: number;
  title: string;
  detail: string;
}

function buildItinerary(route: RouteOption, leaveMin: number, bufferMin: number, finalWalkCovered: boolean): ItineraryRow[] {
  const starts = stepStartTimes(route, leaveMin);
  const firstTransit = route.steps.findIndex((s) => isTransitStep(s.type));
  let lastTransit = -1;
  route.steps.forEach((s, i) => {
    if (isTransitStep(s.type)) lastTransit = i;
  });

  const rows: ItineraryRow[] = [];
  route.steps.forEach((step, i) => {
    const target = prettifyStop(step.targetPoint?.name);
    const minutes = step.durationMin || 0;
    if (step.type === 'train') {
      rows.push({
        time: starts[i],
        title: i === firstTransit ? `Board the ${lineName(step.lineOrService)}` : `Change to the ${lineName(step.lineOrService)}`,
        detail: `${minutes} min to ${target}`,
      });
    } else if (step.type === 'bus') {
      rows.push({ time: starts[i], title: `Board Bus ${step.lineOrService || ''}`.trim(), detail: `${minutes} min to ${target}` });
    } else if (step.type === 'transfer') {
      rows.push({ time: starts[i], title: `Transfer at ${prettifyStop(step.startPoint?.name)}`, detail: `${minutes} min walk` });
    } else if (i < firstTransit) {
      rows.push({ time: starts[i], title: `Walk to ${target} station`, detail: `${minutes} min walk` });
    } else if (i > lastTransit && i === lastTransit + 1) {
      rows.push({
        time: starts[i],
        title: `Alight at ${prettifyStop(route.steps[lastTransit].targetPoint?.name)}`,
        detail: `${finalWalkMinutes(route)} min ${finalWalkCovered ? 'covered ' : ''}walk to work`,
      });
    }
  });
  rows.push({
    time: leaveMin + journeyMinutes(route),
    title: 'Arrive at work',
    detail: bufferMin >= 0 ? `Expected buffer: ${bufferMin} minutes` : `${-bufferMin} min after your 8:45 target`,
  });
  return rows;
}

interface StripNode {
  icon: React.ReactNode;
  label: string;
  time: string;
  accent?: string;
}

const JourneyStrip: React.FC<{ nodes: StripNode[] }> = ({ nodes }) => (
  <div className="flex items-start pt-1" aria-label="Journey timeline">
    {nodes.map((node, i) => (
      <React.Fragment key={`${node.label}-${i}`}>
        {i > 0 && (
          <span aria-hidden="true" className="mt-[18px] w-6 shrink-0 border-t-2 border-dotted border-outline-variant" />
        )}
        <div className="flex flex-col items-center text-center min-w-0 flex-1">
          <span
            className={`w-9 h-9 rounded-full flex items-center justify-center ${
              node.accent ? 'text-white' : 'bg-surface-container-lowest/70 text-secondary'
            }`}
            style={node.accent ? { backgroundColor: node.accent } : undefined}
          >
            {node.icon}
          </span>
          <span className="mt-2 text-sm font-semibold text-on-surface leading-tight text-balance">{node.label}</span>
          <span className="text-xs text-on-surface-variant tabular-nums">{node.time}</span>
        </div>
      </React.Fragment>
    ))}
  </div>
);

const PrimaryButton: React.FC<{ onClick: () => void; children: React.ReactNode; id?: string }> = ({ onClick, children, id }) => (
  <button
    id={id}
    type="button"
    onClick={onClick}
    className="w-full min-h-14 rounded-2xl bg-primary-container hover:bg-primary text-on-primary text-base font-bold transition-colors cursor-pointer active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
  >
    {children}
  </button>
);

const TextButton: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({ onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className="w-full min-h-11 text-base font-bold text-primary hover:underline underline-offset-4 cursor-pointer rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
  >
    {children}
  </button>
);

const Heading: React.FC<{ eyebrow: string; title: string; body: React.ReactNode }> = ({ eyebrow, title, body }) => (
  <section className="space-y-2">
    <p className="text-[13px] font-bold uppercase tracking-[0.08em] text-primary">{eyebrow}</p>
    <h2 className="text-[32px] leading-[1.1] font-bold tracking-[-0.025em] text-on-surface text-balance">{title}</h2>
    <div className="text-[17px] leading-relaxed text-on-surface-variant text-pretty">{body}</div>
  </section>
);

export const RachelHomeScreen: React.FC<RachelHomeScreenProps> = ({
  lineSummaries,
  scenario,
  onStartJourney,
  onPlanFallback,
  onOpenProfile,
  onNotificationChange,
}) => {
  const isDemoClock = scenario !== 'live';
  const [clockMin, setClockMin] = useState(sgtMinutesNow);
  const [usualJourneyStarted, setUsualJourneyStarted] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setClockMin(sgtMinutesNow()), 15000);
    return () => clearInterval(timer);
  }, []);
  // Active journey: the demo clock sits at her usual 07:40 departure, trip under way.
  const isActiveJourney = scenario === 'active' || usualJourneyStarted;
  const nowMin = isActiveJourney ? USUAL_DEPARTURE_MIN : isDemoClock ? DEMO_CLOCK_MIN : clockMin;

  // Live OneMap itineraries for her commute, planned for her next 07:40
  // departure (OneMap accepts up to 2h ahead, so the offset is clamped).
  const [usualRoute, setUsualRoute] = useState<RouteOption | null>(null);
  const [alternatives, setAlternatives] = useState<RouteOption[]>([]);
  const [routeStatus, setRouteStatus] = useState<'loading' | 'live' | 'unavailable'>('loading');
  useEffect(() => {
    if (!ORIGIN || !RAFFLES_PLACE) {
      setRouteStatus('unavailable');
      return;
    }
    let cancelled = false;
    const load = () => {
      const offset = Math.min(120, (USUAL_DEPARTURE_MIN - sgtMinutesNow() + 1440) % 1440);
      Promise.all([
        fetchLiveRoutePlan(ORIGIN, RAFFLES_PLACE, offset, 'transit'),
        fetchLiveRoutePlan(RAFFLES_PLACE, DESTINATION, 0, 'walk'),
        fetchLiveRoutePlan(ORIGIN, DESTINATION, offset, 'transit'),
      ]).then(([ewlPlan, walkPlan, officePlan]) => {
        if (cancelled) return;
        const ewlOptions = ewlPlan.source === 'onemap_live' ? ewlPlan.itineraries : [];
        const ewlRoute = ewlOptions.find(isDirectEwlRoute) || ewlOptions[0] || null;
        if (!ewlRoute) {
          setUsualRoute(null);
          setAlternatives([]);
          setRouteStatus('unavailable');
          return;
        }
        const walk = walkPlan.source === 'onemap_live' ? walkPlan.itineraries[0] ?? null : null;
        setUsualRoute(composeUsualRoute(ewlRoute, walk));
        setAlternatives(officePlan.source === 'onemap_live' ? officePlan.itineraries.filter((r) => !usesEwl(r)) : []);
        setRouteStatus('live');
      });
    };
    load();
    const timer = setInterval(load, 5 * 60000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const ewl = lineSummaries.find((l) => l.line === 'EWL');
  const ewlDisrupted = Boolean(ewl && !ewl.isNormal);
  const lineSentence = !ewl
    ? 'Live East-West Line status is unavailable right now.'
    : ewl.isNormal
    ? 'The East-West Line is running normally.'
    : `East-West Line: ${ewl.status}.`;

  const simulatedDisruption = scenario === 'disruption' || scenario === 'reroute';
  const disrupted = scenario === 'routine' || scenario === 'active' ? false : simulatedDisruption || ewlDisrupted;
  const disruptionCause = simulatedDisruption
    ? 'Simulated East-West Line disruption'
    : ewl?.status || 'An East-West Line disruption';

  // The alternative is the fastest live itinerary to her office that avoids
  // the East-West Line (already excluded when the candidates were fetched).
  const alternativeRoute = useMemo(() => {
    if (!usualRoute) return null;
    return [...alternatives].sort((a, b) => a.totalDurationMin - b.totalDurationMin)[0] || null;
  }, [alternatives, usualRoute]);
  const isLoading = routeStatus === 'loading';
  const isEstimate = routeStatus === 'unavailable';
  const durationMin = journeyMinutes(usualRoute);

  const [departureChoice, setDepartureChoice] = useState<'usual' | 'later'>('usual');
  const [view, setView] = useState<'auto' | 'reroute' | 'keepUsual'>('auto');
  const [rerouteSelection, setRerouteSelection] = useState<'alternative' | 'usual'>('alternative');
  useEffect(() => {
    setDepartureChoice('usual');
    setRerouteSelection('alternative');
    setView(scenario === 'reroute' ? 'reroute' : 'auto');
    setUsualJourneyStarted(false);
  }, [scenario]);

  const commuteIsTomorrow = nowMin >= ARRIVAL_TARGET_MIN;
  const usualLeaveMin = commuteIsTomorrow ? USUAL_DEPARTURE_MIN : Math.max(USUAL_DEPARTURE_MIN, nowMin);
  const laterLeaveMin = usualLeaveMin + LATER_DEPARTURE_STEP_MIN;
  const laterFits = laterLeaveMin + durationMin <= ARRIVAL_TARGET_MIN;
  const leaveMin = departureChoice === 'later' && laterFits ? laterLeaveMin : usualLeaveMin;
  const minutesToLeave = commuteIsTomorrow ? leaveMin + 1440 - nowMin : leaveMin - nowMin;
  const usualTimeline = buildTimeline(usualRoute, leaveMin);
  const bufferMin = ARRIVAL_TARGET_MIN - usualTimeline.arriveMin;

  const bufferSentence =
    bufferMin >= 0
      ? `This keeps a ${bufferMin}-minute buffer before your 8:45 arrival target.`
      : `You'd arrive ${-bufferMin} min after your 8:45 arrival target.`;

  const leaveHeadline =
    minutesToLeave <= 0
      ? 'Leave now'
      : minutesToLeave <= 90 && !commuteIsTomorrow
      ? `Leave in ${minutesToLeave} minute${minutesToLeave === 1 ? '' : 's'}`
      : `Leave at ${formatClock(leaveMin)}${commuteIsTomorrow ? ' tomorrow' : ''}`;

  // The alternative route keeps her arrival time by leaving earlier if it is
  // slower, but never asks her to leave before now.
  const alternativeExtraMin = alternativeRoute ? Math.max(0, journeyMinutes(alternativeRoute) - durationMin) : 0;
  const alternativeLeaveMin = commuteIsTomorrow
    ? leaveMin - alternativeExtraMin
    : Math.max(nowMin, leaveMin - alternativeExtraMin);
  const alternativeTimeline = alternativeRoute ? buildTimeline(alternativeRoute, alternativeLeaveMin) : null;
  const leaveEarlierBy = leaveMin - alternativeLeaveMin;
  const alternativeBuffer = alternativeTimeline ? ARRIVAL_TARGET_MIN - alternativeTimeline.arriveMin : 0;
  const alternativeFirstLine = alternativeTimeline?.firstLine;
  const keepsFamiliarStart = Boolean(alternativeFirstLine && alternativeFirstLine === usualTimeline.firstLine);

  const activeView: 'overview' | 'disrupted' | 'reroute' | 'active' = isActiveJourney
    ? 'active'
    : view === 'reroute'
    ? 'reroute'
    : disrupted && view === 'auto'
    ? 'disrupted'
    : 'overview';

  const progressCards =
    isActiveJourney && usualRoute
      ? buildProgressCards(usualRoute, leaveMin, usualTimeline.arriveMin, nowMin, { walkFactor: 1, destinationLabel: 'work' })
      : [];

  const notification: RachelNotification | null = useMemo(() => {
    if (isLoading) return null;
    if (activeView === 'active') return progressNotification(progressCards, nowMin);
    if (activeView === 'reroute' && alternativeTimeline) {
      return {
        title: 'Alternative route ready',
        body: `Arrive around ${formatClock(alternativeTimeline.arriveMin)} with a ${Math.max(0, alternativeBuffer)} min buffer.`,
      };
    }
    if (activeView === 'disrupted' || activeView === 'reroute') {
      return {
        title: 'Train disruption affects your usual journey',
        body: alternativeRoute
          ? leaveEarlierBy > 0
            ? `Leave ${leaveEarlierBy} min earlier for an alternative route.`
            : 'An alternative route is ready at your usual time.'
          : 'No live alternative avoids the disruption right now.',
      };
    }
    return {
      title: ewlDisrupted ? 'East-West Line disruption' : 'East-West Line running normally',
      body: `${minutesToLeave <= 0 ? 'Leave now' : minutesToLeave <= 90 && !commuteIsTomorrow ? `Leave in ${minutesToLeave} min` : `Leave at ${formatClock(leaveMin)}`} to reach work by ${formatClock(usualTimeline.arriveMin)}.`,
    };
  }, [isLoading, activeView, progressCards[0]?.time, alternativeTimeline, alternativeBuffer, alternativeRoute, leaveEarlierBy, ewlDisrupted, minutesToLeave, commuteIsTomorrow, leaveMin, usualTimeline.arriveMin]);

  useEffect(() => {
    onNotificationChange?.(notification);
  }, [notification?.title, notification?.body]); // eslint-disable-line react-hooks/exhaustive-deps

  const greeting = nowMin < 12 * 60 ? 'Morning' : nowMin < 18 * 60 ? 'Afternoon' : 'Evening';
  // A familiar daily commute only needs the glanceable active-journey view.
  // The full guidance screen remains available from the map button and for
  // unfamiliar routes selected through Plan/Navigation.
  const startUsual = () => (usualRoute ? setUsualJourneyStarted(true) : onPlanFallback());
  const openUsualMap = () => (usualRoute ? onStartJourney(usualRoute) : onPlanFallback());
  const canGoBack = usualJourneyStarted || view !== 'auto';
  const goBack = () => {
    if (usualJourneyStarted) {
      setUsualJourneyStarted(false);
      return;
    }
    setView('auto');
  };
  const pendingTime = '–:––';

  const arrivalStatus = ewlDisrupted
    ? { label: 'Disrupted', className: 'text-error', icon: <AlertTriangle className="w-4 h-4" /> }
    : bufferMin < 0
    ? { label: 'Running late', className: 'text-error', icon: <AlertTriangle className="w-4 h-4" /> }
    : { label: 'On time', className: 'text-primary', icon: <CheckCircle2 className="w-4 h-4" /> };

  const usualStrip: StripNode[] = [
    { icon: <TrainFront className="w-4 h-4" />, label: usualTimeline.firstLine, time: formatClock(usualTimeline.boardMin), accent: lineColor(usualTimeline.firstLine) },
    { icon: <TrainFront className="w-4 h-4" />, label: usualTimeline.alightName, time: formatClock(usualTimeline.alightMin), accent: lineColor(usualTimeline.firstLine) },
    { icon: <Briefcase className="w-4 h-4" />, label: 'Work', time: formatClock(usualTimeline.arriveMin) },
  ];

  const alternativeStrip: StripNode[] = useMemo(() => {
    if (!alternativeRoute || !alternativeTimeline) return [];
    const starts = stepStartTimes(alternativeRoute, alternativeLeaveMin);
    const trainLegs = alternativeRoute.steps
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => isTransitStep(s.type))
      .slice(0, 2);
    return [
      ...trainLegs.map(({ s, i }) => {
        const code = lineLabel(s.lineOrService);
        return {
          icon: s.type === 'bus' ? <Briefcase className="w-4 h-4" /> : <TrainFront className="w-4 h-4" />,
          label: s.type === 'bus' ? `Bus ${s.lineOrService || ''}`.trim() : code,
          time: formatClock(starts[i]),
          // Each rail leg retains its official line colour in every route state.
          accent: s.type === 'train' ? lineColor(s.lineOrService) : undefined,
        };
      }),
      { icon: <Briefcase className="w-4 h-4" />, label: 'Work', time: formatClock(alternativeTimeline.arriveMin) },
    ];
  }, [alternativeRoute, alternativeTimeline, alternativeLeaveMin]);

  const alternativeItinerary = alternativeRoute
    ? buildItinerary(alternativeRoute, alternativeLeaveMin, alternativeBuffer, false)
    : [];

  return (
    <div id="rachel-home-screen" className="pt-4 pb-8 space-y-5 animate-in fade-in duration-200">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {canGoBack && (
            <button
              id="rachel-home-back-button"
              type="button"
              onClick={goBack}
              aria-label="Go back"
              className="w-11 h-11 -ml-2 rounded-full text-on-surface flex items-center justify-center hover:bg-surface-container-high active:scale-95 transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
          )}
          <h1 className="text-[26px] leading-tight font-bold tracking-[-0.02em] text-on-surface truncate">
            {canGoBack ? (activeView === 'active' ? 'Active journey' : 'Journey options') : `${greeting}, Rachel`}
          </h1>
        </div>
        <button
          type="button"
          onClick={onOpenProfile}
          aria-label="Open profile"
          className="w-12 h-12 rounded-full bg-primary-fixed text-primary flex items-center justify-center hover:bg-secondary-container transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <User className="w-5 h-5" />
        </button>
      </header>

      <div className="flex flex-wrap gap-1.5 -mt-2" aria-label="Data sources">
        {routeStatus === 'live' ? <DataBadge tone="live">LIVE</DataBadge> : isEstimate && <DataBadge tone="demo">DEMO DATA</DataBadge>}
        {isDemoClock && <DataBadge tone="demo">Demo clock · {isActiveJourney ? '7:40 am' : '7:20 am'}</DataBadge>}
        {simulatedDisruption && <DataBadge tone="demo">Simulated disruption</DataBadge>}
      </div>

      {activeView === 'active' && (
        <JourneyProgress
          status={routeStatus}
          cards={progressCards}
          currentKey={currentCardKey(progressCards, nowMin)}
          destinationIcon="building"
          loadingText="Getting live journey times from Tampines…"
          fallbackLabel="Live routing unavailable. Plan Tampines to Raffles Place"
          onOpenMap={openUsualMap}
          onPlanFallback={onPlanFallback}
        />
      )}

      {activeView === 'overview' && (
        <>
          <Heading
            eyebrow="Your usual commute"
            title={isLoading ? 'Checking your commute…' : leaveHeadline}
            body={
              <>
                <p>{isLoading ? 'Getting live journey times from Tampines.' : `${lineSentence} ${bufferSentence}`}</p>
                {view === 'keepUsual' && disrupted && !isLoading && (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-[15px]">
                    <AlertTriangle className="w-4 h-4 shrink-0" /> Usual route kept. Expected arrival {formatClock(usualTimeline.arriveMin)}.
                  </p>
                )}
              </>
            }
          />

          <section className="rounded-[28px] bg-primary-fixed p-5 space-y-4" aria-label="Expected arrival">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[15px] font-semibold text-on-surface-variant">Expected arrival</span>
                {!isLoading && (
                  <span className={`inline-flex items-center gap-1.5 text-[15px] font-bold ${arrivalStatus.className}`}>
                    {arrivalStatus.icon}
                    {arrivalStatus.label}
                  </span>
                )}
              </div>
              <p className="text-[44px] leading-none font-bold tracking-[-0.03em] text-on-surface tabular-nums mt-1">
                {isLoading ? pendingTime : formatClock(usualTimeline.arriveMin)}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span className="w-14 h-14 rounded-2xl bg-surface-container-lowest text-secondary flex items-center justify-center shrink-0">
                <TrainFront className="w-6 h-6" />
              </span>
              <div className="min-w-0">
                <p className="text-lg text-on-surface leading-snug">
                  {usualTimeline.firstLine} · departs {isLoading ? pendingTime : formatClock(usualTimeline.boardMin)}
                </p>
                <p className="text-[15px] text-on-surface-variant">
                  From {usualTimeline.boardName} · {usualTimeline.rideMin} min to {usualTimeline.alightName}
                </p>
              </div>
            </div>

            {!isLoading && <JourneyStrip nodes={usualStrip} />}

            {isEstimate && (
              <p className="text-[13px] text-on-surface-variant">Estimated journey time. Live routing is unavailable right now.</p>
            )}
          </section>

          {!isLoading && (laterFits || departureChoice === 'later') && (
            <section className="rounded-[24px] border border-outline-variant p-5 space-y-3">
              <h3 className="text-[15px] font-semibold text-on-surface-variant">
                {departureChoice === 'later' ? 'Prefer your usual time?' : 'Need more time?'}
              </h3>
              <button
                type="button"
                onClick={() => setDepartureChoice(departureChoice === 'later' ? 'usual' : 'later')}
                className="w-full flex items-center justify-between gap-3 rounded-2xl border border-outline-variant bg-surface-container-lowest hover:border-primary/50 px-4 py-4 text-left transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <span>
                  <span className="block text-lg text-on-surface">
                    Leave at {formatClock(departureChoice === 'later' ? usualLeaveMin : laterLeaveMin)}
                  </span>
                  <span className="block text-[15px] text-on-surface-variant">
                    {departureChoice === 'later' ? 'Your usual departure' : 'Still before your 8:45 target'}
                  </span>
                </span>
                <span className="text-[15px] font-bold text-on-surface-variant tabular-nums shrink-0">
                  Arrive {formatClock((departureChoice === 'later' ? usualLeaveMin : laterLeaveMin) + durationMin)}
                </span>
              </button>
            </section>
          )}

          <PrimaryButton id="btn-start-usual-journey" onClick={startUsual}>
            {usualRoute ? 'Start usual journey' : 'Plan usual journey'}
          </PrimaryButton>
        </>
      )}

      {activeView === 'disrupted' && (
        <>
          <Heading
            eyebrow="Journey update"
            title={
              alternativeRoute
                ? leaveEarlierBy > 0
                  ? `Leave ${leaveEarlierBy} minutes earlier`
                  : 'Take an alternative route'
                : 'Train disruption on your commute'
            }
            body={
              <p>
                {alternativeRoute
                  ? `${disruptionCause} affects your usual East-West Line ride. An alternative route avoids the disruption${alternativeBuffer >= 0 ? ' and keeps you on time' : ''}.`
                  : usualRoute
                  ? `${disruptionCause} affects your usual route, and no live alternative avoids it right now.`
                  : `${disruptionCause} is affecting the East-West Line. Live routing details are unavailable right now.`}
              </p>
            }
          />

          {usualRoute && (
            <section className="rounded-[28px] bg-error-container p-5" aria-label="Disruption impact on your usual route">
              <div className="flex items-start gap-4">
                <span className="w-16 h-16 rounded-2xl bg-error text-white flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-7 h-7" />
                </span>
                <div>
                  <h3 className="text-[21px] leading-snug text-on-surface">Your usual route is affected</h3>
                  <p className="text-[15px] text-on-error-container/80 mt-1">
                    {disruptionCause} between {usualTimeline.boardName} and {usualTimeline.alightName}.
                  </p>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-on-error-container/15 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setView('keepUsual')}
                  className="rounded-2xl bg-surface-container-lowest border border-outline-variant/70 hover:border-on-surface/30 p-4 text-left transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <span className="block text-sm text-on-surface-variant">Keep usual route</span>
                  <span className="block text-[21px] text-on-surface mt-1 tabular-nums">Arrive {formatClock(usualTimeline.arriveMin)}</span>
                </button>
                {alternativeTimeline && (
                  <button
                    type="button"
                    onClick={() => setView('reroute')}
                    className="rounded-2xl bg-primary-fixed border-2 border-primary-container hover:bg-secondary-container/60 p-4 text-left transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <span className="block text-sm text-on-surface-variant">Alternative reroute</span>
                    <span className="block text-[21px] text-on-surface mt-1 tabular-nums">
                      Arrive {formatClock(alternativeTimeline.arriveMin)}
                    </span>
                    <span className="block mt-2 text-xs font-bold uppercase tracking-[0.08em] text-primary">Recommended</span>
                  </button>
                )}
              </div>
            </section>
          )}

          {alternativeRoute && alternativeTimeline ? (
            <section className="rounded-[24px] bg-amber-50 border border-amber-200/70 p-5 flex items-center gap-4">
              <span className="w-14 h-14 rounded-2xl bg-surface-container-lowest text-primary flex items-center justify-center shrink-0">
                <ShieldCheck className="w-6 h-6" />
              </span>
              <div>
                <h3 className="text-lg text-on-surface">Recommended: alternative route</h3>
                <p className="text-[15px] text-on-surface-variant">
                  {alternativeRoute.lines.map(lineLabel).join(' + ')} ·{' '}
                  {leaveEarlierBy > 0 ? `${leaveEarlierBy} min earlier departure` : 'usual departure time'}
                </p>
              </div>
            </section>
          ) : (
            <PrimaryButton onClick={startUsual}>{usualRoute ? 'Start usual journey' : 'Plan usual journey'}</PrimaryButton>
          )}
        </>
      )}

      {activeView === 'reroute' && (
        <>
          <Heading
            eyebrow="Recommended route"
            title={
              alternativeRoute
                ? alternativeBuffer >= 0
                  ? 'Stay on time. Avoid the disruption.'
                  : 'Avoid the disruption.'
                : 'Your usual route is best'
            }
            body={
              <p>
                {alternativeRoute
                  ? keepsFamiliarStart
                    ? 'The recommendation changes only the final part of your familiar commute.'
                    : `The recommendation swaps the ${usualTimeline.firstLine} for ${alternativeRoute.lines.map(lineLabel).join(' + ')}.`
                  : isLoading
                  ? 'Getting live journey options.'
                  : 'No live alternative avoids the East-West Line disruption right now.'}
              </p>
            }
          />

          {alternativeRoute && alternativeTimeline && (
            <section className="rounded-[28px] bg-primary-fixed p-5 space-y-4" aria-label="Alternative route">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[15px] font-semibold text-on-surface-variant">Expected arrival</span>
                  {alternativeBuffer >= 0 && (
                    <span className="inline-flex items-center gap-1.5 text-[15px] font-bold text-primary">
                      <ShieldCheck className="w-4 h-4" />
                      {alternativeBuffer} min buffer
                    </span>
                  )}
                </div>
                <p className="text-[44px] leading-none font-bold tracking-[-0.03em] text-on-surface tabular-nums mt-1">
                  {formatClock(alternativeTimeline.arriveMin)}
                </p>
              </div>

              <JourneyStrip nodes={alternativeStrip} />

              <ol className="pt-4 border-t border-on-surface/10 space-y-3.5" aria-label="Step-by-step route">
                {alternativeItinerary.map((row, i) => (
                  <li key={`${row.title}-${i}`} className="grid grid-cols-[3.25rem_1fr] gap-3">
                    <span className="text-[15px] font-bold text-primary tabular-nums pt-px">{formatClock(row.time)}</span>
                    <span>
                      <span className="block text-base text-on-surface leading-snug">{row.title}</span>
                      <span className="block text-sm text-on-surface-variant">{row.detail}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <div className="space-y-3" role="radiogroup" aria-label="Choose a route">
            {alternativeRoute && alternativeTimeline && (
              <button
                type="button"
                role="radio"
                aria-checked={rerouteSelection === 'alternative'}
                onClick={() => setRerouteSelection('alternative')}
                className={`w-full flex items-center gap-3 rounded-2xl border px-4 py-4 text-left transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                  rerouteSelection === 'alternative'
                    ? 'border-primary bg-primary-fixed'
                    : 'border-outline-variant bg-surface-container-lowest hover:border-primary/50'
                }`}
              >
                <ShieldCheck className="w-5 h-5 text-on-surface shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block text-[17px] text-on-surface">Alternative route</span>
                  <span className="block text-sm text-on-surface-variant">
                    Recommended{keepsFamiliarStart ? ' · mostly familiar' : ''}
                  </span>
                </span>
                <span className="text-[17px] text-on-surface tabular-nums">{formatClock(alternativeTimeline.arriveMin)}</span>
              </button>
            )}
            <button
              type="button"
              role="radio"
              aria-checked={!alternativeRoute || rerouteSelection === 'usual'}
              onClick={() => setRerouteSelection('usual')}
              className={`w-full flex items-center gap-3 rounded-2xl border px-4 py-4 text-left transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                !alternativeRoute || rerouteSelection === 'usual'
                  ? 'border-primary bg-primary-fixed'
                  : 'border-outline-variant bg-surface-container-lowest hover:border-primary/50'
              }`}
            >
              <AlertTriangle className="w-5 h-5 text-on-surface shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-[17px] text-on-surface">Usual route</span>
                <span className="block text-sm text-on-surface-variant">
                  {usualRoute ? `${usualTimeline.firstLine} · may be affected` : 'Estimated'}
                </span>
              </span>
              <span className="text-[17px] text-on-surface tabular-nums">
                {isLoading ? pendingTime : formatClock(usualTimeline.arriveMin)}
              </span>
            </button>
          </div>

          <div className="space-y-2 pt-1">
            {alternativeRoute && rerouteSelection === 'alternative' ? (
              <PrimaryButton id="btn-use-alternative-route" onClick={() => onStartJourney(alternativeRoute)}>
                Use alternative route
              </PrimaryButton>
            ) : (
              <PrimaryButton onClick={startUsual}>{usualRoute ? 'Use usual route' : 'Plan usual journey'}</PrimaryButton>
            )}
            <TextButton onClick={() => setView('keepUsual')}>Keep usual route</TextButton>
          </div>
        </>
      )}
    </div>
  );
};
