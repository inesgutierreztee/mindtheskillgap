import {
  BusStop,
  BusArrival,
  TrainStation,
  DisruptionAlert,
  LiveTransportCondition,
  LineSummary,
} from '../types';
import {
  MOCK_BUS_STOPS,
  MOCK_BUS_ARRIVALS_18331,
  MOCK_TRAIN_STATIONS,
  MOCK_LIVE_CONDITIONS,
} from '../data/mockTransportData';

export interface LtaStatusInfo {
  liveMode: boolean;
  provider: string;
  accountKeyConfigured: boolean;
  cachedBusStopsCount?: number;
}

export async function fetchLtaStatus(): Promise<LtaStatusInfo> {
  try {
    const res = await fetch('/api/lta-status');
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // Quiet fallback
  }
  return {
    liveMode: false,
    provider: 'Singapore Transport Data Abstraction (Fallback)',
    accountKeyConfigured: false,
  };
}

export async function fetchBusStops(lat?: number, lng?: number): Promise<BusStop[]> {
  try {
    const url = lat && lng ? `/api/bus-stops?lat=${lat}&lng=${lng}&radius=3` : '/api/bus-stops';
    const res = await fetch(url);
    if (res.ok) {
      const json = await res.json();
      if (json.data && Array.isArray(json.data) && json.data.length > 0) {
        return json.data;
      }
    }
  } catch (e) {
    console.warn('fetchBusStops error, using fallback data', e);
  }
  return MOCK_BUS_STOPS;
}

export async function fetchBusArrivals(stopCode: string): Promise<BusArrival[]> {
  try {
    const res = await fetch(`/api/bus-arrivals?stopCode=${encodeURIComponent(stopCode)}`);
    if (res.ok) {
      const json = await res.json();
      if (json.arrivals && Array.isArray(json.arrivals)) {
        return json.arrivals;
      }
    }
  } catch (e) {
    console.warn('fetchBusArrivals error, using fallback data', e);
  }
  return MOCK_BUS_ARRIVALS_18331;
}

export function getSingaporeTime(includeSeconds = false): string {
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    hour: '2-digit',
    minute: '2-digit',
    second: includeSeconds ? '2-digit' : undefined,
    hour12: true,
  }).format(new Date());
}

// Estimated arrival clock time in Singapore, given a duration from now.
export function getEtaFromNow(durationMin: number): string {
  const eta = new Date(Date.now() + durationMin * 60000);
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(eta);
}

export interface NearbyLiveResponse {
  source: 'lta_live' | 'mock_sg';
  timestamp: string;
  items: LiveTransportCondition[];
  // True when LTA confirms real connectivity but genuinely zero active bus
  // services right now - distinct from a data outage (mock_sg).
  busesOffService?: boolean;
}

export async function fetchNearbyLiveConditions(lat?: number, lng?: number): Promise<NearbyLiveResponse> {
  try {
    const params =
      typeof lat === 'number' && typeof lng === 'number'
        ? `?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`
        : '';
    const res = await fetch(`/api/nearby-live${params}`);
    if (res.ok) {
      const json = await res.json();
      if (json.items && Array.isArray(json.items) && json.items.length > 0) {
        return {
          source: json.source || 'lta_live',
          timestamp: json.timestamp || getSingaporeTime(true),
          items: json.items,
          busesOffService: Boolean(json.busesOffService),
        };
      }
    }
  } catch (e) {
    console.warn('fetchNearbyLiveConditions error:', e);
  }

  return {
    source: 'mock_sg',
    timestamp: getSingaporeTime(true),
    items: MOCK_LIVE_CONDITIONS,
  };
}

export interface TrainStatusResponse {
  source: string;
  isNormalService: boolean;
  ltaStatusCode?: number;
  officialMessages?: string[];
  lines?: LineSummary[];
  stations: TrainStation[];
  timestamp: string;
}

export async function fetchTrainStatusFull(): Promise<TrainStatusResponse> {
  try {
    const res = await fetch('/api/train-status');
    if (res.ok) {
      const json = await res.json();
      if (json.stations && Array.isArray(json.stations)) {
        return {
          source: json.source || 'lta_live',
          isNormalService: json.isNormalService ?? true,
          ltaStatusCode: json.ltaStatusCode,
          officialMessages: json.officialMessages || [],
          lines: json.lines || [],
          stations: json.stations,
          timestamp: json.timestamp || getSingaporeTime(false),
        };
      }
    }
  } catch (e) {
    console.warn('fetchTrainStatusFull error:', e);
  }

  return {
    source: 'mock_sg',
    isNormalService: true,
    officialMessages: [],
    lines: [],
    stations: MOCK_TRAIN_STATIONS,
    timestamp: getSingaporeTime(false),
  };
}

export async function fetchTrainStations(): Promise<TrainStation[]> {
  const full = await fetchTrainStatusFull();
  return full.stations;
}

export async function fetchDisruptions(simulate = false): Promise<{
  disruptions: DisruptionAlert[];
  isSimulated: boolean;
  officialMessages?: string[];
}> {
  try {
    const url = simulate ? '/api/disruptions?simulate=true' : '/api/disruptions';
    const res = await fetch(url);
    if (res.ok) {
      const json = await res.json();
      return {
        disruptions: Array.isArray(json.disruptions) ? json.disruptions : [],
        isSimulated: Boolean(json.isSimulated),
        officialMessages: json.officialMessages || [],
      };
    }
  } catch (e) {
    console.warn('fetchDisruptions error:', e);
  }
  return {
    disruptions: [],
    isSimulated: false,
    officialMessages: [],
  };
}

export function getInitialLiveConditions(): LiveTransportCondition[] {
  return MOCK_LIVE_CONDITIONS;
}

export interface LiftMaintenanceItem {
  line: string;
  stationCode: string;
  stationName: string;
  liftId?: string;
  liftDesc?: string;
}

export interface LiftStatusResult {
  source: 'lta_live' | 'unavailable' | 'error';
  stationCode: string;
  items: LiftMaintenanceItem[];
}

export async function fetchLiftStatus(stationCode: string): Promise<LiftStatusResult> {
  try {
    const res = await fetch(`/api/lift-status?stationCode=${encodeURIComponent(stationCode)}`);
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    console.warn('fetchLiftStatus error:', e);
  }
  return { source: 'unavailable', stationCode, items: [] };
}
