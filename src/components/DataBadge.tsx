import React from 'react';

// LIVE vs demo/simulated labelling for the persona home screens.
export const DataBadge: React.FC<{ tone: 'live' | 'demo'; children: React.ReactNode }> = ({ tone, children }) => (
  <span
    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold tracking-wide border ${
      tone === 'live'
        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
        : 'bg-amber-50 border-amber-300 border-dashed text-amber-800'
    }`}
  >
    <span className={`w-1.5 h-1.5 rounded-full ${tone === 'live' ? 'bg-emerald-600' : 'bg-amber-500'}`} />
    {children}
  </span>
);
