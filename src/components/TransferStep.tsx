import React from 'react';
import { ChevronRight } from 'lucide-react';

interface TransferStepProps {
  stepNumber: number;
  title: string;
  description: string;
  note?: string;
  isLast?: boolean;
  onClick?: () => void;
  clickable?: boolean;
  highlight?: boolean;
}

export const TransferStep: React.FC<TransferStepProps> = ({
  stepNumber,
  title,
  description,
  note,
  isLast = false,
  onClick,
  clickable = false,
  highlight = false,
}) => {
  return (
    <div
      id={`transfer-step-${stepNumber}`}
      onClick={clickable ? onClick : undefined}
      className={`relative flex gap-3.5 ${
        clickable ? 'cursor-pointer hover:bg-surface-container-low p-2.5 -mx-2.5 rounded-2xl transition-colors' : 'py-1'
      }`}
    >
      {/* Timeline indicator with line */}
      <div className="flex flex-col items-center">
        <div
          className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs shrink-0 shadow-xs ${
            highlight
              ? 'bg-primary-container text-on-primary ring-4 ring-secondary-fixed'
              : 'bg-on-primary-fixed text-surface-container-lowest'
          }`}
        >
          {stepNumber}
        </div>
        {!isLast && (
          <div className="w-0.5 flex-1 bg-outline-variant/40 my-1 min-h-[32px]" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 pb-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-on-surface leading-snug">{title}</h4>
          {clickable && (
            <ChevronRight className="w-4 h-4 text-primary shrink-0 ml-1" />
          )}
        </div>
        <p className="text-xs text-on-surface-variant mt-0.5 leading-relaxed">{description}</p>
        {note && (
          <div className="mt-1.5 inline-block text-[11px] font-medium text-on-surface-variant bg-surface-container px-2 py-0.5 rounded-md">
            {note}
          </div>
        )}
      </div>
    </div>
  );
};
