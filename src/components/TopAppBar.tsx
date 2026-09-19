import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useDominantHand } from '../context/DominantHandContext';

interface TopAppBarProps {
  title?: string;
  onBack?: () => void;
  showBack?: boolean;
  onSkip?: () => void;
  showSkip?: boolean;
  skipLabel?: string;
  isLive?: boolean;
  liveStatusKnown?: boolean;
  rightAction?: React.ReactNode;
  subtitle?: string;
}

export const TopAppBar: React.FC<TopAppBarProps> = ({
  title = 'Transit Companion',
  onBack,
  showBack = true,
  onSkip,
  showSkip = false,
  skipLabel = 'Skip',
  isLive = false,
  liveStatusKnown = false,
  rightAction,
  subtitle,
}) => {
  const dominantHand = useDominantHand();
  // One-handed mode: the back button moves to a floating thumb-reach button
  // near the bottom of the screen instead of the top-left corner, so it never
  // has to be reached with a stretch.
  const backFloats = dominantHand !== 'off' && showBack && Boolean(onBack);

  return (
    <header className="w-full bg-surface shrink-0 z-20 select-none">
      {/* iOS Status Bar Mock */}
      <div className="w-full flex justify-between items-center px-4 pt-3 pb-1 text-on-surface">
        <span className="text-sm font-semibold tracking-tight">9:41</span>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-on-surface" />
          <div className="w-2 h-2 rounded-full bg-on-surface" />
          <div className="w-4 h-2.5 rounded-xs border border-on-surface flex items-center p-0.5">
            <div className="h-full w-full bg-on-surface rounded-3xs" />
          </div>
        </div>
      </div>

      {/* Main Top Nav Row */}
      <nav className="flex justify-between items-center w-full px-4 py-2 bg-surface min-h-[48px]">
        <div className="flex items-center gap-1 min-w-[44px]">
          {showBack && onBack && !backFloats ? (
            <button
              id="top-bar-back-button"
              type="button"
              onClick={onBack}
              aria-label="Go back"
              className="flex items-center justify-center w-11 h-11 -ml-2.5 rounded-full hover:bg-surface-container-high text-on-surface active:scale-95 transition-all cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
            </button>
          ) : (
            <div className="w-7" />
          )}
        </div>

        <div className="flex flex-col items-center text-center px-1 flex-1 min-w-0">
          <div className="flex items-center gap-1.5 max-w-full truncate">
            {isLive && (
              <span className="inline-flex items-center gap-1 bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-0.5 rounded-full text-[11px] font-bold tracking-wider uppercase shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                LIVE
              </span>
            )}
            {liveStatusKnown && !isLive && (
              <span className="inline-flex items-center gap-1 bg-amber-50 border border-amber-200 text-amber-700 px-2 py-0.5 rounded-full text-[11px] font-bold tracking-wider uppercase shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                DEMO DATA
              </span>
            )}
            <h1 className="text-base font-semibold text-on-surface tracking-tight truncate">
              {title}
            </h1>
          </div>
          {subtitle && (
            <span className="text-[11px] text-on-surface-variant font-medium truncate">
              {subtitle}
            </span>
          )}
        </div>

        <div className="flex items-center justify-end min-w-[44px]">
          {rightAction ? (
            rightAction
          ) : showSkip && onSkip ? (
            <button
              id="top-bar-skip-button"
              type="button"
              onClick={onSkip}
              className="text-xs font-semibold text-primary hover:opacity-80 active:scale-95 transition-all px-2 py-1 rounded cursor-pointer"
            >
              {skipLabel}
            </button>
          ) : (
            <div className="w-7" />
          )}
        </div>
      </nav>

      {backFloats && (
        <button
          id="top-bar-back-button-floating"
          type="button"
          onClick={onBack}
          aria-label="Go back"
          className={`fixed bottom-28 z-40 w-14 h-14 rounded-full bg-surface-container-lowest text-on-surface flex items-center justify-center shadow-[0_4px_16px_rgba(0,0,0,0.18)] border border-outline-variant/40 active:scale-95 transition-all cursor-pointer ${
            dominantHand === 'left' ? 'left-4' : 'right-4'
          }`}
        >
          <ArrowLeft className="w-6 h-6 stroke-[2.2]" />
        </button>
      )}
    </header>
  );
};
