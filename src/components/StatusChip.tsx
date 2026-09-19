import React from 'react';
import { getCrowdTierInfo } from '../utils/crowdLevel';

interface StatusChipProps {
  type: 'crowd' | 'traffic' | 'train' | 'badge' | 'live' | 'neutral';
  value: string;
  size?: 'sm' | 'md';
}

export const StatusChip: React.FC<StatusChipProps> = ({ type, value, size = 'sm' }) => {
  let style = 'bg-surface-container text-on-surface-variant border-outline-variant/30';
  const crowdTier = type === 'crowd' ? getCrowdTierInfo(value) : null;

  if (type === 'live') {
    style = 'bg-on-tertiary-container text-tertiary border-tertiary-fixed font-semibold';
  } else if (type === 'badge') {
    if (value === 'BEST MATCH' || value === 'RECOMMENDED FOR YOU') {
      style = 'bg-primary-container text-on-primary border-primary-container font-semibold';
    } else if (value === 'FASTEST') {
      style = 'bg-secondary-container text-on-secondary-container border-secondary-container font-medium';
    } else if (value === 'SIMPLEST') {
      style = 'bg-surface-container-high text-on-surface font-medium';
    } else {
      style = 'bg-on-surface text-surface-container-lowest';
    }
  } else if (crowdTier) {
    style = `${crowdTier.bgClass} ${crowdTier.textClass} font-semibold`;
  } else if (type === 'traffic') {
    if (value === 'Smooth' || value === 'Traffic smooth') {
      style = 'bg-tertiary-container/15 text-tertiary font-semibold';
    } else if (value === 'Moderate') {
      style = 'bg-surface-container text-on-surface-variant';
    } else {
      style = 'bg-secondary-container/40 text-on-secondary-container font-semibold';
    }
  } else if (type === 'train') {
    if (value.includes('Normal')) {
      style = 'bg-tertiary-container/15 text-tertiary font-semibold';
    } else if (value.includes('Minor') || value.includes('Slow')) {
      style = 'bg-secondary-container/40 text-on-secondary-container font-semibold';
    } else {
      style = 'bg-error-container text-on-error-container font-semibold';
    }
  }

  const sizeClasses = size === 'sm' ? 'px-2.5 py-0.5 text-[11px]' : 'px-3 py-1 text-xs';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border ${sizeClasses} ${style} transition-colors whitespace-nowrap`}
    >
      {type === 'live' && (
        <span className="w-1.5 h-1.5 rounded-full bg-tertiary animate-pulse" />
      )}
      {crowdTier && (
        <span className="flex items-end gap-[1.5px]" aria-hidden="true">
          {[1, 2, 3].map((bar) => (
            <span
              key={bar}
              className="w-[3px] rounded-[1px]"
              style={{
                height: `${3 + bar * 2}px`,
                backgroundColor: bar <= crowdTier.tier ? crowdTier.hex : 'currentColor',
                opacity: bar <= crowdTier.tier ? 1 : 0.25,
              }}
            />
          ))}
        </span>
      )}
      {value}
    </span>
  );
};
