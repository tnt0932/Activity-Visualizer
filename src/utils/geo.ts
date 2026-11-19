import type {
  ElevationGrid,
  ParsedActivity,
  ProjectedActivity,
  SpatialBounds,
} from '../types/activity';

const EARTH_RADIUS_M = 6371000;

export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * toRad) *
      Math.cos(lat2 * toRad) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

export function latLonToMeters(
  lat: number,
  lon: number,
  homeLat: number,
  homeLon: number,
): { x: number; z: number } {
  const latScale = 111320;
  const lonScale = 111320 * Math.cos((homeLat * Math.PI) / 180);
  return {
    x: (lon - homeLon) * lonScale,
    z: -(lat - homeLat) * latScale, // North is -Z in Three.js top-down
  };
}

export function metersToLatLon(
  x: number,
  z: number,
  homeLat: number,
  homeLon: number,
): { lat: number; lon: number } {
  const latScale = 111320;
  const lonScale = 111320 * Math.cos((homeLat * Math.PI) / 180);
  return {
    lat: homeLat - z / latScale,
    lon: homeLon + x / lonScale,
  };
}

/**
 * Finds the densest cluster of activity start points (~400m grid bin)
 * and returns its median coordinate as the detected Home Origin.
 */
export function detectHomeOrigin(activities: ParsedActivity[]): {
  lat: number;
  lon: number;
} {
  if (activities.length === 0) {
    return { lat: 37.7749, lon: -122.4194 };
  }

  const binDeg = 0.004; // ~400m
  const bins = new Map<string, ParsedActivity[]>();

  for (const act of activities) {
    const keyLat = Math.round(act.startLat / binDeg);
    const keyLon = Math.round(act.startLon / binDeg);
    const key = `${keyLat},${keyLon}`;
    const list = bins.get(key);
    if (list) list.push(act);
    else bins.set(key, [act]);
  }

  let bestCluster: ParsedActivity[] = [];
  for (const list of bins.values()) {
    if (list.length > bestCluster.length) {
      bestCluster = list;
    }
  }

  const lats = bestCluster.map((a) => a.startLat).sort((a, b) => a - b);
  const lons = bestCluster.map((a) => a.startLon).sort((a, b) => a - b);
  const mid = Math.floor(bestCluster.length / 2);

  return {
    lat: lats[mid],
    lon: lons[mid],
  };
}

export function projectActivities(
  activities: ParsedActivity[],
  homeLat: number,
  homeLon: number,
): ProjectedActivity[] {
  return activities.map((act, idx) => {
    const distFromHomeM = haversineMeters(
      act.startLat,
      act.startLon,
      homeLat,
      homeLon,
    );

    const projectedPoints = act.points.map((pt) => {
      const { x, z } = latLonToMeters(pt.lat, pt.lon, homeLat, homeLon);
      return { ...pt, x, z };
    });

    return {
      ...act,
      points: projectedPoints,
      distFromHomeM,
      colorIndex: idx,
    };
  });
}

