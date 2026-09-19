import React from 'react';
import { X, Footprints, Navigation } from 'lucide-react';
import { BusArrival, BusStop } from '../types';
import { BusArrivalCard } from './BusArrivalCard';
import { useDominantHand } from '../context/DominantHandContext';

interface BottomSheetProps {
  busStop: BusStop | null;
  arrivals: BusArrival[];
  loading?: boolean;
  onClose: () => void;
  onSelectRouteForStop?: (busStop: BusStop) => void;
}

export const BottomSheet: React.FC<BottomSheetProps> = ({
  busStop,
  arrivals,
  loading = false,
  onClose,
  onSelectRouteForStop,
}) => {
  const dominantHand = useDominantHand();
  if (!busStop) return null;

  return (
    <div
      id="bus-stop-bottom-sheet-backdrop"
      className="fixed inset-0 bg-black/25 backdrop-blur-[1px] z-50 flex items-end justify-center pointer-events-auto"
      onClick={onClose}
    >
      <div
        id="bus-stop-bottom-sheet"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[430px] bg-white bg-surface-container-lowest rounded-t-[28px] custom-sheet-shadow border-t border-outline-variant/20 z-50 max-h-[75vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-250 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        {/* Drag handle */}
        <div className="w-full flex justify-center pt-2.5 pb-1">
          <div className="w-10 h-1 bg-outline-variant rounded-full" />
        </div>

        {/* Header */}
        <div className="px-5 pb-3 pt-1 border-b border-outline-variant/30">
          <div className={`flex items-start justify-between ${dominantHand === 'left' ? 'flex-row-reverse' : ''}`}>
            <div className={`flex-1 ${dominantHand === 'left' ? 'pl-2' : 'pr-2'}`}>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-secondary-fixed text-on-secondary-fixed-variant">
                  Stop {busStop.code}
                </span>
                <span className="text-xs text-outline font-medium">{busStop.road}</span>
              </div>
              <h2 className="text-base font-bold text-on-surface mt-1">
                {busStop.desc}
              </h2>
              <div className="flex items-center gap-2 mt-1 text-xs text-on-surface-variant">
                <Footprints className="w-3.5 h-3.5 text-outline" />
                <span>{busStop.walkMinutes || 2} min walk • {busStop.distanceMeters || 120} m</span>
              </div>
            </div>

            <button
              id="close-bottom-sheet-btn"
              type="button"
              onClick={onClose}
              className="w-11 h-11 rounded-full bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant transition-colors cursor-pointer shrink-0"
              aria-label="Close sheet"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content: Live Arrivals */}
        <div className="px-4 py-3 overflow-y-auto flex-1 space-y-2.5">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-bold uppercase tracking-wider text-outline">
              Live Arrivals
            </h3>
            {loading && (
              <span className="text-[11px] text-primary animate-pulse font-medium">
                Updating timings...
              </span>
            )}
          </div>

          {arrivals.length === 0 ? (
            <div className="py-8 text-center text-sm text-outline">
              Buses off service at this stop right now.
            </div>
          ) : (
            arrivals.map((arrival) => (
              <BusArrivalCard
                key={arrival.serviceNo}
                arrival={arrival}
                onClick={() => onSelectRouteForStop?.(busStop)}
              />
            ))
          )}

          {onSelectRouteForStop && (
            <button
              type="button"
              onClick={() => onSelectRouteForStop(busStop)}
              className="w-full mt-2 py-3.5 bg-primary-container hover:bg-primary text-on-primary rounded-full text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm active:scale-[0.98]"
            >
              <Navigation className="w-4 h-4" />
              <span>Plan journey from this stop</span>
            </button>
          )}
        </div>

        {/* Home Indicator */}
        <div className="w-32 h-1 bg-on-surface/20 rounded-full mx-auto mt-2 mb-1 shrink-0" />
      </div>
    </div>
  );
};
