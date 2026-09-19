import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowRight,
  RefreshCw,
  Info,
} from 'lucide-react';
import { DisruptionAlert, TrainStation, LineSummary, UserPreferences } from '../types';
import { StatusChip } from '../components/StatusChip';

interface AlertsScreenProps {
  disruption: DisruptionAlert | null;
  trainStations: TrainStation[];
  lineSummaries: LineSummary[];
  isLiveMode?: boolean;
  liveStatusKnown?: boolean;
  userPreferences: UserPreferences;
  onViewReroute: () => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
}

export const AlertsScreen: React.FC<AlertsScreenProps> = ({
  disruption,
  trainStations,
  lineSummaries,
  isLiveMode = false,
  liveStatusKnown = false,
  userPreferences,
  onViewReroute,
  onRefresh,
  isRefreshing = false,
}) => {
  const isCompactAlertMode = userPreferences.alertThresholdMin !== undefined;
  const normalCount = lineSummaries.filter((l) => l.isNormal).length;

  return (
    <div id="alerts-screen-content" className="space-y-4 pb-8 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div>
          <h2 className="text-xl font-bold text-on-surface tracking-tight">Transit Alerts</h2>
          <p className="text-xs text-on-surface-variant flex items-center gap-1.5">
            <span>{isLiveMode ? 'Live disruption monitoring & rerouting' : 'Demo disruption monitoring & rerouting'}</span>
            {liveStatusKnown && (
              <span
                className={`text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
                  isLiveMode ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                }`}
              >
                {isLiveMode ? 'Live' : 'Demo'}
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-xs font-semibold text-on-surface transition-all cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* ACTIVE HIGH-PRIORITY DISRUPTION ALERT */}
      {disruption && disruption.active && (
        isCompactAlertMode ? (
          // One line, one action - for a user who only wants to be interrupted
          // for significant delays, the interruption itself stays minimal too.
          <button
            id="high-priority-disruption-card-compact"
            type="button"
            onClick={onViewReroute}
            className="w-full bg-error-container/30 border border-error/30 rounded-2xl px-4 py-3 card-shadow flex items-center justify-between gap-2 cursor-pointer hover:bg-error-container/45 transition-colors text-left"
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
            id="high-priority-disruption-card"
            className="bg-error-container/30 border border-error/30 rounded-2xl p-4 card-shadow space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-error font-bold text-xs uppercase tracking-wider">
                <AlertTriangle className="w-4 h-4" />
                <span>{disruption.line}</span>
              </div>
              <span className="text-[11px] font-semibold bg-error text-white px-2.5 py-0.5 rounded-full">
                {disruption.confidence}% confidence
              </span>
            </div>

            <div>
              <h3 className="text-base font-bold text-on-surface leading-snug">
                {disruption.headline}
              </h3>
              <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
                {disruption.subText}
              </p>
            </div>

            {/* Structured Guidance Box */}
            <div className="bg-surface-container-lowest rounded-xl p-3.5 border border-outline-variant/30 space-y-2.5 text-xs">
              <div>
                <div className="font-bold text-on-surface">What happened:</div>
                <p className="text-on-surface-variant mt-0.5 leading-relaxed">
                  {disruption.whatHappened}
                </p>
              </div>

              <div className="border-t border-outline-variant/20 pt-2">
                <div className="font-bold text-on-surface">How it affects you:</div>
                <p className="text-on-surface-variant mt-0.5 leading-relaxed">
                  {disruption.howItAffectsYou}
                </p>
              </div>

              <div className="border-t border-outline-variant/20 pt-2">
                <div className="font-bold text-primary">What you should do:</div>
                <p className="text-on-surface-variant mt-0.5 leading-relaxed">
                  {disruption.whatYouShouldDo}
                </p>
              </div>
            </div>

            <button
              id="btn-alerts-view-reroute"
              type="button"
              onClick={onViewReroute}
              className="w-full py-3 bg-primary-container hover:bg-primary text-on-primary rounded-full text-xs font-semibold flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
            >
              <span>View recommended alternate route</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )
      )}

      {/* LINE-BY-LINE SERVICE STATUS */}
      <div className="bg-surface-container-lowest rounded-2xl p-4 card-shadow border border-outline-variant/30 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-on-surface">MRT & LRT Line Health</h3>
          {lineSummaries.length > 0 && (
            <span className="text-[11px] text-tertiary font-semibold flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {normalCount} of {lineSummaries.length} normal
            </span>
          )}
        </div>

        {lineSummaries.length === 0 ? (
          <p className="text-xs text-on-surface-variant py-2">Loading live line status...</p>
        ) : (
          <div className="divide-y divide-outline-variant/20">
            {lineSummaries.map((item) => (
              <div key={item.line} className="py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-10 text-center font-bold text-xs py-1 rounded-lg text-white"
                    style={{ backgroundColor: item.color }}
                  >
                    {item.line}
                  </span>
                  <div>
                    <div className="text-xs font-bold text-on-surface">{item.name}</div>
                    <div className="text-[11px] text-on-surface-variant">{item.crowdSummary}</div>
                  </div>
                </div>

                <div>
                  <StatusChip type="train" value={item.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
};
