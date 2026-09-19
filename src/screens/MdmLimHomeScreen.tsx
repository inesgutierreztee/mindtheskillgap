import React, { useEffect, useMemo, useState } from 'react';
import { Accessibility, AlertTriangle, ArrowRight, BusFront, CalendarDays, CheckCircle2, CloudRain, Footprints, Phone, Share2, TrainFront, X } from 'lucide-react';
import { MdmLimScenario, RouteOption } from '../types';
import { fetchLiveRoutePlan } from '../services/routingService';
import { fetchLiftStatus, LiftMaintenanceItem } from '../services/ltaService';
import { fetchWeather, WeatherInfo } from '../services/weatherService';
import { SINGAPORE_MRT_STATIONS } from '../data/mrtStationsData';
import { formatClock, isTransitStep, lineColor, lineLabel, prettifyStop, sgtMinutesNow } from '../utils/journeyMath';
import { buildProgressCards, currentCardKey, JourneyProgress, progressNotification } from '../components/JourneyProgress';
import { DataBadge } from '../components/DataBadge';
import { useDominantHand } from '../context/DominantHandContext';
import { RachelNotification as PersonaNotification } from './RachelHomeScreen';

// Mdm Lim, per the brief: Bedok -> Singapore General Hospital, fortnightly.
// Walks slowly, avoids stairs, needs lifts and sheltered walkways, and must be
// warned the day before if a lift or exit is out of service.
// Persona assumptions: home is Blk 539 Bedok North Street 3; a demo appointment
// tomorrow at 10:30 am at SGH (1 Hospital Crescent); she aims to arrive 30 min
// early; walking legs take 1.5x OneMap's standard pace.
const HOME = { lat: 1.331313, lng: 103.9253 };
const SGH = { lat: 1.279643, lng: 103.83554 };
const APPOINTMENT_MIN = 10 * 60 + 30;
const ARRIVE_EARLY_MIN = 30;
const WALK_PACE_FACTOR = 1.5;
const NIGHT_BEFORE_CLOCK_MIN = 20 * 60 + 5;
const SAVED_TOMORROW_ROUTE_KEY = 'sg_transit_mdm_lim_saved_tomorrow_route';

interface MdmLimHomeScreenProps {
  scenario: MdmLimScenario;
  onStartJourney: (route: RouteOption, departureOffsetMin: number) => void;
  onPlanFallback: () => void;
  onNotificationChange?: (notification: PersonaNotification | null) => void;
}

type LiftState = { status: 'clear' | 'outage' | 'unknown'; items: LiftMaintenanceItem[] };

const walkMinutes = (route: RouteOption) =>
  route.steps.filter((s) => s.type === 'walk' || s.type === 'transfer').reduce((t, s) => t + (s.durationMin || 0), 0);

// Door-to-door minutes at her pace: OneMap's total plus the extra walking time.
const herMinutes = (route: RouteOption) => Math.round(route.totalDurationMin + walkMinutes(route) * (WALK_PACE_FACTOR - 1));

// Every MRT station she uses: where each train leg starts and ends.
function stationsOn(route: RouteOption): string[] {
  const names: string[] = [];
  for (const step of route.steps) {
    if (step.type !== 'train') continue;
    for (const raw of [step.startPoint?.name, step.targetPoint?.name]) {
      const name = prettifyStop(raw);
      if (name && !names.includes(name)) names.push(name);
    }
  }
  return names;
}

const codesFor = (stationName: string) =>
  SINGAPORE_MRT_STATIONS.filter((s) => s.name === stationName).map((s) => s.code);

function lastTrainStep(route: RouteOption) {
  return [...route.steps].reverse().find((s) => s.type === 'train');
}

// Stations one stop either side on the same line: where she could get off
// instead if the lift at her usual station is out.
function neighbourStations(code: string, excludeName: string) {
  const match = /^([A-Z]+)(\d+)$/.exec(code);
  if (!match) return [];
  const [, prefix, num] = match;
  return [Number(num) - 1, Number(num) + 1]
    .map((n) => SINGAPORE_MRT_STATIONS.find((s) => s.code === `${prefix}${n}`))
    .filter((s): s is (typeof SINGAPORE_MRT_STATIONS)[number] => Boolean(s) && s!.name !== excludeName);
}

