import React from 'react';

interface PreferenceToggleProps {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (nextState: boolean) => void;
  badge?: string;
}

export const PreferenceToggle: React.FC<PreferenceToggleProps> = ({
  id,
  title,
  description,
  enabled,
  onToggle,
  badge,
}) => {
  return (
    <div
      id={`pref-card-${id}`}
      onClick={() => onToggle(!enabled)}
      className="bg-surface-container-lowest rounded-2xl p-4 border border-outline-variant/30 card-shadow flex items-start justify-between gap-4 cursor-pointer select-none active:scale-[0.99] transition-all hover:border-outline-variant"
    >
      <div className="flex-1 pr-1 space-y-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-on-surface leading-snug">{title}</h3>
          {badge && (
            <span className="text-[11px] font-semibold bg-secondary-fixed text-on-secondary-fixed-variant px-2 py-0.5 rounded-full">
              {badge}
            </span>
          )}
        </div>
        <p className="text-xs text-on-surface-variant leading-relaxed">{description}</p>
      </div>

      <button
        id={`toggle-btn-${id}`}
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={(e) => {
          e.stopPropagation();
          onToggle(!enabled);
        }}
        className={`w-[51px] h-[31px] rounded-full p-[2px] transition-colors duration-200 ease-in-out relative shrink-0 focus:outline-none focus:ring-2 focus:ring-primary-container focus:ring-offset-1 cursor-pointer ${
          enabled ? 'bg-primary-container' : 'bg-outline-variant'
        }`}
      >
        <span className="sr-only">Toggle {title}</span>
        <span
          className={`w-[27px] h-[27px] bg-surface-container-lowest rounded-full block shadow-md transform transition-transform duration-200 ease-in-out pointer-events-none ${
            enabled ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
};
