import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ControlDock } from './components/ControlDock';
import { MotionHudOverlay } from './components/MotionHudOverlay';
import {
  StravaViewport3D,
  type StravaViewportHandle,
} from './components/StravaViewport3D';
import { ExportModal } from './components/ExportModal';
import { UploadModal } from './components/UploadModal';
import type {
  ElevationGrid,
  ExportMode,
  ExportOptions,
  ParsedActivity,
  ParseProgress,
  SceneSettings,
  StreetNetwork,
} from './types/activity';
import {
  buildFallbackElevationGrid,
  computeSpatialBounds,
  detectHomeOrigin,
  projectActivities,
} from './utils/geo';
import {
  type BasemapTileResult,
  fetchBasemapTiles,
  fetchOsmStreets,
  fetchStreetOverlayTiles,
  fetchTerrariumElevation,
} from './utils/openData';
import { PALETTES } from './utils/palettes';
import { loadDefaultActivities } from './utils/sampleRuns';
import { parseUploadedFiles } from './utils/stravaParser';

const DEFAULT_SETTINGS: SceneSettings = {
  homeRadiusM: 600,
  useHomeFilter: true,
  sportFilter: 'All',
  playbackSpeed: 90,
  trailStyle: 'heatmap',
  palette: 'ember',
  baseMapStyle: 'studio',
  elevationExaggeration: 1.0,
  showTerrain: true,
  showStreets: true,
  showContours: true,
  cameraPreset: 'tilt',
  autoOrbit: false,
  customMarkerUrl: null,
  markerSize: 1.0,
  trailWidth: 1.0,
  lineGlow: 1.1,
  markerGlow: 1.2,
  trailColor: '#f97316',
  markerColor: '#fff7ed',
  showFinishPulse: true,
  minDistanceKm: null,
  maxDistanceKm: null,
  minDurationMin: null,
  maxDurationMin: null,
  maxSpeedKmh: null,
  dateRangeStartMs: null,
  dateRangeEndMs: null,
};

const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  mode: 'snapshot',
  aspectRatio: '16:9',
  resolution: '1080p',
  showDataPanel: true,
  showTimerAndCounts: true,
  showHistogram: true,
  showTitleAndDistance: true,
  hudPosition: 'top-left',
  hideHomeBeacon: true,
  videoDurationSec: 12,
  videoFps: 30,
  videoAutoOrbit: false,
};

