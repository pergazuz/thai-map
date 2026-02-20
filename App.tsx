
import React, { useState, useCallback, useMemo } from 'react';
import MapView from './components/MapView';
import { CircleMarker, PointMarker, PinCategory } from './types';
import { batchIdentifyProvinces } from './services/geminiService';
import {
  MapPin, Info, Layers, Loader2, Upload, Trash2,
  ClipboardList, Download,
  Tag, Compass, Edit2, Check, X, FileText, Menu
} from 'lucide-react';

const CATEGORY_MAP: Record<PinCategory, { label: string; color: string }> = {
  'Outzone': { label: 'Site Outzone', color: '#64748b' }, // Slate-500 (Grey)
  'Request': { label: 'Site Request', color: '#eab308' }, // Yellow-600
  'Existing': { label: 'Existing Sites', color: '#16a34a' }, // Green-600
  'Pending': { label: 'Site รอสำรวจ', color: '#2563eb' }  // Blue-600
};

const load = <T,>(key: string, fallback: T): T => {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; }
};

const App: React.FC = () => {
  const [markers, setMarkers] = useState<CircleMarker[]>(() => load('thaimap_markers', []));
  const [bulkPins, setBulkPins] = useState<PointMarker[]>(() => load('thaimap_pins', []));
  const [importText, setImportText] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<PinCategory>('Existing');
  const [nextRadiusName, setNextRadiusName] = useState("");
  const [isGeocoding, setIsGeocoding] = useState(false);
  
  // State for renaming zones
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [editingZoneName, setEditingZoneName] = useState("");

  // State for renaming pins
  const [editingPinId, setEditingPinId] = useState<string | null>(null);
  const [editingPinName, setEditingPinName] = useState("");
  const [showPanel, setShowPanel] = useState(false);
  const [showLegend, setShowLegend] = useState(true);

  // Persist state to localStorage
  React.useEffect(() => { localStorage.setItem('thaimap_markers', JSON.stringify(markers)); }, [markers]);
  React.useEffect(() => { localStorage.setItem('thaimap_pins', JSON.stringify(bulkPins)); }, [bulkPins]);

  const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const processedBulkPins = useMemo(() => {
    const provinceCounts = new Map<string, number>();

    return bulkPins.map(pin => {
      let nearestDist = Infinity;
      let nearestZ: string | undefined = undefined;
      const coveringZones: string[] = [];

      markers.forEach(m => {
        const d = getDistance(pin.lat, pin.lng, m.lat, m.lng);
        if (d <= 50000) {
          coveringZones.push(m.label);
        }
        if (d < nearestDist) {
          nearestDist = d;
          nearestZ = m.label;
        }
      });

      let status: 'covered' | 'near' | 'none' = 'none';
      if (nearestDist <= 50000) {
        status = 'covered';
      } else if (nearestDist <= 100000) {
        status = 'near';
      }
      
      let finalLabel = pin.label;
      if (pin.province && !pin.customLabel) {
        const currentCount = provinceCounts.get(pin.province) || 0;
        finalLabel = currentCount === 0 ? pin.province : `${pin.province} ${currentCount + 1}`;
        provinceCounts.set(pin.province, currentCount + 1);
      }

      return { 
        ...pin, 
        label: finalLabel,
        coverageStatus: status,
        distanceToNearest: nearestDist === Infinity ? undefined : (nearestDist / 1000), 
        nearestZone: nearestZ,
        // Custom attribute to store all covering zones for export
        allZones: coveringZones.join("; ")
      };
    });
  }, [bulkPins, markers]);

  const handleAddRadiusMarker = useCallback((lat: number, lng: number) => {
    const name = nextRadiusName.trim() || `Radius Zone ${markers.length + 1}`;
    const newMarker: CircleMarker = {
      id: Math.random().toString(36).substr(2, 9),
      lat,
      lng,
      radius: 50000,
      outerRadius: 100000,
      label: name
    };
    setMarkers(prev => [...prev, newMarker]);
    setNextRadiusName("");
  }, [markers.length, nextRadiusName]);

  const handleRenameRadius = (id: string) => {
    if (!editingZoneName.trim()) return;
    setMarkers(prev => prev.map(m => m.id === id ? { ...m, label: editingZoneName } : m));
    setEditingZoneId(null);
    setEditingZoneName("");
  };

  const startEditing = (marker: CircleMarker) => {
    setEditingZoneId(marker.id);
    setEditingZoneName(marker.label);
  };

  const handleImportBulk = async () => {
    const lines = importText.split('\n');
    const newPointsRaw: { lat: number; lng: number; name?: string }[] = [];

    lines.forEach((line) => {
      if (!line.trim()) return;
      const urlMatch = line.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
      const latLngMatch = line.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
      let lat: number | undefined, lng: number | undefined, name: string | undefined;

      if (urlMatch) {
        lat = parseFloat(urlMatch[1]);
        lng = parseFloat(urlMatch[2]);
      } else if (latLngMatch) {
        lat = parseFloat(latLngMatch[1]);
        lng = parseFloat(latLngMatch[2]);
        const before = line.substring(0, latLngMatch.index!).trim().replace(/,\s*$/, '').trim();
        if (before) name = before;
      }

      if (lat !== undefined && lng !== undefined && !isNaN(lat) && !isNaN(lng)) {
        newPointsRaw.push({ lat, lng, name });
      }
    });

    if (newPointsRaw.length === 0) return;

    // Only call the province service for points that don't have a custom name
    const pointsNeedingProvince = newPointsRaw.filter(p => !p.name);
    setIsGeocoding(true);
    const provinces = await batchIdentifyProvinces(pointsNeedingProvince);

    let provinceIdx = 0;
    const finalNewPins: PointMarker[] = newPointsRaw.map((raw) => {
      const label = raw.name || provinces[provinceIdx] || `${raw.lat}, ${raw.lng}`;
      const province = raw.name ? undefined : provinces[provinceIdx];
      if (!raw.name) provinceIdx++;
      return {
        id: Math.random().toString(36).substr(2, 9),
        lat: raw.lat,
        lng: raw.lng,
        color: CATEGORY_MAP[selectedCategory].color,
        category: selectedCategory,
        label,
        province,
      };
    });

    setBulkPins(prev => [...prev, ...finalNewPins]);
    setImportText("");
    setIsGeocoding(false);
  };

  const handleExportCSV = () => {
    const header = "Name,Province,Category,Latitude,Longitude,CoverageStatus,NearestZone,AllCoveringZones,DistanceToNearest(km)\n";
    const rows = processedBulkPins.map(p => 
      `"${p.label}","${p.province || ''}","${CATEGORY_MAP[p.category].label}",${p.lat},${p.lng},"${p.coverageStatus}","${p.nearestZone || ''}","${(p as any).allZones || ''}",${p.distanceToNearest?.toFixed(2) || ''}`
    ).join("\n");
    
    downloadFile(header + rows, "thairadius_detailed_data.csv");
  };

  const handleExportSummary = () => {
    const header = "Zone Name,Center Latitude,Center Longitude,Total Existing,Total Request,Total Pending,Total Outzone,Total Covered (50km)\n";
    
    const rows = markers.map(m => {
      const coveredPins = processedBulkPins.filter(p => {
        const d = getDistance(p.lat, p.lng, m.lat, m.lng);
        return d <= 50000;
      });
      
      const counts = {
        Existing: coveredPins.filter(p => p.category === 'Existing').length,
        Request: coveredPins.filter(p => p.category === 'Request').length,
        Pending: coveredPins.filter(p => p.category === 'Pending').length,
        Outzone: coveredPins.filter(p => p.category === 'Outzone').length,
      };

      return `"${m.label}",${m.lat},${m.lng},${counts.Existing},${counts.Request},${counts.Pending},${counts.Outzone},${coveredPins.length}`;
    }).join("\n");

    downloadFile(header + rows, "thairadius_zone_summary.csv");
  };

  const downloadFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleRenamePin = (id: string) => {
    if (!editingPinName.trim()) return;
    setBulkPins(prev => prev.map(p => p.id === id ? { ...p, label: editingPinName, customLabel: true } : p));
    setEditingPinId(null);
    setEditingPinName("");
  };

  const handleRemoveRadius = (id: string) => setMarkers(prev => prev.filter(m => m.id !== id));
  const handleRemovePin = (id: string) => setBulkPins(prev => prev.filter(p => p.id !== id));

  const stats = useMemo(() => {
    const covered = processedBulkPins.filter(p => p.coverageStatus === 'covered').length;
    const near = processedBulkPins.filter(p => p.coverageStatus === 'near').length;
    const none = processedBulkPins.filter(p => p.coverageStatus === 'none').length;
    return { covered, near, none };
  }, [processedBulkPins]);

  return (
    <div className="flex h-screen w-full font-sans text-slate-900 overflow-hidden bg-white">
      {/* Mobile backdrop */}
      {showPanel && (
        <div className="fixed inset-0 bg-black/40 z-20 md:hidden" onClick={() => setShowPanel(false)} />
      )}

      <aside className={`
        fixed inset-y-0 left-0 z-30 md:relative md:z-auto
        w-[85vw] md:w-[440px] shrink-0
        bg-white border-r border-slate-200 flex flex-col shadow-2xl overflow-hidden
        transition-transform duration-300 ease-in-out
        ${showPanel ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0
      `}>
        <header className="p-6 border-b border-slate-100 bg-gradient-to-br from-indigo-950 to-indigo-800 text-white shrink-0">
          <div className="flex items-center gap-2 mb-1">
            <div className="bg-indigo-500 p-1.5 rounded-lg">
              <Layers className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">ThaiRadius Pro</h1>
          </div>
          <p className="text-indigo-300 text-[11px] font-medium uppercase tracking-widest">Radius Zone Management & Analytics</p>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Radius Naming & Placement */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <Tag className="w-3.5 h-3.5" /> Zone Management
              </h2>
              {markers.length > 0 && (
                <button 
                  onClick={handleExportSummary}
                  className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 bg-indigo-50 px-2 py-1 rounded"
                >
                  <FileText className="w-3 h-3" /> Export Summary
                </button>
              )}
            </div>
            
            <div className="relative">
              <input 
                type="text"
                placeholder="Enter next zone name..."
                className="w-full p-3 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none pr-10"
                value={nextRadiusName}
                onChange={(e) => setNextRadiusName(e.target.value)}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300">
                <MapPin className="w-4 h-4" />
              </div>
            </div>

            <div className="space-y-1.5 mt-2">
              {markers.map(m => (
                <div key={m.id} className="flex items-center justify-between p-2.5 bg-indigo-50/50 border border-indigo-100 rounded-xl group transition-all hover:bg-indigo-50">
                  {editingZoneId === m.id ? (
                    <div className="flex items-center gap-2 flex-1 mr-2">
                      <input 
                        className="flex-1 p-1 text-[10px] font-bold border border-indigo-300 rounded outline-none focus:ring-1 focus:ring-indigo-500"
                        value={editingZoneName}
                        onChange={(e) => setEditingZoneName(e.target.value)}
                        autoFocus
                      />
                      <button onClick={() => handleRenameRadius(m.id)} className="text-emerald-600"><Check className="w-3.5 h-3.5" /></button>
                      <button onClick={() => setEditingZoneId(null)} className="text-rose-500"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span className="text-[11px] font-bold text-indigo-900 truncate">{m.label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => startEditing(m)} className="text-indigo-300 hover:text-indigo-600 transition-colors">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleRemoveRadius(m.id)} className="text-indigo-200 hover:text-rose-500 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
              {markers.length === 0 && (
                <p className="text-[10px] text-slate-400 italic text-center py-2">Click map to add zones.</p>
              )}
            </div>
          </section>

          {/* Bulk Import */}
          <section className="space-y-3">
            <h2 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Upload className="w-3.5 h-3.5" /> Pin Category & Import
            </h2>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
              <div className="grid grid-cols-2 gap-2 mb-3">
                {(Object.keys(CATEGORY_MAP) as PinCategory[]).map(cat => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`text-[10px] font-bold py-2 px-3 rounded-lg border flex items-center gap-2 transition-all ${
                      selectedCategory === cat 
                        ? 'bg-white border-indigo-500 text-indigo-700 shadow-sm' 
                        : 'bg-transparent border-slate-200 text-slate-500 hover:border-slate-300'
                    }`}
                  >
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CATEGORY_MAP[cat].color }} />
                    {CATEGORY_MAP[cat].label}
                  </button>
                ))}
              </div>
              <textarea
                className="w-full h-20 p-3 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none resize-none mb-3 bg-white"
                placeholder={"Paste coordinates, one per line:\n13.756, 100.501\nMy Site, 18.787, 98.993\nhttps://maps.google.com/..."}

                value={importText}
                onChange={(e) => setImportText(e.target.value)}
              />
              <button 
                onClick={handleImportBulk}
                disabled={isGeocoding}
                className="w-full bg-indigo-600 text-white text-xs font-bold py-2.5 rounded-lg hover:bg-indigo-700 transition-all shadow-md flex items-center justify-center gap-2 disabled:bg-slate-300"
              >
                {isGeocoding ? <Loader2 className="w-4 h-4 animate-spin" /> : "Identify & Add Points"}
              </button>
            </div>
          </section>

          {/* Point Analysis List */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <ClipboardList className="w-3.5 h-3.5" /> Point Status ({bulkPins.length})
              </h2>
              {processedBulkPins.length > 0 && (
                <button onClick={handleExportCSV} className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1">
                  <Download className="w-3 h-3" /> Export Points
                </button>
              )}
            </div>

            {markers.length > 0 && processedBulkPins.length > 0 && (
              <div className="grid grid-cols-3 gap-2 py-2 border-b border-slate-100 mb-2">
                <div className="bg-emerald-50 p-2 rounded-lg text-center border border-emerald-100">
                  <div className="text-lg font-black text-emerald-600 leading-none">{stats.covered}</div>
                  <div className="text-[8px] font-bold text-emerald-700 uppercase mt-1">50km Hub</div>
                </div>
                <div className="bg-amber-50 p-2 rounded-lg text-center border border-amber-100">
                  <div className="text-lg font-black text-amber-600 leading-none">{stats.near}</div>
                  <div className="text-[8px] font-bold text-amber-700 uppercase mt-1">100km Near</div>
                </div>
                <div className="bg-slate-50 p-2 rounded-lg text-center border border-slate-200">
                  <div className="text-lg font-black text-slate-400 leading-none">{stats.none}</div>
                  <div className="text-[8px] font-bold text-slate-500 uppercase mt-1">No Range</div>
                </div>
              </div>
            )}
            
            <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1 custom-scrollbar">
              {processedBulkPins.map(p => (
                <div key={p.id} className="flex flex-col p-3 bg-white border border-slate-100 rounded-xl shadow-sm group hover:border-indigo-300 transition-all relative overflow-hidden">
                  <div className={`absolute top-0 left-0 w-1 h-full`} style={{ backgroundColor: p.color }} />
                  <div className="flex items-center justify-between mb-2 pl-2">
                    {editingPinId === p.id ? (
                      <div className="flex items-center gap-2 flex-1 mr-2">
                        <input
                          className="flex-1 p-1 text-[10px] font-bold border border-indigo-300 rounded outline-none focus:ring-1 focus:ring-indigo-500"
                          value={editingPinName}
                          onChange={(e) => setEditingPinName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleRenamePin(p.id); if (e.key === 'Escape') setEditingPinId(null); }}
                          autoFocus
                        />
                        <button onClick={() => handleRenamePin(p.id)} className="text-emerald-600"><Check className="w-3.5 h-3.5" /></button>
                        <button onClick={() => setEditingPinId(null)} className="text-rose-500"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ) : (
                      <div className="flex flex-col flex-1 overflow-hidden">
                        <span className="text-xs font-bold text-slate-800 truncate">{p.label}</span>
                        <span className="text-[9px] text-slate-400 uppercase font-bold tracking-tighter">{CATEGORY_MAP[p.category].label}</span>
                      </div>
                    )}
                    {editingPinId !== p.id && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => { setEditingPinId(p.id); setEditingPinName(p.label); }} className="text-slate-200 hover:text-indigo-500 transition-colors">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleRemovePin(p.id)} className="text-slate-200 group-hover:text-rose-400 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col pl-2 pt-1 border-t border-slate-50">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1 text-[9px] font-mono text-slate-400">
                        <Compass className="w-2.5 h-2.5" /> {p.lat.toFixed(3)}, {p.lng.toFixed(3)}
                      </div>
                      {p.coverageStatus === 'covered' && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 uppercase">Covered 50km</span>}
                      {p.coverageStatus === 'near' && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 uppercase">Near 100km</span>}
                      {p.coverageStatus === 'none' && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 uppercase">Not Covered</span>}
                    </div>
                    {(p as any).allZones && (
                      <div className="text-[8px] text-slate-400 flex items-center gap-1">
                        <Info className="w-2.5 h-2.5" /> Zones: <span className="font-bold text-slate-600">{(p as any).allZones}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

        </div>
      </aside>

      <main className="flex-1 relative">
        <MapView markers={markers} bulkPins={processedBulkPins} onMapClick={handleAddRadiusMarker} />

        {/* Mobile panel toggle button */}
        <button
          className="md:hidden absolute top-4 left-4 z-[1000] bg-white rounded-xl shadow-lg p-2.5 border border-slate-200"
          onClick={() => setShowPanel(v => !v)}
        >
          <Menu className="w-5 h-5 text-indigo-700" />
        </button>
        
        <div className="absolute top-4 right-4 z-[1000] flex flex-col gap-2 items-end">
          <button
            onClick={() => setShowLegend(v => !v)}
            className="bg-white/90 backdrop-blur-md px-3 py-1.5 rounded-xl shadow-xl border border-white/20 text-[10px] font-bold text-slate-600 hover:text-indigo-700 transition-colors"
          >
            {showLegend ? 'Hide Legend' : 'Show Legend'}
          </button>

          {showLegend && (
            <>
              <div className="bg-white/90 backdrop-blur-md p-4 rounded-2xl shadow-xl border border-white/20 text-[10px] space-y-2 pointer-events-none">
                <h4 className="font-black text-slate-800 uppercase tracking-tighter mb-2 border-b border-slate-100 pb-1">Legend</h4>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-indigo-600 shadow-sm" />
                  <span className="font-bold text-slate-600">Hub Center (50km Inner)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full border border-indigo-400 bg-indigo-50/50" />
                  <span className="font-bold text-slate-600">Extended Range (100km Outer)</span>
                </div>
                <hr className="my-1 border-slate-100" />
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-emerald-500" />
                  <span className="font-bold text-slate-600">Status: Covered (50km)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-amber-400" />
                  <span className="font-bold text-slate-600">Status: Near (100km)</span>
                </div>
              </div>

              <div className="bg-white/90 backdrop-blur-md p-4 rounded-2xl shadow-xl border border-white/20 text-[10px] space-y-2 pointer-events-none">
                <h4 className="font-black text-slate-800 uppercase tracking-tighter mb-2 border-b border-slate-100 pb-1">Categories</h4>
                {Object.entries(CATEGORY_MAP).map(([key, val]) => (
                  <div key={key} className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: val.color }} />
                    <span className="font-bold text-slate-600">{val.label}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
      `}</style>
    </div>
  );
};

export default App;
