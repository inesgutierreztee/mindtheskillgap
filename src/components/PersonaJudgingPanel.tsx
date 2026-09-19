import React from 'react';
import { Route } from 'lucide-react';
import { RachelNotification } from '../screens/RachelHomeScreen';

interface PersonaJudgingPanelProps<T extends string> {
  scenarios: { id: T; label: string }[];
  scenario: T;
  onChangeScenario: (scenario: T) => void;
  caption: string;
  notification: RachelNotification | null;
  notificationTime: string;
}

// Judging-only controls, rendered beside the phone frame on wide screens so they
// never occupy the app's own screen. Every override they apply is also
// labelled inside the app itself.
export function PersonaJudgingPanel<T extends string>({
  scenarios,
  scenario,
  onChangeScenario,
  caption,
  notification,
  notificationTime,
}: PersonaJudgingPanelProps<T>) {
  return (
  <aside
    aria-label="Judging controls"
    className="theme-teal hidden lg:flex fixed left-6 top-6 z-50 w-[272px] flex-col gap-4 text-on-surface"
  >
    <div className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-[0.08em] text-on-surface-variant">Judging controls</p>
      <div className="flex flex-col gap-2" role="radiogroup" aria-label="Demo scenario">
        {scenarios.map((s) => {
          const active = scenario === s.id;
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChangeScenario(s.id)}
              className={`w-full min-h-11 px-5 rounded-full text-[15px] font-semibold text-left border transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                active
                  ? 'bg-on-surface text-surface border-on-surface'
                  : 'bg-surface-container-lowest text-on-surface border-outline-variant hover:border-on-surface/40'
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-on-surface-variant leading-relaxed">{caption}</p>
    </div>

    {notification && (
      <div className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-on-surface-variant">Notification preview</p>
        <div className="rounded-3xl bg-surface-container-lowest border border-outline-variant/60 p-4 flex items-start gap-3 shadow-[0_8px_24px_rgba(16,48,44,0.08)]">
          <span className="w-11 h-11 rounded-xl bg-primary-container text-on-primary flex items-center justify-center shrink-0">
            <Route className="w-5 h-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[15px] font-semibold text-on-surface leading-snug">{notification.title}</p>
              <span className="text-xs text-on-surface-variant tabular-nums shrink-0">{notificationTime}</span>
            </div>
            <p className="text-sm text-on-surface-variant mt-0.5">{notification.body}</p>
          </div>
        </div>
      </div>
    )}
  </aside>
);
}