export default function App() {
  const viewportRef = useRef<StravaViewportHandle | null>(null);

  // Core activity dataset state (loaded from bundled src/activities/*.fit.gz)
  const [rawActivities, setRawActivities] = useState<ParsedActivity[]>([]);
  const [datasetTitle, setDatasetTitle] = useState('North Vancouver Runs');
  const [isSampleData, setIsSampleData] = useState(true);
  const [homeOrigin, setHomeOrigin] = useState<{ lat: number; lon: number }>({
    lat: 49.347662,
    lon: -123.023114
  });

  // Playback & UI state
  const [settings, setSettings] = useState<SceneSettings>(DEFAULT_SETTINGS);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isDockCollapsed, setIsDockCollapsed] = useState(false);
  const [isPickingHome, setIsPickingHome] = useState(false);
  const [showRadiusRing, setShowRadiusRing] = useState(false);
  const radiusTimerRef = useRef<number | null>(null);

  // Upload & export state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [parseProgress, setParseProgress] = useState<ParseProgress | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [windowDragging, setWindowDragging] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportOptions, setExportOptions] = useState<ExportOptions>(
    DEFAULT_EXPORT_OPTIONS,
  );
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);

  // Open Data Terrain, OSM Streets & Raster Basemap Tiles
  const [remoteElevation, setRemoteElevation] = useState<ElevationGrid | null>(
    null,
  );
  const [streetNetwork, setStreetNetwork] = useState<StreetNetwork>({
    polylines: [],
    source: 'none',
  });
  const [basemapTiles, setBasemapTiles] = useState<BasemapTileResult | null>(
    null,
  );
  const [streetOverlayTiles, setStreetOverlayTiles] =
    useState<BasemapTileResult | null>(null);

  const palette = PALETTES[settings.palette];

  // Load bundled default .fit.gz activities on mount
  useEffect(() => {
    let cancelled = false;
    loadDefaultActivities()
      .then((acts) => {
        if (cancelled || acts.length === 0) return;
        setRawActivities(acts);
        setHomeOrigin(detectHomeOrigin(acts));
        setElapsedSec(0);
        setIsPlaying(true);
      })
      .catch(() => {
        // Ignore if bundled activities fail to load
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep document root dark class synced with selected palette
  useEffect(() => {
    const root = document.documentElement;
    if (palette.isLight) {
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
    }
  }, [palette.isLight]);

  // Project activities into local metric space centered on homeOrigin
  const projectedActivities = useMemo(
    () => projectActivities(rawActivities, homeOrigin.lat, homeOrigin.lon),
    [rawActivities, homeOrigin],
  );

  const availableSports = useMemo(() => {
    const set = new Set<string>();
    for (const a of rawActivities) set.add(a.sport);
    return Array.from(set);
  }, [rawActivities]);

  const activityTimestamps = useMemo(() => {
    const out: number[] = [];
    for (const a of rawActivities) {
      const ts = Date.parse(a.startDate);
      if (Number.isFinite(ts)) out.push(ts);
    }
    return out;
  }, [rawActivities]);

  // Precompute max speed (km/h) per activity (max of average speed and sustained >=2s segment speeds)
  const activityMaxSpeedMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const act of rawActivities) {
      let peakKmh =
        act.durationSec > 0 ? (act.distanceM / act.durationSec) * 3.6 : 0;
      const pts = act.points;
      for (let i = 1; i < pts.length; i++) {
        const dt = pts[i].t - pts[i - 1].t;
        if (dt >= 2) {
          const dd = Math.max(0, pts[i].dist - pts[i - 1].dist);
          const segKmh = (dd / dt) * 3.6;
          if (segKmh > peakKmh) peakKmh = segKmh;
        }
      }
      map.set(act.id, peakKmh);
    }
    return map;
  }, [rawActivities]);

  // Apply Home Radius, Sport, Distance, Duration, Max Speed & Date Range filters
  const filteredActivities = useMemo(() => {
    return projectedActivities.filter((act) => {
      if (settings.sportFilter === 'Run') {
        if (act.sport !== 'Run' && act.sport !== 'Trail Run') return false;
      } else if (
        settings.sportFilter !== 'All' &&
        act.sport !== settings.sportFilter
      ) {
        return false;
      }
      if (settings.useHomeFilter && act.distFromHomeM > settings.homeRadiusM) {
        return false;
      }
      const distKm = act.distanceM / 1000;
      if (settings.minDistanceKm !== null && distKm < settings.minDistanceKm) {
        return false;
      }
      if (settings.maxDistanceKm !== null && distKm > settings.maxDistanceKm) {
        return false;
      }
      const durMin = act.durationSec / 60;
      if (settings.minDurationMin !== null && durMin < settings.minDurationMin) {
        return false;
      }
      if (settings.maxDurationMin !== null && durMin > settings.maxDurationMin) {
        return false;
      }
      if (settings.maxSpeedKmh !== null) {
        const peakKmh = activityMaxSpeedMap.get(act.id) ?? 0;
        if (peakKmh > settings.maxSpeedKmh) {
          return false;
        }
      }
      if (
        settings.dateRangeStartMs !== null ||
        settings.dateRangeEndMs !== null
      ) {
        const ts = Date.parse(act.startDate);
        if (Number.isFinite(ts)) {
          if (
            settings.dateRangeStartMs !== null &&
            ts < settings.dateRangeStartMs
          ) {
            return false;
          }
          if (
            settings.dateRangeEndMs !== null &&
            ts > settings.dateRangeEndMs
          ) {
            return false;
          }
        }
      }
      return true;
    });
  }, [
    projectedActivities,
    activityMaxSpeedMap,
    settings.sportFilter,
    settings.useHomeFilter,
    settings.homeRadiusM,
    settings.minDistanceKm,
    settings.maxDistanceKm,
    settings.minDurationMin,
    settings.maxDurationMin,
    settings.maxSpeedKmh,
    settings.dateRangeStartMs,
    settings.dateRangeEndMs,
  ]);

  const maxDurationSec = useMemo(() => {
    if (filteredActivities.length === 0) return 1800;
    return Math.max(
      60,
      ...filteredActivities.map((a) => Math.ceil(a.durationSec)),
    );
  }, [filteredActivities]);

  // Spatial bounds for filtered set (fall back to all projected if empty)
  const bounds = useMemo(() => {
    const source =
      filteredActivities.length > 0 ? filteredActivities : projectedActivities;
    return computeSpatialBounds(source, homeOrigin.lat, homeOrigin.lon);
  }, [filteredActivities, projectedActivities, homeOrigin]);

  // Instant GPS-derived elevation grid fallback
  const fallbackElevation = useMemo(() => {
    const source =
      filteredActivities.length > 0 ? filteredActivities : projectedActivities;
    return buildFallbackElevationGrid(source, bounds);
  }, [filteredActivities, projectedActivities, bounds]);

  const activeElevationGrid = remoteElevation ?? fallbackElevation;

  // Fetch AWS Terrarium DEM + OSM Street Network asynchronously for the active bounding box
  useEffect(() => {
    let cancelled = false;
    setRemoteElevation(null);
    setStreetNetwork({ polylines: [], source: 'none' });

    const loadOpenData = async () => {
      const [dem, streets] = await Promise.all([
        fetchTerrariumElevation(bounds, homeOrigin.lat, homeOrigin.lon),
        fetchOsmStreets(bounds, homeOrigin.lat, homeOrigin.lon),
      ]);
      if (cancelled) return;
      if (dem) setRemoteElevation(dem);
      if (streets.polylines.length > 0) setStreetNetwork(streets);
    };

    loadOpenData();
    return () => {
      cancelled = true;
    };
  }, [
    bounds.minLat,
    bounds.maxLat,
    bounds.minLon,
    bounds.maxLon,
    homeOrigin.lat,
    homeOrigin.lon,
  ]);

  // Fetch raster basemap tiles when Dark Map, Light Map, or Satellite style is active
  useEffect(() => {
    const style = settings.baseMapStyle;
    if (
      style !== 'dark-map' &&
      style !== 'light-map' &&
      style !== 'satellite' &&
      style !== 'satellite-streets'
    ) {
      setBasemapTiles(null);
      return;
    }

    let cancelled = false;
    fetchBasemapTiles(bounds, style, settings.showStreets).then((tiles) => {
      if (!cancelled) {
        setBasemapTiles(tiles);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    settings.baseMapStyle,
    settings.showStreets,
    bounds.minLat,
    bounds.maxLat,
    bounds.minLon,
    bounds.maxLon,
  ]);

  // Fetch transparent street + label overlay tiles for Studio, 3D Relief, Grid, and Minimal when + Streets is active
  useEffect(() => {
    const style = settings.baseMapStyle;
    const needsOverlay =
      settings.showStreets &&
      (style === 'studio' ||
        style === 'relief' ||
        style === 'blueprint' ||
        style === 'minimal');
    if (!needsOverlay) {
      setStreetOverlayTiles(null);
      return;
    }

    let cancelled = false;
    fetchStreetOverlayTiles(bounds).then((tiles) => {
      if (!cancelled) {
        setStreetOverlayTiles(tiles);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    settings.baseMapStyle,
    settings.showStreets,
    bounds.minLat,
    bounds.maxLat,
    bounds.minLon,
    bounds.maxLon,
  ]);

  useEffect(() => {
    return () => {
      if (radiusTimerRef.current !== null) {
        window.clearTimeout(radiusTimerRef.current);
      }
    };
  }, []);

  const clearRadiusPreview = useCallback(() => {
    if (radiusTimerRef.current !== null) {
      window.clearTimeout(radiusTimerRef.current);
      radiusTimerRef.current = null;
    }
    setShowRadiusRing(false);
  }, []);

  const triggerRadiusPreview = useCallback(() => {
    if (radiusTimerRef.current !== null) {
      window.clearTimeout(radiusTimerRef.current);
    }
    setShowRadiusRing(true);
    radiusTimerRef.current = window.setTimeout(() => {
      radiusTimerRef.current = null;
      setShowRadiusRing(false);
    }, 2200);
  }, []);

  const handleUpdateSettings = useCallback(
    (patch: Partial<SceneSettings>) => {
      setSettings((prev) => ({ ...prev, ...patch }));
      if (patch.useHomeFilter === false) {
        clearRadiusPreview();
      } else if ('homeRadiusM' in patch || patch.useHomeFilter === true) {
        triggerRadiusPreview();
      }
    },
    [clearRadiusPreview, triggerRadiusPreview],
  );

  const handleFilesSelected = useCallback(async (files: FileList | File[]) => {
    setUploadError(null);
    setParseProgress({ phase: 'reading', processed: 0, total: files.length });

    const result = await parseUploadedFiles(files, (p) => {
      setParseProgress(p);
    });

    if (result.activities.length === 0) {
      setParseProgress(null);
      setUploadError(
        result.errors[0] ||
          'No valid GPS tracks (.gpx, .tcx, .fit, .fit.gz) were found in the uploaded files.',
      );
      return;
    }

    const firstFileName = Array.from(files)[0]?.name || 'Strava Archive';
    const cleanName = firstFileName
      .replace(/\.zip$/i, '')
      .replace(/^export_\d+_?/i, 'Strava Runs ');

    const detectedHome = detectHomeOrigin(result.activities);
    setRawActivities(result.activities);
    setHomeOrigin(detectedHome);
    setDatasetTitle(cleanName || 'Strava Archive');
    setIsSampleData(false);
    setSettings((prev) => ({
      ...prev,
      sportFilter: 'All',
      useHomeFilter: true,
      minDistanceKm: null,
      maxDistanceKm: null,
      minDurationMin: null,
      maxDurationMin: null,
      maxSpeedKmh: null,
      dateRangeStartMs: null,
      dateRangeEndMs: null,
    }));
    setElapsedSec(0);
    setIsPlaying(true);
    setParseProgress(null);
    setUploadOpen(false);
  }, []);

  const handleLoadSample = useCallback(async () => {
    const sample = await loadDefaultActivities();
    if (sample.length === 0) return;
    setRawActivities(sample);
    setHomeOrigin(detectHomeOrigin(sample));
    setDatasetTitle('North Vancouver Runs');
    setIsSampleData(true);
    setSettings((prev) => ({
      ...prev,
      sportFilter: 'All',
      useHomeFilter: true,
      homeRadiusM: 600,
      minDistanceKm: null,
      maxDistanceKm: null,
      minDurationMin: null,
      maxDurationMin: null,
      maxSpeedKmh: null,
      dateRangeStartMs: null,
      dateRangeEndMs: null,
    }));
    setElapsedSec(0);
    setIsPlaying(true);
    setUploadError(null);
    setUploadOpen(false);
  }, []);

  // Global keyboard shortcuts (Space: Play/Pause, H: Hide/Show HUD dock, R: Restart)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
      ) {
        return;
      }
      if (uploadOpen) {
        if (e.key === 'Escape') setUploadOpen(false);
        return;
      }
      if (exportModalOpen) {
        if (e.key === 'Escape' && exportProgress === null) {
          setExportModalOpen(false);
        }
        return;
      }
      if (e.key === 'Escape' && isPickingHome) {
        setIsPickingHome(false);
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((prev) => {
          if (!prev && elapsedSec >= maxDurationSec) {
            setElapsedSec(0);
          }
          return !prev;
        });
      } else if (e.key === 'h' || e.key === 'H') {
        setIsDockCollapsed((prev) => !prev);
      } else if (e.key === 'r' || e.key === 'R') {
        setElapsedSec(0);
        setIsPlaying(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    uploadOpen,
    exportModalOpen,
    exportProgress,
    isPickingHome,
    elapsedSec,
    maxDurationSec,
  ]);

  // Global drag-and-drop file handler anywhere on window
  useEffect(() => {
    let dragCounter = 0;
    const onDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        dragCounter++;
        setWindowDragging(true);
      }
    };
    const onDragLeave = () => {
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) setWindowDragging(false);
    };
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounter = 0;
      setWindowDragging(false);
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        setUploadOpen(true);
        handleFilesSelected(e.dataTransfer.files);
      }
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [handleFilesSelected]);

  const handleTogglePlay = useCallback(() => {
    setIsPlaying((prev) => {
      if (!prev && elapsedSec >= maxDurationSec - 0.5) {
        setElapsedSec(0);
      }
      return !prev;
    });
  }, [elapsedSec, maxDurationSec]);

  const handleOpenExportModal = useCallback(
    (mode: ExportMode) => {
      setExportOptions((prev) => ({
        ...prev,
        mode,
        videoAutoOrbit: mode === 'video' ? settings.autoOrbit : prev.videoAutoOrbit,
      }));
      setExportModalOpen(true);
    },
    [settings.autoOrbit],
  );

  const handleConfirmExport = useCallback(async () => {
    if (!viewportRef.current || exportProgress !== null) return;
    if (exportOptions.mode === 'snapshot') {
      viewportRef.current.captureSnapshot(datasetTitle, exportOptions);
      setExportModalOpen(false);
      return;
    }

    const controller = new AbortController();
    exportAbortRef.current = controller;
    setExportProgress(0);
    try {
      await viewportRef.current.exportVideo(
        datasetTitle,
        exportOptions,
        (pct) => {
          setExportProgress(pct);
        },
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setExportModalOpen(false);
      }
    } finally {
      exportAbortRef.current = null;
      setExportProgress(null);
    }
  }, [datasetTitle, exportOptions, exportProgress]);

  const handleCancelVideoExport = useCallback(() => {
    exportAbortRef.current?.abort();
  }, []);

  return (
    <main
      className="relative w-screen h-screen overflow-hidden"
      style={{ backgroundColor: palette.backgroundCss }}
    >
      {/* Full-Viewport 3D WebGL Canvas */}
      <StravaViewport3D
        ref={viewportRef}
        activities={filteredActivities}
        bounds={bounds}
        elevationGrid={activeElevationGrid}
        streetNetwork={streetNetwork}
        basemapTiles={basemapTiles}
        streetOverlayTiles={streetOverlayTiles}
        homeLat={homeOrigin.lat}
        homeLon={homeOrigin.lon}
        isPickingHome={isPickingHome}
        showRadiusRing={showRadiusRing}
        showHomeMarker={!isDockCollapsed}
        settings={settings}
        elapsedSec={elapsedSec}
        maxDurationSec={maxDurationSec}
        isPlaying={isPlaying}
        onTickTime={setElapsedSec}
        onSetPlaying={setIsPlaying}
        onPickHome={(lat, lon) => {
          setHomeOrigin({ lat, lon });
          setIsPickingHome(false);
          setSettings((prev) => ({ ...prev, useHomeFilter: true }));
          triggerRadiusPreview();
        }}
      />

      {/* Pick Home on Map Banner */}
      {isPickingHome && (
        <div className="pointer-events-auto fixed top-5 inset-x-0 mx-auto w-fit z-30 flex items-center gap-3 rounded-lg border border-orange-500/60 bg-[#0C1018]/94 px-4 py-2 text-xs text-slate-100 shadow-lg">
          <span>Click anywhere on the 3D map to set the Home Origin</span>
          <button
            type="button"
            onClick={() => setIsPickingHome(false)}
            className="text-orange-400 hover:text-orange-300 font-medium cursor-pointer"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Semantic Motion Graphic HUD & Top Actions */}
      <MotionHudOverlay
        datasetTitle={datasetTitle}
        isSampleData={isSampleData}
        activities={filteredActivities}
        elapsedSec={elapsedSec}
        maxDurationSec={maxDurationSec}
        palette={palette}
        exportProgress={exportProgress}
        terrainSource={activeElevationGrid.source}
        streetCount={streetNetwork.polylines.length}
        onOpenUpload={() => {
          setUploadError(null);
          setUploadOpen(true);
        }}
        onCaptureSnapshot={() => handleOpenExportModal('snapshot')}
        onExportVideo={() => handleOpenExportModal('video')}
      />

      {/* Empty Filter Guard */}
      {filteredActivities.length === 0 && rawActivities.length > 0 && (
        <div className="pointer-events-none fixed inset-0 flex items-center justify-center z-20 p-4">
          <div className="pointer-events-auto rounded-xl border border-slate-700 bg-[#0C1018]/95 px-6 py-4 text-center shadow-xl max-w-sm">
            <p className="font-display text-sm font-semibold text-slate-100">
              No activities match current filters
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Adjust the home origin, start radius, sport, distance, or time bounds.
            </p>
            <div className="mt-3 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setHomeOrigin(detectHomeOrigin(rawActivities));
                  setSettings((prev) => ({
                    ...prev,
                    homeRadiusM: 1200,
                    useHomeFilter: true,
                  }));
                  triggerRadiusPreview();
                }}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Auto-Detect Home
              </button>
              <button
                type="button"
                onClick={() => {
                  clearRadiusPreview();
                  setSettings((prev) => ({
                    ...prev,
                    useHomeFilter: false,
                    sportFilter: 'All',
                    minDistanceKm: null,
                    maxDistanceKm: null,
                    minDurationMin: null,
                    maxDurationMin: null,
                    maxSpeedKmh: null,
                    dateRangeStartMs: null,
                    dateRangeEndMs: null,
                  }));
                }}
                className="px-3.5 py-1.5 text-xs font-medium rounded-lg bg-orange-600 text-white hover:bg-orange-500 transition-colors cursor-pointer"
              >
                Show All {rawActivities.length}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Collapsible Bottom Control Dock */}
      <ControlDock
        settings={settings}
        palette={palette}
        availableSports={availableSports}
        activityTimestamps={activityTimestamps}
        totalParsedCount={rawActivities.length}
        filteredCount={filteredActivities.length}
        homeLat={homeOrigin.lat}
        homeLon={homeOrigin.lon}
        isPickingHome={isPickingHome}
        elapsedSec={elapsedSec}
        maxDurationSec={maxDurationSec}
        isPlaying={isPlaying}
        isCollapsed={isDockCollapsed}
        onToggleCollapse={() => setIsDockCollapsed((p) => !p)}
        onTogglePlay={handleTogglePlay}
        onRestart={() => {
          setElapsedSec(0);
          setIsPlaying(true);
        }}
        onSeek={(sec) => {
          setIsPlaying(false);
          setElapsedSec(sec);
        }}
        onUpdateSettings={handleUpdateSettings}
        onResetCamera={() => viewportRef.current?.resetCamera()}
        onRecenterHome={() => {
          setHomeOrigin(detectHomeOrigin(rawActivities));
          setIsPickingHome(false);
          setSettings((prev) => ({ ...prev, useHomeFilter: true }));
          triggerRadiusPreview();
        }}
        onSetHomeLatLon={(lat, lon) => {
          setHomeOrigin({ lat, lon });
          setIsPickingHome(false);
          setSettings((prev) => ({ ...prev, useHomeFilter: true }));
          triggerRadiusPreview();
        }}
        onTogglePickHome={() => setIsPickingHome((p) => !p)}
      />

      {/* Upload Modal */}
      <UploadModal
        isOpen={uploadOpen}
        palette={palette}
        progress={parseProgress}
        errorMessage={uploadError}
        onClose={() => setUploadOpen(false)}
        onFilesSelected={handleFilesSelected}
        onLoadSample={handleLoadSample}
      />

      {/* Export Render Modal */}
      <ExportModal
        isOpen={exportModalOpen}
        palette={palette}
        options={exportOptions}
        exportProgress={exportProgress}
        viewportWidth={typeof window !== 'undefined' ? window.innerWidth : 1440}
        viewportHeight={typeof window !== 'undefined' ? window.innerHeight : 900}
        datasetTitle={datasetTitle}
        activityCount={filteredActivities.length}
        onChangeOptions={(patch) =>
          setExportOptions((prev) => ({ ...prev, ...patch }))
        }
        onConfirmExport={handleConfirmExport}
        onCancelVideo={handleCancelVideoExport}
        onClose={() => setExportModalOpen(false)}
      />

      {/* Global Window Drop Overlay */}
      {windowDragging && !uploadOpen && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/75 border-4 border-dashed border-orange-500 m-4 rounded-2xl">
          <div className="text-center">
            <p className="font-display text-2xl font-semibold text-white">
              Drop Strava ZIP or GPS Files
            </p>
            <p className="mt-1 text-sm text-slate-300">
              Supports .zip exports, .fit, .fit.gz, .gpx, and .tcx
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