function composeDetour(toStation: RouteOption, onward: RouteOption, via: string): RouteOption {
  const steps = [...toStation.steps, ...onward.steps].map((s, i) => ({ ...s, stepNumber: i + 1 }));
  return {
    ...toStation,
    id: `detour-${via}-${toStation.id}`,
    title: `${toStation.title} → ${onward.title}`,
    lines: Array.from(new Set([...toStation.lines, ...onward.lines])),
    steps,
    totalDurationMin: toStation.totalDurationMin + onward.totalDurationMin,
    walkingMinutes: toStation.walkingMinutes + onward.walkingMinutes,
    transfers: toStation.transfers + onward.transfers + 1,
  };
}

const bestBy = (routes: RouteOption[]) =>
  [...routes].sort((a, b) => herMinutes(a) - herMinutes(b) || walkMinutes(a) - walkMinutes(b))[0] ?? null;

export const MdmLimHomeScreen: React.FC<MdmLimHomeScreenProps> = ({
  scenario,
  onStartJourney,
  onPlanFallback,
  onNotificationChange,
}) => {
  const dominantHand = useDominantHand();
  // Which option she picked in the disruption box; null means she hasn't
  // chosen yet, so the box (rather than a result card) is what's shown.
  const [routeChoice, setRouteChoice] = useState<'usual' | 'alternative' | null>(null);
  const [savedForTomorrow, setSavedForTomorrow] = useState(() => {
    try {
      return localStorage.getItem(SAVED_TOMORROW_ROUTE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [clockMin, setClockMin] = useState(sgtMinutesNow);
  useEffect(() => {
    const timer = setInterval(() => setClockMin(sgtMinutesNow()), 15000);
    return () => clearInterval(timer);
  }, []);
  const isDemoClock = scenario !== 'live';
  // "Usual journey" shows her trip in progress on appointment day; the other
  // demo scenarios are the night before, when the brief says to warn her.
  const isActiveJourney = scenario === 'usual';
  const baseNowMin = scenario === 'live' ? clockMin : NIGHT_BEFORE_CLOCK_MIN;

  // Live OneMap plans: her usual trip to SGH, plus detours that get off one
  // stop either side of her usual station, for when a lift there is out.
  const [usualOptions, setUsualOptions] = useState<RouteOption[]>([]);
  const [detours, setDetours] = useState<{ via: string; route: RouteOption }[]>([]);
  const [status, setStatus] = useState<'loading' | 'live' | 'unavailable'>('loading');
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const offset = Math.min(120, (APPOINTMENT_MIN - ARRIVE_EARLY_MIN - 60 - sgtMinutesNow() + 1440) % 1440);
      const offsets = Array.from(new Set([offset, Math.max(0, offset - 10), Math.max(0, offset - 20)]));
      const plans = await Promise.all(offsets.map((o) => fetchLiveRoutePlan(HOME, SGH, o, 'transit')));
      if (cancelled) return;
      const options = plans.flatMap((p) => (p.source === 'onemap_live' ? p.itineraries : []));
      setUsualOptions(options);
      setStatus(options.length > 0 ? 'live' : 'unavailable');

      const usual = bestBy(options);
      const alight = usual ? lastTrainStep(usual) : undefined;
      const alightName = prettifyStop(alight?.targetPoint?.name);
      const alightCode = codesFor(alightName).find((c) => c.startsWith(lineLabel(alight?.lineOrService).slice(0, 2))) ?? codesFor(alightName)[0];
      if (!alightCode) return;
      const boardName = prettifyStop(usual?.steps.find((s) => s.type === 'train')?.startPoint?.name);
      const found: { via: string; route: RouteOption }[] = [];
      for (const station of neighbourStations(alightCode, boardName)) {
        const [toStation, onward] = await Promise.all([
          fetchLiveRoutePlan(HOME, station, offset, 'transit'),
          fetchLiveRoutePlan(station, SGH, offset, 'transit'),
        ]);
        const first = bestBy(toStation.source === 'onemap_live' ? toStation.itineraries : []);
        const second = bestBy(
          (onward.source === 'onemap_live' ? onward.itineraries : []).filter((r) => !stationsOn(r).includes(alightName))
        );
        if (first && second) found.push({ via: station.name, route: composeDetour(first, second, station.name) });
      }
      if (!cancelled) setDetours(found);
    };
    load();
    const timer = setInterval(load, 10 * 60000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const usual = useMemo(() => bestBy(usualOptions), [usualOptions]);

  // Live LTA lift maintenance for every station on every candidate route.
  const [lifts, setLifts] = useState<Record<string, LiftState>>({});
  useEffect(() => {
    const names = new Set<string>();
    for (const route of [usual, ...detours.map((d) => d.route)]) if (route) stationsOn(route).forEach((n) => names.add(n));
    if (names.size === 0) return;
    let cancelled = false;
    Promise.all(
      Array.from(names).map(async (name) => {
        const codes = codesFor(name);
        if (codes.length === 0) return [name, { status: 'unknown', items: [] }] as const;
        const results = await Promise.all(codes.map((c) => fetchLiftStatus(c)));
        const items = results.flatMap((r) => r.items);
        const allLive = results.every((r) => r.source === 'lta_live');
        const state: LiftState = { status: items.length > 0 ? 'outage' : allLive ? 'clear' : 'unknown', items };
        return [name, state] as const;
      })
    ).then((entries) => {
      if (!cancelled) setLifts(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [usual, detours]);

  const [weather, setWeather] = useState<WeatherInfo[]>([]);
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchWeather('Bedok'), fetchWeather('Bukit Merah')]).then((w) => {
      if (!cancelled) setWeather(w);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Judging scenarios: a simulated lift outage where she leaves the train
  // (the exit she needs for SGH), or simulated heavy rain. Both labelled in-app.
  const usualAlightName = usual ? prettifyStop(lastTrainStep(usual)?.targetPoint?.name) : '';
  const liftFor = (name: string): LiftState => {
    if (scenario === 'lift' && name === usualAlightName) {
      return {
        status: 'outage',
        items: [{ line: 'EWL', stationCode: codesFor(name)[0] || '', stationName: name, liftDesc: 'lift to the exit for SGH (simulated)' }],
      };
    }
    return lifts[name] ?? { status: 'unknown', items: [] };
  };
  const routeLiftStatus = (route: RouteOption): 'clear' | 'outage' | 'unknown' => {
    const states = stationsOn(route).map((n) => liftFor(n).status);
    if (states.includes('outage')) return 'outage';
    return states.length > 0 && states.every((s) => s === 'clear') ? 'clear' : 'unknown';
  };

  const simulatedRain = scenario === 'rain';
  const isRaining = simulatedRain || (scenario === 'live' && weather.some((w) => w.source === 'data_gov_sg' && w.isRaining));

  const usualLift = usual ? routeLiftStatus(usual) : 'unknown';
  const outageStation = usual ? stationsOn(usual).find((n) => liftFor(n).status === 'outage') : undefined;
  const outageItem = outageStation ? liftFor(outageStation).items[0] : undefined;

  // Recommendation: her usual route unless a lift on it is out (then the
  // quickest detour whose lifts are all working), or it rains and a detour
  // walks less.
  const alternative = useMemo(() => {
    if (!usual) return null;
    if (usualLift === 'outage') {
      const safe = detours.filter((d) => routeLiftStatus(d.route) !== 'outage');
      const verified = safe.filter((d) => routeLiftStatus(d.route) === 'clear');
      const pool = verified.length ? verified : safe;
      return pool.sort((a, b) => herMinutes(a.route) - herMinutes(b.route))[0] ?? null;
    }
    if (isRaining) {
      return (
        detours
          .filter((d) => routeLiftStatus(d.route) !== 'outage' && walkMinutes(d.route) < walkMinutes(usual))
          .sort((a, b) => walkMinutes(a.route) - walkMinutes(b.route))[0] ?? null
      );
    }
    return null;
  }, [usual, usualLift, detours, isRaining, lifts, scenario]); // eslint-disable-line react-hooks/exhaustive-deps

  const recommended = alternative?.route ?? usual;
  const isAlternative = Boolean(alternative);
  const arriveTarget = APPOINTMENT_MIN - ARRIVE_EARLY_MIN;
  const usualLeave = usual ? arriveTarget - herMinutes(usual) : 0;
  const leaveMin = recommended ? arriveTarget - herMinutes(recommended) : 0;
  const leaveEarlierBy = Math.max(0, usualLeave - leaveMin);
  const recommendedLift = recommended ? routeLiftStatus(recommended) : 'unknown';

  // Her actual pick for the "Your recommended journey" card below: follows
  // the automatic recommendation unless she has chosen an option in the
  // disruption box herself.
  const effectiveIsAlternative =
    routeChoice === 'usual' ? false : routeChoice === 'alternative' ? true : isAlternative;
  const effectiveRoute = effectiveIsAlternative && alternative ? alternative.route : usual;
  const effectiveLeaveMin = effectiveIsAlternative ? leaveMin : usualLeave;
  const effectiveLift = effectiveRoute ? routeLiftStatus(effectiveRoute) : 'unknown';

  // In the active journey the demo clock sits at the moment she leaves home.
  const nowMin = isActiveJourney ? leaveMin : baseNowMin;
  const appointmentIsToday = isActiveJourney;
  const minutesToLeave = appointmentIsToday ? leaveMin - nowMin : leaveMin + 1440 - nowMin;
  const dayWord = appointmentIsToday ? 'Today' : 'Tomorrow';

  const disruptionText = (() => {
    if (!usual) return null;
    if (usualLift === 'outage' && outageStation) {
      const detail = outageItem?.liftDesc ? ` (${outageItem.liftDesc})` : '';
      return {
        title: 'Your usual route is disrupted',
        body: alternative
          ? `A lift at ${outageStation} is out of service${detail}. Use this accessible alternative${leaveEarlierBy > 0 ? ` and leave ${leaveEarlierBy} minutes earlier` : ''}.`
          : `A lift at ${outageStation} is out of service${detail}. No verified step-free alternative was found, so please ask station staff for help or change your travel plans.`,
      };
    }
    if (isRaining) {
      return {
        title: 'Rain is expected',
        body: alternative
          ? `This route has less walking outdoors${leaveEarlierBy > 0 ? `. Leave ${leaveEarlierBy} minutes earlier` : ''}.`
          : `Your usual route already has the least walking. Bring an umbrella for the ${Math.round(walkMinutes(usual) * WALK_PACE_FACTOR)} minutes of walking.`,
      };
    }
    return null;
  })();

  // A real disruption with two viable options gets an interactive choice box
  // (like Rachel's/Arjun's); until she picks one, the result card is hidden.
  const awaitingChoice = Boolean(disruptionText) && Boolean(alternative) && routeChoice === null;

  const cards =
    recommended && isActiveJourney
      ? buildProgressCards(recommended, leaveMin, arriveTarget, nowMin, { walkFactor: WALK_PACE_FACTOR, destinationLabel: 'SGH' })
      : [];
  const currentKey = currentCardKey(cards, nowMin);

  const notification: PersonaNotification | null = useMemo(() => {
    if (status !== 'live' || !recommended) return null;
    if (isActiveJourney && cards.length > 0) return progressNotification(cards, nowMin);
    if (usualLift === 'outage' || (isRaining && isAlternative)) {
      return {
        title: 'Your journey has changed',
        body: `Your usual route is disrupted. Take the recommended accessible route${leaveEarlierBy > 0 ? ` and leave ${leaveEarlierBy} minutes earlier` : ''}.`,
      };
    }
    if (isRaining) {
      return {
        title: `Rain expected ${appointmentIsToday ? 'today' : 'tomorrow'}`,
        body: `Leave at ${formatClock(leaveMin)} AM. Your usual route has the least walking, so bring an umbrella.`,
      };
    }
    if (appointmentIsToday) {
      return {
        title: 'Hospital appointment today',
        body: minutesToLeave > 0 ? `Leave in ${minutesToLeave} minutes for your 10:30 AM appointment.` : 'Leave now for your 10:30 AM appointment.',
      };
    }
    return {
      title: 'Hospital appointment tomorrow',
      body: `Leave at ${formatClock(leaveMin)} AM. ${recommendedLift === 'clear' ? 'Your usual route is clear.' : 'Lift status could not be fully checked.'} You can review it tonight.`,
    };
  }, [status, recommended, usualLift, isRaining, isAlternative, leaveEarlierBy, appointmentIsToday, minutesToLeave, leaveMin, recommendedLift, isActiveJourney, cards[0]?.title, cards[0]?.time, nowMin]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onNotificationChange?.(notification);
  }, [notification?.title, notification?.body]); // eslint-disable-line react-hooks/exhaustive-deps

  // A fresh disruption (or it clearing) should show the box again rather
  // than carry over a stale choice from before.
  useEffect(() => {
    setRouteChoice(null);
  }, [disruptionText?.title, isAlternative]);

  const shareText = effectiveRoute
    ? `Mdm Lim's trip to SGH (${dayWord.toLowerCase()}, 10:30 AM appointment): leave home at ${formatClock(effectiveLeaveMin)} AM, ${stepsSummary(effectiveRoute)}, arriving about ${formatClock(arriveTarget)} AM.`
    : '';
  const [shareNote, setShareNote] = useState('');
  const shareRoute = async () => {
    if (!shareText) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Hospital trip', text: shareText });
        setShareNote('Shared.');
      } else {
        await navigator.clipboard.writeText(shareText);
        setShareNote('Route copied. Paste it into a message to your family.');
      }
    } catch {
      setShareNote('Sharing was cancelled.');
    }
  };

  const [helpOpen, setHelpOpen] = useState(false);
  const start = () => {
    if (!recommended) return onPlanFallback();
    onStartJourney(recommended, Math.max(0, Math.min(1440, minutesToLeave)));
  };

  const saveForTomorrow = () => {
    setSavedForTomorrow(true);
    try {
      localStorage.setItem(SAVED_TOMORROW_ROUTE_KEY, 'true');
    } catch {
      // The visible confirmation still works if storage is unavailable.
    }
  };

  return (
    <div id="mdmlim-home-screen" className="relative pt-4 pb-8 space-y-5 animate-in fade-in duration-200">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-[1.625rem] leading-tight font-bold tracking-[-0.02em] text-on-surface">Hello, Madam Lim</h1>
        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          aria-label="Get help"
          className="w-14 h-14 rounded-full bg-primary-fixed text-primary flex items-center justify-center hover:bg-secondary-container transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <Phone className="w-6 h-6" />
        </button>
      </header>

      <div className="flex flex-wrap gap-1.5 -mt-2" aria-label="Data sources">
        {status === 'live' ? <DataBadge tone="live">LIVE</DataBadge> : status === 'unavailable' && <DataBadge tone="demo">Live routes unavailable</DataBadge>}
        <DataBadge tone="demo">Demo appointment</DataBadge>
        {isDemoClock && (
          <DataBadge tone="demo">
            Demo clock · {isActiveJourney ? (recommended ? `${formatClock(nowMin)} am, appointment day` : 'appointment day') : '8:05 pm, night before'}
          </DataBadge>
        )}
        {scenario === 'lift' && <DataBadge tone="demo">Simulated lift outage</DataBadge>}
        {simulatedRain && <DataBadge tone="demo">Simulated rain</DataBadge>}
      </div>

      {isActiveJourney && disruptionText && (
        <section className="rounded-3xl bg-amber-50 border border-amber-200/70 p-5" role="status">
          <h3 className="text-[1.125rem] font-semibold text-on-surface">{disruptionText.title}</h3>
          <p className="mt-1 text-[1.0625rem] text-on-surface-variant leading-relaxed">{disruptionText.body}</p>
        </section>
      )}

      {isActiveJourney && (
        <JourneyProgress
          status={status}
          cards={cards}
          currentKey={currentKey}
          loadingText="Planning your trip to SGH…"
          fallbackLabel="Live routes unavailable. Plan Bedok to SGH"
          onOpenMap={start}
          onPlanFallback={onPlanFallback}
        />
      )}

      {!isActiveJourney && (
      <>
      <div className="flex items-center gap-4">
        <span className="w-14 h-14 rounded-2xl bg-primary-fixed text-primary flex items-center justify-center shrink-0">
          <CalendarDays className="w-6 h-6" />
        </span>
        <div>
          <p className="text-[1rem] text-on-surface-variant">Your appointment</p>
          <p className="text-[1.25rem] text-on-surface">{dayWord} · 10:30 AM · SGH</p>
        </div>
      </div>

      {awaitingChoice ? (
        <section className="rounded-[28px] bg-error-container p-5" aria-label="Disruption on your usual route">
          <div className="flex items-start gap-4">
            <span className="w-16 h-16 rounded-2xl bg-error text-white flex items-center justify-center shrink-0">
              {usualLift === 'outage' ? <AlertTriangle className="w-7 h-7" /> : <CloudRain className="w-7 h-7" />}
            </span>
            <div>
              <h3 className="text-[21px] leading-snug text-on-surface">{disruptionText!.title}</h3>
              <p className="text-[15px] text-on-error-container/80 mt-1">{disruptionText!.body}</p>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-on-error-container/15 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setRouteChoice('usual')}
              className="rounded-2xl p-4 text-left transition-colors cursor-pointer bg-surface-container-lowest border border-outline-variant/70 hover:border-on-surface/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span className="block text-sm text-on-surface-variant">Keep usual route</span>
              <span className="block text-[21px] text-on-surface mt-1 tabular-nums">Leave {formatClock(usualLeave)}</span>
            </button>
            <button
              type="button"
              onClick={() => setRouteChoice('alternative')}
              className="rounded-2xl p-4 text-left transition-colors cursor-pointer bg-primary-fixed border-2 border-primary-container hover:bg-secondary-container/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span className="block text-sm text-on-surface-variant">
                {usualLift === 'outage' ? 'Accessible detour' : 'Sheltered detour'}
              </span>
              <span className="block text-[21px] text-on-surface mt-1 tabular-nums">Leave {formatClock(leaveMin)}</span>
              <span className="block mt-2 text-xs font-bold uppercase tracking-[0.08em] text-primary">Recommended</span>
            </button>
          </div>
        </section>
      ) : (
        <>
          {disruptionText && routeChoice === null && (
            <section className="rounded-3xl bg-amber-50 border border-amber-200/70 p-5" role="status">
              <h3 className="flex items-center gap-2 text-[1.125rem] font-semibold text-on-surface">
                {usualLift === 'outage' ? <AlertTriangle className="w-5 h-5 shrink-0 text-amber-700" /> : <CloudRain className="w-5 h-5 shrink-0 text-amber-700" />}
                {disruptionText.title}
              </h3>
              <p className="mt-1 text-[1.0625rem] text-on-surface-variant leading-relaxed">{disruptionText.body}</p>
            </section>
          )}

          <h2 className="text-[2rem] leading-[1.1] font-bold tracking-[-0.025em] text-on-surface">Your recommended journey</h2>

          {status === 'loading' && (
            <div className="rounded-[28px] bg-primary-fixed p-5 text-[1.0625rem] text-on-surface-variant">
              Planning your whole trip to SGH, including the walk at each end…
            </div>
          )}
          {status === 'unavailable' && (
            <div className="rounded-[28px] border border-outline-variant p-5 space-y-3">
              <p className="text-[1.0625rem] text-on-surface-variant">Live routes are unavailable right now, so no journey is being guessed.</p>
              <button type="button" onClick={onPlanFallback} className="w-full min-h-14 rounded-2xl bg-primary-container text-on-primary text-[1.125rem] font-semibold cursor-pointer">
                Plan Bedok to SGH
              </button>
            </div>
          )}

          {effectiveRoute && (
        <section className="rounded-[28px] bg-primary-fixed p-5 space-y-4" aria-label="Your chosen journey">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[0.8125rem] font-bold uppercase tracking-[0.08em] text-primary">
                {routeChoice !== null ? 'Your choice' : 'Best option for you'}
              </p>
              <h3 className="mt-1.5 text-[1.5rem] leading-tight font-bold text-on-surface">
                {effectiveIsAlternative ? 'Alternative hospital route' : 'Your usual hospital route'}
              </h3>
              <p className="mt-1 text-[1.0625rem] text-on-surface-variant">
                {effectiveIsAlternative
                  ? usualLift === 'outage'
                    ? `Avoids the lift outage at ${outageStation}`
                    : 'Less walking outdoors in the rain'
                  : 'The route you usually take'}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[2.25rem] leading-none font-semibold text-on-surface tabular-nums">{formatClock(effectiveLeaveMin)}</p>
              <p className="mt-1 text-[1rem] text-on-surface-variant">leave home</p>
            </div>
          </div>

          <JourneyStrip route={effectiveRoute} />

          <p className="text-[1.0625rem] text-on-surface">
            Arrive about {formatClock(arriveTarget)} AM, {ARRIVE_EARLY_MIN} minutes before your appointment.
            <span className="block text-[0.9375rem] text-on-surface-variant">Walking times allow for a slower pace.</span>
          </p>

          <div className="grid grid-cols-2 gap-2">
            <span className="flex items-center gap-2 rounded-2xl bg-surface-container-lowest px-3.5 py-3 text-[1rem] font-semibold text-on-surface">
              <Accessibility className="w-5 h-5 shrink-0" />
              {effectiveLift === 'clear' ? 'Accessible route' : 'Check lifts'}
            </span>
            <span className="flex items-center gap-2 rounded-2xl bg-surface-container-lowest px-3.5 py-3 text-[1rem] font-semibold text-on-surface">
              {effectiveLift === 'clear' ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertTriangle className="w-5 h-5 shrink-0" />}
              {effectiveLift === 'clear'
                ? effectiveIsAlternative
                  ? 'Accessibility checked'
                  : 'All facilities available'
                : 'Lift status unavailable'}
            </span>
          </div>

          <button
            type="button"
            onClick={saveForTomorrow}
            disabled={savedForTomorrow}
            className={`w-full min-h-14 rounded-2xl text-on-primary text-[1.125rem] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
              savedForTomorrow
                ? 'bg-tertiary cursor-default'
                : 'bg-primary-container hover:bg-primary cursor-pointer'
            }`}
          >
            {savedForTomorrow ? 'Saved for tomorrow ✓' : 'Save for tomorrow'}
          </button>
          {savedForTomorrow && (
            <p className="text-center text-[0.9375rem] text-primary font-semibold" role="status">
              Your hospital journey has been saved for tomorrow.
            </p>
          )}
        </section>
      )}

      {effectiveRoute && (
        <div className="text-center">
          <button
            type="button"
            onClick={shareRoute}
            className="min-h-12 px-4 text-[1.125rem] text-primary font-semibold hover:underline underline-offset-4 cursor-pointer rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Share route with family
          </button>
          {shareNote && <p className="text-[0.9375rem] text-on-surface-variant" role="status">{shareNote}</p>}
        </div>
      )}
        </>
      )}
      </>
      )}

      {helpOpen && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-end justify-center" onClick={() => setHelpOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Help"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[430px] rounded-t-[28px] bg-surface p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] space-y-4"
          >
            <div className={`flex items-center justify-between ${dominantHand === 'left' ? 'flex-row-reverse' : ''}`}>
              <h2 className="text-[1.5rem] font-bold text-on-surface">Need help?</h2>
              <button type="button" onClick={() => setHelpOpen(false)} aria-label="Close help" className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <button
              type="button"
              onClick={shareRoute}
              className="w-full min-h-14 rounded-2xl bg-primary-container text-on-primary text-[1.125rem] font-semibold flex items-center justify-center gap-2 cursor-pointer"
            >
              <Share2 className="w-5 h-5" /> Send my route to family
            </button>
            <a
              href="tel:995"
              className="w-full min-h-14 rounded-2xl border-2 border-error text-error text-[1.125rem] font-semibold flex items-center justify-center gap-2"
            >
              <Phone className="w-5 h-5" /> Emergency: call 995
            </a>
            <p className="text-[1.0625rem] text-on-surface-variant leading-relaxed">
              At any MRT station, staff at the Passenger Service Centre can help you find a working lift or exit.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

function stepsSummary(route: RouteOption): string {
  const parts: string[] = [];
  for (const step of route.steps) {
    if (step.type === 'bus') parts.push(`Bus ${step.lineOrService} to ${prettifyStop(step.targetPoint?.name)}`);
    else if (step.type === 'train') parts.push(`${lineLabel(step.lineOrService)} to ${prettifyStop(step.targetPoint?.name)}`);
  }
  return parts.join(', then ');
}

// First way she travels, the train she takes, and how she reaches SGH.
const JourneyStrip: React.FC<{ route: RouteOption }> = ({ route }) => {
  const firstIdx = route.steps.findIndex((s) => isTransitStep(s.type));
  const first = route.steps[firstIdx];
  const train = route.steps.find((s) => s.type === 'train');
  let lastTransit = -1;
  route.steps.forEach((s, i) => {
    if (isTransitStep(s.type)) lastTransit = i;
  });
  const last = route.steps[lastTransit];
  const finalWalk = route.steps.slice(lastTransit + 1).reduce((t, s) => t + (s.durationMin || 0), 0);

  const nodes: { icon: React.ReactNode; label: string; sub: string; color?: string }[] = [];
  if (first?.type === 'bus') nodes.push({ icon: <BusFront className="w-5 h-5" />, label: `Bus ${first.lineOrService}`, sub: 'usual stop' });
  if (train) nodes.push({ icon: <TrainFront className="w-5 h-5" />, label: lineLabel(train.lineOrService), sub: `to ${prettifyStop(train.targetPoint?.name)}`, color: lineColor(train.lineOrService) });
  if (last && last !== first && last.type === 'bus') {
    nodes.push({ icon: <BusFront className="w-5 h-5" />, label: `Bus ${last.lineOrService}`, sub: 'to SGH' });
  } else {
    nodes.push({ icon: <Footprints className="w-5 h-5" />, label: 'Walk', sub: `to SGH · ${Math.round(finalWalk * WALK_PACE_FACTOR)} min` });
  }

  return (
    <div className="flex items-start" aria-label="Route">
      {nodes.map((node, i) => (
        <React.Fragment key={`${node.label}-${i}`}>
          {i > 0 && <ArrowRight aria-hidden="true" className="w-5 h-5 mt-3.5 shrink-0 text-on-surface-variant" />}
          <div className="flex-1 min-w-0 flex flex-col items-center text-center">
            <span
              className={`w-12 h-12 rounded-full flex items-center justify-center ${node.color ? 'text-white' : 'bg-surface-container-lowest text-secondary'}`}
              style={node.color ? { backgroundColor: node.color } : undefined}
            >
              {node.icon}
            </span>
            <span className="mt-2 text-[1.0625rem] font-semibold text-on-surface leading-tight">{node.label}</span>
            <span className="text-[0.9375rem] text-on-surface-variant leading-tight text-balance">{node.sub}</span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
};
