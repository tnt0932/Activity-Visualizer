import {
  ChevronDown,
  ChevronUp,
  Crosshair,
  ImagePlus,
  Pause,
  Play,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  BaseMapStyle,
  CameraPreset,
  PaletteConfig,
  SceneSettings,
  ThemePalette,
} from '../types/activity';
import { formatClockHMS } from '../utils/geo';
import { PALETTES } from '../utils/palettes';
import { DateRangeScrubber } from './DateRangeScrubber';

interface ControlDockProps {
  settings: SceneSettings;
  palette: PaletteConfig;
  availableSports: string[];
  activityTimestamps: number[];
  totalParsedCount: number;
  filteredCount: number;
  homeLat: number;
  homeLon: number;
  isPickingHome: boolean;
  elapsedSec: number;
  maxDurationSec: number;
  isPlaying: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onTogglePlay: () => void;
  onRestart: () => void;
  onSeek: (sec: number) => void;
  onUpdateSettings: (patch: Partial<SceneSettings>) => void;
  onResetCamera: () => void;
  onRecenterHome: () => void;
  onSetHomeLatLon: (lat: number, lon: number) => void;
  onTogglePickHome: () => void;
}

type DockTab = 'scene' | 'filter' | 'markers';

const SPEED_OPTIONS = [15, 45, 90, 180, 360];

const BASE_MAP_OPTIONS: Array<{ id: BaseMapStyle; label: string }> = [
  { id: 'studio', label: 'Studio' },
  { id: 'relief', label: '3D Relief' },
  { id: 'dark-map', label: 'Dark Map' },
  { id: 'light-map', label: 'Light Map' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'blueprint', label: 'Grid' },
  { id: 'minimal', label: 'Minimal' },
];

const TRAIL_COLOR_SWATCHES = [
  { label: 'Strava Orange', hex: '#f97316' },
  { label: 'Electric Cyan', hex: '#38bdf8' },
  { label: 'Alpine Emerald', hex: '#10b981' },
  { label: 'Crimson Rose', hex: '#f43f5e' },
  { label: 'Solar Gold', hex: '#eab308' },
  { label: 'Violet', hex: '#a855f7' },
  { label: 'Pure White', hex: '#f8fafc' },
];

const MARKER_COLOR_SWATCHES = [
  { label: 'Warm White', hex: '#fff7ed' },
  { label: 'Strava Orange', hex: '#fb923c' },
  { label: 'Ice Blue', hex: '#bae6fd' },
  { label: 'Mint', hex: '#bbf7d0' },
  { label: 'Rose', hex: '#fda4af' },
  { label: 'Gold', hex: '#fef08a' },
  { label: 'Obsidian', hex: '#0f172a' },
];

