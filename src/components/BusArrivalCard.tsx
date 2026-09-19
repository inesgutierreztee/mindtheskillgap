import React from 'react';
import { Bus, Accessibility } from 'lucide-react';
import { BusArrival } from '../types';
import { StatusChip } from './StatusChip';

interface BusArrivalCardProps {
  arrival: BusArrival;
  onClick?: () => void;
}

export const BusArrivalCard: React.FC<BusArrivalCardProps> = ({ arrival, onClick }) => {
  return (
    <div
      id={`bus-service-${arrival.serviceNo}`}
      onClick={onClick}
      className="bg-surface-container-lowest rounded-2xl p-4 border border-outline-variant/30 card-shadow hover:border-primary-container transition-all cursor-pointer"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary-container text-on-primary flex items-center justify-center font-bold text-xl tracking-tight shadow-xs">
            {arrival.serviceNo}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold text-on-surface">
                {arrival.destination}
              </h3>
              {arrival.wheelchair && (
                <Accessibility className="w-3.5 h-3.5 text-outline" title="Wheelchair accessible" />
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <StatusChip type="crowd" value={arrival.crowdLevel} />
              <StatusChip type="traffic" value={arrival.traffic} />
            </div>
          </div>
        </div>

        {/* Live Arrival Minutes */}
        <div className="text-right">
          <div className="flex items-baseline justify-end gap-1">
            <span className="text-2xl font-bold text-on-surface tracking-tight leading-none">
              {arrival.nextBusMin <= 0 ? (
                <span className="text-tertiary">Arr</span>
              ) : (
                arrival.nextBusMin
              )}
            </span>
            {arrival.nextBusMin > 0 && (
              <span className="text-xs font-semibold text-on-surface-variant">min</span>
            )}
          </div>

          <div className="flex items-center justify-end gap-1 mt-1.5 text-[11px] text-outline font-medium">
            {arrival.subsequentBusMin !== undefined && (
              <span>Following: {arrival.subsequentBusMin}m</span>
            )}
            {arrival.thirdBusMin !== undefined && (
              <>
                <span>·</span>
                <span>{arrival.thirdBusMin}m</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
