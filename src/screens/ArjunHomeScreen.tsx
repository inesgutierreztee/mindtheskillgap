import React, { useEffect, useMemo, useState } from 'react';
import { Bike, BusFront, Clock, CloudRain, Footprints, TrainFront, User, Users, ArrowRight } from 'lucide-react';
import { ArjunScenario, RouteOption, UserPreferences } from '../types';
import { fetchLiveMultimodalPlan, fetchLiveRoutePlan } from '../services/routingService';
import { fetchWeather, WeatherInfo } from '../services/weatherService';
import { resolveStationCoords } from '../utils/stationLookup';
import {
  formatClock,
  isTransitStep,
  lineColor,
  lineLabel,
  prettifyStop,
  routeMinutes,
  sgtMinutesNow,
  stepStartTimes,
} from '../utils/journeyMath';
import { DataBadge } from '../components/DataBadge';
import { RachelNotification as PersonaNotification } from './RachelHomeScreen';

// Arjun, per the brief: Punggol -> one-north, cycles to the LRT or takes a bus,
// start time flexible within about an hour, optimises for comfort over speed.
// Persona assumptions: home is Blk 261 Punggol Way (beside Soo Teck LRT), work
// is right by one-north MRT, and his flexible hour is 8:00-9:00 am.
const HOME = { lat: 1.405413, lng: 103.89682 };
const WORK = { lat: 1.29966, lng: 103.78739 };
const WINDOW_START_MIN = 8 * 60;
const WINDOW_END_MIN = 9 * 60;
const DEMO_CLOCK_MIN = 8 * 60 + 2;
const LEAVE_STEP_MIN = 5;
const NEL_TERMINUS = 'NE17';

type FirstMile = 'cycle' | 'bus' | 'lrt' | 'walk';
type CrowdRank = 0 | 1 | 2;

interface CrowdFeed {
  realtime: Record<string, 'l' | 'm' | 'h'>;
  forecast: Record<string, { start: string; level: 'l' | 'm' | 'h' }[]>;
}

interface ArjunHomeScreenProps {
  userPreferences: UserPreferences;
  scenario: ArjunScenario;
  onStartJourney: (route: RouteOption, departureOffsetMin: number) => void;
  onPlanFallback: () => void;
  onOpenProfile: () => void;
  onNotificationChange?: (notification: PersonaNotification | null) => void;
}

const CODE_RANK: Record<'l' | 'm' | 'h', CrowdRank> = { l: 0, m: 1, h: 2 };
const LOAD_RANK: Record<string, CrowdRank> = {
  'Seats available': 0,
  'Standing available': 1,
  'Moderate crowd': 1,
  Crowded: 2,
};
const CROWD_LABEL = ['Low crowding', 'Moderate crowds', 'High crowding'];

function firstMileOf(route: RouteOption): FirstMile {
  const first = route.steps.find((s) => s.type === 'cycle' || isTransitStep(s.type));
  if (!first) return 'walk';
  if (first.type === 'cycle') return 'cycle';
  if (first.type === 'bus') return 'bus';
  if (lineLabel(first.lineOrService) === 'LRT') return 'lrt';
  return 'walk';
}

// Minutes spent outside a vehicle: cycling plus every walk.
const exposedMinutes = (route: RouteOption) =>
  route.steps
    .filter((s) => s.type === 'cycle' || s.type === 'walk')
    .reduce((total, s) => total + (s.durationMin || 0), 0);

const nelBoardingIndex = (route: RouteOption) =>
  route.steps.findIndex((s) => s.type === 'train' && lineLabel(s.lineOrService) !== 'LRT');

// The MRT station list doesn't cover LRT; Soo Teck is the LRT stop beside his home.
const LRT_STATION_CODES: Record<string, string> = { 'Soo Teck': 'PW7' };

function stationCode(name?: string): string | null {
  const pretty = prettifyStop(name);
  return LRT_STATION_CODES[pretty] ?? resolveStationCoords(pretty)?.code ?? null;
}

// Dark ink on light line colours (e.g. the CCL's yellow), white on the rest.
function inkFor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const luminance = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return luminance > 0.6 ? '#10302c' : '#ffffff';
}

