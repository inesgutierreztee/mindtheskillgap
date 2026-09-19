import React, { useEffect, useRef, useState } from 'react';
import { Search, MapPin, Bus, Train, Navigation, Crosshair, Layers, ChevronRight, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { BusStop, BusArrival, TrainStation } from '../types';
import { BottomSheet } from '../components/BottomSheet';
import { fetchBusArrivals, fetchLiftStatus, LiftMaintenanceItem } from '../services/ltaService';
import { StatusChip } from '../components/StatusChip';
import { getCrowdTierInfo } from '../utils/crowdLevel';
import { lineColor } from '../utils/journeyMath';
import { useDominantHand } from '../context/DominantHandContext';

interface MapScreenProps {
  busStops: BusStop[];
  trainStations: TrainStation[];
  onPlanTripFromStop: (stopName: string) => void;
}

export const MapScreen: React.FC<MapScreenProps> = ({
  busStops,
  trainStations,
  onPlanTripFromStop,
}) => {
  const dominantHand = useDominantHand();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'mrt' | 'bus'>('all');
  const [selectedBusStop, setSelectedBusStop] = useState<BusStop | null>(null);
  const [busArrivals, setBusArrivals] = useState<BusArrival[]>([]);
  const [loadingArrivals, setLoadingArrivals] = useState(false);
  const [selectedTrainStation, setSelectedTrainStation] = useState<TrainStation | null>(null);
  const [liftItems, setLiftItems] = useState<LiftMaintenanceItem[]>([]);
  const [liftStatusChecked, setLiftStatusChecked] = useState(false);

  // Lift maintenance for the selected station (accessibility persona)
  useEffect(() => {
    if (!selectedTrainStation) {
      setLiftItems([]);
      setLiftStatusChecked(false);
      return;
    }
    let cancelled = false;
    setLiftStatusChecked(false);
    fetchLiftStatus(selectedTrainStation.code).then((result) => {
      if (cancelled) return;
      setLiftItems(result.items);
      setLiftStatusChecked(result.source === 'lta_live');
    });
    return () => {
      cancelled = true;
    };
  }, [selectedTrainStation]);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    // Centered on Singapore / Kent Ridge & Clementi region
    const map = L.map(mapContainerRef.current, {
      center: [1.2935, 103.7844],
      zoom: 14,
      zoomControl: false,
    });

    // CartoDB's free raster tiles started requiring an API key (now render an
    // "API KEY REQUIRED" watermark unauthenticated) - switched to OSM's own
    // standard tile server, which is also the brief's mandated data source.
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      subdomains: 'abc',
      maxZoom: 19,
    }).addTo(map);

    const layerGroup = L.layerGroup().addTo(map);
    markersRef.current = layerGroup;
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Search matches: bus stops and train stations whose name/road/code contains
  // the query, drawn from whatever is already loaded (no new endpoint needed).
  const searchQueryNormalized = searchQuery.trim().toLowerCase();
  const matchingBusStops = searchQueryNormalized
    ? busStops.filter(
        (s) =>
          s.desc.toLowerCase().includes(searchQueryNormalized) ||
          s.road.toLowerCase().includes(searchQueryNormalized) ||
          s.code.includes(searchQueryNormalized)
      )
    : busStops;
  const matchingTrainStations = searchQueryNormalized
    ? trainStations.filter(
        (s) =>
          s.name.toLowerCase().includes(searchQueryNormalized) ||
          s.code.toLowerCase().includes(searchQueryNormalized)
      )
    : trainStations;

  const searchResults = searchQueryNormalized
    ? [
        ...matchingTrainStations.slice(0, 5).map((s) => ({ type: 'mrt' as const, station: s })),
        ...matchingBusStops.slice(0, 5).map((s) => ({ type: 'bus' as const, stop: s })),
      ].slice(0, 8)
    : [];

  const handleJumpToBusStop = (stop: BusStop) => {
    setSearchQuery('');
    handleSelectBusStop(stop);
  };

  const handleJumpToTrainStation = (station: TrainStation) => {
    setSearchQuery('');
    setSelectedBusStop(null);
    setSelectedTrainStation(station);
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([station.lat, station.lng], 17, { animate: true });
    }
  };

  // Update Markers on filter or data change
  useEffect(() => {
    if (!mapInstanceRef.current || !markersRef.current) return;
    const group = markersRef.current;
    group.clearLayers();

    // 1. Bus Stop Markers
    if (filterType === 'all' || filterType === 'bus') {
      matchingBusStops.forEach((stop) => {
        const busIcon = L.divIcon({
          className: 'custom-bus-marker',
          html: `<div style="background-color: #0050cb; color: white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; box-shadow: 0 2px 5px rgba(0,0,0,0.3); border: 2px solid white;">🚌</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });

        const marker = L.marker([stop.lat, stop.lng], { icon: busIcon });
        marker.on('click', () => {
          setSelectedTrainStation(null);
          handleSelectBusStop(stop);
        });
        marker.addTo(group);
      });
    }

    // 2. Train Station Markers
    // Crowd level is rendered directly on the marker (not just on tap) so it reads
    // in a 1-second glance per the hackathon brief. A filled-bars badge is the
    // primary cue and the ring color is secondary reinforcement, so the level is
    // still legible without relying on color alone.
    if (filterType === 'all' || filterType === 'mrt') {
      matchingTrainStations.forEach((station) => {
        const crowd = getCrowdTierInfo(station.crowdLevel);
        // At interchanges, `line` lists the served lines in travel priority;
        // use the first one as the marker's colour rather than a generic MRT hue.
        const stationLineColor = lineColor(station.line) ?? '#748477';
        const bars = [1, 2, 3]
          .map(
            (bar) =>
              `<span style="display:inline-block; width:2.5px; height:${2 + bar * 2}px; margin-left:1px; border-radius:1px; background:${
                bar <= crowd.tier ? '#ffffff' : 'rgba(255,255,255,0.35)'
              };"></span>`
          )
          .join('');

        const mrtIcon = L.divIcon({
          className: 'custom-mrt-marker',
          html: `
            <div style="position: relative; width: 32px; height: 32px;">
              <div style="background-color: ${stationLineColor}; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: bold; box-shadow: 0 3px 6px rgba(0,0,0,0.35); border: 2px solid white;">🚇</div>
              <div title="${crowd.label} crowding" style="position: absolute; bottom: -3px; right: -3px; background-color: ${crowd.hex}; border: 1.5px solid white; border-radius: 6px; padding: 1.5px 3px; display: flex; align-items: flex-end; box-shadow: 0 1px 3px rgba(0,0,0,0.4);">${bars}</div>
            </div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });

        const marker = L.marker([station.lat, station.lng], { icon: mrtIcon });
        marker.on('click', () => {
          setSelectedBusStop(null);
          setSelectedTrainStation(station);
        });
        marker.addTo(group);
      });
    }
  }, [matchingBusStops, matchingTrainStations, filterType]);

  const handleSelectBusStop = async (stop: BusStop) => {
    setSelectedBusStop(stop);
    setSelectedTrainStation(null);
    setLoadingArrivals(true);
    const arrivals = await fetchBusArrivals(stop.code);
    setBusArrivals(arrivals);
    setLoadingArrivals(false);

    if (mapInstanceRef.current) {
      mapInstanceRef.current.panTo([stop.lat, stop.lng]);
    }
  };

  const handleCenterUser = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([1.2935, 103.7844], 15);
    }
  };

  return (
    <div id="map-screen-container" className="w-full">
      {/* Map viewport - fixed height, everything below is normal page flow so a
          selected stop's detail never overlaps the map or the crowding legend. */}
      <div className="relative w-full h-[65dvh] min-h-0 overflow-hidden rounded-2xl border border-outline-variant/30">
      {/* Search and Filters Bar */}
      <div className="absolute top-3 inset-x-3 z-30 space-y-2">
        <div className="bg-surface-container-lowest/95 backdrop-blur-md rounded-2xl p-2 border border-outline-variant/30 card-shadow flex items-center gap-2 focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-1">
          <Search className="w-4 h-4 text-primary ml-2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search stops, MRT stations..."
            className="w-full bg-transparent text-xs font-medium text-on-surface placeholder:text-outline focus:outline-none py-1"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              className="p-1 -mr-1 text-on-surface-variant hover:bg-surface-container rounded-full cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Search Results Dropdown */}
        {searchQueryNormalized && (
          <div className="bg-surface-container-lowest/95 backdrop-blur-md rounded-2xl border border-outline-variant/30 card-shadow max-h-64 overflow-y-auto no-scrollbar divide-y divide-outline-variant/20">
            {searchResults.length === 0 ? (
              <p className="px-4 py-3 text-xs text-on-surface-variant">No stops or stations match "{searchQuery}"</p>
            ) : (
              searchResults.map((result) =>
                result.type === 'mrt' ? (
                  <button
                    key={`mrt-${result.station.code}`}
                    type="button"
                    onClick={() => handleJumpToTrainStation(result.station)}
                    className="w-full px-3 py-2.5 flex items-center gap-2.5 text-left hover:bg-surface-container cursor-pointer"
                  >
                    <Train className="w-4 h-4 shrink-0" style={{ color: lineColor(result.station.line) ?? '#748477' }} />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-on-surface truncate">{result.station.name}</div>
                      <div className="text-[11px] text-on-surface-variant">{result.station.code}</div>
                    </div>
                  </button>
                ) : (
                  <button
                    key={`bus-${result.stop.code}`}
                    type="button"
                    onClick={() => handleJumpToBusStop(result.stop)}
                    className="w-full px-3 py-2.5 flex items-center gap-2.5 text-left hover:bg-surface-container cursor-pointer"
                  >
                    <Bus className="w-4 h-4 text-primary shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-on-surface truncate">{result.stop.desc}</div>
                      <div className="text-[11px] text-on-surface-variant">{result.stop.road} · {result.stop.code}</div>
                    </div>
                  </button>
                )
              )
            )}
          </div>
        )}

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setFilterType('all')}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all shadow-2xs cursor-pointer ${
              filterType === 'all'
                ? 'bg-primary-container text-on-primary'
                : 'bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container'
            }`}
          >
            All Transit
          </button>
          <button
            type="button"
            onClick={() => setFilterType('mrt')}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all shadow-2xs cursor-pointer flex items-center gap-1 ${
              filterType === 'mrt'
                ? 'bg-primary-container text-on-primary'
                : 'bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container'
            }`}
          >
            <Train className="w-3.5 h-3.5" />
            <span>MRT Stations</span>
          </button>
          <button
            type="button"
            onClick={() => setFilterType('bus')}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all shadow-2xs cursor-pointer flex items-center gap-1 ${
              filterType === 'bus'
                ? 'bg-primary-container text-on-primary'
                : 'bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container'
            }`}
          >
            <Bus className="w-3.5 h-3.5" />
            <span>Bus Stops</span>
          </button>
        </div>
      </div>

      {/* Crowd Level Legend (only relevant when MRT markers are visible) */}
      {(filterType === 'all' || filterType === 'mrt') && (
        <div
          id="map-crowd-legend"
          className="absolute top-24 left-3 z-30 bg-surface-container-lowest/95 backdrop-blur-md rounded-xl px-2.5 py-2 border border-outline-variant/30 card-shadow space-y-1"
        >
          <p className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wide mb-1">
            Platform crowding
          </p>
          {(['Low', 'Moderate', 'High'] as const).map((label) => {
            const crowd = getCrowdTierInfo(label);
            return (
              <div key={label} className="flex items-center gap-1.5">
                <span className="flex items-end gap-[1.5px]" aria-hidden="true">
                  {[1, 2, 3].map((bar) => (
                    <span
                      key={bar}
                      className="w-[3px] rounded-[1px]"
                      style={{
                        height: `${3 + bar * 2}px`,
                        backgroundColor: bar <= crowd.tier ? crowd.hex : 'var(--color-outline-variant, #ccc)',
                      }}
                    />
                  ))}
                </span>
                <span className="text-[11px] font-medium text-on-surface">{label}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Floating Center / User GPS Action Button */}
      <button
        id="btn-map-center-gps"
        type="button"
        onClick={handleCenterUser}
        aria-label="Center on my location"
        className={`absolute bottom-5 z-30 w-11 h-11 rounded-full bg-white bg-surface-container-lowest text-primary flex items-center justify-center card-shadow border border-outline-variant/30 hover:bg-surface-container active:scale-95 transition-all cursor-pointer ${
          dominantHand === 'left' ? 'left-4' : 'right-4'
        }`}
      >
        <Crosshair className="w-5 h-5" />
      </button>

      {/* Map Element */}
      <div ref={mapContainerRef} className="w-full h-full bg-slate-100 z-10" />
      </div>

      {/* Selected stop detail - below the map, never over it or the crowding legend. */}
      {selectedTrainStation && (
        <div
          id="mrt-station-popup"
          className="mt-3 bg-white bg-surface-container-lowest rounded-2xl p-4 card-shadow border border-outline-variant/30 animate-in slide-in-from-bottom duration-200"
        >
          <div className={`flex items-start justify-between ${dominantHand === 'left' ? 'flex-row-reverse' : ''}`}>
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-2xl text-white flex items-center justify-center font-bold text-sm shrink-0"
                style={{ backgroundColor: lineColor(selectedTrainStation.line) ?? '#748477' }}
              >
                MRT
              </div>
              <div>
                <h3 className="text-sm font-bold text-on-surface">{selectedTrainStation.name}</h3>
                <p className="text-xs text-on-surface-variant">{selectedTrainStation.code}</p>
              </div>
            </div>

            <div className={`flex items-start gap-2 shrink-0 ${dominantHand === 'left' ? 'flex-row-reverse' : ''}`}>
              <div className="text-right">
                <div className="text-base font-bold text-on-surface">{selectedTrainStation.nextTrainMin}m</div>
                <div className="text-[11px] text-outline">Every {selectedTrainStation.frequencyMin}m</div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTrainStation(null)}
                aria-label="Close station details"
                className={`w-8 h-8 -mt-0.5 rounded-full bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant transition-colors cursor-pointer shrink-0 ${
                  dominantHand === 'left' ? '-ml-1' : '-mr-1'
                }`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-outline-variant/20">
            <StatusChip type="train" value={selectedTrainStation.status} />
            <StatusChip type="crowd" value={selectedTrainStation.crowdLevel} />
          </div>

          {/* Lift status - accessibility persona */}
          {liftStatusChecked && (
            <div
              className={`mt-2.5 p-2.5 rounded-xl text-[11px] flex items-start gap-1.5 ${
                liftItems.length > 0
                  ? 'bg-amber-50 border border-amber-200 text-amber-800'
                  : 'bg-tertiary-container/15 text-tertiary'
              }`}
            >
              {liftItems.length > 0 ? (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Lift maintenance in progress:</span>{' '}
                    {liftItems.map((i) => i.liftDesc || i.liftId).filter(Boolean).join('; ')}
                  </div>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>All lifts operational</span>
                </>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => onPlanTripFromStop(selectedTrainStation.name)}
            className="w-full mt-3 py-2.5 bg-primary-container text-on-primary rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer hover:bg-primary"
          >
            <Navigation className="w-3.5 h-3.5" />
            <span>Plan route from here</span>
          </button>
        </div>
      )}

      {/* Bus Stop Detail */}
      <BottomSheet
        busStop={selectedBusStop}
        arrivals={busArrivals}
        loading={loadingArrivals}
        onClose={() => setSelectedBusStop(null)}
        onSelectRouteForStop={(stop) => onPlanTripFromStop(stop.desc)}
      />
    </div>
  );
};
