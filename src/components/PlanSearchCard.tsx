import React from 'react';
import { Search, Clock, MapPin, Bus, Train } from 'lucide-react';
import { SpeechInputButton } from './SpeechInputButton';

interface PlanSearchCardProps {
  singaporeTime: string;
  onPlanTrip: (origin?: string, destination?: string) => void;
}

const placesFromSpeech = (transcript: string): { origin?: string; destination?: string } => {
  const cleaned = transcript.replace(/[?.!]/g, '').trim();
  const fromTo = /^\s*from\s+(.+?)\s+to\s+(.+)\s*$/i.exec(cleaned);
  if (fromTo) return { origin: fromTo[1].trim(), destination: fromTo[2].trim() };
  const to = /^\s*(?:go\s+)?to\s+(.+)\s*$/i.exec(cleaned);
  return { destination: (to?.[1] ?? cleaned).trim() };
};

export const PlanSearchCard: React.FC<PlanSearchCardProps> = ({ singaporeTime, onPlanTrip }) => (
  <div className="bg-surface-container-lowest rounded-2xl p-4 card-shadow border border-outline-variant/30 space-y-3">
    <div className="flex items-center justify-between">
      <span className="text-xs font-bold text-outline uppercase tracking-wider">SINGAPORE LIVE TRANSIT</span>
      <div className="flex items-center gap-1.5 bg-secondary-fixed/50 px-2.5 py-0.5 rounded-full text-xs font-semibold text-on-secondary-fixed-variant">
        <Clock className="w-3.5 h-3.5" />
        <span>{singaporeTime || '8:24 am'} SGT</span>
      </div>
    </div>

    <div className="w-full bg-surface-container-low hover:bg-surface-container border border-outline-variant/40 rounded-2xl pl-4 pr-3 py-3.5 flex items-center justify-between text-left transition-all">
      <button
        id="home-search-trigger"
        type="button"
        onClick={() => onPlanTrip()}
        className="min-w-0 flex-1 flex items-center gap-3 text-left cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <Search className="w-5 h-5 text-primary" />
          <span className="text-sm font-medium text-on-surface-variant">Where to? e.g. Bugis, Kent Ridge...</span>
        </div>
      </button>
      <SpeechInputButton
        label="a destination"
        onTranscript={(transcript) => {
          const { origin, destination } = placesFromSpeech(transcript);
          onPlanTrip(origin, destination);
        }}
      />
      <span className="text-xs font-semibold text-primary bg-surface-container-lowest px-2.5 py-1 rounded-xl shadow-2xs">
        Plan
      </span>
    </div>

    <div className="flex items-center gap-2 pt-0.5 overflow-x-auto no-scrollbar">
      <button
        type="button"
        onClick={() => onPlanTrip('Kent Ridge MRT', 'Bugis MRT')}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-container text-xs font-semibold text-on-surface hover:bg-secondary-fixed/40 transition-colors cursor-pointer shrink-0"
      >
        <MapPin className="w-3.5 h-3.5 text-primary" />
        <span>Kent Ridge → Bugis</span>
      </button>
      <button
        type="button"
        onClick={() => onPlanTrip('Clementi Int', 'Kent Ridge MRT')}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-container text-xs font-semibold text-on-surface hover:bg-secondary-fixed/40 transition-colors cursor-pointer shrink-0"
      >
        <Bus className="w-3.5 h-3.5 text-primary" />
        <span>Clementi → Kent Ridge</span>
      </button>
      <button
        type="button"
        onClick={() => onPlanTrip('Kent Ridge', 'Buona Vista')}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-container text-xs font-semibold text-on-surface hover:bg-secondary-fixed/40 transition-colors cursor-pointer shrink-0"
      >
        <Train className="w-3.5 h-3.5 text-primary" />
        <span>To Buona Vista</span>
      </button>
    </div>
  </div>
);
