import React, { createContext, useContext } from 'react';
import { DominantHand } from '../types';

// One-handed accessibility preference, read by components scattered across the
// app (TopAppBar, map controls, close buttons, the planner's swap button) that
// have no other reason to receive props from App.tsx. A context avoids
// threading "dominantHand" through every intermediate screen just to reach
// these few leaf controls.
const DominantHandContext = createContext<DominantHand>('off');

export const DominantHandProvider: React.FC<{ value: DominantHand; children: React.ReactNode }> = ({
  value,
  children,
}) => <DominantHandContext.Provider value={value}>{children}</DominantHandContext.Provider>;

export function useDominantHand(): DominantHand {
  return useContext(DominantHandContext);
}