export function ControlDock({
  settings,
  palette,
  availableSports,
  activityTimestamps,
  totalParsedCount,
  filteredCount,
  homeLat,
  homeLon,
  isPickingHome,
  elapsedSec,
  maxDurationSec,
  isPlaying,
  isCollapsed,
  onToggleCollapse,
  onTogglePlay,
  onRestart,
  onSeek,
  onUpdateSettings,
  onResetCamera,
  onRecenterHome,
  onSetHomeLatLon,
  onTogglePickHome,
}: ControlDockProps) {
  const [activeTab, setActiveTab] = useState<DockTab>('scene');
  const [latInput, setLatInput] = useState(homeLat.toFixed(5));
  const [lonInput, setLonInput] = useState(homeLon.toFixed(5));
  const [radiusInput, setRadiusInput] = useState(String(settings.homeRadiusM));

  useEffect(() => {
    setLatInput(homeLat.toFixed(5));
    setLonInput(homeLon.toFixed(5));
  }, [homeLat, homeLon]);

  useEffect(() => {
    setRadiusInput(String(settings.homeRadiusM));
  }, [settings.homeRadiusM]);

  const isLight = palette.isLight;
  const dockBg = isLight
    ? 'bg-[#F5F2EB]/95 border-stone-300 text-slate-900'
    : 'bg-[#0C1018]/95 border-slate-800 text-slate-100';
  const mutedText = isLight ? 'text-slate-600' : 'text-slate-400';
  const segBg = isLight ? 'bg-stone-200/80' : 'bg-slate-900/90';
  const segActive = isLight
    ? 'bg-white text-slate-900 shadow-xs'
    : 'bg-slate-700 text-white shadow-xs';
  const segIdle = isLight
    ? 'text-slate-600 hover:text-slate-900'
    : 'text-slate-400 hover:text-slate-200';
  const dividerClass = isLight ? 'border-stone-300' : 'border-slate-800';
  const inputClass = isLight
    ? 'bg-white border-stone-300 text-slate-900 focus:border-orange-500'
    : 'bg-slate-900 border-slate-700 text-slate-100 focus:border-orange-500';

  const handleMarkerFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onUpdateSettings({ customMarkerUrl: reader.result });
      }
    };
    reader.readAsDataURL(file);
  };

  const commitHomeCoords = () => {
    const parsedLat = parseFloat(latInput);
    const parsedLon = parseFloat(lonInput);
    if (
      Number.isFinite(parsedLat) &&
      Number.isFinite(parsedLon) &&
      Math.abs(parsedLat) <= 90 &&
      Math.abs(parsedLon) <= 180
    ) {
      onSetHomeLatLon(parsedLat, parsedLon);
    } else {
      setLatInput(homeLat.toFixed(5));
      setLonInput(homeLon.toFixed(5));
    }
  };

  const commitRadius = () => {
    const val = Math.round(Number(radiusInput));
    if (Number.isFinite(val) && val >= 25 && val <= 50000) {
      onUpdateSettings({ homeRadiusM: val, useHomeFilter: true });
    } else {
      setRadiusInput(String(settings.homeRadiusM));
    }
  };

  return (
    <div
      className="pointer-events-none fixed bottom-4 inset-x-0 mx-auto z-20 flex flex-col items-center w-[min(920px,calc(100vw-24px))] transition-transform duration-200 ease-out"
      style={{
        transform: isCollapsed
          ? 'translateY(calc(100% - 26px))'
          : 'translateY(0)',
      }}
    >
      {/* Collapse / Expand Handle */}
      <button
        type="button"
        onClick={onToggleCollapse}
        className={`pointer-events-auto flex items-center gap-1.5 px-3.5 py-1 text-[11px] font-medium rounded-t-lg border border-b-0 transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-orange-500 ${dockBg}`}
      >
        {isCollapsed ? (
          <>
            <ChevronUp className="w-3.5 h-3.5" />
            <span>Show Controls (H)</span>
          </>
        ) : (
          <>
            <ChevronDown className="w-3.5 h-3.5" />
            <span>Hide Controls (H)</span>
          </>
        )}
      </button>

      {/* Main Dock Container */}
      <div
        className={`pointer-events-auto w-full max-h-[46vh] overflow-y-auto rounded-xl border shadow-2xl px-4 py-3 ${dockBg}`}
      >
        {/* Persistent Transport Row */}
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-3">
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onTogglePlay}
              aria-label={isPlaying ? 'Pause simulation' : 'Play simulation'}
              className="flex items-center justify-center w-9 h-9 rounded-lg bg-orange-600 hover:bg-orange-500 text-white transition-colors cursor-pointer shrink-0 focus-visible:outline-2 focus-visible:outline-white"
            >
              {isPlaying ? (
                <Pause className="w-4 h-4" />
              ) : (
                <Play className="w-4 h-4 ml-0.5" />
              )}
            </button>
            <button
              type="button"
              onClick={onRestart}
              aria-label="Restart from 00:00"
              title="Restart from 00:00"
              className={`flex items-center justify-center w-9 h-9 rounded-lg border transition-colors cursor-pointer shrink-0 focus-visible:outline-2 focus-visible:outline-orange-500 ${dividerClass} ${segIdle}`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Scrubber */}
          <div className="flex-1 min-w-[160px] flex items-center gap-2.5">
            <span className="font-mono-tabular text-xs w-16 shrink-0">
              {formatClockHMS(elapsedSec)}
            </span>
            <input
              type="range"
              aria-label="Playback timeline"
              min={0}
              max={Math.max(1, maxDurationSec)}
              step={1}
              value={Math.min(elapsedSec, maxDurationSec)}
              onChange={(e) => onSeek(Number(e.target.value))}
              className={`studio-slider w-full ${
                isLight ? 'bg-stone-300' : 'bg-slate-800'
              }`}
            />
            <span
              className={`font-mono-tabular text-xs w-16 text-right shrink-0 ${mutedText}`}
            >
              {formatClockHMS(maxDurationSec)}
            </span>
          </div>

          {/* Speed Selector */}
          <div className={`flex items-center gap-0.5 p-0.5 rounded-lg shrink-0 ${segBg}`}>
            {SPEED_OPTIONS.map((spd) => (
              <button
                key={spd}
                type="button"
                onClick={() => onUpdateSettings({ playbackSpeed: spd })}
                className={`px-2 py-1 text-[11px] font-mono-tabular font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  settings.playbackSpeed === spd ? segActive : segIdle
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>
        </div>

        {/* Tab Navigation Bar */}
        <div
          className={`mt-2.5 pt-2.5 border-t flex flex-wrap items-center justify-between gap-3 ${dividerClass}`}
        >
          <div className={`flex items-center gap-1 p-0.5 rounded-lg ${segBg}`}>
            {(
              [
                ['scene', 'Base Map & Camera'],
                ['filter', 'Home & Filters'],
                ['markers', 'Glow & Markers'],
              ] as Array<[DockTab, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  activeTab === id ? segActive : segIdle
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className={`flex items-center gap-2 text-xs ${mutedText}`}>
            <span className="font-mono-tabular">
              {filteredCount} / {totalParsedCount} runs
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular">
              {homeLat.toFixed(4)}, {homeLon.toFixed(4)}
            </span>
          </div>
        </div>

        {/* Tab Content Panels */}
        <div className="mt-2.5 pt-1">
          {activeTab === 'scene' && (
            <div className="space-y-2.5 text-xs">
              {/* Row 1: Base Map Style + Universal Streets Toggle */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className={`font-medium shrink-0 ${mutedText}`}>
                  Base Map
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <div
                    className={`flex flex-wrap sm:flex-nowrap items-center gap-1 p-0.5 rounded-lg ${segBg}`}
                  >
                    {BASE_MAP_OPTIONS.map((opt) => {
                      const isActive =
                        settings.baseMapStyle === opt.id ||
                        (opt.id === 'satellite' &&
                          settings.baseMapStyle === 'satellite-streets');
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() =>
                            onUpdateSettings({ baseMapStyle: opt.id })
                          }
                          className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                            isActive ? segActive : segIdle
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    aria-pressed={settings.showStreets}
                    onClick={() =>
                      onUpdateSettings({
                        showStreets: !settings.showStreets,
                        ...(settings.baseMapStyle === 'satellite-streets' &&
                        settings.showStreets
                          ? { baseMapStyle: 'satellite' }
                          : {}),
                      })
                    }
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      settings.showStreets
                        ? 'bg-orange-600 border-orange-500 text-white'
                        : `${dividerClass} ${segIdle}`
                    }`}
                  >
                    + Streets
                  </button>
                </div>
              </div>

              {/* Row 2: Trail Palette + Camera + Relief */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
                <div>
                  <div className={`mb-1 font-medium ${mutedText}`}>
                    Map Theme
                  </div>
                  <div className={`flex items-center gap-1 p-0.5 rounded-lg ${segBg}`}>
                    {(Object.keys(PALETTES) as ThemePalette[]).map((pKey) => (
                      <button
                        key={pKey}
                        type="button"
                        onClick={() => onUpdateSettings({ palette: pKey })}
                        className={`flex-1 px-2 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                          settings.palette === pKey ? segActive : segIdle
                        }`}
                      >
                        {PALETTES[pKey].label.split(' ')[0]}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`font-medium ${mutedText}`}>Camera</span>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={settings.autoOrbit}
                          onChange={(e) =>
                            onUpdateSettings({ autoOrbit: e.target.checked })
                          }
                          className="accent-orange-500"
                        />
                        <span className={mutedText}>Orbit</span>
                      </label>
                      <button
                        type="button"
                        onClick={onResetCamera}
                        className="text-orange-500 hover:text-orange-400 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                  <div className={`flex items-center gap-1 p-0.5 rounded-lg ${segBg}`}>
                    {(
                      [
                        ['tilt', 'Tilt'],
                        ['top', 'Top'],
                        ['horizon', 'Horizon'],
                      ] as Array<[CameraPreset, string]>
                    ).map(([preset, label]) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => onUpdateSettings({ cameraPreset: preset })}
                        className={`flex-1 px-2 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                          settings.cameraPreset === preset ? segActive : segIdle
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`font-medium ${mutedText}`}>
                      Relief ({settings.elevationExaggeration.toFixed(1)}x)
                    </span>
                    <div className="flex items-center gap-2.5">
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={settings.showContours}
                          onChange={(e) =>
                            onUpdateSettings({ showContours: e.target.checked })
                          }
                          className="accent-orange-500"
                        />
                        <span className={mutedText}>Contours</span>
                      </label>
                    </div>
                  </div>
                  <input
                    type="range"
                    aria-label="Terrain elevation exaggeration"
                    min={0}
                    max={3.5}
                    step={0.1}
                    value={settings.elevationExaggeration}
                    onChange={(e) =>
                      onUpdateSettings({
                        elevationExaggeration: Number(e.target.value),
                      })
                    }
                    className={`studio-slider w-full ${
                      isLight ? 'bg-stone-300' : 'bg-slate-800'
                    }`}
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'filter' && (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                {/* Home Origin Lat / Lng Controls */}
                <div className="md:col-span-5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className={`font-medium ${mutedText}`}>
                      Home Origin (Lat / Lng)
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={onTogglePickHome}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                          isPickingHome
                            ? 'bg-orange-600 text-white'
                            : `${mutedText} hover:text-orange-400`
                        }`}
                      >
                        <Crosshair className="w-3 h-3" />
                        <span>{isPickingHome ? 'Click Map...' : 'Pick on Map'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={onRecenterHome}
                        className={`text-[11px] font-medium cursor-pointer whitespace-nowrap shrink-0 ${mutedText} hover:text-orange-400`}
                      >
                        Auto-Detect
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      aria-label="Home Latitude"
                      value={latInput}
                      onChange={(e) => setLatInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && commitHomeCoords()}
                      placeholder="Lat"
                      className={`w-full min-w-0 px-2.5 py-1.5 rounded-md border font-mono-tabular text-xs outline-none ${inputClass}`}
                    />
                    <input
                      type="text"
                      aria-label="Home Longitude"
                      value={lonInput}
                      onChange={(e) => setLonInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && commitHomeCoords()}
                      placeholder="Lng"
                      className={`w-full min-w-0 px-2.5 py-1.5 rounded-md border font-mono-tabular text-xs outline-none ${inputClass}`}
                    />
                    <button
                      type="button"
                      onClick={commitHomeCoords}
                      className="px-3 py-1.5 rounded-md bg-orange-600 hover:bg-orange-500 text-white font-medium text-xs transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Set
                    </button>
                  </div>
                </div>

                {/* Home Radius Slider + Exact Input */}
                <div className="md:col-span-4 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.useHomeFilter}
                        onChange={(e) =>
                          onUpdateSettings({ useHomeFilter: e.target.checked })
                        }
                        className="accent-orange-500"
                      />
                      <span className="font-medium">Start Radius</span>
                    </label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        aria-label="Home radius in meters"
                        min={25}
                        max={50000}
                        step={50}
                        value={radiusInput}
                        onChange={(e) => setRadiusInput(e.target.value)}
                        onBlur={commitRadius}
                        onKeyDown={(e) => e.key === 'Enter' && commitRadius()}
                        disabled={!settings.useHomeFilter}
                        className={`w-20 px-2 py-0.5 rounded border font-mono-tabular text-xs text-right outline-none disabled:opacity-40 ${inputClass}`}
                      />
                      <span className={mutedText}>m</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    aria-label="Home origin radius slider"
                    min={100}
                    max={5000}
                    step={50}
                    disabled={!settings.useHomeFilter}
                    value={Math.min(5000, settings.homeRadiusM)}
                    onChange={(e) =>
                      onUpdateSettings({ homeRadiusM: Number(e.target.value) })
                    }
                    className={`studio-slider w-full disabled:opacity-40 ${
                      isLight ? 'bg-stone-300' : 'bg-slate-800'
                    }`}
                  />
                </div>

                {/* Sport Type Filter */}
                <div className="md:col-span-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className={`font-medium ${mutedText}`}>Sport</span>
                    {settings.sportFilter === 'Run' && (
                      <span className={`text-[11px] ${mutedText}`}>
                        incl. Trail
                      </span>
                    )}
                  </div>
                  <div
                    className={`flex items-center gap-1 p-0.5 rounded-lg overflow-x-auto ${segBg}`}
                  >
                    {['All', ...availableSports].map((sp) => (
                      <button
                        key={sp}
                        type="button"
                        onClick={() => onUpdateSettings({ sportFilter: sp })}
                        className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                          settings.sportFilter === sp ? segActive : segIdle
                        }`}
                      >
                        {sp}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Row 2: Min / Max Distance (km), Activity Time (min), and Max Speed (km/h) */}
              <div
                className={`grid grid-cols-1 md:grid-cols-3 gap-4 pt-2.5 border-t ${dividerClass}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-medium shrink-0 ${mutedText}`}>
                    Distance (km)
                  </span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      aria-label="Minimum activity distance in km"
                      min={0}
                      step={0.5}
                      placeholder="Min"
                      value={settings.minDistanceKm ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value;
                        onUpdateSettings({
                          minDistanceKm:
                            raw === '' ? null : Math.max(0, Number(raw)),
                        });
                      }}
                      className={`w-16 px-2 py-1 rounded-md border font-mono-tabular text-xs outline-none ${inputClass}`}
                    />
                    <span className={mutedText}>–</span>
                    <input
                      type="number"
                      aria-label="Maximum activity distance in km"
                      min={0}
                      step={0.5}
                      placeholder="Max"
                      value={settings.maxDistanceKm ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value;
                        onUpdateSettings({
                          maxDistanceKm:
                            raw === '' ? null : Math.max(0, Number(raw)),
                        });
                      }}
                      className={`w-16 px-2 py-1 rounded-md border font-mono-tabular text-xs outline-none ${inputClass}`}
                    />
                    {(settings.minDistanceKm !== null ||
                      settings.maxDistanceKm !== null) && (
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateSettings({
                            minDistanceKm: null,
                            maxDistanceKm: null,
                          })
                        }
                        className="text-[11px] text-orange-500 hover:text-orange-400 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className={`font-medium shrink-0 ${mutedText}`}>
                    Time (min)
                  </span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      aria-label="Minimum activity time in minutes"
                      min={0}
                      step={5}
                      placeholder="Min"
                      value={settings.minDurationMin ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value;
                        onUpdateSettings({
                          minDurationMin:
                            raw === '' ? null : Math.max(0, Number(raw)),
                        });
                      }}
                      className={`w-16 px-2 py-1 rounded-md border font-mono-tabular text-xs outline-none ${inputClass}`}
                    />
                    <span className={mutedText}>–</span>
                    <input
                      type="number"
                      aria-label="Maximum activity time in minutes"
                      min={0}
                      step={5}
                      placeholder="Max"
                      value={settings.maxDurationMin ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value;
                        onUpdateSettings({
                          maxDurationMin:
                            raw === '' ? null : Math.max(0, Number(raw)),
                        });
                      }}
                      className={`w-16 px-2 py-1 rounded-md border font-mono-tabular text-xs outline-none ${inputClass}`}
                    />
                    {(settings.minDurationMin !== null ||
                      settings.maxDurationMin !== null) && (
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateSettings({
                            minDurationMin: null,
                            maxDurationMin: null,
                          })
                        }
                        className="text-[11px] text-orange-500 hover:text-orange-400 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className={`font-medium shrink-0 ${mutedText}`}>
                    Max Speed (km/h)
                  </span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      aria-label="Maximum activity speed in km/h"
                      min={1}
                      step={1}
                      placeholder="Any"
                      value={settings.maxSpeedKmh ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value;
                        onUpdateSettings({
                          maxSpeedKmh:
                            raw === '' ? null : Math.max(1, Number(raw)),
                        });
                      }}
                      className={`w-20 px-2 py-1 rounded-md border font-mono-tabular text-xs outline-none ${inputClass}`}
                    />
                    {settings.maxSpeedKmh !== null && (
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateSettings({ maxSpeedKmh: null })
                        }
                        className="text-[11px] text-orange-500 hover:text-orange-400 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Row 3: Activity Date Distribution Scrubber */}
              {activityTimestamps.length > 0 && (
                <div className={`pt-2.5 border-t ${dividerClass}`}>
                  <DateRangeScrubber
                    timestamps={activityTimestamps}
                    startMs={settings.dateRangeStartMs}
                    endMs={settings.dateRangeEndMs}
                    isLight={isLight}
                    onChange={(dateRangeStartMs, dateRangeEndMs) =>
                      onUpdateSettings({ dateRangeStartMs, dateRangeEndMs })
                    }
                  />
                </div>
              )}
            </div>
          )}

          {activeTab === 'markers' && (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center text-xs">
              {/* Trail Style & Finish Animation */}
              <div className="md:col-span-3 space-y-2.5">
                <div>
                  <div className={`mb-1.5 font-medium ${mutedText}`}>
                    Trail Mode
                  </div>
                  <div className={`flex items-center gap-1 p-0.5 rounded-lg ${segBg}`}>
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ trailStyle: 'heatmap' })}
                      className={`flex-1 px-2 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        settings.trailStyle === 'heatmap' ? segActive : segIdle
                      }`}
                    >
                      Heatmap
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ trailStyle: 'ribbon' })}
                      className={`flex-1 px-2 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        settings.trailStyle === 'ribbon' ? segActive : segIdle
                      }`}
                    >
                      Ribbons
                    </button>
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.showFinishPulse}
                    onChange={(e) =>
                      onUpdateSettings({ showFinishPulse: e.target.checked })
                    }
                    className="accent-orange-500"
                  />
                  <span className={mutedText}>Finish Animation</span>
                </label>
              </div>

              {/* Line Width & Line Glow */}
              <div className="md:col-span-3 space-y-2">
                <div>
                  <div className="flex justify-between mb-1">
                    <span className={mutedText}>Line Glow</span>
                    <span className="font-mono-tabular">
                      {settings.lineGlow.toFixed(2)}x
                    </span>
                  </div>
                  <input
                    type="range"
                    aria-label="Line glow intensity"
                    min={0}
                    max={3.0}
                    step={0.05}
                    value={settings.lineGlow}
                    onChange={(e) =>
                      onUpdateSettings({ lineGlow: Number(e.target.value) })
                    }
                    className={`studio-slider w-full ${
                      isLight ? 'bg-stone-300' : 'bg-slate-800'
                    }`}
                  />
                </div>
                <div>
                  <div className="flex justify-between mb-1">
                    <span className={mutedText}>Line Width</span>
                    <span className="font-mono-tabular">
                      {settings.trailWidth.toFixed(1)}x
                    </span>
                  </div>
                  <input
                    type="range"
                    aria-label="Trail ribbon width"
                    min={0.4}
                    max={2.4}
                    step={0.1}
                    value={settings.trailWidth}
                    onChange={(e) =>
                      onUpdateSettings({ trailWidth: Number(e.target.value) })
                    }
                    className={`studio-slider w-full ${
                      isLight ? 'bg-stone-300' : 'bg-slate-800'
                    }`}
                  />
                </div>
              </div>

              {/* Marker Glow & Marker Scale */}
              <div className="md:col-span-3 space-y-2">
                <div>
                  <div className="flex justify-between mb-1">
                    <span className={mutedText}>Marker Glow</span>
                    <span className="font-mono-tabular">
                      {settings.markerGlow.toFixed(2)}x
                    </span>
                  </div>
                  <input
                    type="range"
                    aria-label="Marker glow intensity"
                    min={0}
                    max={3.0}
                    step={0.05}
                    value={settings.markerGlow}
                    onChange={(e) =>
                      onUpdateSettings({ markerGlow: Number(e.target.value) })
                    }
                    className={`studio-slider w-full ${
                      isLight ? 'bg-stone-300' : 'bg-slate-800'
                    }`}
                  />
                </div>
                <div>
                  <div className="flex justify-between mb-1">
                    <span className={mutedText}>Marker Scale</span>
                    <span className="font-mono-tabular">
                      {settings.markerSize.toFixed(1)}x
                    </span>
                  </div>
                  <input
                    type="range"
                    aria-label="Runner marker size"
                    min={0.4}
                    max={2.5}
                    step={0.1}
                    value={settings.markerSize}
                    onChange={(e) =>
                      onUpdateSettings({ markerSize: Number(e.target.value) })
                    }
                    className={`studio-slider w-full ${
                      isLight ? 'bg-stone-300' : 'bg-slate-800'
                    }`}
                  />
                </div>
              </div>

              {/* Custom Face / Avatar Marker Upload */}
              <div className="md:col-span-3 flex flex-col gap-1.5">
                <div className={`font-medium ${mutedText}`}>Runner Sprite</div>
                <div className="flex items-center gap-1.5">
                  <label
                    className={`flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${dividerClass} ${segIdle}`}
                  >
                    <ImagePlus className="w-3.5 h-3.5" />
                    <span>
                      {settings.customMarkerUrl ? 'Replace Image' : 'Upload Face'}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleMarkerFile(e.target.files?.[0])}
                    />
                  </label>
                  {settings.customMarkerUrl && (
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ customMarkerUrl: null })}
                      title="Remove custom marker"
                      className={`p-1.5 rounded-lg border cursor-pointer ${dividerClass} ${segIdle}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Independent Line & Marker Colors */}
              <div
                className={`md:col-span-12 grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2.5 border-t ${dividerClass}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-medium shrink-0 ${mutedText}`}>
                    Line Color
                  </span>
                  <div className="flex items-center gap-1.5">
                    {TRAIL_COLOR_SWATCHES.map((sw) => (
                      <button
                        key={sw.hex}
                        type="button"
                        title={sw.label}
                        aria-label={`Set line color to ${sw.label}`}
                        onClick={() => onUpdateSettings({ trailColor: sw.hex })}
                        className={`w-5 h-5 rounded-full border transition-transform cursor-pointer ${
                          settings.trailColor.toLowerCase() === sw.hex
                            ? 'scale-110 ring-2 ring-orange-500 ring-offset-1 ring-offset-slate-900 border-white'
                            : 'border-white/25 hover:scale-105'
                        }`}
                        style={{ backgroundColor: sw.hex }}
                      />
                    ))}
                    <input
                      type="color"
                      aria-label="Custom line color"
                      value={settings.trailColor}
                      onChange={(e) =>
                        onUpdateSettings({ trailColor: e.target.value })
                      }
                      className="w-6 h-6 rounded border-0 bg-transparent cursor-pointer p-0"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className={`font-medium shrink-0 ${mutedText}`}>
                    Marker Color
                  </span>
                  <div className="flex items-center gap-1.5">
                    {MARKER_COLOR_SWATCHES.map((sw) => (
                      <button
                        key={sw.hex}
                        type="button"
                        title={sw.label}
                        aria-label={`Set marker color to ${sw.label}`}
                        onClick={() => onUpdateSettings({ markerColor: sw.hex })}
                        className={`w-5 h-5 rounded-full border transition-transform cursor-pointer ${
                          settings.markerColor.toLowerCase() === sw.hex
                            ? 'scale-110 ring-2 ring-orange-500 ring-offset-1 ring-offset-slate-900 border-white'
                            : 'border-white/25 hover:scale-105'
                        }`}
                        style={{ backgroundColor: sw.hex }}
                      />
                    ))}
                    <input
                      type="color"
                      aria-label="Custom marker color"
                      value={settings.markerColor}
                      onChange={(e) =>
                        onUpdateSettings({ markerColor: e.target.value })
                      }
                      className="w-6 h-6 rounded border-0 bg-transparent cursor-pointer p-0"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
