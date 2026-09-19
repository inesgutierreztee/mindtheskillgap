import React from 'react';
import { RefreshCw } from 'lucide-react';
import { LiveTransportCondition } from '../types';
import { StatusChip } from './StatusChip';

interface NearbyLiveTransitProps {
  liveConditions: LiveTransportCondition[];
  busesOffService?: boolean;
  isRefreshingLive?: boolean;
  onRefreshLive: () => void;
  onSwitchToMap?: () => void;
  onPlanTrip: (origin?: string, destination?: string) => void;
}

export const NearbyLiveTransit: React.FC<NearbyLiveTransitProps> = ({
  liveConditions,
  busesOffService = false,
  isRefreshingLive = false,
  onRefreshLive,
  onSwitchToMap,
  onPlanTrip,
}) => {
  // Distance is the primary ordering: arrival time only breaks a tie at the
  // same stop. This keeps the list useful as a "what can I board near me?"
  // view instead of silently prioritising a bus much farther away.
  const nearbyFirst = [...liveConditions].sort((a, b) => {
    const distanceA = a.distanceMeters ?? Number.MAX_SAFE_INTEGER;
    const distanceB = b.distanceMeters ?? Number.MAX_SAFE_INTEGER;
    return distanceA - distanceB || a.nextArrivalMin - b.nextArrivalMin;
  });

  return (
  <div className="bg-surface-container-lowest rounded-2xl p-4 card-shadow border border-outline-variant/30 space-y-3">
    <div className="flex items-center justify-between">
      <div>
        <h3 className="text-sm font-bold text-on-surface">Live Nearby Transit</h3>
        <p className="text-xs text-on-surface-variant">Real-time arrival feeds</p>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRefreshLive}
          disabled={isRefreshingLive}
          aria-label="Refresh live transit arrivals"
          className="w-7 h-7 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingLive ? 'animate-spin' : ''}`} />
        </button>
        {onSwitchToMap && (
          <button
            type="button"
            onClick={onSwitchToMap}
            className="text-xs font-semibold text-primary hover:underline cursor-pointer"
          >
            View map
          </button>
        )}
      </div>
    </div>

    <div className="space-y-2 pt-1">
      {busesOffService && (
        <div className="px-3 py-2 rounded-xl bg-surface-container-low text-[11px] text-on-surface-variant">
          Buses off service nearby right now — showing nearby trains only.
        </div>
      )}
      {nearbyFirst.length === 0 && (
        <div className="px-3 py-4 text-center text-xs text-outline">No live transit data available right now.</div>
      )}
      {nearbyFirst.slice(0, 4).map((item) => (
        <div
          key={item.id}
          // Start planning from the actual boarding stop, never from display
          // text such as "Bus 168 · Bedok Int" that a place search cannot map.
          onClick={() => onPlanTrip(item.boardingStopName || item.routeTitle)}
          className="p-3 rounded-xl border border-outline-variant/30 hover:border-primary-container/40 flex items-center justify-between cursor-pointer transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs ${
                item.type === 'bus'
                  ? 'bg-primary-container text-on-primary'
                  : 'bg-secondary-container text-on-secondary-container'
              }`}
            >
              {item.serviceOrLine}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-on-surface truncate">
                {item.type === 'bus' && item.destination
                  ? `Bus ${item.serviceOrLine} · towards ${item.destination}`
                  : item.routeTitle}
              </div>
              {item.type === 'bus' && item.boardingStopName && (
                <div className="text-[11px] text-on-surface-variant mt-0.5 truncate">
                  Board at {item.boardingStopName}
                  {typeof item.distanceMeters === 'number' ? ` · ${Math.round(item.distanceMeters)} m away` : ''}
                </div>
              )}
              <div className="flex items-center gap-1 mt-0.5">
                <StatusChip type="crowd" value={item.crowdLevel} />
              </div>
            </div>
          </div>

          <div className="text-right">
            <div className="text-base font-bold text-on-surface">
              {item.nextArrivalMin <= 0 ? 'Arr' : `${item.nextArrivalMin}m`}
            </div>
            <div className="text-[11px] text-outline">{item.trafficOrStatus}</div>
          </div>
        </div>
      ))}
    </div>
  </div>
  );
};