function forecastRankAt(feed: CrowdFeed | null, code: string | null, minuteOfDay: number): CrowdRank | null {
  if (!feed || !code) return null;
  const intervals = feed.forecast[code];
  if (intervals?.length) {
    const hit = intervals.find((interval) => {
      const match = /T(\d{2}):(\d{2})/.exec(interval.start);
      if (!match) return false;
      const start = Number(match[1]) * 60 + Number(match[2]);
      return minuteOfDay >= start && minuteOfDay < start + 30;
    });
    if (hit) return CODE_RANK[hit.level];
  }
  const now = feed.realtime[code];
  return now ? CODE_RANK[now] : null;
}

interface RankedOption {
  route: RouteOption;
  mode: FirstMile;
  leaveMin: number;
  arriveMin: number;
  crowd: CrowdRank | null;
  exposure: number;
  busService?: string;
  busCrowded: boolean;
  leaveShiftedForCrowds: boolean;
  nelStation: string;
}

function firstMileLabel(option: RankedOption): string {
  if (option.mode === 'cycle') return 'Cycle';
  if (option.mode === 'bus') return `Bus ${option.busService || ''}`.trim();
  if (option.mode === 'lrt') return 'LRT';
  return 'Walk';
}

function routeSentence(route: RouteOption): string {
  const parts: string[] = [];
  let seenMrt = false;
  for (const step of route.steps) {
    const target = prettifyStop(step.targetPoint?.name);
    if (step.type === 'cycle') parts.push(`Cycle to ${target} and park`);
    else if (step.type === 'bus') parts.push(`Bus ${step.lineOrService} to ${target}`);
    else if (step.type === 'train') {
      const code = lineLabel(step.lineOrService);
      if (code === 'LRT') parts.push(`LRT to ${target}`);
      else {
        parts.push(`${seenMrt ? 'change to ' : ''}${code} to ${target}`);
        seenMrt = true;
      }
    }
  }
  const sentence = parts.join(' → ');
  return sentence ? `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.` : '';
}

