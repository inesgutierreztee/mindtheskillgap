import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import {
  Compass,
  Navigation,
  ZoomIn,
  ZoomOut,
  MapPin,
  AlertCircle,
  Maximize2,
  Minimize2,
  Info,
} from 'lucide-react';
import { RouteStep, RouteOption, StepTargetInfo } from '../types';
import { ensureStepWayfinding } from '../utils/personalisation';
import { useDominantHand } from '../context/DominantHandContext';

export type LocationStatus = 'checking' | 'active' | 'denied' | 'unavailable';

interface WayfindingMapProps {
  step: RouteStep;
  route: RouteOption;
  stepIndex: number;
  heightClass?: string;
  allowExpand?: boolean;
  // Lets a parent (e.g. turn-by-turn guidance) react to the same live GPS fix
  // this map already tracks, instead of opening a second watchPosition.
  onLocationUpdate?: (location: { lat: number; lng: number } | null, status: LocationStatus) => void;
}

export const WayfindingMap: React.FC<WayfindingMapProps> = ({
  step,
  route,
  stepIndex,
  heightClass = 'h-64',
  allowExpand = true,
  onLocationUpdate,
}) => {
  const dominantHand = useDominantHand();
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);

  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [deviceHeading, setDeviceHeading] = useState<number | null>(null);
  const [locationStatus, setLocationStatus] = useState<
    'checking' | 'active' | 'denied' | 'unavailable'
  >('checking');
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [showTargetDetails, setShowTargetDetails] = useState<boolean>(true);

  // Compute robust wayfinding coordinates & targets
  const wayfinding = ensureStepWayfinding(step, route, stepIndex);
  const { startPoint, targetPoint, pathCoordinates } = wayfinding;

  // 1. Monitor device heading if reliable (orientation event)
  useEffect(() => {
    let handleOrientation: ((e: DeviceOrientationEvent) => void) | null = null;

    if (typeof window !== 'undefined' && 'DeviceOrientationEvent' in window) {
      handleOrientation = (event: DeviceOrientationEvent) => {
        // iOS provides webkitCompassHeading directly
        const webkitHeading = (event as unknown as { webkitCompassHeading?: number }).webkitCompassHeading;
        if (typeof webkitHeading === 'number' && !isNaN(webkitHeading)) {
          setDeviceHeading(webkitHeading);
          return;
        }

        // On Android / standard, event.alpha is reliable only when event.absolute is true
        if (event.absolute && typeof event.alpha === 'number') {
          const heading = (360 - event.alpha) % 360;
          setDeviceHeading(heading);
        } else {
          // If not reliable, do not invent or guess heading
          setDeviceHeading(null);
        }
      };

      try {
        window.addEventListener('deviceorientation', handleOrientation, true);
      } catch (err) {
        console.warn('Orientation listener error', err);
      }
    }

    return () => {
      if (handleOrientation) {
        window.removeEventListener('deviceorientation', handleOrientation, true);
      }
    };
  }, []);

  // 2. Monitor Geolocation
  useEffect(() => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setLocationStatus('unavailable');
      onLocationUpdate?.(null, 'unavailable');
      return;
    }

    let watchId: number | null = null;

    const onSuccess = (pos: GeolocationPosition) => {
      const location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setUserLocation(location);
      setLocationStatus('active');
      onLocationUpdate?.(location, 'active');

      // If position has reliable heading property from GPS velocity
      if (
        pos.coords.heading !== null &&
        pos.coords.heading !== undefined &&
        !isNaN(pos.coords.heading) &&
        pos.coords.speed !== null &&
        pos.coords.speed > 0.5
      ) {
        setDeviceHeading(pos.coords.heading);
      }
    };

    const onError = (err: GeolocationPositionError) => {
      const status = err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable';
      setLocationStatus(status);
      onLocationUpdate?.(null, status);
    };

    try {
      watchId = navigator.geolocation.watchPosition(onSuccess, onError, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 3000,
      });
    } catch (err) {
      setLocationStatus('unavailable');
      onLocationUpdate?.(null, 'unavailable');
    }

    return () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 3. Initialize / Update Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Clean up prior map instance if existing
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    // Default center to start point
    const initialCenter: [number, number] = [startPoint.lat, startPoint.lng];

    const map = L.map(mapContainerRef.current, {
      center: initialCenter,
      zoom: 17,
      zoomControl: false,
      // OSM attribution must display wherever a map appears, per the brief.
      attributionControl: true,
    });
    map.attributionControl.setPrefix(false);

    // Basemap: OSM standard tiles. CartoDB's free raster tiles started
    // requiring an API key (render an "API KEY REQUIRED" watermark
    // unauthenticated) - OSM's own tile server needs no key and is also the
    // brief's mandated data source.
    L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        maxZoom: 19,
        subdomains: 'abc',
        attribution: '&copy; OpenStreetMap contributors',
      }
    ).addTo(map);

    const layerGroup = L.layerGroup().addTo(map);
    layerGroupRef.current = layerGroup;
    mapInstanceRef.current = map;

    // A. Draw Walking / Transit Path Polyline
    if (pathCoordinates.length >= 2) {
      // Outer casing for maximum contrast
      L.polyline(pathCoordinates, {
        color: '#ffffff',
        weight: 8,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(layerGroup);

      // Walking polyline: vibrant blue with dashed effect for walking, solid for transit
      const isWalk = step.type === 'walk' || step.type === 'transfer';
      const isCycle = step.type === 'cycle';
      L.polyline(pathCoordinates, {
        color: isCycle ? '#0066ff' : isWalk ? '#0050cb' : '#006835',
        weight: 5,
        opacity: 1,
        dashArray: isWalk ? '8, 8' : undefined,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(layerGroup);
    }

    // B. Start Marker (A)
    const startIcon = L.divIcon({
      className: 'start-marker-pin',
      html: `
        <div style="
          width: 32px;
          height: 32px;
          background: #ffffff;
          border: 3px solid #0050cb;
          color: #0050cb;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 800;
          font-size: 13px;
          box-shadow: 0 4px 10px rgba(0,0,0,0.3);
        ">
          A
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });

    L.marker([startPoint.lat, startPoint.lng], { icon: startIcon })
      .addTo(layerGroup)
      .bindPopup(
        `<div style="font-family: inherit; font-size: 12px; padding: 2px;">
          <strong>Start:</strong> ${startPoint.name || 'Current Step Starting Point'}
        </div>`
      );

    // C. Next Target Marker
    let targetBg = '#ba1a1a';
    let targetIconChar = '🎯';
    if (targetPoint.type === 'bus_stop') {
      targetBg = '#006835';
      targetIconChar = '🚌';
    } else if (targetPoint.type === 'bike_parking') {
      targetBg = '#0066ff';
      targetIconChar = '🚲';
    } else if (targetPoint.type === 'mrt_entrance' || targetPoint.type === 'platform') {
      targetBg = '#b45309';
      targetIconChar = '🚇';
    } else if (targetPoint.type === 'destination') {
      targetBg = '#ba1a1a';
      targetIconChar = '🏁';
    }

    const targetIcon = L.divIcon({
      className: 'target-marker-pin',
      html: `
        <div style="position: relative; width: 38px; height: 38px; display: flex; align-items: center; justify-content: center;">
          <div style="
            position: absolute;
            width: 38px;
            height: 38px;
            background: ${targetBg};
            border-radius: 50%;
            opacity: 0.25;
            animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;
          "></div>
          <div style="
            width: 34px;
            height: 34px;
            background: ${targetBg};
            border: 2.5px solid #ffffff;
            color: #ffffff;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.35);
            z-index: 2;
          ">
            ${targetIconChar}
          </div>
        </div>
      `,
      iconSize: [38, 38],
      iconAnchor: [19, 19],
    });

    const targetMarker = L.marker([targetPoint.lat, targetPoint.lng], { icon: targetIcon })
      .addTo(layerGroup)
      .bindPopup(
        `<div style="font-family: inherit; font-size: 12px; min-width: 150px; padding: 2px;">
          <div style="font-weight: bold; color: ${targetBg};">${targetPoint.name}</div>
          ${targetPoint.identifier ? `<div style="font-size: 11px; color: #444; margin-top: 2px;">${targetPoint.identifier}</div>` : ''}
          ${targetPoint.landmark ? `<div style="font-size: 11px; color: #666; margin-top: 2px; font-style: italic;">${targetPoint.landmark}</div>` : ''}
        </div>`
      );

    // D. Fit initial map view to the current walking segment
    if (pathCoordinates.length > 0) {
      const bounds = L.latLngBounds(pathCoordinates);
      map.fitBounds(bounds, {
        padding: [45, 45],
        maxZoom: 18,
      });
    }

    // E. Sizing fix: Observe container resize & trigger invalidateSize
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(mapContainerRef.current);

    // Additional delayed invalidate calls for layout stability
    const timer1 = setTimeout(() => map.invalidateSize(), 150);
    const timer2 = setTimeout(() => map.invalidateSize(), 350);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [stepIndex, step.stepNumber, startPoint.lat, startPoint.lng, targetPoint.lat, targetPoint.lng]);

  // 4. Update or render user location marker with strict heading check
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layerGroup = layerGroupRef.current;
    if (!map || !layerGroup) return;

    if (!userLocation) {
      if (userMarkerRef.current) {
        layerGroup.removeLayer(userMarkerRef.current);
        userMarkerRef.current = null;
      }
      return;
    }

    // Reliable heading indicator: only render direction pointer if heading is valid
    const hasReliableHeading = deviceHeading !== null && !isNaN(deviceHeading);

    const userDivIcon = L.divIcon({
      className: 'user-location-marker',
      html: `
        <div style="position: relative; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;">
          ${
            hasReliableHeading
              ? `
            <div style="
              position: absolute;
              width: 34px;
              height: 34px;
              transform: rotate(${deviceHeading}deg);
              transform-origin: center center;
              pointer-events: none;
            ">
              <svg viewBox="0 0 34 34" width="34" height="34" style="position: absolute; top: -8px; left: 0;">
                <polygon points="17,0 24,14 10,14" fill="#0050cb" opacity="0.9" />
              </svg>
            </div>
            `
              : ''
          }
          <div style="
            position: absolute;
            width: 28px;
            height: 28px;
            background: rgba(0, 80, 203, 0.25);
            border-radius: 50%;
            animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;
          "></div>
          <div style="
            width: 16px;
            height: 16px;
            background: #0050cb;
            border: 3px solid #ffffff;
            border-radius: 50%;
            box-shadow: 0 2px 6px rgba(0,0,0,0.35);
            z-index: 3;
          "></div>
        </div>
      `,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });

    if (userMarkerRef.current) {
      userMarkerRef.current.setLatLng([userLocation.lat, userLocation.lng]);
      userMarkerRef.current.setIcon(userDivIcon);
    } else {
      userMarkerRef.current = L.marker([userLocation.lat, userLocation.lng], {
        icon: userDivIcon,
        zIndexOffset: 1000,
      }).addTo(layerGroup);
    }
  }, [userLocation, deviceHeading]);

  // Recenter on user location, or fallback to current segment bounds
  const handleRecenter = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (userLocation) {
      map.setView([userLocation.lat, userLocation.lng], 18, { animate: true });
    } else if (pathCoordinates.length > 0) {
      const bounds = L.latLngBounds(pathCoordinates);
      map.fitBounds(bounds, { padding: [40, 40], animate: true });
    }
  }, [userLocation, pathCoordinates]);

  // Focus directly on the next target marker
  const handleFocusTarget = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    map.setView([targetPoint.lat, targetPoint.lng], 18, { animate: true });
  }, [targetPoint.lat, targetPoint.lng]);

  const handleZoomIn = () => {
    mapInstanceRef.current?.zoomIn();
  };

  const handleZoomOut = () => {
    mapInstanceRef.current?.zoomOut();
  };

  return (
    <div
      id={`wayfinding-map-step-${step.stepNumber}`}
      className={`relative w-full rounded-2xl overflow-hidden border border-outline-variant/50 shadow-sm transition-all duration-300 bg-surface-container ${
        isExpanded ? 'h-96 sm:h-[420px]' : heightClass
      }`}
    >
      {/* Map Leaflet Container */}
      <div ref={mapContainerRef} className="w-full h-full z-0" />

      {/* Top Floating Target Callout Banner */}
      {showTargetDetails && (
        <div className={`absolute top-2.5 z-10 bg-white/95 backdrop-blur-sm px-3 py-2 rounded-xl border border-outline-variant/40 shadow-sm text-xs flex items-start justify-between gap-2 ${
          dominantHand === 'left' ? 'left-12 right-2.5' : 'left-2.5 right-12'
        }`}>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 font-bold text-on-surface">
              <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
              <span className="truncate">Next Target: {targetPoint.name}</span>
            </div>
            {(targetPoint.identifier || targetPoint.landmark) && (
              <p className="text-[11px] text-on-surface-variant truncate mt-0.5 ml-3.5">
                {[targetPoint.identifier, targetPoint.landmark].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleFocusTarget}
            className="shrink-0 text-[11px] font-semibold text-primary bg-primary/10 hover:bg-primary/20 px-2 py-1 rounded-md cursor-pointer transition-colors"
          >
            Target
          </button>
        </div>
      )}

      {/* Geolocation Status Badge (When unavailable / denied) */}
      {locationStatus !== 'active' && (
        <div className={`absolute bottom-2.5 z-10 bg-surface-container-highest/95 backdrop-blur-sm px-2.5 py-1.5 rounded-lg border border-outline-variant/50 text-[11px] text-on-surface-variant flex items-center gap-1.5 shadow-2xs ${
          dominantHand === 'left' ? 'left-14 right-2.5' : 'left-2.5 right-14'
        }`}>
          <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <span className="truncate">
            {locationStatus === 'denied'
              ? 'GPS permission denied. Showing planned route.'
              : 'Live location unavailable. Showing planned route.'}
          </span>
        </div>
      )}

      {/* Map Interactive Controls (Right Side) */}
      <div className={`absolute top-2.5 z-10 flex flex-col gap-1.5 ${dominantHand === 'left' ? 'left-2.5' : 'right-2.5'}`}>
        {/* Expand / Collapse toggle */}
        {allowExpand && (
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            className="w-11 h-11 rounded-lg bg-white/95 backdrop-blur-sm border border-outline-variant/40 shadow-2xs flex items-center justify-center text-on-surface hover:bg-surface-container cursor-pointer transition-all active:scale-95"
            title={isExpanded ? 'Collapse map' : 'Expand map'}
          >
            {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        )}

        {/* Recenter Button */}
        <button
          type="button"
          onClick={handleRecenter}
          className={`w-11 h-11 rounded-lg bg-white/95 backdrop-blur-sm border border-outline-variant/40 shadow-2xs flex items-center justify-center cursor-pointer transition-all active:scale-95 ${
            userLocation ? 'text-primary' : 'text-on-surface-variant'
          }`}
          title="Recenter on current location or path"
        >
          <Navigation className="w-4 h-4" />
        </button>

        {/* Zoom In */}
        <button
          type="button"
          onClick={handleZoomIn}
          className="w-11 h-11 rounded-lg bg-white/95 backdrop-blur-sm border border-outline-variant/40 shadow-2xs flex items-center justify-center text-on-surface hover:bg-surface-container cursor-pointer transition-all active:scale-95"
          title="Zoom in"
        >
          <ZoomIn className="w-4 h-4" />
        </button>

        {/* Zoom Out */}
        <button
          type="button"
          onClick={handleZoomOut}
          className="w-11 h-11 rounded-lg bg-white/95 backdrop-blur-sm border border-outline-variant/40 shadow-2xs flex items-center justify-center text-on-surface hover:bg-surface-container cursor-pointer transition-all active:scale-95"
          title="Zoom out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
      </div>

      {/* Facing direction indicator note (Only when device heading is active) */}
      {deviceHeading !== null && locationStatus === 'active' && (
        <div
          className={`absolute top-12 z-10 bg-primary-container/90 text-on-primary text-[11px] font-semibold px-2 py-0.5 rounded-full shadow-2xs flex items-center gap-1 ${
            dominantHand === 'left' ? 'right-2.5' : 'left-2.5'
          }`}
        >
          <Compass className="w-3 h-3 animate-pulse" />
          <span>Facing {Math.round(deviceHeading)}°</span>
        </div>
      )}
    </div>
  );
};
