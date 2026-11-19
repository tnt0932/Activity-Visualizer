import { useMemo, useRef } from 'react';

interface DateRangeScrubberProps {
  timestamps: number[];
  startMs: number | null;
  endMs: number | null;
  isLight: boolean;
  onChange: (startMs: number | null, endMs: number | null) => void;
}

const BUCKET_COUNT = 40;

function formatShortDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
  });
}

export function DateRangeScrubber({
  timestamps,
  startMs,
  endMs,
  isLight,
  onChange,
}: DateRangeScrubberProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);

  const { minMs, maxMs, buckets, maxCount } = useMemo(() => {
    const valid = timestamps.filter((t) => Number.isFinite(t));
    if (valid.length === 0) {
      return { minMs: 0, maxMs: 0, buckets: [] as number[], maxCount: 1 };
    }
    let min = Infinity;
    let max = -Infinity;
    for (const t of valid) {
      if (t < min) min = t;
      if (t > max) max = t;
    }
    // Ensure at least a 1-day span so single-day datasets still render cleanly
    if (max <= min) {
      max = min + 86_400_000;
    }
    const span = max - min;
    const counts = new Array<number>(BUCKET_COUNT).fill(0);
    for (const t of valid) {
      const idx = Math.min(
        BUCKET_COUNT - 1,
        Math.max(0, Math.floor(((t - min) / span) * BUCKET_COUNT)),
      );
      counts[idx]++;
    }
    const peak = Math.max(1, ...counts);
    return { minMs: min, maxMs: max, buckets: counts, maxCount: peak };
  }, [timestamps]);

  if (buckets.length === 0 || maxMs <= minMs) {
    return null;
  }

  const span = maxMs - minMs;
  const activeStart =
    startMs !== null ? Math.max(minMs, Math.min(maxMs, startMs)) : minMs;
  const activeEnd =
    endMs !== null ? Math.max(activeStart, Math.min(maxMs, endMs)) : maxMs;

  const startPct = ((activeStart - minMs) / span) * 100;
  const endPct = ((activeEnd - minMs) / span) * 100;
  const isFiltered = startMs !== null || endMs !== null;

  const clientXToMs = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return minMs;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(minMs + ratio * span);
  };

  const beginDrag = (
    e: React.PointerEvent,
    mode: 'start' | 'end' | 'window',
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const originX = e.clientX;
    const initStart = activeStart;
    const initEnd = activeEnd;
    const windowSpan = initEnd - initStart;
    const minGap = Math.max(86_400_000, span * 0.02);

    const onMove = (ev: PointerEvent) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;

      if (mode === 'window') {
        const deltaRatio = (ev.clientX - originX) / rect.width;
        const deltaMs = deltaRatio * span;
        let nextStart = initStart + deltaMs;
        let nextEnd = initEnd + deltaMs;
        if (nextStart < minMs) {
          nextStart = minMs;
          nextEnd = minMs + windowSpan;
        }
        if (nextEnd > maxMs) {
          nextEnd = maxMs;
          nextStart = maxMs - windowSpan;
        }
        onChange(Math.round(nextStart), Math.round(nextEnd));
      } else if (mode === 'start') {
        const raw = clientXToMs(ev.clientX);
        const clamped = Math.min(raw, activeEnd - minGap);
        const nextStart = clamped <= minMs + span * 0.005 ? null : clamped;
        const nextEnd = activeEnd >= maxMs - span * 0.005 ? null : activeEnd;
        onChange(nextStart, nextEnd);
      } else {
        const raw = clientXToMs(ev.clientX);
        const clamped = Math.max(raw, activeStart + minGap);
        const nextStart =
          activeStart <= minMs + span * 0.005 ? null : activeStart;
        const nextEnd = clamped >= maxMs - span * 0.005 ? null : clamped;
        onChange(nextStart, nextEnd);
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleTrackPointerDown = (e: React.PointerEvent) => {
    const clickedMs = clientXToMs(e.clientX);
    const distToStart = Math.abs(clickedMs - activeStart);
    const distToEnd = Math.abs(clickedMs - activeEnd);
    const mode = distToStart <= distToEnd ? 'start' : 'end';
    const minGap = Math.max(86_400_000, span * 0.02);
    if (mode === 'start') {
      const clamped = Math.min(clickedMs, activeEnd - minGap);
      onChange(
        clamped <= minMs + span * 0.005 ? null : clamped,
        endMs,
      );
    } else {
      const clamped = Math.max(clickedMs, activeStart + minGap);
      onChange(
        startMs,
        clamped >= maxMs - span * 0.005 ? null : clamped,
      );
    }
    beginDrag(e, mode);
  };

  const mutedText = isLight ? 'text-slate-600' : 'text-slate-400';
  const trackBg = isLight
    ? 'bg-stone-200/70 border-stone-300'
    : 'bg-slate-900/90 border-slate-800';
  const dimBar = isLight ? 'bg-stone-400/45' : 'bg-slate-700/65';
  const activeBar = isLight ? 'bg-orange-600' : 'bg-orange-500';
  const windowFill = isLight ? 'bg-orange-500/12' : 'bg-orange-500/15';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className={`font-medium ${mutedText}`}>Activity Dates</span>
        <div className="flex items-center gap-2">
          <span className="font-mono-tabular text-[11px]">
            {formatShortDate(activeStart)} – {formatShortDate(activeEnd)}
          </span>
          {isFiltered && (
            <button
              type="button"
              onClick={() => onChange(null, null)}
              className="text-[11px] text-orange-500 hover:text-orange-400 cursor-pointer whitespace-nowrap shrink-0"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Interactive Date Distribution Histogram + Range Window */}
      <div
        ref={trackRef}
        onPointerDown={handleTrackPointerDown}
        className={`relative h-9 w-full rounded-lg border px-1.5 py-1 select-none touch-none cursor-pointer ${trackBg}`}
      >
        {/* Distribution Bars */}
        <div className="flex items-end gap-[2px] w-full h-full pointer-events-none">
          {buckets.map((count, i) => {
            const bucketStart = minMs + (i / BUCKET_COUNT) * span;
            const bucketEnd = minMs + ((i + 1) / BUCKET_COUNT) * span;
            const inRange =
              bucketEnd >= activeStart && bucketStart <= activeEnd;
            const heightPct =
              count === 0 ? 6 : Math.max(16, (count / maxCount) * 100);
            return (
              <div
                key={i}
                className={`flex-1 rounded-t-[1px] transition-colors ${
                  inRange ? activeBar : dimBar
                }`}
                style={{
                  height: `${heightPct}%`,
                  opacity: count === 0 ? 0.25 : inRange ? 0.95 : 0.45,
                }}
              />
            );
          })}
        </div>

        {/* Selected Range Window (draggable to scrub time window) */}
        <div
          onPointerDown={(e) => beginDrag(e, 'window')}
          title="Drag to scrub date window"
          className={`absolute inset-y-0 border-x border-orange-500/80 cursor-grab active:cursor-grabbing ${windowFill}`}
          style={{
            left: `${startPct}%`,
            width: `${Math.max(1, endPct - startPct)}%`,
          }}
        />

        {/* Left Start Handle */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Filter start date"
          aria-valuemin={minMs}
          aria-valuemax={maxMs}
          aria-valuenow={activeStart}
          onPointerDown={(e) => beginDrag(e, 'start')}
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-6 rounded-xs bg-orange-500 border border-white/80 shadow cursor-ew-resize hover:bg-orange-400"
          style={{ left: `${startPct}%` }}
        />

        {/* Right End Handle */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Filter end date"
          aria-valuemin={minMs}
          aria-valuemax={maxMs}
          aria-valuenow={activeEnd}
          onPointerDown={(e) => beginDrag(e, 'end')}
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-6 rounded-xs bg-orange-500 border border-white/80 shadow cursor-ew-resize hover:bg-orange-400"
          style={{ left: `${endPct}%` }}
        />
      </div>
    </div>
  );
}
