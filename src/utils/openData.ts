import type { ElevationGrid, SpatialBounds, StreetNetwork } from '../types/activity';
import { latLonToMeters } from './geo';

function lonToTileX(lon: number, zoom: number): number {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}

function latToTileY(lat: number, zoom: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) *
      Math.pow(2, zoom),
  );
}

function tileXToLon(x: number, zoom: number): number {
  return (x / Math.pow(2, zoom)) * 360 - 180;
}

function tileYToLat(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, zoom);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function loadTileImage(url: string, timeoutMs = 4500): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = window.setTimeout(() => {
      img.src = '';
      reject(new Error('Tile timeout'));
    }, timeoutMs);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('Tile failed'));
    };
    img.src = url;
  });
}

/**
 * Fetches real elevation terrain from AWS Mapzen Terrarium tiles
 * (free, no API key required, CORS-enabled).
 */
export async function fetchTerrariumElevation(
  bounds: SpatialBounds,
  homeLat: number,
  homeLon: number,
  cols = 96,
  rows = 96,
): Promise<ElevationGrid | null> {
  try {
    // Pick zoom level so bounding box spans ~2-4 tiles
    let zoom = 12;
    for (let z = 14; z >= 9; z--) {
      const txMin = lonToTileX(bounds.minLon, z);
      const txMax = lonToTileX(bounds.maxLon, z);
      const tyMin = latToTileY(bounds.maxLat, z);
      const tyMax = latToTileY(bounds.minLat, z);
      const count = (txMax - txMin + 1) * (tyMax - tyMin + 1);
      if (count <= 9) {
        zoom = z;
        break;
      }
    }

    const txMin = lonToTileX(bounds.minLon, zoom);
    const txMax = lonToTileX(bounds.maxLon, zoom);
    const tyMin = latToTileY(bounds.maxLat, zoom);
    const tyMax = latToTileY(bounds.minLat, zoom);

    const tilesX = txMax - txMin + 1;
    const tilesY = tyMax - tyMin + 1;
    if (tilesX <= 0 || tilesY <= 0 || tilesX * tilesY > 12) return null;

    const canvas = document.createElement('canvas');
    canvas.width = tilesX * 256;
    canvas.height = tilesY * 256;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    const jobs: Array<Promise<void>> = [];
    for (let ty = tyMin; ty <= tyMax; ty++) {
      for (let tx = txMin; tx <= txMax; tx++) {
        const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${tx}/${ty}.png`;
        jobs.push(
          loadTileImage(url).then((img) => {
            ctx.drawImage(img, (tx - txMin) * 256, (ty - tyMin) * 256);
          }),
        );
      }
    }

    await Promise.all(jobs);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    const gridMinLon = tileXToLon(txMin, zoom);
    const gridMaxLon = tileXToLon(txMax + 1, zoom);
    const gridMaxLat = tileYToLat(tyMin, zoom);
    const gridMinLat = tileYToLat(tyMax + 1, zoom);

    const elevations = new Float32Array(cols * rows);
    let minEle = Infinity;
    let maxEle = -Infinity;

    for (let r = 0; r < rows; r++) {
      const tz = r / (rows - 1);
      const worldZ = bounds.minZ + tz * (bounds.maxZ - bounds.minZ);
      for (let c = 0; c < cols; c++) {
        const tx = c / (cols - 1);
        const worldX = bounds.minX + tx * (bounds.maxX - bounds.minX);

        // Inverse project back to lat/lon
        const latScale = 111320;
        const lonScale = 111320 * Math.cos((homeLat * Math.PI) / 180);
        const lat = homeLat - worldZ / latScale;
        const lon = homeLon + worldX / lonScale;

        const u = Math.max(
          0,
          Math.min(1, (lon - gridMinLon) / (gridMaxLon - gridMinLon)),
        );
        const v = Math.max(
          0,
          Math.min(1, (gridMaxLat - lat) / (gridMaxLat - gridMinLat)),
        );

        const px = Math.min(canvas.width - 1, Math.floor(u * (canvas.width - 1)));
        const py = Math.min(
          canvas.height - 1,
          Math.floor(v * (canvas.height - 1)),
        );
        const offset = (py * canvas.width + px) * 4;
        const R = imgData[offset];
        const G = imgData[offset + 1];
        const B = imgData[offset + 2];
        const ele = R * 256 + G + B / 256 - 32768;

        elevations[r * cols + c] = ele;
        if (ele < minEle) minEle = ele;
        if (ele > maxEle) maxEle = ele;
      }
    }

    return {
      cols,
      rows,
      minX: bounds.minX,
      maxX: bounds.maxX,
      minZ: bounds.minZ,
      maxZ: bounds.maxZ,
      elevations,
      minEle,
      maxEle,
      source: 'terrarium',
    };
  } catch {
    return null;
  }
}

const osmStreetCache = new Map<string, StreetNetwork>();
const basemapTileCache = new Map<string, BasemapTileResult>();
const streetOverlayCache = new Map<string, BasemapTileResult>();

/**
 * Fetches OpenStreetMap road/path network via Overpass API (with mirror fallback)
 * for the active bounding box.
 */
export async function fetchOsmStreets(
  bounds: SpatialBounds,
  homeLat: number,
  homeLon: number,
): Promise<StreetNetwork> {
  // Clamp query span to prevent massive Overpass responses on global datasets
  const latSpan = bounds.maxLat - bounds.minLat;
  const lonSpan = bounds.maxLon - bounds.minLon;
  if (latSpan > 0.6 || lonSpan > 0.75) {
    return { polylines: [], source: 'none' };
  }

  const bbox = `${bounds.minLat.toFixed(4)},${bounds.minLon.toFixed(4)},${bounds.maxLat.toFixed(4)},${bounds.maxLon.toFixed(4)}`;
  const cacheKey = `${bbox}|${homeLat.toFixed(4)},${homeLon.toFixed(4)}`;
  const cached = osmStreetCache.get(cacheKey);
  if (cached) return cached;

  const query = `[out:json][timeout:8];(way["highway"~"motorway|trunk|primary|secondary|tertiary|residential|unclassified|cycleway|footway|track|path"](${bbox}););out geom;`;
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8500);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        signal: controller.signal,
      });

      if (!res.ok) continue;

      const json = (await res.json()) as {
        elements?: Array<{
          type: string;
          geometry?: Array<{ lat: number; lon: number }>;
        }>;
      };

      const polylines: Array<Array<{ x: number; z: number }>> = [];
      for (const el of json.elements ?? []) {
        if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
        const line: Array<{ x: number; z: number }> = [];
        for (const node of el.geometry) {
          line.push(latLonToMeters(node.lat, node.lon, homeLat, homeLon));
        }
        polylines.push(line);
      }

      if (polylines.length > 0) {
        const result: StreetNetwork = { polylines, source: 'osm' };
        osmStreetCache.set(cacheKey, result);
        return result;
      }
    } catch {
      // Try next Overpass mirror
    } finally {
      window.clearTimeout(timeout);
    }
  }

  return { polylines: [], source: 'none' };
}

export interface BasemapTileResult {
  canvas: HTMLCanvasElement;
  minLon: number;
  maxLon: number;
  mercMinY: number;
  mercMaxY: number;
}

export function latToMercatorY(lat: number): number {
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
  const rad = (clamped * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + rad / 2));
}

function tileYToMercatorY(y: number, zoom: number): number {
  return Math.PI * (1 - (2 * y) / Math.pow(2, zoom));
}

export async function fetchBasemapTiles(
  bounds: SpatialBounds,
  style: 'dark-map' | 'light-map' | 'satellite' | 'satellite-streets',
  showStreets = true,
): Promise<BasemapTileResult | null> {
  const effectiveSatStreets =
    style === 'satellite-streets' || (style === 'satellite' && showStreets);
  const tileCacheKey = `${style}|${showStreets ? '1' : '0'}|${bounds.minLat.toFixed(4)},${bounds.minLon.toFixed(4)},${bounds.maxLat.toFixed(4)},${bounds.maxLon.toFixed(4)}`;
  const cachedTiles = basemapTileCache.get(tileCacheKey);
  if (cachedTiles) return cachedTiles;

  try {
    const isSat = style === 'satellite' || style === 'satellite-streets';
    const tilePx = 256;
    const maxTiles = isSat && !effectiveSatStreets ? 100 : 64;

    let zoom = 13;
    for (let z = 16; z >= 9; z--) {
      const txMin = lonToTileX(bounds.minLon, z);
      const txMax = lonToTileX(bounds.maxLon, z);
      const tyMin = latToTileY(bounds.maxLat, z);
      const tyMax = latToTileY(bounds.minLat, z);
      const tilesX = txMax - txMin + 1;
      const tilesY = tyMax - tyMin + 1;
      const count = tilesX * tilesY;
      if (count <= maxTiles && tilesX * tilePx <= 4096 && tilesY * tilePx <= 4096) {
        zoom = z;
        break;
      }
    }

    const txMin = lonToTileX(bounds.minLon, zoom);
    const txMax = lonToTileX(bounds.maxLon, zoom);
    const tyMin = latToTileY(bounds.maxLat, zoom);
    const tyMax = latToTileY(bounds.minLat, zoom);

    const tilesX = txMax - txMin + 1;
    const tilesY = tyMax - tyMin + 1;
    if (tilesX <= 0 || tilesY <= 0 || tilesX * tilesY > 100) return null;

    const canvas = document.createElement('canvas');
    canvas.width = tilesX * tilePx;
    canvas.height = tilesY * tilePx;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const baseJobs: Array<Promise<boolean>> = [];

    for (let ty = tyMin; ty <= tyMax; ty++) {
      for (let tx = txMin; tx <= txMax; tx++) {
        let url = '';
        if (style === 'dark-map') {
          url = `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${zoom}/${ty}/${tx}`;
        } else if (style === 'light-map') {
          url = `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/${zoom}/${ty}/${tx}`;
        } else {
          url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`;
        }

        baseJobs.push(
          loadTileImage(url, 7500)
            .then((img) => {
              ctx.drawImage(
                img,
                (tx - txMin) * tilePx,
                (ty - tyMin) * tilePx,
                tilePx,
                tilePx,
              );
              return true;
            })
            .catch(() => false),
        );
      }
    }

    const baseResults = await Promise.all(baseJobs);
    if (!baseResults.some(Boolean)) return null;

    // Composite roads (without place/city labels) over satellite imagery when + Streets is active
    if (effectiveSatStreets) {
      interface LoadedOverlay {
        img: HTMLImageElement | null;
        dx: number;
        dy: number;
      }
      const roadPromises: Array<Promise<LoadedOverlay>> = [];

      for (let ty = tyMin; ty <= tyMax; ty++) {
        for (let tx = txMin; tx <= txMax; tx++) {
          const dx = (tx - txMin) * tilePx;
          const dy = (ty - tyMin) * tilePx;
          const roadUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/${zoom}/${ty}/${tx}`;

          roadPromises.push(
            loadTileImage(roadUrl, 6000)
              .then((img) => ({ img, dx, dy }))
              .catch(() => ({ img: null, dx, dy })),
          );
        }
      }

      const roads = await Promise.all(roadPromises);
      for (const item of roads) {
        if (item.img) ctx.drawImage(item.img, item.dx, item.dy, tilePx, tilePx);
      }
    }

    const result: BasemapTileResult = {
      canvas,
      minLon: tileXToLon(txMin, zoom),
      maxLon: tileXToLon(txMax + 1, zoom),
      mercMaxY: tileYToMercatorY(tyMin, zoom),
      mercMinY: tileYToMercatorY(tyMax + 1, zoom),
    };
    basemapTileCache.set(tileCacheKey, result);
    return result;
  } catch {
    return null;
  }
}

/**
 * Fetches a transparent raster street + street-label overlay canvas
 * (ArcGIS World Transportation + Boundaries/Places) so streets can be
 * cleanly draped on 3D Relief, Grid, Minimal, or any basemap reliably.
 */
export async function fetchStreetOverlayTiles(
  bounds: SpatialBounds,
): Promise<BasemapTileResult | null> {
  const cacheKey = `${bounds.minLat.toFixed(4)},${bounds.minLon.toFixed(4)},${bounds.maxLat.toFixed(4)},${bounds.maxLon.toFixed(4)}`;
  const cached = streetOverlayCache.get(cacheKey);
  if (cached) return cached;

  try {
    const tilePx = 256;
    const maxTiles = 64;

    let zoom = 13;
    for (let z = 17; z >= 9; z--) {
      const txMin = lonToTileX(bounds.minLon, z);
      const txMax = lonToTileX(bounds.maxLon, z);
      const tyMin = latToTileY(bounds.maxLat, z);
      const tyMax = latToTileY(bounds.minLat, z);
      const tilesX = txMax - txMin + 1;
      const tilesY = tyMax - tyMin + 1;
      if (tilesX * tilesY <= maxTiles) {
        zoom = z;
        break;
      }
    }

    const txMin = lonToTileX(bounds.minLon, zoom);
    const txMax = lonToTileX(bounds.maxLon, zoom);
    const tyMin = latToTileY(bounds.maxLat, zoom);
    const tyMax = latToTileY(bounds.minLat, zoom);
    const tilesX = txMax - txMin + 1;
    const tilesY = tyMax - tyMin + 1;
    if (tilesX <= 0 || tilesY <= 0 || tilesX * tilesY > 81) return null;

    const canvas = document.createElement('canvas');
    canvas.width = tilesX * tilePx;
    canvas.height = tilesY * tilePx;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    interface LoadedOverlay {
      img: HTMLImageElement | null;
      dx: number;
      dy: number;
    }
    const roadPromises: Array<Promise<LoadedOverlay>> = [];

    for (let ty = tyMin; ty <= tyMax; ty++) {
      for (let tx = txMin; tx <= txMax; tx++) {
        const dx = (tx - txMin) * tilePx;
        const dy = (ty - tyMin) * tilePx;
        const roadUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/${zoom}/${ty}/${tx}`;

        roadPromises.push(
          loadTileImage(roadUrl, 6000)
            .then((img) => ({ img, dx, dy }))
            .catch(() => ({ img: null, dx, dy })),
        );
      }
    }

    const roads = await Promise.all(roadPromises);

    let anyDrawn = false;
    for (const item of roads) {
      if (item.img) {
        ctx.drawImage(item.img, item.dx, item.dy, tilePx, tilePx);
        anyDrawn = true;
      }
    }

    if (!anyDrawn) return null;

    const result: BasemapTileResult = {
      canvas,
      minLon: tileXToLon(txMin, zoom),
      maxLon: tileXToLon(txMax + 1, zoom),
      mercMaxY: tileYToMercatorY(tyMin, zoom),
      mercMinY: tileYToMercatorY(tyMax + 1, zoom),
    };
    streetOverlayCache.set(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}