const OptionCard: React.FC<{
  eyebrow: string;
  title: string;
  subtitle: string;
  option: RankedOption;
  onStart: () => void;
  id: string;
}> = ({ eyebrow, title, subtitle, option, onStart, id }) => {
  const route = option.route;
  const firstMileStep = route.steps.find((s) => s.type === 'cycle' || isTransitStep(s.type));
  const firstMileWhere =
    option.mode === 'cycle'
      ? prettifyStop(firstMileStep?.targetPoint?.name)
      : prettifyStop(firstMileStep?.startPoint?.name);
  const mrtLegs = route.steps.filter((s) => s.type === 'train' && lineLabel(s.lineOrService) !== 'LRT').slice(0, 2);
  const firstMileIcon =
    option.mode === 'cycle' ? <Bike className="w-5 h-5" /> : option.mode === 'bus' ? <BusFront className="w-5 h-5" /> : option.mode === 'lrt' ? <TrainFront className="w-5 h-5" /> : <Footprints className="w-5 h-5" />;

  const nodes = [
    { icon: firstMileIcon, label: firstMileLabel(option), sub: firstMileWhere, color: option.mode === 'lrt' ? lineColor('PW') : undefined },
    ...mrtLegs.map((leg) => ({
      icon: <TrainFront className="w-5 h-5" />,
      label: lineLabel(leg.lineOrService),
      sub: `to ${prettifyStop(leg.targetPoint?.name)}`,
      color: lineColor(leg.lineOrService),
    })),
  ];

  return (
    <section id={id} className="rounded-[28px] bg-primary-fixed p-5 space-y-4" aria-label={`${eyebrow}: ${title}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-bold uppercase tracking-[0.08em] text-primary">{eyebrow}</p>
          <h3 className="mt-1.5 text-[22px] leading-tight font-bold text-on-surface">{title}</h3>
          <p className="mt-1 text-[15px] text-on-surface-variant">{subtitle}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[34px] leading-none font-semibold tracking-[-0.02em] text-on-surface tabular-nums">
            {formatClock(option.leaveMin)}
          </p>
          <p className="mt-1.5 text-sm text-on-surface-variant">leave home</p>
        </div>
      </div>

      <div className="flex items-start" aria-label="Route">
        {nodes.map((node, i) => (
          <React.Fragment key={`${node.label}-${i}`}>
            {i > 0 && <ArrowRight aria-hidden="true" className="w-5 h-5 mt-3.5 shrink-0 text-on-surface-variant" />}
            <div className="flex-1 min-w-0 flex flex-col items-center text-center">
              <span
                className={`w-12 h-12 rounded-full flex items-center justify-center ${
                  node.color ? '' : 'bg-surface-container-lowest text-secondary'
                }`}
                style={node.color ? { backgroundColor: node.color, color: inkFor(node.color) } : undefined}
              >
                {node.icon}
              </span>
              <span className="mt-2 text-base font-semibold text-on-surface leading-tight">{node.label}</span>
              <span className="text-sm text-on-surface-variant leading-tight text-balance">{node.sub}</span>
            </div>
          </React.Fragment>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <span className="flex items-center gap-2 rounded-2xl bg-surface-container-lowest px-3.5 py-3 text-[15px] font-semibold text-on-surface">
          <Users className="w-5 h-5 shrink-0" />
          {option.crowd === null ? 'Crowding unknown' : CROWD_LABEL[option.crowd]}
        </span>
        <span className="flex items-center gap-2 rounded-2xl bg-surface-container-lowest px-3.5 py-3 text-[15px] font-semibold text-on-surface tabular-nums">
          <Clock className="w-5 h-5 shrink-0" />
          Arrive {formatClock(option.arriveMin)}
        </span>
      </div>

      <p className="text-sm text-on-surface-variant leading-snug">{routeSentence(route)}</p>

      <button
        type="button"
        onClick={onStart}
        className="w-full min-h-14 rounded-2xl bg-primary-container hover:bg-primary text-on-primary text-lg font-semibold transition-colors cursor-pointer active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        Start this journey
      </button>
    </section>
  );
};

export const ArjunHomeScreen: React.FC<ArjunHomeScreenProps> = ({
  userPreferences,
  scenario,
  onStartJourney,
  onPlanFallback,
  onOpenProfile,
  onNotificationChange,
}) => {
  const isDemoClock = scenario !== 'live';
  // Which option he picked in the disruption box; null means he hasn't chosen
  // yet, so the box (rather than a result card) is what's shown.
  const [selectedOption, setSelectedOption] = useState<'best' | 'alternative' | null>(null);
  const [clockMin, setClockMin] = useState(sgtMinutesNow);
  useEffect(() => {
    const timer = setInterval(() => setClockMin(sgtMinutesNow()), 15000);
    return () => clearInterval(timer);
  }, []);
  const nowMin = isDemoClock ? DEMO_CLOCK_MIN : clockMin;
  const cyclingAllowed = Boolean(userPreferences.transportModes.cycling && userPreferences.cyclingPreferences.enabled);

  // Live OneMap options for his next commute window (up to 2h ahead).
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [status, setStatus] = useState<'loading' | 'live' | 'unavailable'>('loading');
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      const offset = Math.min(120, (WINDOW_START_MIN - sgtMinutesNow() + 1440) % 1440);
      // OneMap returns only its top three itineraries, and which bus or LRT
      // option makes the cut shifts minute to minute, so sample a few nearby
      // departures and merge them.
      const offsets = Array.from(new Set([offset, Math.max(0, offset - 10), Math.max(0, offset - 20)]));
      Promise.all([
        Promise.all(offsets.map((o) => fetchLiveRoutePlan(HOME, WORK, o, 'transit'))),
        cyclingAllowed
          ? fetchLiveMultimodalPlan(HOME, WORK, offset, userPreferences.cyclingPreferences.bikeAtStation)
          : Promise.resolve(null),
      ]).then(([transitPlans, multimodal]) => {
        if (cancelled) return;
        const found = [
          ...transitPlans.flatMap((plan) => (plan.source === 'onemap_live' ? plan.itineraries : [])),
          ...(multimodal?.source === 'onemap_live' ? multimodal.itineraries : []),
        ];
        setRoutes(found);
        setStatus(found.length > 0 ? 'live' : 'unavailable');
      });
    };
    load();
    const timer = setInterval(load, 5 * 60000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [cyclingAllowed, userPreferences.cyclingPreferences.bikeAtStation]);

  // One option per first-mile mode he actually uses (cycle, bus, LRT): the quickest of each.
  const candidates = useMemo(() => {
    const best = new Map<FirstMile, RouteOption>();
    for (const route of routes) {
      const mode = firstMileOf(route);
      if (mode === 'walk') continue;
      if (mode === 'cycle' && route.bicycleParkingAvailable === false && userPreferences.cyclingPreferences.avoidWhen.noBikeParking) continue;
      const current = best.get(mode);
      if (!current || routeMinutes(route) < routeMinutes(current)) best.set(mode, route);
    }
    return Array.from(best.entries()).map(([mode, route]) => ({ mode, route }));
  }, [routes, userPreferences.cyclingPreferences.avoidWhen.noBikeParking]);

  // Live crowding: LTA bus Load at each boarding stop, NEL station crowding
  // (now + 30-minute forecast) and Punggol LRT crowding.
  const [busLoads, setBusLoads] = useState<Record<string, CrowdRank>>({});
  const [nelFeed, setNelFeed] = useState<CrowdFeed | null>(null);
  const [lrtFeed, setLrtFeed] = useState<CrowdFeed | null>(null);
  useEffect(() => {
    if (candidates.length === 0) return;
    let cancelled = false;
    const busStops = new Map<string, string>();
    const nelCodes = new Set<string>([NEL_TERMINUS]);
    const lrtCodes = new Set<string>();
    for (const { route } of candidates) {
      for (const step of route.steps) {
        if (step.type === 'bus' && step.boardingStopCode && step.lineOrService) busStops.set(step.boardingStopCode, step.lineOrService);
        if (step.type === 'train') {
          const code = stationCode(step.startPoint?.name);
          if (!code) continue;
          if (lineLabel(step.lineOrService) === 'LRT') lrtCodes.add(code);
          else if (code.startsWith('NE')) nelCodes.add(code);
        }
      }
    }
    const crowd = (line: string, codes: Set<string>) =>
      codes.size === 0
        ? Promise.resolve(null)
        : fetch(`/api/station-crowd?line=${line}&stations=${Array.from(codes).join(',')}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((json) => (json?.source === 'lta_live' ? (json as CrowdFeed) : null))
            .catch(() => null);
    Promise.all([
      crowd('NEL', nelCodes),
      crowd('PLRT', lrtCodes),
      Promise.all(
        Array.from(busStops.entries()).map(([stopCode, service]) =>
          fetch(`/api/bus-arrivals?stopCode=${encodeURIComponent(stopCode)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((json) => {
              if (json?.source !== 'lta_live') return null;
              const arrival = (json.arrivals || []).find((a: { serviceNo: string }) => a.serviceNo === service);
              return arrival ? ([`${stopCode}:${service}`, LOAD_RANK[arrival.crowdLevel] ?? 0] as const) : null;
            })
            .catch(() => null)
        )
      ),
    ]).then(([nel, lrt, loads]) => {
      if (cancelled) return;
      setNelFeed(nel);
      setLrtFeed(lrt);
      const map: Record<string, CrowdRank> = {};
      for (const entry of loads) if (entry) map[entry[0]] = entry[1];
      setBusLoads(map);
    });
    return () => {
      cancelled = true;
    };
  }, [candidates]);

  const [weather, setWeather] = useState<WeatherInfo[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      Promise.all([fetchWeather('Punggol'), fetchWeather('Queenstown')]).then((results) => {
        if (!cancelled) setWeather(results);
      });
    load();
    const timer = setInterval(load, 5 * 60000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const simulatedRain = scenario === 'rain';
  const simulatedCrowding = scenario === 'crowd';
  const liveRain = weather.some((w) => w.source === 'data_gov_sg' && w.isRaining);
  const isRaining = scenario === 'normal' || scenario === 'crowd' ? false : simulatedRain || liveRain;

  const windowIsTomorrow = nowMin >= WINDOW_END_MIN;
  const windowStart = windowIsTomorrow ? WINDOW_START_MIN : Math.max(WINDOW_START_MIN, nowMin);
  const forecastUsable = !windowIsTomorrow;

  const ranked: RankedOption[] = useMemo(() => {
    return candidates.map(({ mode, route }) => {
      const nelIdx = nelBoardingIndex(route);
      const nelCode = nelIdx >= 0 ? stationCode(route.steps[nelIdx].startPoint?.name) : null;
      const offsetToNel = nelIdx >= 0 ? stepStartTimes(route, 0)[nelIdx] : 0;
      const busStep = route.steps.find((s) => s.type === 'bus');
      const lrtStep = route.steps.find((s) => s.type === 'train' && lineLabel(s.lineOrService) === 'LRT');

      const busRankLive = busStep ? busLoads[`${busStep.boardingStopCode}:${busStep.lineOrService}`] : undefined;
      const busRank: CrowdRank | null = busStep ? (simulatedCrowding ? 2 : busRankLive ?? null) : null;
      const lrtCode = lrtStep ? stationCode(lrtStep.startPoint?.name) : null;
      const lrtRank = lrtStep && lrtFeed && lrtCode && lrtFeed.realtime[lrtCode] ? CODE_RANK[lrtFeed.realtime[lrtCode]] : null;

      const nelRankAt = (leave: number): CrowdRank | null => {
        const rank = forecastUsable ? forecastRankAt(nelFeed, nelCode, leave + offsetToNel) : null;
        if (rank === null) return null;
        // Simulated build-up: one level busier everywhere except the terminus, where trains start empty.
        return simulatedCrowding && nelCode !== NEL_TERMINUS ? (Math.min(2, rank + 1) as CrowdRank) : rank;
      };

      // His flexible hour: the leave time with the quietest NEL boarding, earliest on ties.
      let leaveMin = windowStart;
      let bestNel = nelRankAt(windowStart);
      if (forecastUsable) {
        for (let leave = windowStart; leave <= WINDOW_END_MIN; leave += LEAVE_STEP_MIN) {
          const rank = nelRankAt(leave);
          if (rank !== null && (bestNel === null || rank < bestNel)) {
            bestNel = rank;
            leaveMin = leave;
          }
        }
      }

      const known = [busRank, lrtRank, bestNel].filter((r): r is CrowdRank => r !== null);
      return {
        route,
        mode,
        leaveMin,
        arriveMin: leaveMin + routeMinutes(route),
        crowd: known.length ? (Math.max(...known) as CrowdRank) : null,
        exposure: exposedMinutes(route),
        busService: busStep?.lineOrService,
        busCrowded: busRank === 2,
        leaveShiftedForCrowds: leaveMin > windowStart,
        nelStation: nelIdx >= 0 ? prettifyStop(route.steps[nelIdx].startPoint?.name) : '',
      };
    });
  }, [candidates, busLoads, nelFeed, lrtFeed, simulatedCrowding, windowStart, forecastUsable]);

  // Comfort first: in rain, least time outside; otherwise least crowding, then
  // his habit of cycling when it's dry, then least time outside, then speed.
  const ordered = useMemo(() => {
    const crowdOf = (o: RankedOption) => (o.crowd === null ? 1 : o.crowd);
    return [...ranked].sort((a, b) => {
      if (isRaining) return a.exposure - b.exposure || crowdOf(a) - crowdOf(b) || a.arriveMin - b.arriveMin;
      const cyclePref = cyclingAllowed ? Number(b.mode === 'cycle') - Number(a.mode === 'cycle') : 0;
      return crowdOf(a) - crowdOf(b) || cyclePref || a.exposure - b.exposure || a.arriveMin - b.arriveMin;
    });
  }, [ranked, isRaining, cyclingAllowed]);

  // In rain, cycling drops out entirely when his preferences say to avoid it.
  const avoidCyclingNow = isRaining && userPreferences.cyclingPreferences.avoidWhen.heavyRain;
  const shown = avoidCyclingNow ? ordered.filter((o) => o.mode !== 'cycle') : ordered;
  const best = shown[0];
  const alternative = shown[1];
  const crowdedBus = ranked.find((o) => o.busCrowded);
  const hasCycleOption = ranked.some((o) => o.mode === 'cycle');
  // Crowding only shapes the headline when some option is genuinely busier than the pick.
  const busierOption = best ? ranked.find((o) => o !== best && (o.crowd ?? 0) > (best.crowd ?? 0)) : undefined;
  const crowdingMatters = Boolean(busierOption);

  const bestTitle = !best ? '' : isRaining ? 'More sheltered trip' : crowdingMatters ? 'Lower-crowd trip' : 'Quietest trip';
  const bestSubtitle = !best
    ? ''
    : isRaining
    ? hasCycleOption && best.mode !== 'cycle'
      ? 'Avoids the exposed cycling section'
      : `${best.exposure} min outdoors`
    : crowdingMatters
    ? crowdedBus && best.mode !== 'bus'
      ? `Avoids the crowded Bus ${crowdedBus.busService}`
      : busierOption?.nelStation && busierOption.nelStation !== best.nelStation
      ? `Avoids the crowds building at ${busierOption.nelStation}`
      : 'Lowest crowding on your commute'
    : best.leaveShiftedForCrowds
    ? 'Leave at the best time to miss the peak'
    : 'Crowds are low right now';

  const altTitle = !alternative
    ? ''
    : alternative.mode === 'cycle'
    ? 'Cycle instead'
    : alternative.mode === 'bus'
    ? 'Bus connection'
    : 'LRT connection';
  const altSubtitle = (() => {
    if (!best || !alternative) return '';
    const diff = alternative.arriveMin - best.arriveMin;
    const timing = diff === 0 ? 'same arrival time' : `${Math.abs(diff)} min ${diff < 0 ? 'faster' : 'slower'}`;
    const crowdWord =
      alternative.crowd === null ? 'crowding unknown' : alternative.crowd <= (best.crowd ?? 0) ? 'still quiet' : 'slightly busier';
    const phrase = `${crowdWord}, ${timing}`;
    return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}`;
  })();

  // A genuine disruption today: rain, or a busier option than the one he'd
  // otherwise be shown. Only then does he get an explicit route choice.
  const disrupted = isRaining || crowdingMatters;
  const disruptionTitle = isRaining ? 'Rain is affecting your commute' : 'Crowding is affecting your commute';
  const disruptionBody = isRaining
    ? hasCycleOption && best && best.mode !== 'cycle'
      ? 'Heavy rain is affecting your usual cycling leg. A different first-mile option keeps you drier.'
      : `Rain is forecast along your usual route. ${bestSubtitle}.`
    : crowdedBus && best && best.mode !== 'bus'
    ? `Bus ${crowdedBus.busService} is getting crowded. ${bestSubtitle}.`
    : busierOption?.nelStation
    ? `Crowds are building at ${busierOption.nelStation}. ${bestSubtitle}.`
    : `Your usual pick is busier than normal today. ${bestSubtitle}.`;
  const chosen = selectedOption === 'alternative' && alternative ? alternative : best;

  const notification: PersonaNotification | null = useMemo(() => {
    if (status !== 'live' || !best) return null;
    const bestPhrase =
      best.mode === 'cycle'
        ? `cycling to ${prettifyStop(best.route.steps.find((s) => s.type === 'cycle')?.targetPoint?.name)}`
        : best.mode === 'bus'
        ? `Bus ${best.busService}`
        : 'the LRT';
    if (isRaining) {
      return {
        title: 'Comfort update',
        body:
          hasCycleOption && best.mode !== 'cycle'
            ? `Heavy rain is affecting your cycling section. We recommend ${bestPhrase}.`
            : `Rain is expected. We recommend ${bestPhrase} to stay drier.`,
      };
    }
    if (crowdedBus && best.mode !== 'bus') {
      return { title: 'Comfort update', body: `Crowds on Bus ${crowdedBus.busService} are increasing. We recommend ${bestPhrase} instead.` };
    }
    if (busierOption?.nelStation && busierOption.nelStation !== best.nelStation) {
      return { title: 'Comfort update', body: `Crowds are building at ${busierOption.nelStation}. We recommend ${bestPhrase} instead.` };
    }
    return {
      title: 'Comfort update',
      body: `Crowds are ${best.crowd === 0 || best.crowd === null ? 'low' : 'building'}. Take ${bestPhrase} and leave at ${formatClock(best.leaveMin)}.`,
    };
  }, [status, best, isRaining, hasCycleOption, crowdedBus, busierOption]);

  useEffect(() => {
    onNotificationChange?.(notification);
  }, [notification?.title, notification?.body]); // eslint-disable-line react-hooks/exhaustive-deps

  // A fresh disruption (or the disruption clearing) should show the box
  // again rather than carry over a stale choice from before.
  useEffect(() => {
    setSelectedOption(null);
  }, [disrupted]);

  const greeting = nowMin < 12 * 60 ? 'Morning' : nowMin < 18 * 60 ? 'Afternoon' : 'Evening';
  const start = (option: RankedOption) => {
    const offset = (windowIsTomorrow ? option.leaveMin + 1440 : option.leaveMin) - nowMin;
    onStartJourney(option.route, Math.max(0, offset));
  };

  return (
    <div id="arjun-home-screen" className="pt-4 pb-8 space-y-5 animate-in fade-in duration-200">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-[26px] leading-tight font-bold tracking-[-0.02em] text-on-surface">{greeting}, Arjun</h1>
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
        {status === 'live' ? <DataBadge tone="live">LIVE</DataBadge> : status === 'unavailable' && <DataBadge tone="demo">Live routes unavailable</DataBadge>}
        {isDemoClock && <DataBadge tone="demo">Demo clock · 8:02 am</DataBadge>}
        {simulatedCrowding && <DataBadge tone="demo">Simulated crowding</DataBadge>}
        {simulatedRain && <DataBadge tone="demo">Simulated rain</DataBadge>}
      </div>

      <section className="space-y-2">
        <p className="text-[13px] font-bold uppercase tracking-[0.08em] text-primary">Comfort-first recommendation</p>
        <h2 className="text-[32px] leading-[1.1] font-bold tracking-[-0.025em] text-on-surface text-balance">
          How would you like to travel today?
        </h2>
        <p className="text-[17px] leading-relaxed text-on-surface-variant text-pretty">
          {windowIsTomorrow
            ? 'Planning your next commute window, 8:00 to 9:00 tomorrow.'
            : 'Choose what matters now. We will adjust the route and when you should leave.'}
        </p>
      </section>

      {status === 'loading' && (
        <div className="rounded-[28px] bg-primary-fixed p-5 text-[15px] text-on-surface-variant">
          Comparing live cycling, bus and LRT options from Punggol…
        </div>
      )}

      {status === 'unavailable' && (
        <div className="rounded-[28px] border border-outline-variant p-5 space-y-3">
          <p className="text-[15px] text-on-surface-variant">
            Live route options are unavailable right now, so no recommendation is being invented.
          </p>
          <button
            type="button"
            onClick={onPlanFallback}
            className="w-full min-h-12 rounded-2xl bg-primary-container hover:bg-primary text-on-primary text-base font-semibold cursor-pointer"
          >
            Plan Punggol to one-north
          </button>
        </div>
      )}

      {disrupted && best && alternative ? (
        selectedOption === null ? (
          <section className="rounded-[28px] bg-error-container p-5" aria-label="Disruption on your usual pick">
            <div className="flex items-start gap-4">
              <span className="w-16 h-16 rounded-2xl bg-error text-white flex items-center justify-center shrink-0">
                {isRaining ? <CloudRain className="w-7 h-7" /> : <Users className="w-7 h-7" />}
              </span>
              <div>
                <h3 className="text-[21px] leading-snug text-on-surface">{disruptionTitle}</h3>
                <p className="text-[15px] text-on-error-container/80 mt-1">{disruptionBody}</p>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-on-error-container/15 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSelectedOption('alternative')}
                className="rounded-2xl p-4 text-left transition-colors cursor-pointer bg-surface-container-lowest border border-outline-variant/70 hover:border-on-surface/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <span className="block text-sm text-on-surface-variant">{altTitle}</span>
                <span className="block text-[21px] text-on-surface mt-1 tabular-nums">Arrive {formatClock(alternative.arriveMin)}</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedOption('best')}
                className="rounded-2xl p-4 text-left transition-colors cursor-pointer bg-primary-fixed border-2 border-primary-container hover:bg-secondary-container/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <span className="block text-sm text-on-surface-variant">{bestTitle}</span>
                <span className="block text-[21px] text-on-surface mt-1 tabular-nums">Arrive {formatClock(best.arriveMin)}</span>
                <span className="block mt-2 text-xs font-bold uppercase tracking-[0.08em] text-primary">Recommended</span>
              </button>
            </div>
          </section>
        ) : (
          chosen && (
            <OptionCard
              id="arjun-chosen-option"
              eyebrow={selectedOption === 'best' ? 'Your choice · recommended' : 'Your choice'}
              title={selectedOption === 'best' ? bestTitle : altTitle}
              subtitle={selectedOption === 'best' ? bestSubtitle : altSubtitle}
              option={chosen}
              onStart={() => start(chosen)}
            />
          )
        )
      ) : (
        <>
          {best && (
            <OptionCard id="arjun-best-match" eyebrow="Best match" title={bestTitle} subtitle={bestSubtitle} option={best} onStart={() => start(best)} />
          )}
          {alternative && (
            <OptionCard id="arjun-alternative" eyebrow="Alternative" title={altTitle} subtitle={altSubtitle} option={alternative} onStart={() => start(alternative)} />
          )}
        </>
      )}
    </div>
  );
};