export function computeSpatialBounds(
  activities: ProjectedActivity[],
  homeLat: number,
  homeLon: number,
): SpatialBounds {
  if (activities.length === 0) {
    const half = 2000;
    const nw = metersToLatLon(-half, -half, homeLat, homeLon);
    const se = metersToLatLon(half, half, homeLat, homeLon);
    return {
      minX: -half,
      maxX: half,
      minZ: -half,
      maxZ: half,
      minLat: se.lat,
      maxLat: nw.lat,
      minLon: nw.lon,
      maxLon: se.lon,
      radiusM: half,
    };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const act of activities) {
    for (const pt of act.points) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.z < minZ) minZ = pt.z;
      if (pt.z > maxZ) maxZ = pt.z;
    }
  }

  const spanX = Math.max(800, maxX - minX);
  const spanZ = Math.max(800, maxZ - minZ);
  const pad = Math.max(spanX, spanZ) * 0.16;

  // Keep terrain centered/square enough for nice cinematic framing
  const halfSpan = Math.max(
    Math.abs(minX - pad),
    Math.abs(maxX + pad),
    Math.abs(minZ - pad),
    Math.abs(maxZ + pad),
    900,
  );

  const clampedHalf = Math.min(halfSpan, 45000);
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const halfBox = Math.max(spanX, spanZ) / 2 + pad;

  const boxMinX = centerX - halfBox;
  const boxMaxX = centerX + halfBox;
  const boxMinZ = centerZ - halfBox;
  const boxMaxZ = centerZ + halfBox;

  const nw = metersToLatLon(boxMinX, boxMinZ, homeLat, homeLon);
  const se = metersToLatLon(boxMaxX, boxMaxZ, homeLat, homeLon);

  return {
    minX: boxMinX,
    maxX: boxMaxX,
    minZ: boxMinZ,
    maxZ: boxMaxZ,
    minLat: se.lat,
    maxLat: nw.lat,
    minLon: nw.lon,
    maxLon: se.lon,
    radiusM: Math.min(clampedHalf, halfBox),
  };
}

export interface InterpolatedSample {
  x: number;
  z: number;
  ele: number;
  dist: number;
  headingRad: number;
  active: boolean;
  finished: boolean;
  /** Index of the last point <= t */
  segmentIndex: number;
  /** Fraction [0..1] between segmentIndex and segmentIndex + 1 */
  segmentAlpha: number;
}

export function interpolateActivityAtTime(
  activity: ProjectedActivity,
  t: number,
): InterpolatedSample {
  const pts = activity.points;
  const n = pts.length;
  if (n === 0) {
    return {
      x: 0,
      z: 0,
      ele: 0,
      dist: 0,
      headingRad: 0,
      active: false,
      finished: true,
      segmentIndex: 0,
      segmentAlpha: 0,
    };
  }

  if (t <= 0) {
    const p0 = pts[0];
    const p1 = pts[Math.min(1, n - 1)];
    return {
      x: p0.x,
      z: p0.z,
      ele: p0.ele,
      dist: 0,
      headingRad: Math.atan2(p1.x - p0.x, p1.z - p0.z),
      active: t >= 0 && activity.durationSec > 0,
      finished: false,
      segmentIndex: 0,
      segmentAlpha: 0,
    };
  }

  if (t >= activity.durationSec || n === 1) {
    const last = pts[n - 1];
    const prev = pts[Math.max(0, n - 2)];
    return {
      x: last.x,
      z: last.z,
      ele: last.ele,
      dist: activity.distanceM,
      headingRad: Math.atan2(last.x - prev.x, last.z - prev.z),
      active: false,
      finished: true,
      segmentIndex: n - 1,
      segmentAlpha: 0,
    };
  }

  // Binary search for largest i with pts[i].t <= t
  let lo = 0;
  let hi = n - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].t <= t) lo = mid;
    else hi = mid;
  }

  const a = pts[lo];
  const b = pts[Math.min(lo + 1, n - 1)];
  const dt = b.t - a.t;
  const alpha = dt > 0 ? Math.max(0, Math.min(1, (t - a.t) / dt)) : 0;

  return {
    x: a.x + (b.x - a.x) * alpha,
    z: a.z + (b.z - a.z) * alpha,
    ele: a.ele + (b.ele - a.ele) * alpha,
    dist: a.dist + (b.dist - a.dist) * alpha,
    headingRad: Math.atan2(b.x - a.x, b.z - a.z),
    active: true,
    finished: false,
    segmentIndex: lo,
    segmentAlpha: alpha,
  };
}

/**
 * Generates an instant smoothed topographic elevation grid directly from
 * GPS track elevations using spatial binning + diffusion smoothing so
 * 3D terrain relief renders immediately with zero external dependencies.
 */
