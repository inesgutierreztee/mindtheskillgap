import React from 'react';
import { Building2, BusFront, Crosshair, Footprints, Map as MapIcon, TrainFront } from 'lucide-react';
import { RouteOption } from '../types';
import { SINGAPORE_MRT_STATIONS } from '../data/mrtStationsData';
import { formatClock, isTransitStep, lineColor, lineLabel, lineName, prettifyStop } from '../utils/journeyMath';

export interface ProgressCard {
  key: string;
  kind: 'bus' | 'train' | 'walk';
  title: string;
  detail: string;
  time: number;
  timeLabel: 'leave' | 'board' | 'arrive';
  endsAt: number;
  color?: string;
}

const isWalk = (type: string) => type === 'walk' || type === 'transfer';

export const inMinutes = (n: number) => (n <= 0 ? 'now' : `in ${n} minute${n === 1 ? '' : 's'}`);

// Start time of each step: walks scaled by the traveller's pace, platform
// waiting (OneMap's total minus leg times) placed before the first boarding.
export function scheduleAtPace(route: RouteOption, leaveMin: number, walkFactor: number): number[] {
  const firstTransit = route.steps.findIndex((s) => isTransitStep(s.type));
  const legTotal = route.steps.reduce((t, s) => t + (s.durationMin || 0), 0);
  const wait = Math.max(0, route.totalDurationMin - legTotal);
  let t = leaveMin;
  return route.steps.map((s, i) => {
    if (i === firstTransit) t += wait;
    const start = Math.round(t);
    t += (s.durationMin || 0) * (isWalk(s.type) ? walkFactor : 1);
    return start;
  });
}

// The end of the line a train is heading towards, from the station numbering.
function terminusFor(lineCode: string, fromName: string, toName: string): string | null {
  const prefix: Record<string, string> = { EWL: 'EW', NSL: 'NS', CCL: 'CC', DTL: 'DT', NEL: 'NE', TEL: 'TE' };
  const p = prefix[lineCode];
  if (!p) return null;
  const num = (name: string) => {
    const code = SINGAPORE_MRT_STATIONS.find((s) => s.name === name && s.code.startsWith(p))?.code;
    return code ? Number(code.slice(p.length)) : null;
  };
  const from = num(fromName);
  const to = num(toName);
  if (from === null || to === null || from === to) return null;
  const onLine = SINGAPORE_MRT_STATIONS.filter((s) => new RegExp(`^${p}\\d+$`).test(s.code)).sort(
    (a, b) => Number(a.code.slice(p.length)) - Number(b.code.slice(p.length))
  );
  return (to > from ? onLine[onLine.length - 1] : onLine[0])?.name ?? null;
}

interface CardOptions {
  walkFactor: number;
  destinationLabel: string;
}

export function buildProgressCards(
  route: RouteOption,
  leaveMin: number,
  arriveMin: number,
  nowMin: number,
  { walkFactor, destinationLabel }: CardOptions
): ProgressCard[] {
  const schedule = scheduleAtPace(route, leaveMin, walkFactor);
  const cards: ProgressCard[] = [];
  // A trip that starts on foot to a train gets its own first step; a bus card
  // already covers the walk to the stop ("arrives at your usual stop in...").
  const firstTransit = route.steps.findIndex((s) => isTransitStep(s.type));
  if (firstTransit > 0 && route.steps[firstTransit].type === 'train') {
    const station = prettifyStop(route.steps[firstTransit].startPoint?.name);
    const walk = Math.round(route.steps.slice(0, firstTransit).reduce((t, s) => t + (s.durationMin || 0), 0) * walkFactor);
    cards.push({
      key: 'walk-start',
      kind: 'walk',
      title: `Walk to ${station} station`,
      detail: `${walk} min walk${walkFactor !== 1 ? ' at your pace' : ''}`,
      time: leaveMin,
      timeLabel: 'leave',
      endsAt: leaveMin + walk,
    });
  }
  let lastTransit = -1;
  route.steps.forEach((step, i) => {
    if (!isTransitStep(step.type)) return;
    lastTransit = i;
    const start = schedule[i];
    const end = start + (step.durationMin || 0);
    const target = prettifyStop(step.targetPoint?.name);
    if (step.type === 'bus') {
      const where = cards.every((c) => c.kind === 'walk') ? 'your usual stop' : prettifyStop(step.startPoint?.name);
      cards.push({
        key: `bus-${i}`,
        kind: 'bus',
        title: `Bus ${step.lineOrService}`,
        detail: nowMin < start ? `Arrives at ${where} ${inMinutes(start - nowMin)}` : `${step.durationMin} min to ${target}`,
        time: start,
        timeLabel: 'board',
        endsAt: end,
      });
    } else {
      const towards = terminusFor(lineLabel(step.lineOrService), prettifyStop(step.startPoint?.name), target);
      const timing = nowMin < start ? `train arrives ${inMinutes(start - nowMin)}` : `${step.durationMin} min to ${target}`;
      cards.push({
        key: `train-${i}`,
        kind: 'train',
        title: lineName(step.lineOrService),
        detail: towards ? `Towards ${towards} · ${timing}` : timing,
        time: start,
        timeLabel: 'board',
        endsAt: end,
        color: lineColor(step.lineOrService),
      });
    }
  });
  const alightName = lastTransit >= 0 ? prettifyStop(route.steps[lastTransit].targetPoint?.name) : '';
  const finalWalk = Math.round(
    route.steps.slice(lastTransit + 1).reduce((t, s) => t + (s.durationMin || 0), 0) * walkFactor
  );
  cards.push({
    key: 'walk',
    kind: 'walk',
    title: `Walk to ${destinationLabel}`,
    detail: `Get off at ${alightName} · ${finalWalk} min walk${walkFactor !== 1 ? ' at your pace' : ''}`,
    time: arriveMin,
    timeLabel: 'arrive',
    endsAt: arriveMin,
  });
  return cards;
}

