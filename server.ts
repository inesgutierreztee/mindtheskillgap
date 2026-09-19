import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { SINGAPORE_MRT_STATIONS } from './src/data/mrtStationsData';
import type { RouteOption } from './src/types';
import type { CrowdRisk, ResourceObservation } from './src/networkAware/types';
import { resolveStationByNameAndLine } from './src/utils/stationLookup';
import { normalizeLineToCode } from './src/utils/lineCodes';
import { adaptTransitCompanionRoutes } from './src/networkAware/adapters/transitCompanionAdapter';
import { networkAwareRuntime } from './src/networkAware/server/networkAwareRuntime';
import {
  mapPcdCode,
  NETWORK_PROXY_CAPACITY_15_MIN,
  proxyDemandForCrowd,
} from './src/networkAware/server/networkProxyConfig';
import {
  coordinateLocationId,
  createStableRouteId,
} from './src/networkAware/server/stableRouteId';
import { collectCompleteOffsetPages } from './src/services/busStopPagination';

// Prefer developer-local secrets while still supporting hosting platforms and
// existing deployments that provide a conventional .env file or real process
// environment variables. dotenv does not overwrite already-defined values.
dotenv.config({ path: '.env.local' });
dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

// In-memory cache for all official Singapore bus stops from LTA DataMall
interface LtaBusStop {
  code: string;
  road: string;
  desc: string;
  lat: number;
  lng: number;
}

let cachedBusStops: LtaBusStop[] = [];
let stopCodeToName: Record<string, string> = {};
let isStopsCacheLoaded = false;

// Tracks the last time a REAL LTA DataMall call actually succeeded, so
// /api/lta-status can report genuine connectivity instead of just "a key is
// configured" - a configured-but-rejected key must not claim live mode.
let lastLtaSuccessAt = 0;
const LTA_LIVE_FRESHNESS_MS = 5 * 60 * 1000;
function markLtaSuccess(): void {
  lastLtaSuccessAt = Date.now();
}

// Format timestamps explicitly in Singapore Standard Time (SGT, UTC+8)
function getSingaporeTimeString(includeSeconds = true): string {
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    hour: '2-digit',
    minute: '2-digit',
    second: includeSeconds ? '2-digit' : undefined,
    hour12: true,
  }).format(new Date());
}

// In-memory cache for live MRT platform crowd density from LTA PCDRealTime
interface StationCrowdInfo {
  crowdLevel: 'Seats available' | 'Standing available' | 'Crowded';
  rawCode: 'l' | 'm' | 'h';
  startTime?: string;
}

let stationPcdCache: Record<string, StationCrowdInfo> = {};
let pcdLastFetchTime = 0;
let isFetchingPcd = false;

async function updateStationCrowdData(apiKey: string): Promise<void> {
  // If recently fetched within 55 seconds and we have data, use cache
  if (Date.now() - pcdLastFetchTime < 55000 && Object.keys(stationPcdCache).length > 20) {
    return;
  }
  if (isFetchingPcd) return;

  isFetchingPcd = true;
  try {
    const lines = ['CCL', 'EWL', 'NSL', 'DTL', 'NEL', 'TEL'];
    const newCache: Record<string, StationCrowdInfo> = {};

    for (const line of lines) {
      try {
        const res = await fetch(`https://datamall2.mytransport.sg/ltaodataservice/PCDRealTime?TrainLine=${line}`, {
          headers: { AccountKey: apiKey, accept: 'application/json' },
          signal: AbortSignal.timeout(3500),
        });
        if (res.ok) {
          const d = await res.json();
          if (Array.isArray(d.value)) {
            for (const item of d.value) {
              const code = item.Station;
              const raw = (item.CrowdLevel || 'l').toLowerCase();
              let crowdLevel: 'Seats available' | 'Standing available' | 'Crowded' = 'Seats available';
              if (raw === 'h') crowdLevel = 'Crowded';
              else if (raw === 'm') crowdLevel = 'Standing available';

              newCache[code] = {
                crowdLevel,
                rawCode: (raw || 'l') as 'l' | 'm' | 'h',
                startTime: item.StartTime,
              };
            }
          }
        }
        // Small 120ms throttle to prevent spike-arrest
        await new Promise((r) => setTimeout(r, 120));
      } catch (lineErr) {
        // Individual line error; continue with other lines
      }
    }

    if (Object.keys(newCache).length > 0) {
      stationPcdCache = { ...stationPcdCache, ...newCache };
      pcdLastFetchTime = Date.now();
      markLtaSuccess();
      console.log(`[LTA PCDRealTime] Cached live crowd data for ${Object.keys(stationPcdCache).length} MRT stations.`);
    }
  } catch (err) {
    console.warn('[LTA PCDRealTime] Failed to update crowd data:', err);
  } finally {
    isFetchingPcd = false;
  }
}

// Shared cache for LTA TrainServiceAlerts. Both /api/train-status and
// /api/disruptions need this same feed - previously each called it
// independently on every request, doubling load with no cache at all
// (unlike every other LTA-backed endpoint in this file). Alerts are "ad hoc"
// data per LTA, not second-by-second, so a 30s cache is safely fresh.
let trainServiceAlertsCache: any = null;
let trainServiceAlertsFetchedAt = 0;

