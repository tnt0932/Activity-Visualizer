import { Camera, Film, FolderUp } from 'lucide-react';
import type { PaletteConfig, ProjectedActivity } from '../types/activity';
import { formatClockHMS } from '../utils/geo';
import { buildFinishHistogram } from '../utils/histogram';

interface MotionHudOverlayProps {
  datasetTitle: string;
  isSampleData: boolean;
  activities: ProjectedActivity[];
  elapsedSec: number;
  maxDurationSec: number;
  palette: PaletteConfig;
  exportProgress: number | null;
  terrainSource: 'gps' | 'terrarium';
  streetCount: number;
  onOpenUpload: () => void;
  onCaptureSnapshot: () => void;
  onExportVideo: () => void;
}

export function MotionHudOverlay({
  datasetTitle,
  isSampleData,
  activities,
  elapsedSec,
  maxDurationSec,
  palette,
  exportProgress,
  terrainSource,
  streetCount,
  onOpenUpload,
  onCaptureSnapshot,
  onExportVideo,
}: MotionHudOverlayProps) {
  const { buckets, maxBucketTotal, stillRunning, finishedCount } =
    buildFinishHistogram(activities, elapsedSec, maxDurationSec, 18);

  const totalKmValue =
    activities.reduce((sum, a) => sum + a.distanceM, 0) / 1000;
  const formattedTotalKm =
    totalKmValue >= 1000
      ? `${Math.round(totalKmValue).toLocaleString()} km`
      : `${totalKmValue.toFixed(1)} km`;

  const isLight = palette.isLight;
  const panelClass = isLight
    ? 'bg-[#F5F2EB]/92 border-stone-300 text-slate-900'
    : 'bg-[#0C1018]/90 border-slate-800/90 text-slate-100';
  const mutedClass = isLight ? 'text-slate-600' : 'text-slate-400';
  const accentClass = isLight ? 'text-orange-700' : 'text-orange-400';
  const trackFill = isLight ? 'rgba(15, 23, 42, 0.14)' : 'rgba(248, 250, 252, 0.13)';
  const barFill = isLight ? '#c2410c' : '#fb923c';

  return (
    <>
      {/* Top-Left Broadcast Telemetry HUD */}
      <aside
        className={`pointer-events-auto fixed top-5 left-5 z-20 w-[300px] sm:w-[324px] rounded-xl border px-4 py-3.5 shadow-lg transition-colors duration-200 ${panelClass}`}
      >
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="font-display text-base font-semibold tracking-tight truncate">
            {datasetTitle}
          </h1>
          <span className={`text-xs shrink-0 ${mutedClass}`}>
            {isSampleData ? 'Sample Set' : 'Local Archive'}
          </span>
        </div>

        <div className={`mt-0.5 flex items-center gap-1.5 text-xs ${mutedClass}`}>
          <span className="font-mono-tabular">{activities.length} runs</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono-tabular">{formattedTotalKm} total</span>
          <span aria-hidden="true">·</span>
          <span>
            {terrainSource === 'terrarium' ? 'DEM Terrain' : 'GPS Relief'}
            {streetCount > 0 ? ' + OSM' : ''}
          </span>
        </div>

        <div className="mt-3 flex items-baseline justify-between">
          <div className="font-mono-tabular text-3xl font-bold tracking-tight">
            {formatClockHMS(elapsedSec)}
          </div>
        </div>

        <div className="mt-1 flex items-center gap-2 text-xs">
          <span className={`font-mono-tabular font-semibold ${accentClass}`}>
            {stillRunning} Still Running
          </span>
          <span className={mutedClass} aria-hidden="true">
            ·
          </span>
          <span className={`font-mono-tabular ${mutedClass}`}>
            {finishedCount} Finished
          </span>
        </div>

        {/* Dynamic Finish-Time Histogram */}
        <div className="mt-3 pt-2.5 border-t border-current/10">
          <div className="flex items-center justify-between text-[11px] mb-1.5">
            <span className={mutedClass}>Finish-Time Distribution</span>
            <span className={`font-mono-tabular ${mutedClass}`}>
              0m – {Math.round(maxDurationSec / 60)}m
            </span>
          </div>
          <svg
            viewBox="0 0 260 44"
            className="w-full h-11 block"
            aria-label="Finish time distribution histogram"
          >
            {buckets.map((b, i) => {
              const barW = 11;
              const gap = 3.6;
              const x = i * (barW + gap);
              const totalH = Math.max(2, (b.totalCount / maxBucketTotal) * 42);
              const doneH = (b.completedCount / maxBucketTotal) * 42;
              return (
                <g key={b.index}>
                  <rect
                    x={x}
                    y={44 - totalH}
                    width={barW}
                    height={totalH}
                    rx={1.5}
                    fill={trackFill}
                  />
                  {doneH > 0 && (
                    <rect
                      x={x}
                      y={44 - doneH}
                      width={barW}
                      height={doneH}
                      rx={1.5}
                      fill={barFill}
                    />
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </aside>

      {/* Top-Right Compact Action Cluster */}
      <div className="pointer-events-auto fixed top-5 right-5 z-20 flex items-center gap-2.5">
        <button
          type="button"
          onClick={onCaptureSnapshot}
          title="Save PNG Snapshot"
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-orange-500 ${panelClass} ${
            isLight ? 'hover:bg-stone-200/80' : 'hover:bg-slate-800/90'
          }`}
        >
          <Camera className="w-3.5 h-3.5" />
          <span>Snapshot</span>
        </button>

        <button
          type="button"
          onClick={onExportVideo}
          disabled={exportProgress !== null || activities.length === 0}
          title="Render and download WebM motion graphic video"
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-orange-500 ${panelClass} ${
            isLight ? 'hover:bg-stone-200/80' : 'hover:bg-slate-800/90'
          }`}
        >
          <Film className="w-3.5 h-3.5" />
          <span className="font-mono-tabular">
            {exportProgress !== null ? `Rendering ${exportProgress}%` : 'Export Video'}
          </span>
        </button>

        <button
          type="button"
          onClick={onOpenUpload}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-orange-600 text-white hover:bg-orange-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-md focus-visible:outline-2 focus-visible:outline-white"
        >
          <FolderUp className="w-3.5 h-3.5" />
          <span>Upload Strava ZIP</span>
        </button>
      </div>
    </>
  );
}
