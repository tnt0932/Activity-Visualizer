import { Camera, Film, X } from 'lucide-react';
import type {
  ExportOptions,
  HudPosition,
  PaletteConfig,
} from '../types/activity';
import {
  ASPECT_RATIO_PRESETS,
  RESOLUTION_TIERS,
  resolveExportDimensions,
} from '../utils/exportDimensions';

interface ExportModalProps {
  isOpen: boolean;
  palette: PaletteConfig;
  options: ExportOptions;
  exportProgress: number | null;
  viewportWidth: number;
  viewportHeight: number;
  datasetTitle: string;
  activityCount: number;
  onChangeOptions: (patch: Partial<ExportOptions>) => void;
  onConfirmExport: () => void;
  onCancelVideo: () => void;
  onClose: () => void;
}

const HUD_POSITIONS: Array<{ id: HudPosition; label: string }> = [
  { id: 'top-left', label: 'Top Left' },
  { id: 'top-right', label: 'Top Right' },
  { id: 'bottom-left', label: 'Bottom Left' },
  { id: 'bottom-center', label: 'Bottom Center' },
];

const VIDEO_DURATIONS = [8, 12, 20, 30];

export function ExportModal({
  isOpen,
  palette,
  options,
  exportProgress,
  viewportWidth,
  viewportHeight,
  datasetTitle,
  activityCount,
  onChangeOptions,
  onConfirmExport,
  onCancelVideo,
  onClose,
}: ExportModalProps) {
  if (!isOpen) return null;

  const isLight = palette.isLight;
  const isRendering = exportProgress !== null;
  const isVideo = options.mode === 'video';

  const { width, height } = resolveExportDimensions(
    options.aspectRatio,
    options.resolution,
    viewportWidth,
    viewportHeight,
  );
  const previewAspect = width / Math.max(1, height);

  const cardBg = isLight
    ? 'bg-[#F8F6F0] border-stone-300 text-slate-900'
    : 'bg-[#0E121B] border-slate-800 text-slate-100';
  const muted = isLight ? 'text-slate-600' : 'text-slate-400';
  const dividerClass = isLight ? 'border-stone-200' : 'border-slate-800';
  const segBg = isLight ? 'bg-stone-200/80' : 'bg-slate-900/90';
  const segActive = isLight
    ? 'bg-white text-slate-900 shadow-xs'
    : 'bg-slate-700 text-white shadow-xs';
  const segIdle = isLight
    ? 'text-slate-600 hover:text-slate-900'
    : 'text-slate-400 hover:text-slate-200';
  const optionIdle = isLight
    ? 'border-stone-300 bg-white/70 text-slate-700 hover:border-stone-400'
    : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700';
  const optionActive = isLight
    ? 'border-orange-600 bg-orange-50 text-orange-950'
    : 'border-orange-500 bg-orange-500/12 text-white';

  const previewPositionClass =
    options.hudPosition === 'top-left'
      ? 'top-2.5 left-2.5'
      : options.hudPosition === 'top-right'
        ? 'top-2.5 right-2.5'
        : options.hudPosition === 'bottom-center'
          ? 'bottom-2.5 left-1/2 -translate-x-1/2'
          : 'bottom-2.5 left-2.5';

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isRendering) onClose();
      }}
    >
      <div
        className={`w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-xl border p-6 shadow-2xl ${cardBg}`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="export-modal-title"
              className="font-display text-lg font-semibold tracking-tight"
            >
              Export Render
            </h2>
            <p className={`mt-0.5 text-xs ${muted}`}>
              {datasetTitle} · {activityCount} {activityCount === 1 ? 'activity' : 'activities'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Format Mode Switch */}
            <div className={`flex items-center gap-0.5 p-0.5 rounded-lg ${segBg}`}>
              <button
                type="button"
                disabled={isRendering}
                onClick={() => onChangeOptions({ mode: 'snapshot' })}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50 ${
                  !isVideo ? segActive : segIdle
                }`}
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Snapshot (PNG)</span>
              </button>
              <button
                type="button"
                disabled={isRendering}
                onClick={() => onChangeOptions({ mode: 'video' })}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50 ${
                  isVideo ? segActive : segIdle
                }`}
              >
                <Film className="w-3.5 h-3.5" />
                <span>Video (WebM)</span>
              </button>
            </div>

            {!isRendering && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close export dialog"
                className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                  isLight
                    ? 'hover:bg-stone-200 text-slate-600'
                    : 'hover:bg-slate-800 text-slate-400'
                }`}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Main 2-Column Configuration + Preview Layout */}
        <div className="mt-5 grid grid-cols-1 md:grid-cols-[1fr_200px] gap-5 items-start">
          <div className="space-y-4">
            {/* Aspect Ratio Presets */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium">Aspect Ratio</span>
                <span className={`text-[11px] font-mono-tabular ${muted}`}>
                  {width} × {height} px
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {ASPECT_RATIO_PRESETS.map((preset) => {
                  const selected = options.aspectRatio === preset.id;
                  const boxRatio =
                    preset.id === 'viewport'
                      ? Math.max(0.5, Math.min(2, viewportWidth / Math.max(1, viewportHeight)))
                      : preset.ratioW / preset.ratioH;
                  const boxH = boxRatio >= 1 ? Math.round(14 / boxRatio) : 14;
                  const boxW = boxRatio >= 1 ? 14 : Math.round(14 * boxRatio);
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      disabled={isRendering}
                      onClick={() => onChangeOptions({ aspectRatio: preset.id })}
                      className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg border text-left transition-colors cursor-pointer disabled:opacity-50 ${
                        selected ? optionActive : optionIdle
                      }`}
                    >
                      <span
                        className="shrink-0 flex items-center justify-center w-4 h-4"
                        aria-hidden="true"
                      >
                        <span
                          className={`rounded-[2px] border ${
                            selected
                              ? 'border-orange-500 bg-orange-500/20'
                              : isLight
                                ? 'border-slate-500/70'
                                : 'border-slate-500'
                          }`}
                          style={{ width: `${Math.max(6, boxW)}px`, height: `${Math.max(6, boxH)}px` }}
                        />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs font-semibold leading-tight">
                          {preset.label}
                        </span>
                        <span className={`block text-[10px] truncate leading-tight mt-0.5 ${muted}`}>
                          {preset.platformHint}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Resolution */}
            <div>
              <span className="block text-xs font-medium mb-2">Resolution</span>
              <div className={`grid grid-cols-4 gap-1 p-1 rounded-lg ${segBg}`}>
                {RESOLUTION_TIERS.map((tier) => {
                  const selected = options.resolution === tier.id;
                  return (
                    <button
                      key={tier.id}
                      type="button"
                      disabled={isRendering}
                      onClick={() => onChangeOptions({ resolution: tier.id })}
                      className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50 ${
                        selected ? segActive : segIdle
                      }`}
                    >
                      {tier.label}
                    </button>
                  );
                })}
              </div>
              {isVideo && options.resolution === '4k' && (
                <p className={`mt-1.5 text-[11px] ${muted}`}>
                  4K video encoding is GPU-intensive; 1080p FHD is recommended for fast smooth sharing.
                </p>
              )}
            </div>

            {/* Data Panel & Overlay Controls */}
            <div className={`pt-3.5 border-t ${dividerClass}`}>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-medium">Data Panel Overlay</span>
                  <p className={`text-[11px] ${muted}`}>
                    Include title, elapsed clock, runner counter, and finish histogram
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isRendering}
                  role="switch"
                  aria-checked={options.showDataPanel}
                  onClick={() =>
                    onChangeOptions({ showDataPanel: !options.showDataPanel })
                  }
                  className={`px-3 py-1 text-xs font-medium rounded-md border transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50 ${
                    options.showDataPanel
                      ? 'border-orange-500 bg-orange-600 text-white'
                      : optionIdle
                  }`}
                >
                  {options.showDataPanel ? 'Visible' : 'Hidden'}
                </button>
              </div>

              {options.showDataPanel && (
                <div className="mt-3 space-y-2.5">
                  {/* Position */}
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[11px] ${muted}`}>Position</span>
                    <div className={`flex items-center gap-0.5 p-0.5 rounded-lg ${segBg}`}>
                      {HUD_POSITIONS.map((pos) => (
                        <button
                          key={pos.id}
                          type="button"
                          disabled={isRendering}
                          onClick={() => onChangeOptions({ hudPosition: pos.id })}
                          className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50 ${
                            options.hudPosition === pos.id ? segActive : segIdle
                          }`}
                        >
                          {pos.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Individual Panel Sections */}
                  <div className="grid grid-cols-3 gap-2">
                    <label
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[11px] cursor-pointer select-none ${
                        options.showTitleAndDistance ? optionActive : optionIdle
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={isRendering}
                        checked={options.showTitleAndDistance}
                        onChange={(e) =>
                          onChangeOptions({
                            showTitleAndDistance: e.target.checked,
                          })
                        }
                        className="accent-orange-500"
                      />
                      <span>Title & Distance</span>
                    </label>

                    <label
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[11px] cursor-pointer select-none ${
                        options.showTimerAndCounts ? optionActive : optionIdle
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={isRendering}
                        checked={options.showTimerAndCounts}
                        onChange={(e) =>
                          onChangeOptions({
                            showTimerAndCounts: e.target.checked,
                          })
                        }
                        className="accent-orange-500"
                      />
                      <span>Clock & Counts</span>
                    </label>

                    <label
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[11px] cursor-pointer select-none ${
                        options.showHistogram ? optionActive : optionIdle
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={isRendering}
                        checked={options.showHistogram}
                        onChange={(e) =>
                          onChangeOptions({ showHistogram: e.target.checked })
                        }
                        className="accent-orange-500"
                      />
                      <span>Histogram</span>
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* Scene & Video Settings */}
            <div className={`pt-3.5 border-t space-y-3 ${dividerClass}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                  <input
                    type="checkbox"
                    disabled={isRendering}
                    checked={options.hideHomeBeacon}
                    onChange={(e) =>
                      onChangeOptions({ hideHomeBeacon: e.target.checked })
                    }
                    className="accent-orange-500"
                  />
                  <span>Hide home origin marker in export</span>
                </label>

                {isVideo && (
                  <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                    <input
                      type="checkbox"
                      disabled={isRendering}
                      checked={options.videoAutoOrbit}
                      onChange={(e) =>
                        onChangeOptions({ videoAutoOrbit: e.target.checked })
                      }
                      className="accent-orange-500"
                    />
                    <span>Slow camera orbit</span>
                  </label>
                )}
              </div>

              {isVideo && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs ${muted}`}>Clip Length</span>
                    <div className={`flex items-center gap-0.5 p-0.5 rounded-lg ${segBg}`}>
                      {VIDEO_DURATIONS.map((sec) => (
                        <button
                          key={sec}
                          type="button"
                          disabled={isRendering}
                          onClick={() =>
                            onChangeOptions({ videoDurationSec: sec })
                          }
                          className={`px-2.5 py-1 text-xs font-mono-tabular font-medium rounded-md transition-colors cursor-pointer disabled:opacity-50 ${
                            options.videoDurationSec === sec ? segActive : segIdle
                          }`}
                        >
                          {sec}s
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`text-xs ${muted}`}>Frame Rate</span>
                    <div className={`flex items-center gap-0.5 p-0.5 rounded-lg ${segBg}`}>
                      {([30, 60] as const).map((fps) => (
                        <button
                          key={fps}
                          type="button"
                          disabled={isRendering}
                          onClick={() => onChangeOptions({ videoFps: fps })}
                          className={`px-2.5 py-1 text-xs font-mono-tabular font-medium rounded-md transition-colors cursor-pointer disabled:opacity-50 ${
                            options.videoFps === fps ? segActive : segIdle
                          }`}
                        >
                          {fps} fps
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Live Aspect & Layout Composition Preview */}
          <div
            className={`rounded-xl border p-3.5 flex flex-col items-center justify-center ${
              isLight ? 'border-stone-200 bg-stone-100/70' : 'border-slate-800 bg-slate-950/60'
            }`}
          >
            <span className={`text-[11px] font-medium mb-3 ${muted}`}>
              Frame Composition
            </span>

            <div className="w-full h-52 flex items-center justify-center">
              <div
                className="relative rounded-md border overflow-hidden shadow-md transition-all duration-150"
                style={{
                  aspectRatio: String(previewAspect),
                  maxWidth: '100%',
                  maxHeight: '100%',
                  width: previewAspect >= 0.85 ? '100%' : 'auto',
                  height: previewAspect < 0.85 ? '100%' : 'auto',
                  backgroundColor: palette.backgroundCss,
                  borderColor: isLight ? '#d6d3cd' : '#334155',
                }}
              >
                {/* Stylized mini trail arc preview */}
                <svg
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  className="absolute inset-0 w-full h-full opacity-55"
                >
                  <path
                    d="M 18 72 Q 42 42 52 54 T 82 28"
                    fill="none"
                    stroke="#f97316"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                  <path
                    d="M 24 64 Q 55 74 74 44"
                    fill="none"
                    stroke="#fb923c"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    opacity="0.7"
                  />
                </svg>

                {/* Optional Data Panel schematic block */}
                {options.showDataPanel &&
                  (options.showTitleAndDistance ||
                    options.showTimerAndCounts ||
                    options.showHistogram) && (
                    <div
                      className={`absolute rounded px-2 py-1.5 border ${previewPositionClass}`}
                      style={{
                        width: previewAspect < 0.75 ? '76%' : '56%',
                        backgroundColor: isLight
                          ? 'rgba(243,240,233,0.88)'
                          : 'rgba(7,9,14,0.82)',
                        borderColor: isLight
                          ? 'rgba(0,0,0,0.12)'
                          : 'rgba(255,255,255,0.14)',
                      }}
                    >
                      {options.showTitleAndDistance && (
                        <div
                          className="h-1 w-4/5 rounded-xs mb-1 opacity-60"
                          style={{
                            backgroundColor: isLight ? '#475569' : '#94a3b8',
                          }}
                        />
                      )}
                      {options.showTimerAndCounts && (
                        <div
                          className="h-2 w-3/5 rounded-xs mb-1"
                          style={{
                            backgroundColor: isLight ? '#0f172a' : '#f8fafc',
                          }}
                        />
                      )}
                      {options.showHistogram && (
                        <div className="flex items-end gap-0.5 h-2.5 mt-1">
                          {[35, 65, 90, 55, 80, 40, 60].map((pct, i) => (
                            <span
                              key={i}
                              className="flex-1 rounded-t-[1px]"
                              style={{
                                height: `${pct}%`,
                                backgroundColor:
                                  i < 4
                                    ? '#f97316'
                                    : isLight
                                      ? 'rgba(15,23,42,0.18)'
                                      : 'rgba(255,255,255,0.2)',
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
              </div>
            </div>

            <div className={`mt-3 text-center text-[11px] font-mono-tabular ${muted}`}>
              <div>
                {width} × {height} px
              </div>
              {isVideo && (
                <div className="mt-0.5">
                  {options.videoDurationSec}s @ {options.videoFps} fps
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer Progress / Actions */}
        <div className={`mt-5 pt-4 border-t flex items-center justify-between gap-4 ${dividerClass}`}>
          {isRendering ? (
            <div className="flex-1 flex items-center gap-3">
              <div className="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-orange-500 transition-all duration-150"
                  style={{ width: `${exportProgress}%` }}
                />
              </div>
              <span className="text-xs font-mono-tabular shrink-0">
                Rendering {exportProgress}%
              </span>
              <button
                type="button"
                onClick={onCancelVideo}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border cursor-pointer transition-colors whitespace-nowrap shrink-0 ${optionIdle}`}
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <span className={`text-xs ${muted}`}>
                {isVideo
                  ? 'Renders synchronized 00:00:00 → finish WebM animation'
                  : 'Captures current playback timestamp as crisp PNG'}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={onClose}
                  className={`px-3.5 py-2 text-xs font-medium rounded-lg border cursor-pointer transition-colors whitespace-nowrap ${optionIdle}`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isVideo && activityCount === 0}
                  onClick={onConfirmExport}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-orange-600 text-white hover:bg-orange-500 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  {isVideo ? (
                    <>
                      <Film className="w-3.5 h-3.5" />
                      <span>Render Video</span>
                    </>
                  ) : (
                    <>
                      <Camera className="w-3.5 h-3.5" />
                      <span>Save PNG Snapshot</span>
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