async function fetchTrainServiceAlerts(ltaKey: string): Promise<any | null> {
  if (trainServiceAlertsCache && Date.now() - trainServiceAlertsFetchedAt < 30000) {
    return trainServiceAlertsCache;
  }
  try {
    const response = await fetch('https://datamall2.mytransport.sg/ltaodataservice/TrainServiceAlerts', {
      headers: { AccountKey: ltaKey, accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (response.ok) {
      const data = await response.json();
      trainServiceAlertsCache = data;
      trainServiceAlertsFetchedAt = Date.now();
      markLtaSuccess();
      return data;
    }
    console.warn('[LTA TrainServiceAlerts] Non-OK response:', response.status);
  } catch (err) {
    console.warn('[LTA TrainServiceAlerts] Error:', err);
  }
  return trainServiceAlertsCache; // serve stale cache over a hard failure, if we have one
}

// Compute dynamic train arrival countdown based on real time in Singapore
function getTrainArrivalInfo(stationCode: string): { frequencyMin: number; nextTrainMin: number } {
  const now = new Date();
  const sgTimeString = new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).format(now);

  const [hStr, mStr, sStr] = sgTimeString.split(':');
  const sgHour = parseInt(hStr, 10);
  const sgMin = parseInt(mStr, 10);
  const sgSec = parseInt(sStr || '0', 10);

  // Peak, Off-Peak, or Late Night frequency in Singapore
  let frequency = 4;
  if ((sgHour >= 7 && sgHour < 9) || (sgHour >= 17 && sgHour < 20)) {
    frequency = 3;
  } else if (sgHour >= 22 || sgHour < 6) {
    frequency = 6;
  } else {
    frequency = 4;
  }

  const codeNum = stationCode.replace(/\D/g, '');
  const seed = parseInt(codeNum || '1', 10);
  const totalSeconds = (sgMin * 60 + sgSec + seed * 37) % (frequency * 60);
  const secondsUntil = (frequency * 60) - totalSeconds;
  const nextTrainMin = Math.max(1, Math.ceil(secondsUntil / 60));

  return { frequencyMin: frequency, nextTrainMin };
}

// Fallback stops in case key is missing or initial network boot
const FALLBACK_BUS_STOPS: LtaBusStop[] = [
  { code: '18331', road: 'Lower Kent Ridge Rd', desc: 'Kent Ridge Stn Exit A / NUH', lat: 1.2935, lng: 103.7844 },
  { code: '18339', road: 'Lower Kent Ridge Rd', desc: 'Opp Kent Ridge Stn Exit A', lat: 1.2939, lng: 103.7841 },
  { code: '18221', road: 'Lower Kent Ridge Rd', desc: 'National University Hospital', lat: 1.2946, lng: 103.7831 },
  { code: '18239', road: 'Lower Kent Ridge Rd', desc: 'Opp NUH', lat: 1.2949, lng: 103.7834 },
  { code: '15131', road: 'Sth Buona Vista Rd', desc: 'Kent Ridge Stn', lat: 1.2928, lng: 103.7852 },
  { code: '15139', road: 'Sth Buona Vista Rd', desc: 'Kent Ridge Stn Exit B', lat: 1.2924, lng: 103.7855 },
  { code: '16009', road: 'Clementi Rd', desc: 'Kent Ridge Ter', lat: 1.2941, lng: 103.7698 },
  { code: '11361', road: 'Nth Buona Vista Rd', desc: 'Buona Vista Stn Exit C', lat: 1.3072, lng: 103.7904 },
  { code: '41021', road: 'Bt Timah Rd', desc: 'Botanic Gardens Stn', lat: 1.3224, lng: 103.8152 },
  { code: '01112', road: 'Victoria St', desc: 'Bugis Stn Exit A', lat: 1.3005, lng: 103.8560 },
  { code: '01119', road: 'Victoria St', desc: 'Bugis Stn Exit B', lat: 1.3002, lng: 103.8565 },
  // Persona neighbourhood fallbacks keep the nearby-stop view meaningful
  // even before a complete LTA stop cache is available.
  { code: '75059', road: 'Tampines Central 1', desc: 'Tampines Int', lat: 1.3540, lng: 103.9434 },
  { code: '76101', road: 'Tampines Ave 5', desc: 'Opp Tampines Int', lat: 1.3526, lng: 103.9451 },
  { code: '65069', road: 'Punggol Pl', desc: 'Punggol Temp Int', lat: 1.4044, lng: 103.9020 },
  { code: '65241', road: 'Punggol Pl', desc: 'Punggol MRT', lat: 1.4057, lng: 103.9024 },
  { code: '84031', road: 'Bedok North St 3', desc: 'Blk 539', lat: 1.3313, lng: 103.9254 },
  { code: '84009', road: 'New Upper Changi Rd', desc: 'Bedok Int', lat: 1.3240, lng: 103.9300 },
];

const FALLBACK_NEARBY_BUS_SERVICE: Record<string, { serviceNo: string; destination: string; etaMinutes: number; crowd: string; traffic: string }> = {
  '18331': { serviceNo: '95', destination: 'Buona Vista', etaMinutes: 2, crowd: 'Seats available', traffic: 'Smooth' },
  '18339': { serviceNo: '96', destination: 'Clementi Int', etaMinutes: 4, crowd: 'Seats available', traffic: 'Smooth' },
  '16009': { serviceNo: '151', destination: 'Hougang Central', etaMinutes: 5, crowd: 'Moderate crowd', traffic: 'Slow traffic' },
  '15131': { serviceNo: '200', destination: 'Buona Vista', etaMinutes: 6, crowd: 'Seats available', traffic: 'Smooth' },
  '75059': { serviceNo: '10', destination: 'Tampines Int', etaMinutes: 3, crowd: 'Seats available', traffic: 'Smooth' },
  '76101': { serviceNo: '27', destination: 'Changi Airport', etaMinutes: 5, crowd: 'Standing available', traffic: 'Smooth' },
  '65069': { serviceNo: '83', destination: 'Sengkang Int', etaMinutes: 4, crowd: 'Seats available', traffic: 'Smooth' },
  '65241': { serviceNo: '382G', destination: 'Punggol Field', etaMinutes: 6, crowd: 'Moderate crowd', traffic: 'Smooth' },
  '84031': { serviceNo: '225G', destination: 'Bedok Int', etaMinutes: 3, crowd: 'Seats available', traffic: 'Smooth' },
  '84009': { serviceNo: '14', destination: 'Clementi Rd', etaMinutes: 6, crowd: 'Moderate crowd', traffic: 'Slow traffic' },
};

// Asynchronously load all official Singapore bus stops from LTA DataMall
async function initializeLtaBusStops() {
  const ltaKey = process.env.LTA_ACCOUNT_KEY;
  if (!ltaKey) {
    cachedBusStops = FALLBACK_BUS_STOPS;
    FALLBACK_BUS_STOPS.forEach((s) => {
      stopCodeToName[s.code] = s.desc;
    });
    isStopsCacheLoaded = true;
    return;
  }

  try {
    const sync = await collectCompleteOffsetPages<any>({
      pageSize: 500,
      maxPages: 20,
      keyOf: (stop) => String(stop.BusStopCode || ''),
      fetchPage: async (skip) => {
        let lastError: Error | null = null;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            const response = await fetch(`https://datamall2.mytransport.sg/ltaodataservice/BusStops?$skip=${skip}`, {
              headers: { AccountKey: ltaKey, accept: 'application/json' },
              signal: AbortSignal.timeout(8000),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status} at skip ${skip}`);
            const data = await response.json();
            if (!Array.isArray(data.value)) throw new Error(`malformed page at skip ${skip}`);
            return data.value;
          } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
          }
        }
        throw lastError ?? new Error(`page failed at skip ${skip}`);
      },
    });

    if (sync.complete && sync.items.length > 0) {
      const nextStops = sync.items.map((s: any) => ({
        code: String(s.BusStopCode),
        road: String(s.RoadName || ''),
        desc: String(s.Description || ''),
        lat: Number(s.Latitude),
        lng: Number(s.Longitude),
      }));

      const nextNames: Record<string, string> = {};
      nextStops.forEach((s) => { nextNames[s.code] = s.desc; });
      cachedBusStops = nextStops;
      stopCodeToName = nextNames;

      isStopsCacheLoaded = true;
      markLtaSuccess();
      console.log(`[LTA Sync] Atomically cached ${cachedBusStops.length} unique bus stops from ${sync.pagesFetched} complete DataMall pages.`);
    } else {
      console.warn(`[LTA Sync] Incomplete refresh (${sync.reason || 'empty dataset'}); retaining ${cachedBusStops.length || FALLBACK_BUS_STOPS.length} previous/fallback stops.`);
      if (cachedBusStops.length === 0) cachedBusStops = FALLBACK_BUS_STOPS;
    }
  } catch (err) {
    console.warn('[LTA Sync] Bus stops cache init failed, using fallback list:', err);
    cachedBusStops = FALLBACK_BUS_STOPS;
  }
}

// Kick off cache population
initializeLtaBusStops();

const MOCK_TRAIN_STATIONS = [
  {
    code: 'CC24',
    name: 'Kent Ridge',
    line: 'CCL',
    lat: 1.2931,
    lng: 103.7845,
    status: 'Normal service',
    crowdLevel: 'Seats available',
    nextTrainMin: 2,
    frequencyMin: 3,
  },
  {
    code: 'CC22 / EW21',
    name: 'Buona Vista',
    line: 'CCL / EWL',
    lat: 1.3073,
    lng: 103.7901,
    status: 'Normal service (CCL) / Slow (EWL)',
    crowdLevel: 'Moderate crowd',
    nextTrainMin: 3,
    frequencyMin: 4,
  },
  {
    code: 'CC19 / DT9',
    name: 'Botanic Gardens',
    line: 'CCL / DTL',
    lat: 1.3223,
    lng: 103.8153,
    status: 'Normal service',
    crowdLevel: 'Standing available',
    nextTrainMin: 2,
    frequencyMin: 3,
  },
  {
    code: 'NS25 / EW13',
    name: 'City Hall',
    line: 'NSL / EWL',
    lat: 1.2932,
    lng: 103.8522,
    status: 'Minor delay (EWL)',
    crowdLevel: 'Crowded',
    nextTrainMin: 4,
    frequencyMin: 4,
    disruptionNote: 'Eastbound trains moving at reduced speeds near City Hall. High platform crowding.',
  },
  {
    code: 'DT14 / EW12',
    name: 'Bugis',
    line: 'DTL / EWL',
    lat: 1.3005,
    lng: 103.8560,
    status: 'Normal service',
    crowdLevel: 'Moderate crowd',
    nextTrainMin: 2,
    frequencyMin: 3,
  },
];

const MOCK_DISRUPTIONS = [
  {
    id: 'ewl-city-hall-001',
    line: 'East-West Line',
    headline: 'EW Line crowding is rising near City Hall',
    subText: 'Leaving 8 min earlier may save ~12 min.',
    confidence: 82,
    delayEstimateMin: 18,
    active: true,
    whatHappened: 'Track point maintenance near Bugis caused eastbound trains to run at reduced speeds, causing dwell time bottlenecks at City Hall.',
    howItAffectsYou: 'Your routine commute to Bugis via EWL interchange faces severe congestion (+18 min delay risk).',
    whatYouShouldDo: 'Reroute via Circle Line to Botanic Gardens, transferring to Downtown Line to Bugis. Total time ~41 min.',
    recommendedRouteId: 'ccl-dtl',
  },
];

// Weather (data.gov.sg 2-hour forecast) — no registration/key required.
interface WeatherInfo {
  area: string;
  forecast: string;
  isRaining: boolean;
  timestamp: string;
}

// Nearest data.gov.sg forecast area to the Kent Ridge / Buona Vista / Bugis corridor this app covers.
const WEATHER_AREA = 'Queenstown';

// One data.gov.sg response covers every forecast area, so it is cached once and
// each area (e.g. Tampines, City for Raffles Place) is looked up from it.
let forecastAreasCache: { area: string; forecast: string }[] | null = null;
let forecastTimestamp = '';
let weatherLastAttemptTime = 0;

async function fetchWeatherForecast(area: string = WEATHER_AREA): Promise<WeatherInfo> {
  // 2-hour forecasts update roughly every 30 min on data.gov.sg; a 5 min cache is
  // plenty fresh while respecting the "don't hammer public endpoints" guidance.
  if (Date.now() - weatherLastAttemptTime >= 5 * 60000) {
    weatherLastAttemptTime = Date.now();
    try {
      const res = await fetch('https://api.data.gov.sg/v1/environment/2-hour-weather-forecast', {
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const data = await res.json();
        const forecasts = data.items?.[0]?.forecasts;
        if (Array.isArray(forecasts) && forecasts.length > 0) {
          forecastAreasCache = forecasts;
          forecastTimestamp = data.items[0].timestamp || new Date().toISOString();
        }
      }
    } catch (err) {
      console.warn('[data.gov.sg Weather] Failed to fetch forecast:', err);
    }
  }

  const match = forecastAreasCache?.find((f) => f.area === area);
  if (match) {
    const forecast = String(match.forecast || 'Partly Cloudy');
    return {
      area: match.area,
      forecast,
      isRaining: /rain|shower|thundery/i.test(forecast),
      timestamp: forecastTimestamp,
    };
  }

  // Fallback assumes fair weather rather than falsely triggering rain-avoidance routing.
  return {
    area,
    forecast: 'Partly Cloudy (Fallback)',
    isRaining: false,
    timestamp: new Date().toISOString(),
  };
}

// Weather Endpoint (Live data.gov.sg 2-Hour Forecast)
app.get('/api/weather', async (req, res) => {
  const requestedArea = typeof req.query.area === 'string' ? req.query.area.trim() : '';
  const area = /^[A-Za-z ]{1,40}$/.test(requestedArea) ? requestedArea : WEATHER_AREA;
  const weather = await fetchWeatherForecast(area);
  res.json({
    source: weather.forecast.includes('Fallback') ? 'mock_sg' : 'data_gov_sg',
    ...weather,
  });
});

// OneMap public-transit routing (real multi-modal itineraries for ANY Singapore
// origin/destination — the resource the hackathon brief lists for this purpose,
// avoiding the need to self-host a routing engine like OpenTripPlanner).
// Auth: https://www.onemap.gov.sg/apidocs/register (free), ROPC-style token exchange.
let oneMapToken: string | null = null;
let oneMapTokenExpiryMs = 0;

// Best-effort decode of a JWT's payload to read its `exp` claim, without
// verifying the signature (we're only reading our own already-trusted token
// to know when to stop using it, not authenticating anything with this).
function decodeJwtExpiryMs(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    const json = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function getOneMapToken(): Promise<string | null> {
  // A pre-issued token (e.g. copied from OneMap's own portal) takes priority
  // over the email/password flow, so a user never has to store their real
  // account password just to use this feature.
  const presetToken = process.env.ONEMAP_TOKEN;
  if (presetToken) {
    const expiry = decodeJwtExpiryMs(presetToken);
    if (!expiry || Date.now() < expiry - 60000) {
      return presetToken;
    }
    console.warn('[OneMap Auth] ONEMAP_TOKEN has expired; set ONEMAP_EMAIL/ONEMAP_PASSWORD for auto-refresh, or paste a fresh token.');
    return null;
  }

  const email = process.env.ONEMAP_EMAIL;
  const password = process.env.ONEMAP_PASSWORD;
  if (!email || !password) return null;

  // Reuse the cached token until shortly before it expires (~3 day TTL).
  if (oneMapToken && Date.now() < oneMapTokenExpiryMs - 60000) {
    return oneMapToken;
  }

  try {
    const res = await fetch('https://www.onemap.gov.sg/api/auth/post/getToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.access_token) {
        oneMapToken = data.access_token;
        oneMapTokenExpiryMs = data.expiry_timestamp
          ? Number(data.expiry_timestamp) * 1000
          : Date.now() + 3 * 24 * 60 * 60 * 1000;
        return oneMapToken;
      }
    }
    console.warn('[OneMap Auth] getToken did not return access_token:', res.status);
  } catch (err) {
    console.warn('[OneMap Auth] Failed to get token:', err);
  }
  return null;
}

// Place search powers the planner's normal wayfinding behaviour. MRT stations
// and LTA bus stops resolve locally, while OneMap adds addresses, landmarks and
// other Singapore places. Coordinates—not a station name—are what routing uses.
app.get('/api/location-search', async (req, res) => {
  const rawQuery = String(req.query.q || '').trim();
  if (!rawQuery) return res.json({ results: [] });
  const query = rawQuery
    .replace(/^bus\s+[^·.-]+\s*[·.-]\s*/i, '')
    .replace(/\b(mrt|station)\b/gi, '')
    .trim()
    .toLowerCase();
  if (!query) return res.json({ results: [] });

  const localResults = [
    ...SINGAPORE_MRT_STATIONS.map((station) => ({
      name: `${station.name} MRT`,
      lat: station.lat,
      lng: station.lng,
      kind: 'station' as const,
      detail: station.line,
      score: station.name.toLowerCase() === query ? 0 : station.name.toLowerCase().startsWith(query) ? 1 : 2,
    })),
    ...(cachedBusStops.length ? cachedBusStops : FALLBACK_BUS_STOPS).map((stop) => ({
      name: stop.desc,
      lat: stop.lat,
      lng: stop.lng,
      kind: 'bus_stop' as const,
      detail: `${stop.road} · Stop ${stop.code}`,
      score: stop.desc.toLowerCase() === query ? 0 : stop.desc.toLowerCase().startsWith(query) ? 1 : 2,
    })),
  ]
    .filter((place) => `${place.name} ${place.detail}`.toLowerCase().includes(query))
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    .slice(0, 6);

  const results: Array<{
    name: string;
    lat: number;
    lng: number;
    kind: 'station' | 'bus_stop' | 'place';
    detail: string;
    score: number;
  }> = [...localResults];
  try {
    const params = new URLSearchParams({ searchVal: rawQuery, returnGeom: 'Y', getAddrDetails: 'Y', pageNum: '1' });
    const response = await fetch(`https://www.onemap.gov.sg/api/common/elastic/search?${params.toString()}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (response.ok) {
      const data = await response.json();
      for (const item of Array.isArray(data.results) ? data.results : []) {
        const lat = Number(item.LATITUDE);
        const lng = Number(item.LONGITUDE);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const name = String(item.SEARCHVAL || item.BUILDING || item.ADDRESS || rawQuery);
        if (results.some((place) => Math.abs(place.lat - lat) < 0.00001 && Math.abs(place.lng - lng) < 0.00001)) continue;
        results.push({
          name,
          lat,
          lng,
          kind: 'place',
          detail: String(item.ADDRESS || item.POSTAL || 'Singapore'),
          score: 3,
        });
      }
    }
  } catch (error) {
    console.warn('[OneMap Search] unavailable:', error instanceof Error ? error.message : error);
  }

  res.json({ results: results.slice(0, 8) });
});

// Standard Google/OTP encoded-polyline decoder (OneMap's transit legs return
// leg geometry this way) — no external package needed for this.
function decodeOneMapPolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

// OneMap's cycling route_instructions entries are positional arrays; index 3
// is "lat,lng" for where that turn actually happens, index 9 the human text
// (falling back to index 0's turn-type code). The anchor point is what lets
// the client advance guidance by real device location instead of a static list.
interface CycleInstruction {
  text: string;
  lat?: number;
  lng?: number;
}

function parseOneMapCycleInstructions(raw: unknown): CycleInstruction[] {
  const result: CycleInstruction[] = [];
  for (const instruction of Array.isArray(raw) ? raw : []) {
    if (!Array.isArray(instruction)) continue;
    const text = String(instruction[9] || instruction[0] || '').trim();
    if (!text) continue;
    const anchor = typeof instruction[3] === 'string' ? instruction[3].split(',') : null;
    const lat = anchor ? Number(anchor[0]) : NaN;
    const lng = anchor ? Number(anchor[1]) : NaN;
    result.push(Number.isFinite(lat) && Number.isFinite(lng) ? { text, lat, lng } : { text });
  }
  return result;
}

// Live Route Planning Endpoint (OneMap "pt" routing, walk + bus + train)
app.get('/api/route-plan', async (req, res) => {
  const originLat = parseFloat(String(req.query.originLat || ''));
  const originLng = parseFloat(String(req.query.originLng || ''));
  const destLat = parseFloat(String(req.query.destLat || ''));
  const destLng = parseFloat(String(req.query.destLng || ''));
  const routeMode = req.query.routeMode === 'cycle' ? 'cycle' : req.query.routeMode === 'walk' ? 'walk' : 'transit';

  if ([originLat, originLng, destLat, destLng].some((n) => isNaN(n))) {
    return res
      .status(400)
      .json({ source: 'error', reason: 'originLat/originLng/destLat/destLng required', itineraries: [] });
  }

  const token = await getOneMapToken();
  if (!token) {
    return res.json({
      source: 'unavailable',
      reason: 'ONEMAP_EMAIL/ONEMAP_PASSWORD not configured',
      itineraries: [],
    });
  }

  try {
    // Optional offset so callers can compare a few departure times (Arjun:
    // flexible ~60 min start window) instead of only "leave right now".
    const departureOffsetMin = Math.max(0, Math.min(120, Number(req.query.departureOffsetMin) || 0));
    const now = new Date(Date.now() + departureOffsetMin * 60000);
    const sgDate = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Singapore',
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    })
      .format(now)
      .replace(/\//g, '-');
    const sgTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Singapore',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(now);

    const params = new URLSearchParams({
      start: `${originLat},${originLng}`,
      end: `${destLat},${destLng}`,
      routeType: routeMode === 'transit' ? 'pt' : routeMode,
    });
    if (routeMode === 'transit') {
      params.set('date', sgDate);
      params.set('time', sgTime);
      params.set('mode', 'TRANSIT');
      params.set('maxWalkDistance', '1000');
      params.set('numItineraries', '3');
    }

    const response = await fetch(`https://www.onemap.gov.sg/api/public/routingsvc/route?${params.toString()}`, {
      headers: { Authorization: token },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      console.warn('[OneMap Routing] Non-OK response:', response.status);
      return res.json({ source: 'unavailable', reason: `OneMap returned ${response.status}`, itineraries: [] });
    }

    const data = await response.json();

    // Walk/drive/cycle responses use a different, flatter shape than public
    // transport itineraries. Keep the server adapter as the single place the
    // client needs to know about that OneMap API distinction.
    if (routeMode === 'cycle' || routeMode === 'walk') {
      const isWalk = routeMode === 'walk';
      const summary = data.route_summary;
      const encodedGeometry = data.route_geometry;
      if (!summary || !encodedGeometry) {
        return res.json({ source: 'unavailable', reason: `no_${routeMode}_route`, itineraries: [] });
      }

      const pathCoordinates = decodeOneMapPolyline(encodedGeometry);
      const durationMin = Math.max(1, Math.round(Number(summary.total_time || 0) / 60));
      const distanceMeters = Math.max(0, Math.round(Number(summary.total_distance || 0)));
      const navigationInstructions = parseOneMapCycleInstructions(data.route_instructions);

      const route = {
        id: createStableRouteId({
          routeMode,
          startId: coordinateLocationId(originLat, originLng),
          endId: coordinateLocationId(destLat, destLng),
          legs: [{ mode: routeMode, fromId: coordinateLocationId(originLat, originLng), toId: coordinateLocationId(destLat, destLng) }],
        }),
        title: isWalk ? 'Walking route' : 'Cycling route',
        summary: isWalk ? 'Walk' : 'Cycle',
        lines: isWalk ? [] : ['Cycle'],
        totalDurationMin: durationMin,
        departureTimeMs: now.getTime(),
        walkingMinutes: isWalk ? durationMin : 0,
        transfers: 0,
        crowdRating: 'Low',
        reliabilityRating: 'Moderate',
        whyRecommended: isWalk
          ? 'Live walking route computed by OneMap using Singapore pedestrian network data.'
          : 'Live cycling route computed by OneMap using Singapore cycling and road-network data.',
        routeMode: isWalk ? undefined : 'cycle',
        cyclingDistanceMeters: isWalk ? undefined : distanceMeters,
        steps: [
          {
            stepNumber: 1,
            type: routeMode,
            instruction: isWalk ? 'Walk to your destination' : 'Cycle to your destination',
            subText: `${(distanceMeters / 1000).toFixed(1)} km · about ${durationMin} min`,
            durationMin,
            distanceMeters,
            lineOrService: isWalk ? undefined : 'Cycle',
            startPoint: { lat: originLat, lng: originLng, name: 'Starting point' },
            targetPoint: {
              name: 'Destination',
              lat: destLat,
              lng: destLng,
              type: 'destination',
            },
            pathCoordinates,
            navigationInstructions,
          },
        ],
      };

      return res.json({ source: 'onemap_live', departureOffsetMin, itineraries: [route] });
    }

    // This endpoint represents public-transport alternatives. OneMap may return
    // a very long walking-only itinerary outside operating hours; do not label
    // that as a live transit route.
    const itineraries = (Array.isArray(data.plan?.itineraries) ? data.plan.itineraries : []).filter(
      (itinerary: any) =>
        Array.isArray(itinerary.legs) && itinerary.legs.some((leg: any) => leg.mode !== 'WALK')
    );

    const mapped = itineraries.map((it: any, idx: number) => {
      const legs = it.legs || [];
      const steps = legs.map((leg: any, legIdx: number) => {
        const isWalk = leg.mode === 'WALK';
        // A walk leg between two stops of the same name is the transfer walk
        // within an interchange, not a "walk to X" — OneMap's SUBWAY mode is
        // MRT (train); anything else non-walk is a bus leg.
        const isTransferWalk = isWalk && !!leg.from?.name && leg.from.name === leg.to?.name;
        const modeType = isTransferWalk ? 'transfer' : isWalk ? 'walk' : leg.mode === 'BUS' ? 'bus' : 'train';
        const rawCoords: [number, number][] = leg.legGeometry?.points
          ? decodeOneMapPolyline(leg.legGeometry.points)
          : [
              [leg.from?.lat, leg.from?.lon],
              [leg.to?.lat, leg.to?.lon],
            ];
        const pathCoordinates = rawCoords.filter(
          (c) => typeof c[0] === 'number' && typeof c[1] === 'number' && !isNaN(c[0]) && !isNaN(c[1])
        );
        const durationMin = Math.max(1, Math.round((leg.duration || 0) / 60));
        const lineOrService = leg.route || leg.routeShortName || undefined;
        const boardingStation = modeType === 'train'
          ? resolveStationByNameAndLine(String(leg.from?.name || ''), lineOrService)
          : null;
        const alightingStation = modeType === 'train'
          ? resolveStationByNameAndLine(String(leg.to?.name || ''), lineOrService)
          : null;

        return {
          stepNumber: legIdx + 1,
          type: modeType,
          instruction: isTransferWalk
            ? `Transfer at ${leg.from?.name}`
            : isWalk
            ? `Walk to ${leg.to?.name || 'next stop'}`
            : `Take ${leg.route || leg.routeShortName || leg.mode} towards ${leg.to?.name || 'destination'}`,
          subText: `${durationMin} min`,
          durationMin,
          distanceMeters: leg.distance ? Math.round(leg.distance) : undefined,
          lineOrService,
          startPoint: { lat: leg.from?.lat, lng: leg.from?.lon, name: leg.from?.name },
          boardingStopCode: leg.mode === 'BUS' ? leg.from?.stopCode || undefined : undefined,
          alightingStopCode: leg.mode === 'BUS' ? leg.to?.stopCode || undefined : undefined,
          boardingStationCode: modeType === 'train' ? leg.from?.stopCode || boardingStation?.code : undefined,
          alightingStationCode: modeType === 'train' ? leg.to?.stopCode || alightingStation?.code : undefined,
          targetPoint: {
            name: leg.to?.name || 'Stop',
            lat: leg.to?.lat,
            lng: leg.to?.lon,
            type: isWalk ? 'destination' : modeType === 'bus' ? 'bus_stop' : 'mrt_entrance',
          },
          pathCoordinates,
        };
      });

      const walkingMinutes = steps
        .filter((s: any) => s.type === 'walk' || s.type === 'transfer')
        .reduce((sum: number, s: any) => sum + s.durationMin, 0);
      const transitLines: string[] = Array.from(
        new Set(steps.filter((s: any) => s.lineOrService).map((s: any) => s.lineOrService))
      );
      const transitLegCount = legs.filter((l: any) => l.mode !== 'WALK').length;

      return {
        id: createStableRouteId({
          routeMode: 'transit',
          startId: coordinateLocationId(originLat, originLng),
          endId: coordinateLocationId(destLat, destLng),
          legs: steps.map((step: any) => ({
            mode: step.type,
            lineOrService: step.lineOrService,
            fromId: step.boardingStopCode || step.boardingStationCode || step.startPoint?.name,
            toId: step.alightingStopCode || step.alightingStationCode || step.targetPoint?.name,
          })),
        }),
        title: transitLines.length > 0 ? transitLines.join(' → ') : 'Walking Route',
        summary: transitLines.length > 0 ? transitLines.join(' + ') : 'On foot',
        lines: transitLines,
        totalDurationMin: Math.max(1, Math.round((it.duration || 0) / 60)),
        departureTimeMs: now.getTime(),
        walkingMinutes,
        transfers: Math.max(0, transitLegCount - 1),
        crowdRating: 'Moderate',
        crowdEstimateText: 'Not available for live-routed options yet',
        estimatedFare: it.fare ? parseFloat(it.fare) : undefined,
        reliabilityRating: 'Moderate',
        // Unknown from OneMap's response — left undefined rather than guessed, so the UI
        // never shows a false accessibility/shelter claim (brief: "unverifiable claims do
        // not score"). Only the hand-curated demo routes assert these today.
        stepFreeAccessible: undefined,
        whyRecommended: 'Live route computed by OneMap public transport routing for your entered origin and destination.',
        steps,
        trafficSensitive: legs.some((l: any) => l.mode === 'BUS'),
        routeMode: 'transit',
      };
    });

    res.json({
      source: mapped.length > 0 ? 'onemap_live' : 'unavailable',
      reason: mapped.length > 0 ? undefined : 'no_transit_service_for_departure',
      departureOffsetMin,
      itineraries: mapped,
    });
  } catch (err) {
    console.warn('[OneMap Routing] Error:', err);
    res.json({ source: 'unavailable', reason: 'request_failed', itineraries: [] });
  }
});

function distanceMetersBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const earthRadius = 6371000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(h));
}

// Builds genuine bike-and-ride journeys instead of presenting cycling as a
// separate door-to-door competitor. Each result cycles to a useful nearby MRT
// hub, includes an explicit park/transfer step, then continues with OneMap's
// public-transport itinerary (bus/train/walk) to the destination.
app.get('/api/multimodal-route-plan', async (req, res) => {
  const origin = {
    lat: parseFloat(String(req.query.originLat || '')),
    lng: parseFloat(String(req.query.originLng || '')),
  };
  const destination = {
    lat: parseFloat(String(req.query.destLat || '')),
    lng: parseFloat(String(req.query.destLng || '')),
  };
  if ([origin.lat, origin.lng, destination.lat, destination.lng].some((n) => isNaN(n))) {
    return res.status(400).json({
      source: 'error',
      reason: 'originLat/originLng/destLat/destLng required',
      itineraries: [],
    });
  }

  const token = await getOneMapToken();
  if (!token) {
    return res.json({ source: 'unavailable', reason: 'OneMap credentials not configured', itineraries: [] });
  }

  const departureOffsetMin = Math.max(0, Math.min(360, Number(req.query.departureOffsetMin) || 0));
  const bikeAtStation = req.query.bikeAtStation === 'foldable' ? 'foldable' : 'park';
  const departure = new Date(Date.now() + departureOffsetMin * 60000);
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Singapore',
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  })
    .format(departure)
    .replace(/\//g, '-');
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Singapore',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(departure);

  const originToDestination = distanceMetersBetween(origin, destination);
  const uniqueStations = Array.from(
    new Map(SINGAPORE_MRT_STATIONS.map((station) => [station.name, station])).values()
  );
  const hubCandidates = uniqueStations
    .map((station) => ({
      ...station,
      cycleApproachMeters: distanceMetersBetween(origin, station),
      remainingMeters: distanceMetersBetween(station, destination),
    }))
    .filter(
      (station) =>
        station.cycleApproachMeters >= 1200 &&
        station.cycleApproachMeters <= 5000 &&
        station.remainingMeters < originToDestination * 1.15
    )
    .sort(
      (a, b) =>
        a.cycleApproachMeters + a.remainingMeters * 0.2 -
        (b.cycleApproachMeters + b.remainingMeters * 0.2)
    )
    .slice(0, 2);

  if (hubCandidates.length === 0) {
    return res.json({ source: 'unavailable', reason: 'no_suitable_bike_transit_hub', itineraries: [] });
  }

  const fetchJson = async (params: URLSearchParams) => {
    const response = await fetch(
      `https://www.onemap.gov.sg/api/public/routingsvc/route?${params.toString()}`,
      { headers: { Authorization: token }, signal: AbortSignal.timeout(10000) }
    );
    if (!response.ok) throw new Error(`OneMap returned ${response.status}`);
    return response.json();
  };

  const findBikeParking = async (hub: { lat: number; lng: number }) => {
    const ltaKey = process.env.LTA_ACCOUNT_KEY;
    if (!ltaKey) return null;
    try {
      const params = new URLSearchParams({
        Lat: String(hub.lat),
        Long: String(hub.lng),
        Dist: '0.5',
      });
      const response = await fetch(
        `https://datamall2.mytransport.sg/ltaodataservice/BicycleParkingv2?${params.toString()}`,
        {
          headers: { AccountKey: ltaKey, accept: 'application/json' },
          signal: AbortSignal.timeout(6000),
        }
      );
      if (!response.ok) return null;
      const data = await response.json();
      const locations = Array.isArray(data.value) ? data.value : [];
      if (locations.length === 0) return null;
      markLtaSuccess();
      return locations
        .map((location: any) => ({
          description: String(location.Description || 'Bicycle parking'),
          lat: Number(location.Latitude),
          lng: Number(location.Longitude),
          rackType: String(location.RackType || 'bicycle racks'),
          rackCount: Number(location.RackCount || 0),
          sheltered: String(location.ShelterIndicator || '').toUpperCase() === 'Y',
        }))
        .filter((location: any) => Number.isFinite(location.lat) && Number.isFinite(location.lng))
        .sort(
          (a: any, b: any) =>
            distanceMetersBetween(hub, a) - distanceMetersBetween(hub, b)
        )[0] || null;
    } catch {
      return null;
    }
  };

  const buildForHub = async (hub: (typeof hubCandidates)[number], hubIndex: number) => {
    const parking = bikeAtStation === 'park' ? await findBikeParking(hub) : null;
    const cycleTarget = parking
      ? { lat: parking.lat, lng: parking.lng }
      : { lat: hub.lat, lng: hub.lng };

    const cycleParams = new URLSearchParams({
      start: `${origin.lat},${origin.lng}`,
      end: `${cycleTarget.lat},${cycleTarget.lng}`,
      routeType: 'cycle',
    });
    const transitParams = new URLSearchParams({
      start: `${hub.lat},${hub.lng}`,
      end: `${destination.lat},${destination.lng}`,
      routeType: 'pt',
      date,
      time,
      mode: 'TRANSIT',
      maxWalkDistance: '1000',
      numItineraries: '2',
    });

    const [cycleData, transitData] = await Promise.all([
      fetchJson(cycleParams),
      fetchJson(transitParams),
    ]);
    const cycleSummary = cycleData.route_summary;
    const transitItinerary = (Array.isArray(transitData.plan?.itineraries)
      ? transitData.plan.itineraries
      : []
    ).find((itinerary: any) =>
      Array.isArray(itinerary.legs) && itinerary.legs.some((leg: any) => leg.mode !== 'WALK')
    );
    if (!cycleSummary || !cycleData.route_geometry || !transitItinerary) return null;

    const cyclingDistanceMeters = Math.round(Number(cycleSummary.total_distance || 0));
    const cyclingDurationMin = Math.max(1, Math.round(Number(cycleSummary.total_time || 0) / 60));
    const navigationInstructions = parseOneMapCycleInstructions(cycleData.route_instructions);

    const transitLegs = Array.isArray(transitItinerary.legs) ? transitItinerary.legs : [];
    const transitSteps = transitLegs.map((leg: any, index: number) => {
      const isWalk = leg.mode === 'WALK';
      const isTransferWalk = isWalk && !!leg.from?.name && leg.from.name === leg.to?.name;
      const type = isTransferWalk ? 'transfer' : isWalk ? 'walk' : leg.mode === 'BUS' ? 'bus' : 'train';
      const rawCoordinates: [number, number][] = leg.legGeometry?.points
        ? decodeOneMapPolyline(leg.legGeometry.points)
        : [
            [leg.from?.lat, leg.from?.lon],
            [leg.to?.lat, leg.to?.lon],
          ];
      const pathCoordinates = rawCoordinates.filter(
        (coordinate) => Number.isFinite(coordinate[0]) && Number.isFinite(coordinate[1])
      );
      const durationMin = Math.max(1, Math.round(Number(leg.duration || 0) / 60));
      const lineOrService = leg.route || leg.routeShortName || undefined;
      const boardingStation = type === 'train'
        ? resolveStationByNameAndLine(String(leg.from?.name || ''), lineOrService)
        : null;
      const alightingStation = type === 'train'
        ? resolveStationByNameAndLine(String(leg.to?.name || ''), lineOrService)
        : null;
      return {
        stepNumber: index + 3,
        type,
        instruction: isTransferWalk
          ? `Transfer at ${leg.from?.name}`
          : isWalk
          ? `Walk to ${leg.to?.name || 'next stop'}`
          : `Take ${leg.route || leg.routeShortName || leg.mode} towards ${leg.to?.name || 'destination'}`,
        subText: `${durationMin} min`,
        durationMin,
        distanceMeters: leg.distance ? Math.round(leg.distance) : undefined,
        lineOrService,
        startPoint: { lat: leg.from?.lat, lng: leg.from?.lon, name: leg.from?.name },
        boardingStopCode: leg.mode === 'BUS' ? leg.from?.stopCode || undefined : undefined,
        alightingStopCode: leg.mode === 'BUS' ? leg.to?.stopCode || undefined : undefined,
        boardingStationCode: type === 'train' ? leg.from?.stopCode || boardingStation?.code : undefined,
        alightingStationCode: type === 'train' ? leg.to?.stopCode || alightingStation?.code : undefined,
        targetPoint: {
          name: leg.to?.name || 'Stop',
          lat: leg.to?.lat,
          lng: leg.to?.lon,
          type: isWalk ? 'destination' : type === 'bus' ? 'bus_stop' : 'mrt_entrance',
        },
        pathCoordinates,
      };
    });

    const parkingToHubMeters = Math.round(distanceMetersBetween(cycleTarget, hub));
    const transferDurationMin = Math.max(3, Math.round(parkingToHubMeters / 70) + 2);
    const parkingDescription = bikeAtStation === 'foldable'
      ? 'Fold bicycle before entering paid areas · follow operator rules'
      : parking
      ? `${parking.rackCount || 'LTA-listed'} ${parking.rackType}${parking.sheltered ? ' · sheltered' : ''}`
      : 'Allow time to secure your bicycle · parking availability not verified';
    const transitLines: string[] = Array.from(
      new Set(
        transitSteps
          .filter((step: any) => step.lineOrService)
          .map((step: any) => String(step.lineOrService))
      )
    );
    const walkingMinutes = transitSteps
      .filter((step: any) => step.type === 'walk' || step.type === 'transfer')
      .reduce((total: number, step: any) => total + step.durationMin, 0) + transferDurationMin;
    const transitLegCount = transitLegs.filter((leg: any) => leg.mode !== 'WALK').length;
    const transitDurationMin = Math.max(1, Math.round(Number(transitItinerary.duration || 0) / 60));

    const steps = [
      {
        stepNumber: 1,
        type: 'cycle',
        instruction: `Cycle to ${parking?.description || `${hub.name} MRT`}`,
        subText: `${(cyclingDistanceMeters / 1000).toFixed(1)} km · about ${cyclingDurationMin} min`,
        durationMin: cyclingDurationMin,
        distanceMeters: cyclingDistanceMeters,
        lineOrService: 'Cycle',
        startPoint: { ...origin, name: 'Starting point' },
        targetPoint: {
          name: parking?.description || `${hub.name} MRT`,
          lat: cycleTarget.lat,
          lng: cycleTarget.lng,
          type: parking ? 'bike_parking' : 'mrt_entrance',
        },
        pathCoordinates: decodeOneMapPolyline(cycleData.route_geometry),
        navigationInstructions,
      },
      {
        stepNumber: 2,
        type: 'transfer',
        instruction: bikeAtStation === 'foldable'
          ? `Fold bicycle and enter ${hub.name} MRT`
          : `Secure bicycle and enter ${hub.name} MRT`,
        subText: parkingDescription,
        durationMin: transferDurationMin,
        distanceMeters: parkingToHubMeters,
        startPoint: { ...cycleTarget, name: parking?.description || 'Cycle arrival point' },
        targetPoint: {
          name: `${hub.name} MRT`,
          identifier: hub.code,
          lat: hub.lat,
          lng: hub.lng,
          type: 'mrt_entrance',
        },
        pathCoordinates:
          parkingToHubMeters > 10
            ? [
                [cycleTarget.lat, cycleTarget.lng],
                [hub.lat, hub.lng],
              ]
            : [
                [hub.lat, hub.lng],
                [hub.lat + 0.00001, hub.lng + 0.00001],
              ],
      },
      ...transitSteps,
    ];

    return {
      id: createStableRouteId({
        routeMode: 'bike-transit',
        startId: coordinateLocationId(origin.lat, origin.lng),
        endId: coordinateLocationId(destination.lat, destination.lng),
        legs: steps.map((step: any) => ({
          mode: step.type,
          lineOrService: step.lineOrService,
          fromId: step.boardingStopCode || step.boardingStationCode || step.startPoint?.name,
          toId: step.alightingStopCode || step.alightingStationCode || step.targetPoint?.identifier || step.targetPoint?.name,
        })),
      }),
      title: `Bike-and-ride via ${hub.name}`,
      summary: `Cycle → ${transitLines.join(' → ') || 'public transport'}`,
      lines: ['Cycle', ...transitLines],
      totalDurationMin: cyclingDurationMin + transferDurationMin + transitDurationMin,
      departureTimeMs: departure.getTime(),
      walkingMinutes,
      transfers: Math.max(0, transitLegCount - 1),
      crowdRating: 'Moderate',
      crowdEstimateText: 'Transit crowd estimate not available for live-routed options',
      estimatedFare: transitItinerary.fare ? parseFloat(transitItinerary.fare) : undefined,
      reliabilityRating: 'Moderate',
      stepFreeAccessible: undefined,
      whyRecommended: `Cycle ${(cyclingDistanceMeters / 1000).toFixed(1)} km to ${hub.name}, secure your bicycle, then continue by public transport.`,
      steps,
      trafficSensitive: transitLegs.some((leg: any) => leg.mode === 'BUS'),
      routeMode: 'multimodal',
      cyclingDistanceMeters,
      bicycleParkingVerified: Boolean(parking),
      bicycleParkingAvailable: bikeAtStation === 'foldable' ? true : parking ? true : undefined,
      cyclingInfrastructureQuality: 'mixed',
      weatherSuitable: true,
      dataSource: 'live',
    };
  };

  try {
    const routes = (await Promise.all(hubCandidates.map(buildForHub))).filter(Boolean);
    return res.json({
      source: routes.length > 0 ? 'onemap_live' : 'unavailable',
      reason: routes.length > 0 ? undefined : 'no_multimodal_route',
      departureOffsetMin,
      itineraries: routes,
    });
  } catch (error) {
    console.warn('[Multimodal Routing] Error:', error);
    return res.json({ source: 'unavailable', reason: 'request_failed', itineraries: [] });
  }
});

// LTA Status check endpoint
// Lift Maintenance Endpoint (LTA v2/FacilitiesMaintenance). Central to the
// accessibility persona: warns which stations currently have a lift under
// adhoc maintenance. In practice this LTA endpoint returns the same
// network-wide list regardless of the StationCode param passed to it (tested:
// NS1, CC24 and EW1 all returned identical results) — so we fetch it once as
// a shared list and filter by station server-side, rather than trusting the
// upstream param to do that filtering.
interface LiftMaintenanceItem {
  line: string;
  stationCode: string;
  stationName: string;
  liftId?: string;
  liftDesc?: string;
}

let liftStatusCache: LiftMaintenanceItem[] = [];
let liftStatusFetchedAt = 0;

async function fetchAllLiftMaintenance(): Promise<LiftMaintenanceItem[]> {
  if (liftStatusCache.length > 0 && Date.now() - liftStatusFetchedAt < 10 * 60000) {
    return liftStatusCache;
  }

  const ltaKey = process.env.LTA_ACCOUNT_KEY;
  if (!ltaKey) return [];

  try {
    const response = await fetch(
      'https://datamall2.mytransport.sg/ltaodataservice/v2/FacilitiesMaintenance?StationCode=STATION',
      { headers: { AccountKey: ltaKey, accept: 'application/json' }, signal: AbortSignal.timeout(5000) }
    );
    if (response.ok) {
      const data = await response.json();
      const items: LiftMaintenanceItem[] = (data.value || []).map((v: any) => ({
        line: v.Line,
        stationCode: v.StationCode,
        stationName: v.StationName,
        liftId: v.LiftID || undefined,
        liftDesc: v.LiftDesc || undefined,
      }));
      liftStatusCache = items;
      liftStatusFetchedAt = Date.now();
      markLtaSuccess();
      return items;
    }
    console.warn('[LTA Lift Status] Non-OK response:', response.status);
  } catch (err) {
    console.warn('[LTA Lift Status] Error:', err);
  }
  return liftStatusCache; // serve stale cache over a hard failure, if we have one
}

app.get('/api/lift-status', async (req, res) => {
  const ltaKey = process.env.LTA_ACCOUNT_KEY;
  if (!ltaKey) {
    return res.json({ source: 'unavailable', reason: 'LTA_ACCOUNT_KEY not configured', items: [] });
  }

  const stationCode = String(req.query.stationCode || '').toUpperCase().trim();
  const all = await fetchAllLiftMaintenance();
  const items = stationCode ? all.filter((i) => i.stationCode === stationCode) : all;
  const isLive = Date.now() - lastLtaSuccessAt < LTA_LIVE_FRESHNESS_MS;
  res.json({ source: isLive ? 'lta_live' : 'mock_sg', stationCode: stationCode || undefined, items });
});

app.get('/api/lta-status', (req, res) => {
  const hasKey = Boolean(process.env.LTA_ACCOUNT_KEY && process.env.LTA_ACCOUNT_KEY.trim().length > 0);
  // A configured key that LTA is actually rejecting (expired, malformed,
  // not yet approved) must not report live - liveMode reflects real recent
  // connectivity, not just "a key string is present".
  const liveMode = hasKey && Date.now() - lastLtaSuccessAt < LTA_LIVE_FRESHNESS_MS;
  res.json({
    liveMode,
    provider: liveMode ? 'LTA DataMall v3 Live API' : 'Singapore Transport Data Abstraction (Fallback)',
    accountKeyConfigured: hasKey,
    cachedBusStopsCount: cachedBusStops.length,
  });
});

// Bus Stops Endpoint (supports viewport bounds or proximity)
app.get('/api/bus-stops', (req, res) => {
  const isLive = cachedBusStops.length > 0;
  const stops = isLive ? cachedBusStops : FALLBACK_BUS_STOPS;

  const lat = parseFloat(String(req.query.lat || ''));
  const lng = parseFloat(String(req.query.lng || ''));
  const radiusKm = parseFloat(String(req.query.radius || '3.5'));

  if (!isNaN(lat) && !isNaN(lng)) {
    // Distance filter
    const degKm = 111.0;
    const filtered = stops.filter((s) => {
      const dLat = (s.lat - lat) * degKm;
      const dLng = (s.lng - lng) * degKm * Math.cos((lat * Math.PI) / 180);
      const dist = Math.sqrt(dLat * dLat + dLng * dLng);
      return dist <= radiusKm;
    });
    return res.json({ source: isLive ? 'lta_live' : 'mock_sg', total: filtered.length, data: filtered.slice(0, 80) });
  }

  // Default: Return Kent Ridge area + major transit hubs
  const defaultStops = stops.filter((s) => {
    // Within Kent Ridge / Queenstown / Buona Vista / Central corridor
    const inWest = s.lat >= 1.285 && s.lat <= 1.325 && s.lng >= 103.765 && s.lng <= 103.815;
    const inCentral = s.lat >= 1.290 && s.lat <= 1.310 && s.lng >= 103.845 && s.lng <= 103.865;
    return inWest || inCentral;
  });

  return res.json({
    source: isLive ? 'lta_live' : 'mock_sg',
    total: defaultStops.length > 0 ? defaultStops.length : stops.length,
    data: defaultStops.length > 0 ? defaultStops.slice(0, 100) : stops.slice(0, 100),
  });
});

// Helper to format terminus name from destination code
function getTerminusName(destCode: string, svcNo: string): string {
  if (destCode && stopCodeToName[destCode]) {
    return stopCodeToName[destCode];
  }
  if (destCode === '16009') return 'Kent Ridge Ter';
  if (destCode === '17009') return 'Clementi Int';
  if (destCode === '18009') return 'Buona Vista Ter';
  if (destCode === '64009') return 'Hougang Central Int';
  if (destCode === '84009') return 'Bedok Int';
  if (destCode === '01059') return 'Marina Ctr Ter';
  if (destCode === '02049') return 'Shenton Way Ter';
  if (destCode === '03218') return 'Bugis Stn';
  return `Terminus (${destCode || svcNo})`;
}

// Single Bus Stop Arrivals Endpoint (Live LTA DataMall v3)
// Per-stop cache, short TTL since arrival ETAs are time-sensitive - just
// enough to absorb rapid repeated taps/renders without hammering LTA.
const busArrivalsCache: Record<string, { body: any; fetchedAt: number }> = {};
const BUS_ARRIVALS_CACHE_MS = 15000;

app.get('/api/bus-arrivals', async (req, res) => {
  const stopCode = String(req.query.stopCode || '18331');
  const ltaKey = process.env.LTA_ACCOUNT_KEY;

  const cached = busArrivalsCache[stopCode];
  if (cached && Date.now() - cached.fetchedAt < BUS_ARRIVALS_CACHE_MS) {
    return res.json(cached.body);
  }

  if (ltaKey) {
    try {
      const response = await fetch(
        `https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival?BusStopCode=${stopCode}`,
        {
          headers: { AccountKey: ltaKey, accept: 'application/json' },
          signal: AbortSignal.timeout(5000),
        }
      );

      if (response.ok) {
        const data = await response.json();
        markLtaSuccess(); // a real, successful LTA response, even with zero active Services right now
        if (data.Services && data.Services.length > 0) {
          const now = Date.now();
          const mappedServices = data.Services.map((svc: any) => {
            const calculateEta = (isoString?: string) => {
              if (!isoString) return undefined;
              const diffMs = new Date(isoString).getTime() - now;
              const min = Math.round(diffMs / 60000);
              return Math.max(0, min);
            };

            const eta1 = calculateEta(svc.NextBus?.EstimatedArrival) ?? 0;
            const eta2 = calculateEta(svc.NextBus2?.EstimatedArrival);
            const eta3 = calculateEta(svc.NextBus3?.EstimatedArrival);

            // Map LTA Load: SEA (Seats Available), SDA (Standing Available), LSD (Limited Standing)
            let crowd: string = 'Seats available';
            if (svc.NextBus?.Load === 'SDA') crowd = 'Standing available';
            if (svc.NextBus?.Load === 'LSD') crowd = 'Crowded';

            const destCode = svc.NextBus?.DestinationCode || '';
            const destName = getTerminusName(destCode, svc.ServiceNo);

            return {
              serviceNo: svc.ServiceNo,
              destination: destName,
              nextBusMin: eta1,
              subsequentBusMin: eta2,
              thirdBusMin: eta3,
              crowdLevel: crowd,
              traffic: eta1 > 8 ? 'Slow traffic' : 'Smooth',
              wheelchair: svc.NextBus?.Feature === 'WAB',
              type: svc.NextBus?.Type === 'DD' ? 'DD' : 'SD',
            };
          });

          const body = {
            source: 'lta_live',
            stopCode,
            stopName: stopCodeToName[stopCode] || `Stop ${stopCode}`,
            timestamp: new Date().toISOString(),
            arrivals: mappedServices,
          };
          busArrivalsCache[stopCode] = { body, fetchedAt: Date.now() };
          return res.json(body);
        }
        // A real, successful LTA response confirming zero active services right
        // now is live information, not a failure - never fake bus arrivals here.
        const offServiceBody = {
          source: 'lta_live',
          stopCode,
          stopName: stopCodeToName[stopCode] || `Stop ${stopCode}`,
          timestamp: new Date().toISOString(),
          arrivals: [],
          offService: true,
        };
        busArrivalsCache[stopCode] = { body: offServiceBody, fetchedAt: Date.now() };
        console.log(`[LTA Bus Arrival] Stop ${stopCode}: confirmed off service (0 active buses right now)`);
        return res.json(offServiceBody);
      } else {
        console.warn(`[LTA Bus Arrival] Stop ${stopCode}: Non-OK response: ${response.status}`);
      }
    } catch (err) {
      console.warn('[LTA Live Arrivals] Failed, falling back:', err);
    }
  }

  // Fallback
  return res.json({
    source: 'mock_sg',
    stopCode,
    arrivals: [
      {
        serviceNo: '95',
        destination: 'Kent Ridge Ter / Buona Vista',
        nextBusMin: 2,
        subsequentBusMin: 8,
        thirdBusMin: 14,
        crowdLevel: 'Seats available',
        traffic: 'Smooth',
        wheelchair: true,
        type: 'DD',
      },
    ],
  });
});

// Real-Time Nearby Live Conditions Endpoint (powers Home & Alerts screens).
// Queries 4 bus stops at once on every call - this was the single biggest
// uncached hotspot in the app (hit on mount AND every manual refresh tap).
let nearbyLiveCache: any = null;
let nearbyLiveFetchedAt = 0;
const NEARBY_LIVE_CACHE_MS = 15000;

app.get('/api/nearby-live', async (req, res) => {
  const requestedLat = Number(req.query.lat);
  const requestedLng = Number(req.query.lng);
  const hasRequestedLocation = Number.isFinite(requestedLat) && Number.isFinite(requestedLng);
  // Kent Ridge is the neutral default before a persona is selected.
  const referenceLat = hasRequestedLocation ? requestedLat : 1.2935;
  const referenceLng = hasRequestedLocation ? requestedLng : 103.7844;
  const cacheKey = `${referenceLat.toFixed(4)},${referenceLng.toFixed(4)}`;

  if (
    nearbyLiveCache?.cacheKey === cacheKey &&
    Date.now() - nearbyLiveFetchedAt < NEARBY_LIVE_CACHE_MS
  ) {
    return res.json(nearbyLiveCache);
  }

  const ltaKey = process.env.LTA_ACCOUNT_KEY;

  if (ltaKey) {
    try {
      // Stop proximity determines the list. Arrival time is used only to pick
      // the representative service for an already-selected nearest stop.
      const nearbyStops = [...(cachedBusStops.length ? cachedBusStops : FALLBACK_BUS_STOPS)]
        .map((stop) => ({
          ...stop,
          distanceMeters: Math.round(distanceMetersBetween({ lat: referenceLat, lng: referenceLng }, stop)),
        }))
        .sort((a, b) => a.distanceMeters - b.distanceMeters)
        .slice(0, 4);
      const fetches = nearbyStops.map((stop) =>
        fetch(`https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival?BusStopCode=${stop.code}`, {
          headers: { AccountKey: ltaKey, accept: 'application/json' },
          signal: AbortSignal.timeout(4000),
        })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
      );

      const responses = await Promise.all(fetches);
      const now = Date.now();
      const liveItems: any[] = [];
      const seenServices = new Set<string>();

      let respondedCount = 0;
      responses.forEach((resp, idx) => {
        if (!resp) return;
        respondedCount++;
        markLtaSuccess(); // a real, successful LTA response, even with zero active Services right now
        if (!resp.Services) return;
        const stop = nearbyStops[idx];
        if (!stop) return;
        const stopCode = stop.code;
        const stopName = stopCodeToName[stopCode] || stop.desc || `Stop ${stopCode}`;

        // One card per stop makes the shown stops an unambiguous nearest-to-
        // furthest list instead of letting several services at one stop crowd
        // out the next closest stop.
        const services = [...resp.Services].sort((a: any, b: any) => {
          const eta = (service: any) =>
            service.NextBus?.EstimatedArrival
              ? Math.max(0, new Date(service.NextBus.EstimatedArrival).getTime() - now)
              : Number.MAX_SAFE_INTEGER;
          return eta(a) - eta(b);
        });

        for (const svc of services) {
          const svcNo = svc.ServiceNo;
          if (seenServices.has(svcNo)) continue;

          if (svc.NextBus?.EstimatedArrival) {
            const diffMs = new Date(svc.NextBus.EstimatedArrival).getTime() - now;
            const min = Math.max(0, Math.round(diffMs / 60000));
            seenServices.add(svcNo);

            let crowd = 'Seats available';
            if (svc.NextBus.Load === 'SDA') crowd = 'Standing available';
            if (svc.NextBus.Load === 'LSD') crowd = 'Crowded';

            const dest = getTerminusName(svc.NextBus.DestinationCode, svcNo);

            liveItems.push({
              id: `live-bus-${svcNo}-${stopCode}`,
              type: 'bus',
              serviceOrLine: svcNo,
              routeTitle: `Bus ${svcNo} · ${dest}`,
              title: `Bus ${svcNo}`,
              subtitle: `${stopName} → ${dest}`,
              status: min === 0 ? 'Arr' : `${min} min`,
              nextArrivalMin: min,
              crowdLevel: crowd,
              trafficOrStatus: min > 8 ? 'Slow traffic' : 'Smooth',
              trafficStatus: min > 8 ? 'Slow traffic' : 'Smooth',
              routeId: svcNo,
              etaMinutes: min,
              stopCode,
              stopName,
              boardingStopName: stopName,
              destination: dest,
              distanceMeters: stop.distanceMeters,
            });
            break;
          }
        }
      });

      // Track whether any REAL LTA bus data came through before adding the
      // locally-simulated train estimate below - that estimate is always
      // present, so "source" must not claim live off its presence alone.
      const hasRealLiveBusData = liveItems.length > 0;

      // Add Kent Ridge and Buona Vista MRT to nearby live conditions
      const cclKentRidge = stationPcdCache['CC24'];
      const kentRidgeTrain = getTrainArrivalInfo('CC24');
      liveItems.push({
        id: 'live-train-ccl-kent-ridge',
        type: 'train',
        serviceOrLine: 'CCL',
        routeTitle: 'Circle Line · Kent Ridge Stn',
        title: 'Kent Ridge MRT (CCL)',
        subtitle: 'Towards HarbourFront / Dhoby Ghaut',
        status: `${kentRidgeTrain.nextTrainMin} min`,
        nextArrivalMin: kentRidgeTrain.nextTrainMin,
        crowdLevel: cclKentRidge ? cclKentRidge.crowdLevel : 'Seats available',
        trafficOrStatus: 'Normal service',
        trafficStatus: 'Normal service',
        routeId: 'ccl',
        etaMinutes: kentRidgeTrain.nextTrainMin,
        stopCode: 'CC24',
        stopName: 'Kent Ridge MRT',
      });

      if (hasRealLiveBusData) {
        // Distance controls the order; arrival breaks ties only at one stop.
        liveItems.sort(
          (a, b) =>
            (a.distanceMeters ?? Number.MAX_SAFE_INTEGER) - (b.distanceMeters ?? Number.MAX_SAFE_INTEGER) ||
            a.etaMinutes - b.etaMinutes
        );
        const body = {
          source: 'lta_live',
          timestamp: getSingaporeTimeString(true),
          items: liveItems.slice(0, 8),
          cacheKey,
        };
        nearbyLiveCache = body;
        nearbyLiveFetchedAt = Date.now();
        return res.json(body);
      }

      if (respondedCount > 0) {
        // Real LTA connectivity confirmed (at least one stop answered), but
        // genuinely zero active bus services right now - that is live,
        // honest information, not a failure. Never fake bus arrivals here;
        // say so plainly instead. liveItems only holds the train estimate.
        const body = {
          source: 'lta_live',
          timestamp: getSingaporeTimeString(true),
          items: liveItems,
          busesOffService: true,
        };
        nearbyLiveCache = body;
        nearbyLiveFetchedAt = Date.now();
        return res.json(body);
      }
    } catch (err) {
      console.warn('[LTA Live Nearby] Error fetching live conditions:', err);
    }
  }

  // Geographic fallback: preserve the same nearest-stop ordering when LTA
  // arrivals are unavailable instead of reverting to Kent Ridge data.
  const fallbackItems = [...FALLBACK_BUS_STOPS]
    .map((stop) => ({
      ...stop,
      distanceMeters: Math.round(distanceMetersBetween({ lat: referenceLat, lng: referenceLng }, stop)),
    }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 4)
    .map((stop, index) => {
      const service =
        FALLBACK_NEARBY_BUS_SERVICE[stop.code] ??
        { serviceNo: String(10 + index), destination: 'City', etaMinutes: 4 + index, crowd: 'Seats available', traffic: 'Smooth' };
      return {
        id: `fallback-bus-${stop.code}`,
        type: 'bus',
        title: `Bus ${service.serviceNo}`,
        subtitle: `${stop.desc} → ${service.destination}`,
        status: service.etaMinutes === 0 ? 'Arr' : `${service.etaMinutes} min`,
        crowdLevel: service.crowd,
        trafficStatus: service.traffic,
        routeId: service.serviceNo,
        etaMinutes: service.etaMinutes,
        serviceOrLine: service.serviceNo,
        routeTitle: `Bus ${service.serviceNo} · ${service.destination}`,
        nextArrivalMin: service.etaMinutes,
        trafficOrStatus: service.traffic,
        stopCode: stop.code,
        stopName: stop.desc,
        boardingStopName: stop.desc,
        destination: service.destination,
        distanceMeters: stop.distanceMeters,
      };
    });

  return res.json({
    source: 'mock_sg',
    timestamp: getSingaporeTimeString(true),
    items: fallbackItems,
    cacheKey,
  });
});

// Station crowding for specific stations on one line: live PCDRealTime levels
// plus PCDForecast's 30-minute interval forecast for the rest of the day, so a
// flexible commuter can be told when to leave to miss the peak.
type CrowdCode = 'l' | 'm' | 'h';
interface CrowdInterval {
  start: string;
  end: string;
  level: CrowdCode;
}
const pcdLineCache: Record<
  string,
  { fetchedAt: number; realtime: Record<string, CrowdCode>; forecast: Record<string, CrowdInterval[]> }
> = {};

const toCrowdCode = (raw: unknown): CrowdCode | null => {
  const v = String(raw || '').toLowerCase();
  return v === 'l' || v === 'm' || v === 'h' ? v : null;
};

async function getLineCrowd(line: string, apiKey: string) {
  const cached = pcdLineCache[line];
  if (cached && Date.now() - cached.fetchedAt < 5 * 60000) return cached;

  const headers = { AccountKey: apiKey, accept: 'application/json' };
  const realtime: Record<string, CrowdCode> = {};
  const forecast: Record<string, CrowdInterval[]> = {};

  try {
    const res = await fetch(`https://datamall2.mytransport.sg/ltaodataservice/PCDRealTime?TrainLine=${line}`, {
      headers,
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      for (const item of Array.isArray(data.value) ? data.value : []) {
        const level = toCrowdCode(item.CrowdLevel);
        if (item.Station && level) realtime[item.Station] = level;
      }
    }
  } catch (err) {
    console.warn(`[LTA PCDRealTime] ${line} failed:`, err);
  }

  try {
    const res = await fetch(`https://datamall2.mytransport.sg/ltaodataservice/PCDForecast?TrainLine=${line}`, {
      headers,
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const data = await res.json();
      for (const day of Array.isArray(data.value) ? data.value : []) {
        for (const station of Array.isArray(day.Stations) ? day.Stations : []) {
          const intervals: CrowdInterval[] = [];
          for (const interval of Array.isArray(station.Interval) ? station.Interval : []) {
            const level = toCrowdCode(interval.CrowdLevel);
            if (level && interval.Start) {
              intervals.push({ start: interval.Start, end: interval.End || '', level });
            }
          }
          if (station.Station && intervals.length > 0) forecast[station.Station] = intervals;
        }
      }
    }
  } catch (err) {
    console.warn(`[LTA PCDForecast] ${line} failed:`, err);
  }

  const entry = { fetchedAt: Date.now(), realtime, forecast };
  if (Object.keys(realtime).length > 0 || Object.keys(forecast).length > 0) {
    markLtaSuccess();
    pcdLineCache[line] = entry;
  }
  return entry;
}

app.get('/api/station-crowd', async (req, res) => {
  const line = String(req.query.line || '').toUpperCase();
  const stations = String(req.query.stations || '')
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter((code) => /^[A-Z]{1,3}\d{1,3}$/.test(code))
    .slice(0, 12);
  if (!/^[A-Z]{2,5}$/.test(line) || stations.length === 0) {
    return res.status(400).json({ source: 'error', reason: 'line and stations required' });
  }

  const ltaKey = process.env.LTA_ACCOUNT_KEY;
  if (!ltaKey) {
    return res.json({ source: 'unavailable', reason: 'LTA_ACCOUNT_KEY not configured', realtime: {}, forecast: {} });
  }

  const data = await getLineCrowd(line, ltaKey);
  const realtime: Record<string, CrowdCode> = {};
  const forecast: Record<string, CrowdInterval[]> = {};
  for (const code of stations) {
    if (data.realtime[code]) realtime[code] = data.realtime[code];
    if (data.forecast[code]) forecast[code] = data.forecast[code];
  }
  const hasData = Object.keys(realtime).length > 0 || Object.keys(forecast).length > 0;
  res.json({ source: hasData ? 'lta_live' : 'unavailable', line, realtime, forecast });
});

function crowdFromBusLoad(load: unknown): CrowdRisk {
  const value = String(load || '').trim().toUpperCase();
  if (value === 'SEA' || value === 'SEATS AVAILABLE') return 'LOW';
  if (value === 'SDA' || value === 'STANDING AVAILABLE' || value === 'MODERATE CROWD') return 'MODERATE';
  if (value === 'LSD' || value === 'CROWDED') return 'HIGH';
  return 'UNKNOWN';
}

async function getMatchedBusCrowd(
  stopCode: string,
  serviceNo: string,
  apiKey: string
): Promise<CrowdRisk> {
  const cached = busArrivalsCache[stopCode];
  if (cached && Date.now() - cached.fetchedAt < BUS_ARRIVALS_CACHE_MS && cached.body?.source === 'lta_live') {
    const arrival = (cached.body.arrivals || []).find(
      (item: any) => String(item.serviceNo) === serviceNo
    );
    if (arrival) return crowdFromBusLoad(arrival.crowdLevel);
  }

  try {
    const response = await fetch(
      `https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival?BusStopCode=${encodeURIComponent(stopCode)}`,
      {
        headers: { AccountKey: apiKey, accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!response.ok) return 'UNKNOWN';
    const data = await response.json();
    markLtaSuccess();
    const service = (Array.isArray(data.Services) ? data.Services : []).find(
      (item: any) => String(item.ServiceNo) === serviceNo
    );
    return crowdFromBusLoad(service?.NextBus?.Load);
  } catch {
    return 'UNKNOWN';
  }
}

function lineForStationCode(code: string): string | null {
  return SINGAPORE_MRT_STATIONS.find((station) => station.code === code)?.line || null;
}

function crowdForForecastTarget(
  intervals: CrowdInterval[] | undefined,
  targetTimeMs: number
): { crowd: CrowdRisk; atMs: number } | null {
  if (!intervals?.length) return null;
  const target = new Date(targetTimeMs);
  const targetSgParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Singapore',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(target).split(':').map(Number);
  const targetMinute = targetSgParts[0] * 60 + targetSgParts[1];
  const match = intervals.find((interval) => {
    const startIso = Date.parse(interval.start);
    const endIso = Date.parse(interval.end);
    if (Number.isFinite(startIso)) {
      return targetTimeMs >= startIso && (!Number.isFinite(endIso) || targetTimeMs < endIso);
    }
    const start = /^(\d{1,2}):(\d{2})/.exec(interval.start);
    const end = /^(\d{1,2}):(\d{2})/.exec(interval.end);
    if (!start) return false;
    const startMinute = Number(start[1]) * 60 + Number(start[2]);
    const endMinute = end ? Number(end[1]) * 60 + Number(end[2]) : startMinute + 30;
    return targetMinute >= startMinute && targetMinute < endMinute;
  });
  return match ? { crowd: mapPcdCode(match.level), atMs: targetTimeMs } : null;
}

function observation(
  resourceId: string,
  type: ResourceObservation['type'],
  name: string | undefined,
  currentCrowd: CrowdRisk,
  observedAtMs: number,
  disrupted: boolean,
  forecast?: { crowd: CrowdRisk; atMs: number } | null
): ResourceObservation {
  return {
    resourceId,
    type,
    name,
    observedAtMs,
    currentCrowd,
    backgroundDemand15Min: proxyDemandForCrowd(currentCrowd),
    capacity15Min: NETWORK_PROXY_CAPACITY_15_MIN,
    disrupted,
    forecastCrowd: forecast?.crowd,
    forecastAtMs: forecast?.atMs,
  };
}

async function buildNetworkObservations(
  routes: RouteOption[],
  nowMs: number
): Promise<{ observations: ResourceObservation[]; disruptedLines: string[] }> {
  const apiKey = process.env.LTA_ACCOUNT_KEY;
  if (!apiKey) return { observations: [], disruptedLines: [] };

  const adapted = adaptTransitCompanionRoutes(routes, { nowMs });
  const lineCodes = new Set<string>();
  for (const route of adapted) {
    for (const resource of route.resources) {
      const stationMatch = /^STATION_([A-Z]{1,3}\d{1,3})$/.exec(resource.resourceId);
      const corridorMatch = /^RAIL_([A-Z]{2,5})_/.exec(resource.resourceId);
      const line = stationMatch ? lineForStationCode(stationMatch[1]) : corridorMatch?.[1];
      if (line && normalizeLineToCode(line)) lineCodes.add(line);
    }
  }

  const [alerts, ...lineEntries] = await Promise.all([
    fetchTrainServiceAlerts(apiKey),
    ...Array.from(lineCodes).map(async (line) => [line, await getLineCrowd(line, apiKey)] as const),
  ]);
  const crowdByLine = new Map(lineEntries as Array<readonly [string, Awaited<ReturnType<typeof getLineCrowd>>]>);
  const disruptedLines: string[] = Array.from(
    new Set<string>(
      (alerts?.value?.AffectedSegments || [])
        .map((segment: any) => normalizeLineToCode(String(segment.Line || '')))
        .filter((line: string | null): line is string => Boolean(line))
    )
  );
  const disruptedSet = new Set(disruptedLines);
  const byId = new Map<string, ResourceObservation>();

  for (const route of adapted) {
    for (const resource of route.resources) {
      if (resource.type !== 'STATION' && resource.type !== 'RAIL_SEGMENT') continue;
      const stationMatch = /^STATION_([A-Z]{1,3}\d{1,3})$/.exec(resource.resourceId);
      const corridorMatch = /^RAIL_([A-Z]{2,5})_([A-Z]{1,3}\d{1,3})_([A-Z]{1,3}\d{1,3})$/.exec(resource.resourceId);
      const stationCodes = stationMatch
        ? [stationMatch[1]]
        : corridorMatch
        ? [corridorMatch[2], corridorMatch[3]]
        : [];
      const line = stationCodes.length > 0
        ? lineForStationCode(stationCodes[0])
        : corridorMatch?.[1] || null;
      const lineEntry = line ? crowdByLine.get(line) : undefined;
      const currentCodes = stationCodes
        .map((code) => lineEntry?.realtime[code] || stationPcdCache[code]?.rawCode)
        .filter(Boolean);
      const currentRisks = currentCodes.map(mapPcdCode);
      const riskRank: Record<CrowdRisk, number> = { UNKNOWN: 0, LOW: 1, MODERATE: 2, HIGH: 3, CRITICAL: 4 };
      const currentCrowd = currentRisks.sort((a, b) => riskRank[b] - riskRank[a])[0] || 'UNKNOWN';
      const targetTimeMs = route.departureTimeMs + resource.arrivalOffsetMinutes * 60_000;
      const forecasts = stationCodes
        .map((code) => crowdForForecastTarget(lineEntry?.forecast[code], targetTimeMs))
        .filter((value): value is { crowd: CrowdRisk; atMs: number } => Boolean(value));
      const forecast = forecasts.sort((a, b) => riskRank[b.crowd] - riskRank[a.crowd])[0];
      const isDisrupted = Boolean(line && disruptedSet.has(line));

      // No current, forecast or disruption signal means the resource must stay
      // absent from NetworkState, which preserves conservative UNKNOWN handling.
      if (currentCrowd === 'UNKNOWN' && !forecast && !isDisrupted) continue;
      byId.set(
        resource.resourceId,
        observation(resource.resourceId, resource.type, resource.name, currentCrowd, nowMs, isDisrupted, forecast)
      );
    }
  }

  const busUses = new Map<string, { stopCode: string; serviceNo: string; names: string[] }>();
  for (const route of routes) {
    for (const step of route.steps) {
      if (step.type !== 'bus' || !step.boardingStopCode || !step.lineOrService) continue;
      const key = `${step.boardingStopCode}::${step.lineOrService}`;
      busUses.set(key, {
        stopCode: step.boardingStopCode,
        serviceNo: step.lineOrService,
        names: [step.startPoint?.name || `Stop ${step.boardingStopCode}`, `Bus ${step.lineOrService}`],
      });
    }
  }
  await Promise.all(
    Array.from(busUses.values()).map(async ({ stopCode, serviceNo, names }) => {
      const crowd = await getMatchedBusCrowd(stopCode, serviceNo, apiKey);
      if (crowd === 'UNKNOWN') return;
      byId.set(
        `BUS_STOP_${stopCode}`,
        observation(`BUS_STOP_${stopCode}`, 'BUS_STOP', names[0], crowd, nowMs, false)
      );
      byId.set(
        `BUS_SERVICE_${serviceNo.toUpperCase()}`,
        observation(`BUS_SERVICE_${serviceNo}`, 'BUS_SERVICE', names[1], crowd, nowMs, false)
      );
    })
  );

  return { observations: Array.from(byId.values()), disruptedLines };
}

function sanitiseRouteOption(value: unknown): RouteOption | null {
  if (!value || typeof value !== 'object') return null;
  const route = value as RouteOption;
  if (
    typeof route.id !== 'string' || route.id.length < 1 || route.id.length > 200 ||
    !Number.isFinite(route.totalDurationMin) || route.totalDurationMin <= 0 || route.totalDurationMin > 1440 ||
    !Array.isArray(route.steps) || route.steps.length > 100
  ) return null;
  const allowedTypes = new Set(['walk', 'cycle', 'train', 'bus', 'transfer']);
  if (route.steps.some((step) => !step || !allowedTypes.has(step.type) || !Number.isFinite(step.durationMin))) {
    return null;
  }
  return {
    ...route,
    id: route.id.trim(),
    departureTimeMs: Number.isFinite(route.departureTimeMs) ? route.departureTimeMs : undefined,
    steps: route.steps.map((step) => ({ ...step })),
  };
}

app.post('/api/network-aware/evaluate', async (req, res) => {
  const rawRoutes = Array.isArray(req.body?.routes) ? req.body.routes.slice(0, 20) : [];
  const routes = rawRoutes.map(sanitiseRouteOption).filter((route): route is RouteOption => Boolean(route));
  if (routes.length === 0 || routes.length !== rawRoutes.length) {
    return res.status(400).json({ error: 'A valid routes array is required.' });
  }
  if (new Set(routes.map((route) => route.id)).size !== routes.length) {
    return res.status(400).json({ error: 'Route IDs must be unique.' });
  }
  const rawCosts = req.body?.personalCostByRouteId;
  if (!rawCosts || typeof rawCosts !== 'object') {
    return res.status(400).json({ error: 'personalCostByRouteId is required.' });
  }
  const personalCostByRouteId: Record<string, number> = {};
  for (const route of routes) {
    const cost = Number(rawCosts[route.id]);
    if (!Number.isFinite(cost) || cost < 0 || cost > 1_000_000) {
      return res.status(400).json({ error: `Invalid personal cost for ${route.id}.` });
    }
    personalCostByRouteId[route.id] = cost;
  }

  const nowMs = Number.isFinite(req.body?.nowMs) ? Number(req.body.nowMs) : Date.now();
  const { observations, disruptedLines } = await buildNetworkObservations(routes, nowMs);
  const beforeLedgerSize = networkAwareRuntime.ledger.size();
  const result = networkAwareRuntime.evaluate({
    routes,
    personalCostByRouteId,
    nowMs,
    incumbentRouteId: typeof req.body?.incumbentRouteId === 'string' ? req.body.incumbentRouteId : undefined,
    observations,
    adapterOptions: { nowMs, disruptedLineCodes: disruptedLines },
  });
  if (networkAwareRuntime.ledger.size() !== beforeLedgerSize) {
    return res.status(500).json({ error: 'Shadow evaluation unexpectedly changed recommendation demand.' });
  }
  const observationById = new Map(
    observations.map((item) => [item.resourceId.trim().toUpperCase(), item])
  );
  const replayMode = req.body?.mode === 'replay';

  return res.json({
    recommendedRouteId: result.recommended?.route.id ?? null,
    personalBaselineRouteId: result.personalBaselineRouteId,
    rankedRoutes: result.rankedRoutes.map((item) => ({
      routeId: item.route.id,
      personalCost: item.personalCost,
      networkCost: item.networkCost,
      fairnessPenalty: item.fairness.penalty,
      switchingCost: item.switchingCost,
      totalCost: item.totalCost,
      crowdRisk: item.prediction.crowdRisk,
      bottleneckResourceId: item.prediction.bottleneckResourceId,
      bottleneckResourceName: item.prediction.bottleneckResourceName,
      reason: item.reason,
      decisionReasonCode: item.decisionReasonCode,
      resources: item.prediction.resourcePredictions.map((prediction) => {
        const source = observationById.get(prediction.resourceId.trim().toUpperCase());
        const provenance: string[] = replayMode ? ['REPLAY'] : [];
        if (!source) {
          provenance.push('UNKNOWN');
        } else {
          if (source.currentCrowd !== 'UNKNOWN') provenance.push('LTA_REALTIME');
          if (source.forecastCrowd) provenance.push('LTA_FORECAST');
          provenance.push('PROXY');
        }
        return {
          resourceId: prediction.resourceId,
          resourceType: prediction.resourceType,
          resourceName: prediction.resourceName,
          targetTimeMs: prediction.targetTimeMs,
          crowdRisk: prediction.crowdRisk,
          currentCrowd: source?.currentCrowd ?? 'UNKNOWN',
          forecastCrowd: source?.forecastCrowd,
          forecastAtMs: source?.forecastAtMs,
          disrupted: source?.disrupted ?? false,
          normalizedBackgroundDemand15Min: source?.backgroundDemand15Min,
          normalizedCapacity15Min: source?.capacity15Min,
          ledgerDemand: prediction.components.recommendationDemand,
          provenance,
        };
      }),
    })),
    provenance: {
      mode: replayMode ? 'replay' : 'live',
      usesProxyDemandModel: true,
    },
  });
});

app.post('/api/network-aware/issue', (req, res) => {
  const route = sanitiseRouteOption(req.body?.route);
  const journeyRequestId = typeof req.body?.journeyRequestId === 'string'
    ? req.body.journeyRequestId.trim().slice(0, 200)
    : '';
  if (!route || !journeyRequestId) {
    return res.status(400).json({ error: 'journeyRequestId and a valid route are required.' });
  }
  const complianceProbability = req.body?.complianceProbability === undefined
    ? undefined
    : Number(req.body.complianceProbability);
  const userCountRepresented = req.body?.userCountRepresented === undefined
    ? 1
    : Number(req.body.userCountRepresented);
  if (
    (complianceProbability !== undefined && (!Number.isFinite(complianceProbability) || complianceProbability < 0 || complianceProbability > 1)) ||
    !Number.isFinite(userCountRepresented) || userCountRepresented < 0 || userCountRepresented > 10_000
  ) {
    return res.status(400).json({ error: 'Invalid complianceProbability or userCountRepresented.' });
  }
  const result = networkAwareRuntime.issue({
    journeyRequestId,
    route,
    issuedAtMs: Date.now(),
    complianceProbability,
    userCountRepresented,
  });
  return res.json({ ...result, journeyRequestId });
});

// Train Status Endpoint (Queries live LTA TrainServiceAlerts + PCDRealTime)
app.get('/api/train-status', async (req, res) => {
  const ltaKey = process.env.LTA_ACCOUNT_KEY;

  if (ltaKey) {
    try {
      // 1. Ensure live station crowd cache is fresh from LTA PCDRealTime
      await updateStationCrowdData(ltaKey);

      // 2. Query official real-time LTA train alerts (shared 30s cache)
      const data = await fetchTrainServiceAlerts(ltaKey);

      if (data) {
        const ltaStatus = data.value?.Status; // 1 = Normal, 2 = Disruption
        const affectedSegments = data.value?.AffectedSegments || [];
        const messages = data.value?.Message || [];

        // Build station states with live LTA PCD platform crowd density
        const stations = SINGAPORE_MRT_STATIONS.map((st) => {
          const isAffected = affectedSegments.some((seg: any) => seg.Line === st.line);
          const pcd = stationPcdCache[st.code];
          const crowdLevel = pcd ? pcd.crowdLevel : (isAffected ? 'Crowded' : 'Unknown');
          const rawCrowdCode = pcd?.rawCode;
          const arrivalInfo = getTrainArrivalInfo(st.code);

          return {
            code: st.code,
            name: `${st.name} MRT`,
            line: st.line,
            lat: st.lat,
            lng: st.lng,
            status: isAffected ? 'Service delay' : 'Normal service',
            crowdLevel,
            rawCrowdCode,
            nextTrainMin: arrivalInfo.nextTrainMin,
            frequencyMin: arrivalInfo.frequencyMin,
            transferCodes: st.transferCodes || [],
            disruptionNote: isAffected ? `Delay reported on ${st.line} by LTA.` : undefined,
          };
        });

        // Line-level health and crowd distribution
        const lineMeta: Record<string, { name: string; color: string }> = {
          CCL: { name: 'Circle Line', color: '#FA9E0D' },
          EWL: { name: 'East-West Line', color: '#009645' },
          NSL: { name: 'North-South Line', color: '#D42E12' },
          DTL: { name: 'Downtown Line', color: '#005EC4' },
          NEL: { name: 'North-East Line', color: '#9016B2' },
          TEL: { name: 'Thomson-East Coast Line', color: '#9D5B25' },
        };

        const lines = Object.keys(lineMeta).map((lineCode) => {
          const lineStations = stations.filter((s) => s.line === lineCode);
          const isNormal = !affectedSegments.some((seg: any) => seg.Line === lineCode);
          const crowdedCount = lineStations.filter((s) => s.crowdLevel === 'Crowded').length;
          const moderateCount = lineStations.filter((s) => s.crowdLevel === 'Standing available').length;

          let crowdSummary = 'Low crowding';
          if (crowdedCount > 2) crowdSummary = 'Heavy platform crowding';
          else if (moderateCount > 5) crowdSummary = 'Moderate platform crowding';

          return {
            line: lineCode,
            name: lineMeta[lineCode].name,
            color: lineMeta[lineCode].color,
            status: isNormal ? 'Normal service' : 'Service delay',
            isNormal,
            stationCount: lineStations.length,
            crowdSummary,
          };
        });

        return res.json({
          source: 'lta_live',
          ltaStatusCode: ltaStatus,
          isNormalService: ltaStatus === 1,
          officialMessages: messages.map((m: any) => m.Content),
          affectedSegments,
          lines,
          stations,
          timestamp: getSingaporeTimeString(false),
        });
      }
    } catch (err) {
      console.warn('[LTA Train Status] Error querying LTA:', err);
    }
  }

  // Fallback
  const fallbackStations = SINGAPORE_MRT_STATIONS.slice(0, 30).map((st) => {
    const arrival = getTrainArrivalInfo(st.code);
    return {
      code: st.code,
      name: `${st.name} MRT`,
      line: st.line,
      lat: st.lat,
      lng: st.lng,
      status: 'Normal service',
      crowdLevel: 'Seats available' as const,
      rawCrowdCode: 'l' as const,
      nextTrainMin: arrival.nextTrainMin,
      frequencyMin: arrival.frequencyMin,
    };
  });

  return res.json({
    source: 'mock_sg',
    isNormalService: true,
    stations: fallbackStations,
    alerts: [],
    timestamp: getSingaporeTimeString(false),
  });
});

// Disruptions Endpoint (Reflects genuine LTA TrainServiceAlerts or simulation mode)
app.get('/api/disruptions', async (req, res) => {
  const isSimulated = req.query.simulate === 'true';

  if (isSimulated) {
    return res.json({
      isSimulated: true,
      source: 'simulated_test',
      disruptions: MOCK_DISRUPTIONS,
    });
  }

  const ltaKey = process.env.LTA_ACCOUNT_KEY;
  if (ltaKey) {
    try {
      const data = await fetchTrainServiceAlerts(ltaKey);

      if (data) {
        const ltaStatus = data.value?.Status;
        const affectedSegments = data.value?.AffectedSegments || [];
        const messages = data.value?.Message || [];

        if (ltaStatus === 2 && affectedSegments.length > 0) {
          // Real unplanned train disruption
          const ltaDisruptions = affectedSegments.map((seg: any, idx: number) => ({
            id: `lta-disruption-${idx}`,
            line: seg.Line || 'Train Line',
            headline: `Service disruption on ${seg.Line} between ${seg.Stations || 'affected stations'}`,
            subText: seg.FreeMRTShuttle ? 'Free bridging bus available' : 'Expect extended travel time',
            confidence: 95,
            delayEstimateMin: 20,
            active: true,
            whatHappened: `LTA Alert: ${seg.Line} disrupted. Direction: ${seg.Direction || 'Both directions'}.`,
            howItAffectsYou: `Direct transit via ${seg.Line} is impacted. Alternative routing recommended.`,
            whatYouShouldDo: 'Reroute via connecting lines or designated bridging buses.',
            recommendedRouteId: 'alt-route',
          }));

          return res.json({
            isSimulated: false,
            source: 'lta_live',
            disruptions: ltaDisruptions,
            officialMessages: messages.map((m: any) => m.Content),
          });
        }

        // Network is normal
        return res.json({
          isSimulated: false,
          source: 'lta_live',
          disruptions: [],
          officialMessages: messages.map((m: any) => m.Content),
        });
      }
    } catch (err) {
      console.warn('[LTA Disruptions] Query failed:', err);
    }
  }

  return res.json({
    isSimulated: false,
    disruptions: [],
    officialMessages: [],
  });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SG Commuter Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
