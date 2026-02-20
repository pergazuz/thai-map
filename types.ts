export type PinCategory = 'Outzone' | 'Request' | 'Existing' | 'Pending';

export interface CircleMarker {
  id: string;
  lat: number;
  lng: number;
  radius: number; // Primary radius (50km)
  outerRadius: number; // Secondary radius (100km)
  label: string;
}

export interface PointMarker {
  id: string;
  lat: number;
  lng: number;
  color: string;
  label: string;
  province?: string;
  customLabel?: boolean; // true when label was manually set by user
  category: PinCategory;
  coverageStatus?: 'covered' | 'near' | 'none'; // covered <= 50km, near <= 100km
  distanceToNearest?: number; // in km
  nearestZone?: string;
}

export interface AnalysisResult {
  summary: string;
  landmarks: string[];
  provinces: string[];
}