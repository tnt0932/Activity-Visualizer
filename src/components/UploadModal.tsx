import { FileArchive, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { PaletteConfig, ParseProgress } from '../types/activity';

interface UploadModalProps {
  isOpen: boolean;
  palette: PaletteConfig;
  progress: ParseProgress | null;
  errorMessage: string | null;
  onClose: () => void;
  onFilesSelected: (files: FileList | File[]) => void;
  onLoadSample: () => void;
}

export function UploadModal({
  isOpen,
  palette,
  progress,
  errorMessage,
  onClose,
  onFilesSelected,
  onLoadSample,
}: UploadModalProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const isLight = palette.isLight;
  const cardBg = isLight
    ? 'bg-[#F8F6F0] border-stone-300 text-slate-900'
    : 'bg-[#0E121B] border-slate-800 text-slate-100';
  const muted = isLight ? 'text-slate-600' : 'text-slate-400';
  const dropZoneBorder = isDragging
    ? 'border-orange-500 bg-orange-500/10'
    : isLight
      ? 'border-stone-300 bg-stone-100/60 hover:border-orange-500/70'
      : 'border-slate-700 bg-slate-900/60 hover:border-orange-500/70';

  const isParsing = progress !== null && progress.phase !== 'done';
  const pct =
    progress && progress.total > 0
      ? Math.round((progress.processed / progress.total) * 100)
      : 0;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-modal-title"
    >
      <div
        className={`w-full max-w-lg rounded-xl border p-6 shadow-2xl ${cardBg}`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="upload-modal-title"
              className="font-display text-xl font-semibold tracking-tight"
            >
              Load Strava Activity Archive
            </h2>
            <p className={`mt-1 text-sm ${muted}`}>
              All GPS tracks are decoded locally in your browser. Nothing is uploaded to a server.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close upload dialog"
            className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
              isLight ? 'hover:bg-stone-200 text-slate-600' : 'hover:bg-slate-800 text-slate-400'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer.files.length > 0) {
              onFilesSelected(e.dataTransfer.files);
            }
          }}
          onClick={() => !isParsing && inputRef.current?.click()}
          className={`mt-5 flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-9 text-center transition-colors cursor-pointer ${dropZoneBorder}`}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".zip,.gpx,.tcx,.fit,.gz"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                onFilesSelected(e.target.files);
              }
            }}
          />

          {isParsing ? (
            <div className="w-full max-w-xs">
              <FileArchive className="w-8 h-8 text-orange-500 mx-auto" />
              <p className="mt-3 text-sm font-medium">
                {progress.phase === 'reading'
                  ? 'Reading ZIP archive...'
                  : `Decoding ${progress.processed} / ${progress.total} files`}
              </p>
              {progress.currentFile && (
                <p className={`mt-1 text-xs truncate font-mono-tabular ${muted}`}>
                  {progress.currentFile}
                </p>
              )}
              <div className="mt-3 h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-orange-500 transition-all duration-150"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          ) : (
            <>
              <Upload className="w-8 h-8 text-orange-500" />
              <p className="mt-3 text-sm font-semibold">
                Drop your Strava export .zip or activity files here
              </p>
              <p className={`mt-1 text-xs ${muted}`}>
                Supports Strava bulk archives (activities.csv + .fit.gz / .gpx / .tcx) or individual GPS tracks
              </p>
            </>
          )}
        </div>

        {errorMessage && (
          <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-400">
            {errorMessage}
          </div>
        )}

        <div className={`mt-5 pt-4 border-t text-xs ${muted} ${isLight ? 'border-stone-200' : 'border-slate-800'}`}>
          <p className="font-medium text-current">How to export from Strava</p>
          <p className="mt-1 leading-relaxed">
            Open Strava on desktop → Settings → My Account → Download or Delete Your Account → Get Started → Request Your Archive. Drop the resulting <span className="font-mono-tabular">export_*.zip</span> directly above.
          </p>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onLoadSample}
            disabled={isParsing}
            className={`px-3 py-2 text-xs font-medium rounded-lg border cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
              isLight
                ? 'border-stone-300 text-slate-700 hover:bg-stone-200'
                : 'border-slate-700 text-slate-300 hover:bg-slate-800'
            }`}
          >
            Load Sample City Runs
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-orange-600 text-white hover:bg-orange-500 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
