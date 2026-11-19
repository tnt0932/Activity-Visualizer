export interface TrackPoint {
  lat: number;
  lon: number;
  ele: number;
  /** Seconds elapsed since activity start (starts at 0) */
  t: number;
  /** Cumulative distance in meters */
  dist: number;
  /** Local projected East (+X) meters relative to Home Origin */
  x: number;
  /** Local projected South (+Z, so North is -Z) meters relative to Home Origin */
  z: number;
}

export interface ParsedActivity {
  id: string;
  name: string;
  sport: string;
  startDate: string;
  durationSec: number;
  distanceM: number;
  elevationGainM: number;
  startLat: number;
  startLon: number;
  points: TrackPoint[];
  fileName: string;
}

export interface ProjectedActivity extends ParsedActivity {
  distFromHomeM: number;
  colorIndex: number;
}

export interface SpatialBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  radiusM: number;
}

export interface ElevationGrid {
  cols: number;
  rows: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  elevations: Float32Array;
  minEle: number;
  maxEle: number;
  source: 'gps' | 'terrarium';
}

export interface StreetNetwork {
  polylines: Array<Array<{ x: number; z: number }>>;
  source: 'osm' | 'none';
}

export type ThemePalette = 'ember' | 'cobalt' | 'emerald' | 'paper';
export type BaseMapStyle =
  | 'studio'
  | 'relief'
  | 'dark-map'
  | 'light-map'
  | 'satellite'
  | 'satellite-streets'
  | 'blueprint'
  | 'minimal';
export type CameraPreset = 'tilt' | 'top' | 'horizon';
export type TrailStyle = 'heatmap' | 'ribbon';

export interface SceneSettings {
  homeRadiusM: number;
  useHomeFilter: boolean;
  sportFilter: string;
  playbackSpeed: number;
  trailStyle: TrailStyle;
  palette: ThemePalette;
  baseMapStyle: BaseMapStyle;
  elevationExaggeration: number;
  showTerrain: boolean;
  showStreets: boolean;
  showContours: boolean;
  cameraPreset: CameraPreset;
  autoOrbit: boolean;
  customMarkerUrl: string | null;
  markerSize: number;
  trailWidth: number;
  lineGlow: number;
  markerGlow: number;
  trailColor: string;
  markerColor: string;
  showFinishPulse: boolean;
  minDistanceKm: number | null;
  maxDistanceKm: number | null;
  minDurationMin: number | null;
  maxDurationMin: number | null;
  maxSpeedKmh: number | null;
  dateRangeStartMs: number | null;
  dateRangeEndMs: number | null;
}

export interface ParseProgress {
  phase: 'reading' | 'parsing' | 'done';
  processed: number;
  total: number;
  currentFile?: string;
}

export interface PaletteConfig {
  id: ThemePalette;
  label: string;
  isLight: boolean;
  backgroundHex: number;
  backgroundCss: string;
  fogHex: number;
  terrainLowHex: number;
  terrainHighHex: number;
  contourHex: number;
  streetHex: number;
  streetOpacity: number;
  trailBaseHex: number;
  trailPeakHex: number;
  markerHex: number;
  homeRingHex: number;
  hudTextCss: string;
  hudMutedCss: string;
  hudAccentCss: string;
}