// Whichever step hasn't finished yet; the last one once everything else has.
export const currentCardKey = (cards: ProgressCard[], nowMin: number) =>
  cards.find((c) => c.endsAt > nowMin)?.key ?? cards[cards.length - 1]?.key;

export function progressNotification(cards: ProgressCard[], nowMin: number) {
  const next = cards.find((c) => c.kind !== 'walk');
  if (!next) return null;
  return {
    title: 'Journey in progress',
    body:
      next.kind === 'bus'
        ? `${next.title} arrives at your stop ${inMinutes(next.time - nowMin)}.`
        : `The ${next.title} train arrives ${inMinutes(next.time - nowMin)}.`,
  };
}

export const JourneyProgress: React.FC<{
  status: 'loading' | 'live' | 'unavailable';
  cards: ProgressCard[];
  currentKey?: string;
  destinationIcon?: 'walk' | 'building';
  loadingText: string;
  fallbackLabel: string;
  onOpenMap: () => void;
  onPlanFallback: () => void;
}> = ({ status, cards, currentKey, destinationIcon = 'walk', loadingText, fallbackLabel, onOpenMap, onPlanFallback }) => (
  <section className="space-y-4" aria-label="Your usual journey">
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-[1rem] font-semibold text-primary">
        <Crosshair className="w-5 h-5" /> Journey progress
      </p>
      <h2 className="text-[2rem] leading-[1.1] font-bold tracking-[-0.025em] text-on-surface">Your usual journey</h2>
      <p className="text-[1.0625rem] text-on-surface-variant">Only the step you need now is highlighted.</p>
    </div>

    {status === 'loading' && (
      <div className="rounded-[24px] bg-primary-fixed p-5 text-[1.0625rem] text-on-surface-variant">{loadingText}</div>
    )}
    {status === 'unavailable' && (
      <button
        type="button"
        onClick={onPlanFallback}
        className="w-full min-h-14 rounded-2xl bg-primary-container text-on-primary text-[1.125rem] font-semibold cursor-pointer"
      >
        {fallbackLabel}
      </button>
    )}

    <ol className="space-y-3">
      {cards.map((card) => {
        const active = card.key === currentKey;
        const icon =
          card.kind === 'bus' ? (
            <BusFront className="w-6 h-6" />
          ) : card.kind === 'train' ? (
            <TrainFront className="w-6 h-6" />
          ) : card.key === 'walk' && destinationIcon === 'building' ? (
            <Building2 className="w-6 h-6" />
          ) : (
            <Footprints className="w-6 h-6" />
          );
        return (
          <li
            key={card.key}
            aria-current={active ? 'step' : undefined}
            className={`flex items-center gap-4 rounded-[24px] border p-4 transition-colors ${
              active ? 'border-2 border-primary-container bg-primary-fixed' : 'border-outline-variant bg-surface-container-lowest'
            }`}
          >
            <span
              className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${
                card.color ? 'text-white' : active ? 'bg-surface-container-lowest text-secondary' : 'bg-secondary-fixed text-secondary'
              }`}
              style={card.color ? { backgroundColor: card.color } : undefined}
            >
              {icon}
            </span>
            <span className="flex-1 min-w-0">
              <span className={`block text-[1.25rem] leading-snug text-on-surface ${active ? 'font-semibold' : ''}`}>{card.title}</span>
              <span className="block text-[1rem] text-on-surface-variant leading-snug">{card.detail}</span>
            </span>
            <span className="text-right shrink-0">
              <span className="block text-[1.375rem] text-on-surface tabular-nums">{formatClock(card.time)}</span>
              <span className="block text-[0.9375rem] text-on-surface-variant">{card.timeLabel}</span>
            </span>
          </li>
        );
      })}
    </ol>

    {cards.length > 0 && (
      <div className="sticky bottom-4 flex justify-end pointer-events-none">
        <button
          type="button"
          onClick={onOpenMap}
          aria-label="Open the step-by-step map"
          className="pointer-events-auto w-16 h-16 rounded-full bg-on-surface text-surface flex items-center justify-center shadow-[0_8px_20px_rgba(16,48,44,0.25)] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <MapIcon className="w-6 h-6" />
        </button>
      </div>
    )}
  </section>
);
