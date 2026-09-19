import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { RouteOption, DisruptionAlert } from '../types';
import { ensureStepWayfinding } from '../utils/personalisation';
import { normalizeLineToCode } from '../utils/lineCodes';

interface RouteOverviewMapProps {
  route: RouteOption;
  disruption?: DisruptionAlert | null;
  heightClass?: string;
  // Optional second route drawn as a muted reference underneath `route`, so the
  // two paths can be compared side-by-side on one map where that's clearer than
  // two separate maps (e.g. an alternative vs. the recommended "original" route).
  compareRoute?: RouteOption | null;
}

// Renders the ENTIRE journey (every step stitched into one path), with any
// segment on the disrupted line rendered in a visually distinct style —
// per the hackathon brief's "map-based display distinguishing affected vs.
// unaffected route segments" requirement. The affected style differs in both
// color AND dash pattern/weight (not color alone), and a legend explains both.
export const RouteOverviewMap: React.FC<RouteOverviewMapProps> = ({
  route,
  disruption,
  heightClass = 'h-56',
  compareRoute,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  const affectedLineCode = disruption?.active ? normalizeLineToCode(disruption.line) : null;

  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      // OSM attribution must display wherever a map appears, per the brief.
      attributionControl: true,
    });
    map.attributionControl.setPrefix(false);
    mapInstanceRef.current = map;

    // CartoDB's free raster tiles started requiring an API key (now render an
    // "API KEY REQUIRED" watermark unauthenticated) - switched to OSM's own
    // standard tile server, which is also the brief's mandated data source.
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      subdomains: 'abc',
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    const layerGroup = L.layerGroup().addTo(map);
    const allCoords: [number, number][] = [];

    // Reference route (e.g. the original "BEST MATCH"), drawn first so the main
    // route renders on top of it. Kept deliberately neutral/muted (grey, dotted,
    // thin) so it never competes with the affected/unaffected styling above.
    if (compareRoute && compareRoute.id !== route.id) {
      compareRoute.steps.forEach((step, idx) => {
        const { pathCoordinates } = ensureStepWayfinding(step, compareRoute, idx);
        if (pathCoordinates.length < 2) return;
        allCoords.push(...pathCoordinates);
        L.polyline(pathCoordinates, {
          color: '#8b8fa3',
          weight: 3,
          opacity: 0.8,
          dashArray: '1, 6',
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(layerGroup);
      });
    }

    route.steps.forEach((step, idx) => {
      const { startPoint, targetPoint, pathCoordinates } = ensureStepWayfinding(step, route, idx);
      if (pathCoordinates.length < 2) return;

      allCoords.push(...pathCoordinates);

      const stepLineCode = step.lineOrService ? normalizeLineToCode(step.lineOrService) : null;
      const isAffected = !!affectedLineCode && stepLineCode === affectedLineCode;
      const isWalk = step.type === 'walk' || step.type === 'transfer';
      const isCycle = step.type === 'cycle';

      // White casing underneath every segment for contrast against the basemap.
      L.polyline(pathCoordinates, {
        color: '#ffffff',
        weight: isAffected ? 9 : 7,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(layerGroup);

      if (isAffected) {
        // Distinct from every other segment style by color, dash pattern AND weight.
        L.polyline(pathCoordinates, {
          color: '#ba1a1a',
          weight: 6,
          opacity: 1,
          dashArray: '2, 10',
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(layerGroup);

        const mid = pathCoordinates[Math.floor(pathCoordinates.length / 2)];
        L.marker(mid, {
          icon: L.divIcon({
            className: 'affected-segment-marker',
            html: `<div style="background:#ba1a1a; color:#fff; width:22px; height:22px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:800; box-shadow:0 2px 6px rgba(0,0,0,0.4); border:2px solid white;">⚠</div>`,
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          }),
        })
          .addTo(layerGroup)
          .bindPopup(
            `<div style="font-size:12px;"><strong>Disruption on ${step.lineOrService}</strong><br/>${disruption?.headline || ''}</div>`
          );
      } else {
        L.polyline(pathCoordinates, {
          color: isCycle ? '#0066ff' : isWalk ? '#0050cb' : '#006835',
          weight: 4,
          opacity: 1,
          dashArray: isWalk ? '1, 7' : undefined,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(layerGroup);
      }

      // Transfer/interchange point marker between consecutive steps
      if (idx > 0) {
        L.circleMarker(startPoint, {
          radius: 5,
          color: '#ffffff',
          weight: 2,
          fillColor: '#5c5f77',
          fillOpacity: 1,
        }).addTo(layerGroup);
      }
    });

    // Start marker (A)
    const firstCoord = allCoords[0];
    if (firstCoord) {
      L.marker(firstCoord, {
        icon: L.divIcon({
          className: 'route-overview-start',
          html: `<div style="width:26px; height:26px; background:#ffffff; border:3px solid #0050cb; color:#0050cb; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:11px; box-shadow:0 3px 8px rgba(0,0,0,0.3);">A</div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
      }).addTo(layerGroup);
    }

    // Destination marker (flag)
    const lastCoord = allCoords[allCoords.length - 1];
    if (lastCoord) {
      L.marker(lastCoord, {
        icon: L.divIcon({
          className: 'route-overview-end',
          html: `<div style="width:30px; height:30px; background:#ba1a1a; color:#fff; border:2.5px solid white; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:14px; box-shadow:0 3px 8px rgba(0,0,0,0.35);">🏁</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        }),
      }).addTo(layerGroup);
    }

    if (allCoords.length > 0) {
      map.fitBounds(L.latLngBounds(allCoords), { padding: [32, 32], maxZoom: 16 });
    }

    const resizeObserver = new ResizeObserver(() => map.invalidateSize());
    resizeObserver.observe(mapContainerRef.current);
    const timer = setTimeout(() => map.invalidateSize(), 150);

    return () => {
      clearTimeout(timer);
      resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [route, affectedLineCode, compareRoute]);

  const hasAffectedSegment = route.steps.some((s) => {
    const code = s.lineOrService ? normalizeLineToCode(s.lineOrService) : null;
    return !!affectedLineCode && code === affectedLineCode;
  });
  const hasCyclingSegment = route.steps.some((s) => s.type === 'cycle');
  const hasTransitSegment = route.steps.some((s) => s.type === 'bus' || s.type === 'train');
  const hasWalkingSegment = route.steps.some((s) => s.type === 'walk' || s.type === 'transfer');

  return (
    <div
      id={`route-overview-map-${route.id}`}
      className={`relative w-full rounded-2xl overflow-hidden border border-outline-variant/50 bg-surface-container ${heightClass}`}
    >
      <div ref={mapContainerRef} className="w-full h-full z-0" />

      {/* Legend: shape + color, never color alone */}
      <div className="absolute bottom-2 left-2 z-10 bg-white/95 backdrop-blur-sm rounded-lg px-2.5 py-1.5 border border-outline-variant/40 shadow-2xs space-y-1">
        {hasCyclingSegment && (
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-on-surface">
            <span className="inline-block w-4 h-0 border-t-[3px] border-solid" style={{ borderColor: '#0066ff' }} />
            Cycling segment
          </div>
        )}
        {hasTransitSegment && (
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-on-surface">
            <span className="inline-block w-4 h-0 border-t-[3px] border-solid" style={{ borderColor: '#006835' }} />
            Bus or train segment
          </div>
        )}
        {hasWalkingSegment && (
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-on-surface">
            <span className="inline-block w-4 h-0 border-t-[3px]" style={{ borderColor: '#0050cb', borderStyle: 'dotted' }} />
            Walking or transfer
          </div>
        )}
        {hasAffectedSegment && (
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-on-surface">
            <span
              className="inline-block w-4 h-0 border-t-[3px]"
              style={{ borderColor: '#ba1a1a', borderStyle: 'dotted' }}
            />
            ⚠ Disrupted segment
          </div>
        )}
        {compareRoute && compareRoute.id !== route.id && (
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-on-surface">
            <span
              className="inline-block w-4 h-0 border-t-[3px]"
              style={{ borderColor: '#8b8fa3', borderStyle: 'dotted' }}
            />
            {compareRoute.title} (reference)
          </div>
        )}
      </div>
    </div>
  );
};
