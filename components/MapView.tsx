import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { CircleMarker, PointMarker } from '../types';

interface MapViewProps {
  markers: CircleMarker[];
  bulkPins: PointMarker[];
  onMapClick: (lat: number, lng: number) => void;
}

const REGION_COLORS: Record<string, string> = {
  "North": "#E0F2FE",
  "Northeast": "#FEF3C7",
  "Central": "#F0FDF4",
  "East": "#FAF5FF",
  "West": "#FFF1F2",
  "South": "#ECFEFF"
};

const getRegionColor = (lat: number, lng: number) => {
  if (lat > 17.5) return REGION_COLORS["North"];
  if (lat > 14 && lng > 101.5) return REGION_COLORS["Northeast"];
  if (lat < 10) return REGION_COLORS["South"];
  if (lng > 101.5 && lat <= 14) return REGION_COLORS["East"];
  if (lng < 99.5) return REGION_COLORS["West"];
  return REGION_COLORS["Central"];
};

const MapView: React.FC<MapViewProps> = ({ markers, bulkPins, onMapClick }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const onMapClickRef = useRef(onMapClick);

  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  const SOUTH_WEST: L.LatLngTuple = [5.5, 97.0];
  const NORTH_EAST: L.LatLngTuple = [20.5, 106.0];
  const THAILAND_BOUNDS = L.latLngBounds(SOUTH_WEST, NORTH_EAST);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [13.7367, 100.5232],
      zoom: 6,
      minZoom: 5,
      maxZoom: 14,
      maxBounds: THAILAND_BOUNDS,
      zoomControl: false,
      attributionControl: false
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(map);

    const outerMask = [[90, -180], [90, 180], [-90, 180], [-90, -180], [90, -180]] as L.LatLngTuple[];
    const innerMask = [[5.5, 97], [20.5, 97], [20.5, 106], [5.5, 106], [5.5, 97]] as L.LatLngTuple[];

    L.polygon([outerMask, innerMask], {
      color: '#f8fafc',
      fillColor: '#f1f5f9',
      fillOpacity: 1,
      weight: 0,
      interactive: false
    }).addTo(map);

    fetch('https://raw.githubusercontent.com/apisit/thailand.json/master/thailand.json')
      .then(res => res.json())
      .then(data => {
        L.geoJSON(data, {
          style: (feature) => {
            const bounds = L.geoJSON(feature).getBounds();
            const center = bounds.getCenter();
            return {
              fillColor: getRegionColor(center.lat, center.lng),
              fillOpacity: 0.4,
              color: '#cbd5e1',
              weight: 0.5
            };
          }
        }).addTo(map);
      })
      .catch(e => console.error("Error loading GeoJSON", e));

    layerGroupRef.current = L.layerGroup().addTo(map);

    map.on('click', (e: L.LeafletMouseEvent) => {
      if (THAILAND_BOUNDS.contains(e.latlng)) {
        onMapClickRef.current(e.latlng.lat, e.latlng.lng);
      }
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!layerGroupRef.current) return;
    layerGroupRef.current.clearLayers();

    // Render Hub Zones with 50km and 100km rings
    markers.forEach(m => {
      // 100km Outer Circle (Lighter)
      const outerCircle = L.circle([m.lat, m.lng], {
        radius: 100000,
        color: '#818cf8',
        fillColor: '#818cf8',
        fillOpacity: 0.04,
        weight: 1,
        dashArray: '10, 10'
      });

      // 50km Inner Circle (Darker)
      const innerCircle = L.circle([m.lat, m.lng], {
        radius: 50000,
        color: '#4338ca',
        fillColor: '#4338ca',
        fillOpacity: 0.12,
        weight: 2,
        dashArray: '5, 5'
      });
      
      const center = L.circleMarker([m.lat, m.lng], {
        radius: 4,
        color: '#312e81',
        fillColor: '#fff',
        fillOpacity: 1,
        weight: 2
      });

      const group = L.featureGroup([outerCircle, innerCircle, center]).addTo(layerGroupRef.current!);
      group.bindPopup(`
        <div class="p-2 min-w-[140px]">
          <div class="font-black text-indigo-800 text-xs mb-1 uppercase tracking-tighter">${m.label}</div>
          <div class="flex items-center gap-2 mt-2">
            <div class="w-2 h-2 rounded-full bg-indigo-600"></div>
            <span class="text-[9px] font-bold text-slate-600">Primary: 50km</span>
          </div>
          <div class="flex items-center gap-2">
            <div class="w-2 h-2 rounded-full border border-indigo-400"></div>
            <span class="text-[9px] font-bold text-slate-400">Extended: 100km</span>
          </div>
        </div>
      `);
    });

    // Render Data Points
    bulkPins.forEach(p => {
      let ringColor = '#cbd5e1';
      if (p.coverageStatus === 'covered') ringColor = '#10b981'; // Green
      else if (p.coverageStatus === 'near') ringColor = '#facc15'; // Yellow

      const marker = L.circleMarker([p.lat, p.lng], {
        radius: 7,
        color: ringColor,
        fillColor: p.color,
        fillOpacity: 1,
        weight: 3
      });

      const statusText = p.coverageStatus === 'covered' 
        ? '✓ COVERED (50KM)' 
        : p.coverageStatus === 'near' 
          ? '⚠ NEAR (100KM)' 
          : '✕ OUTSIDE RANGE';

      marker.bindPopup(`
        <div class="p-2 space-y-1 min-w-[150px]">
          <div class="font-black text-xs uppercase tracking-tight" style="color: ${p.color}">${p.label}</div>
          <div class="text-[9px] text-slate-400 font-mono tracking-tighter">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</div>

          <div class="text-[10px] border-t border-slate-100 pt-2 mt-1">
             <div class="flex justify-between items-center mb-1">
                <span class="text-[9px] font-bold text-slate-300 uppercase">Status</span>
                <span class="font-black ${p.coverageStatus === 'covered' ? 'text-emerald-600' : p.coverageStatus === 'near' ? 'text-amber-500' : 'text-slate-400'}">
                  ${statusText}
                </span>
             </div>
             ${p.nearestZone ? `
               <div class="flex justify-between items-center pt-1">
                  <span class="text-[9px] font-bold text-slate-300 uppercase">Nearest Hub</span>
                  <div class="text-right">
                    <div class="text-indigo-600 font-black">${p.nearestZone}</div>
                    <div class="text-[8px] font-bold text-slate-400">${p.distanceToNearest?.toFixed(2)}km Away</div>
                  </div>
               </div>
             ` : ''}
          </div>
        </div>
      `);
      
      layerGroupRef.current?.addLayer(marker);
    });
  }, [markers, bulkPins]);

  return (
    <div className="w-full h-full">
      <div ref={mapContainerRef} className="w-full h-full z-10" />
      <style>{`
        .leaflet-container { background: #f8fafc !important; }
        .leaflet-popup-content-wrapper { border-radius: 16px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04); border: 1px solid rgba(255,255,255,0.8); }
        .leaflet-popup-tip { box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); }
      `}</style>
    </div>
  );
};

export default MapView;