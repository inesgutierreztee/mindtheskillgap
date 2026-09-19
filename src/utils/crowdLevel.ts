export type CrowdTier = 1 | 2 | 3;

export interface CrowdTierInfo {
  tier: CrowdTier;
  label: 'Low' | 'Moderate' | 'High';
  hex: string;
  textClass: string;
  bgClass: string;
}

// Hackathon brief 3.2.3: crowding must render on a three-level scale, legible in
// a 1-second glance, and must not rely on color alone. `tier` (1-3 filled bars)
// is the shape cue; color is a secondary reinforcement, not the only signal.
const LOW: CrowdTierInfo = {
  tier: 1,
  label: 'Low',
  hex: '#0f9d58',
  textClass: 'text-tertiary',
  bgClass: 'bg-tertiary-container/15',
};

const MODERATE: CrowdTierInfo = {
  tier: 2,
  label: 'Moderate',
  hex: '#b5750a',
  textClass: 'text-on-secondary-container',
  bgClass: 'bg-secondary-container/40',
};

const HIGH: CrowdTierInfo = {
  tier: 3,
  label: 'High',
  hex: '#c22a2a',
  textClass: 'text-error',
  bgClass: 'bg-error-container',
};

// Normalises every crowd-related string used across the app (LTA's own
// SEA/SDA/LSD-derived labels, plus our route-level "Low/Moderate/High") into
// one canonical three-tier scale.
export function getCrowdTierInfo(value: string): CrowdTierInfo {
  const v = (value || '').toLowerCase();
  if (v.includes('crowded') || v === 'high') return HIGH;
  if (v.includes('standing') || v.includes('moderate')) return MODERATE;
  return LOW;
}