export function buildFallbackElevationGrid(
  activities: ProjectedActivity[],
  bounds: SpatialBounds,
  cols = 80,
  rows = 80,
): ElevationGrid {
  const elevations = new Float32Array(cols * rows);
  const weights = new Float32Array(cols * rows);

  const width = Math.max(1, bounds.maxX - bounds.minX);
  const depth = Math.max(1, bounds.maxZ - bounds.minZ);

  let sumEle = 0;
  let countEle = 0;

  for (const act of activities) {
    const step = Math.max(1, Math.floor(act.points.length / 180));
    for (let i = 0; i < act.points.length; i += step) {
      const pt = act.points[i];
      if (!Number.isFinite(pt.ele)) continue;
      sumEle += pt.ele;
      countEle++;

      const gx = ((pt.x - bounds.minX) / width) * (cols - 1);
      const gz = ((pt.z - bounds.minZ) / depth) * (rows - 1);
      const ix = Math.round(gx);
      const iz = Math.round(gz);

      // Splat with radius 3 cells
      for (let dz = -3; dz <= 3; dz++) {
        const rz = iz + dz;
        if (rz < 0 || rz >= rows) continue;
        for (let dx = -3; dx <= 3; dx++) {
          const rx = ix + dx;
          if (rx < 0 || rx >= cols) continue;
          const d2 = dx * dx + dz * dz;
          if (d2 > 9) continue;
          const w = 1 / (1 + d2 * 0.8);
          const idx = rz * cols + rx;
          elevations[idx] += pt.ele * w;
          weights[idx] += w;
        }
      }
    }
  }

  const baseEle = countEle > 0 ? sumEle / countEle : 0;
  for (let i = 0; i < elevations.length; i++) {
    if (weights[i] > 0) {
      elevations[i] = elevations[i] / weights[i];
    } else {
      elevations[i] = baseEle;
    }
  }

  // Diffuse unvisited cells smoothly from populated neighbors
  const temp = new Float32Array(elevations.length);
  for (let iter = 0; iter < 14; iter++) {
    temp.set(elevations);
    for (let r = 1; r < rows - 1; r++) {
      for (let c = 1; c < cols - 1; c++) {
        const idx = r * cols + c;
        const avg =
          (temp[idx - 1] +
            temp[idx + 1] +
            temp[idx - cols] +
            temp[idx + cols] +
            temp[idx] * 2) /
          6;
        // Keep seeded cells close to observed GPS elevation
        if (weights[idx] > 0 && iter > 3) {
          elevations[idx] = temp[idx] * 0.7 + avg * 0.3;
        } else {
          elevations[idx] = avg;
        }
      }
    }
  }

  let minEle = Infinity;
  let maxEle = -Infinity;
  for (let i = 0; i < elevations.length; i++) {
    if (elevations[i] < minEle) minEle = elevations[i];
    if (elevations[i] > maxEle) maxEle = elevations[i];
  }
  if (!Number.isFinite(minEle)) {
    minEle = 0;
    maxEle = 10;
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
    source: 'gps',
  };
}

export function sampleElevationGrid(
  grid: ElevationGrid,
  x: number,
  z: number,
): number {
  const u = Math.max(
    0,
    Math.min(1, (x - grid.minX) / Math.max(1, grid.maxX - grid.minX)),
  );
  const v = Math.max(
    0,
    Math.min(1, (z - grid.minZ) / Math.max(1, grid.maxZ - grid.minZ)),
  );

  const fx = u * (grid.cols - 1);
  const fz = v * (grid.rows - 1);
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const x1 = Math.min(grid.cols - 1, x0 + 1);
  const z1 = Math.min(grid.rows - 1, z0 + 1);
  const tx = fx - x0;
  const tz = fz - z0;

  const e00 = grid.elevations[z0 * grid.cols + x0];
  const e10 = grid.elevations[z0 * grid.cols + x1];
  const e01 = grid.elevations[z1 * grid.cols + x0];
  const e11 = grid.elevations[z1 * grid.cols + x1];

  const ex0 = e00 + (e10 - e00) * tx;
  const ex1 = e01 + (e11 - e01) * tx;
  return ex0 + (ex1 - ex0) * tz;
}

export function formatClockHMS(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = clamped % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
