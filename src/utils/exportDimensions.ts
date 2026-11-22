import type { AspectRatioPreset, ResolutionTier } from '../types/activity';

export interface AspectPresetMeta {
  id: AspectRatioPreset;
  label: string;
  platformHint: string;
  ratioW: number;
  ratioH: number;
}

export const ASPECT_RATIO_PRESETS: AspectPresetMeta[] = [
  {
    id: '16:9',
    label: '16:9',
    platformHint: 'YouTube / Desktop',
    ratioW: 16,
    ratioH: 9,
  },
  {
    id: '9:16',
    label: '9:16',
    platformHint: 'Reels / TikTok / Shorts',
    ratioW: 9,
    ratioH: 16,
  },
  {
    id: '4:5',
    label: '4:5',
    platformHint: 'Instagram Feed',
    ratioW: 4,
    ratioH: 5,
  },
  {
    id: '1:1',
    label: '1:1',
    platformHint: 'Square Post',
    ratioW: 1,
    ratioH: 1,
  },
  {
    id: '4:3',
    label: '4:3',
    platformHint: 'Presentation',
    ratioW: 4,
    ratioH: 3,
  },
  {
    id: 'viewport',
    label: 'Window',
    platformHint: 'Match Screen',
    ratioW: 16,
    ratioH: 10,
  },
];

export const RESOLUTION_TIERS: Array<{
  id: ResolutionTier;
  label: string;
  shortEdgePx: number;
}> = [
  { id: '720p', label: '720p HD', shortEdgePx: 720 },
  { id: '1080p', label: '1080p FHD', shortEdgePx: 1080 },
  { id: '1440p', label: '1440p QHD', shortEdgePx: 1440 },
  { id: '4k', label: '4K UHD', shortEdgePx: 2160 },
];

function makeEven(n: number): number {
  const rounded = Math.max(2, Math.round(n));
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

export function resolveExportDimensions(
  aspectRatio: AspectRatioPreset,
  resolution: ResolutionTier,
  viewportWidth = 1440,
  viewportHeight = 900,
): { width: number; height: number } {
  const tier = RESOLUTION_TIERS.find((t) => t.id === resolution) ?? RESOLUTION_TIERS[1];
  const shortPx = tier.shortEdgePx;

  let ratio = 16 / 9;
  if (aspectRatio === 'viewport') {
    ratio = Math.max(0.25, Math.min(4, viewportWidth / Math.max(1, viewportHeight)));
  } else {
    const preset = ASPECT_RATIO_PRESETS.find((p) => p.id === aspectRatio);
    if (preset) {
      ratio = preset.ratioW / preset.ratioH;
    }
  }

  if (ratio >= 1) {
    return {
      width: makeEven(shortPx * ratio),
      height: makeEven(shortPx),
    };
  }
  return {
    width: makeEven(shortPx),
    height: makeEven(shortPx / ratio),
  };
}
