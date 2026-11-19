import JSZip from 'jszip';
import { ungzip } from 'pako';
import FitParser from 'fit-file-parser';
import type { ParseProgress, ParsedActivity, TrackPoint } from '../types/activity';
import { haversineMeters } from './geo';

interface CsvMeta {
  name?: string;
  sport?: string;
  startDate?: string;
}

const MAX_POINTS_PER_ACTIVITY = 720;

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

function parseStravaActivitiesCsv(csvText: string): Map<string, CsvMeta> {
  const map = new Map<string, CsvMeta>();
  const lines = csvText.split(/\r?\n/);
  if (lines.length < 2) return map;

  const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const fileIdx = headers.findIndex((h) => h === 'filename');
  const nameIdx = headers.findIndex((h) => h === 'activity name');
  const typeIdx = headers.findIndex((h) => h === 'activity type');
  const dateIdx = headers.findIndex((h) => h === 'activity date');

  if (fileIdx === -1) return map;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCsvLine(line);
    const filename = cols[fileIdx]?.trim();
    if (!filename) continue;
    const baseName = filename.split('/').pop() || filename;
    const meta: CsvMeta = {
      name: nameIdx >= 0 ? cols[nameIdx]?.trim() : undefined,
      sport: typeIdx >= 0 ? cols[typeIdx]?.trim() : undefined,
      startDate: dateIdx >= 0 ? cols[dateIdx]?.trim() : undefined,
    };
    map.set(filename, meta);
    map.set(baseName, meta);
  }

  return map;
}

function normalizePoints(
  raw: Array<{ lat: number; lon: number; ele: number; timeMs: number }>,
): {
  points: TrackPoint[];
  durationSec: number;
  distanceM: number;
  elevationGainM: number;
} {
  if (raw.length < 2) {
    return { points: [], durationSec: 0, distanceM: 0, elevationGainM: 0 };
  }

  // Filter out invalid coordinates or (0,0) null island glitches
  const valid = raw.filter(
    (p) =>
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lon) &&
      Math.abs(p.lat) <= 90 &&
      Math.abs(p.lon) <= 180 &&
      (Math.abs(p.lat) > 0.001 || Math.abs(p.lon) > 0.001),
  );

  if (valid.length < 2) {
    return { points: [], durationSec: 0, distanceM: 0, elevationGainM: 0 };
  }

  // Sort chronologically if timestamps are valid
  const hasTimestamps = valid.every((p) => Number.isFinite(p.timeMs) && p.timeMs > 0);
  if (hasTimestamps) {
    valid.sort((a, b) => a.timeMs - b.timeMs);
  }

  const startMs = hasTimestamps ? valid[0].timeMs : 0;
  let totalDist = 0;
  let elevGain = 0;

  const fullPoints: TrackPoint[] = [];
  for (let i = 0; i < valid.length; i++) {
    const cur = valid[i];
    const prev = i > 0 ? valid[i - 1] : cur;
    const segDist = i > 0 ? haversineMeters(prev.lat, prev.lon, cur.lat, cur.lon) : 0;
    // Filter absurd GPS teleport spikes (> 150 m/s)
    const dt = hasTimestamps ? (cur.timeMs - prev.timeMs) / 1000 : 1;
    if (i > 0 && dt > 0 && segDist / dt > 120) {
      continue;
    }

    totalDist += segDist;
    const ele = Number.isFinite(cur.ele) ? cur.ele : fullPoints[fullPoints.length - 1]?.ele ?? 0;
    if (fullPoints.length > 0) {
      const dEle = ele - fullPoints[fullPoints.length - 1].ele;
      if (dEle > 0.4 && dEle < 80) {
        elevGain += dEle;
      }
    }

    const t = hasTimestamps ? Math.max(0, (cur.timeMs - startMs) / 1000) : i;
    fullPoints.push({
      lat: cur.lat,
      lon: cur.lon,
      ele,
      t,
      dist: totalDist,
      x: 0,
      z: 0,
    });
  }

  if (fullPoints.length < 2) {
    return { points: [], durationSec: 0, distanceM: 0, elevationGainM: 0 };
  }

  // Ensure strictly non-decreasing t and estimate t if file lacked timestamps
  const durationSec = fullPoints[fullPoints.length - 1].t;
  if (durationSec <= 0 && totalDist > 0) {
    // Fallback 3.3 m/s (~5:00/km) if GPX had no timestamps
    for (const pt of fullPoints) {
      pt.t = pt.dist / 3.33;
    }
  }

  // Downsample long tracks while preserving first, last, and true temporal spacing
  let sampled = fullPoints;
  if (fullPoints.length > MAX_POINTS_PER_ACTIVITY) {
    const step = (fullPoints.length - 1) / (MAX_POINTS_PER_ACTIVITY - 1);
    sampled = [];
    for (let i = 0; i < MAX_POINTS_PER_ACTIVITY - 1; i++) {
      sampled.push(fullPoints[Math.round(i * step)]);
    }
    sampled.push(fullPoints[fullPoints.length - 1]);
  }

  const finalDuration = sampled[sampled.length - 1].t;
  return {
    points: sampled,
    durationSec: finalDuration,
    distanceM: totalDist,
    elevationGainM: Math.round(elevGain),
  };
}

function parseGpxText(
  xmlText: string,
  fileName: string,
  meta?: CsvMeta,
): ParsedActivity | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const trkpts = Array.from(doc.getElementsByTagName('trkpt'));
  if (trkpts.length < 2) return null;

  const raw: Array<{ lat: number; lon: number; ele: number; timeMs: number }> = [];
  for (const pt of trkpts) {
    const lat = parseFloat(pt.getAttribute('lat') || '');
    const lon = parseFloat(pt.getAttribute('lon') || '');
    const eleText = pt.getElementsByTagName('ele')[0]?.textContent;
    const timeText = pt.getElementsByTagName('time')[0]?.textContent;
    const ele = eleText ? parseFloat(eleText) : 0;
    const timeMs = timeText ? Date.parse(timeText) : 0;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      raw.push({ lat, lon, ele: Number.isFinite(ele) ? ele : 0, timeMs });
    }
  }

  const { points, durationSec, distanceM, elevationGainM } = normalizePoints(raw);
  if (points.length < 2 || distanceM < 50) return null;

  const xmlName = doc.getElementsByTagName('name')[0]?.textContent?.trim();
  const xmlType = doc.getElementsByTagName('type')[0]?.textContent?.trim();
  const firstTime = doc.getElementsByTagName('time')[0]?.textContent?.trim() || '';

  return {
    id: fileName,
    name: meta?.name || xmlName || fileName.replace(/\.(gpx|gz)+$/gi, ''),
    sport: normalizeSportName(meta?.sport || xmlType || 'Run'),
    startDate: meta?.startDate || firstTime,
    durationSec,
    distanceM,
    elevationGainM,
    startLat: points[0].lat,
    startLon: points[0].lon,
    points,
    fileName,
  };
}

function parseTcxText(
  xmlText: string,
  fileName: string,
  meta?: CsvMeta,
): ParsedActivity | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const trackpoints = Array.from(doc.getElementsByTagName('Trackpoint'));
  if (trackpoints.length < 2) return null;

  const raw: Array<{ lat: number; lon: number; ele: number; timeMs: number }> = [];
  for (const tp of trackpoints) {
    const latStr = tp.getElementsByTagName('LatitudeDegrees')[0]?.textContent;
    const lonStr = tp.getElementsByTagName('LongitudeDegrees')[0]?.textContent;
    if (!latStr || !lonStr) continue;
    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);
    const eleStr = tp.getElementsByTagName('AltitudeMeters')[0]?.textContent;
    const timeStr = tp.getElementsByTagName('Time')[0]?.textContent;
    const ele = eleStr ? parseFloat(eleStr) : 0;
    const timeMs = timeStr ? Date.parse(timeStr) : 0;
    raw.push({ lat, lon, ele: Number.isFinite(ele) ? ele : 0, timeMs });
  }

  const { points, durationSec, distanceM, elevationGainM } = normalizePoints(raw);
  if (points.length < 2 || distanceM < 50) return null;

  const activityEl = doc.getElementsByTagName('Activity')[0];
  const sportAttr = activityEl?.getAttribute('Sport') || 'Run';
  const idText = doc.getElementsByTagName('Id')[0]?.textContent?.trim() || '';

  return {
    id: fileName,
    name: meta?.name || fileName.replace(/\.(tcx|gz)+$/gi, ''),
    sport: normalizeSportName(meta?.sport || sportAttr),
    startDate: meta?.startDate || idText,
    durationSec,
    distanceM,
    elevationGainM,
    startLat: points[0].lat,
    startLon: points[0].lon,
    points,
    fileName,
  };
}

async function parseFitBuffer(
  buffer: ArrayBuffer,
  fileName: string,
  meta?: CsvMeta,
): Promise<ParsedActivity | null> {
  const parser = new FitParser({
    force: true,
    speedUnit: 'm/s',
    lengthUnit: 'm',
    mode: 'list',
  });

  const parsed = await parser.parseAsync(buffer);
  const records = (parsed.records ?? []) as Array<Record<string, unknown>>;
  if (records.length < 2) return null;

  const raw: Array<{ lat: number; lon: number; ele: number; timeMs: number }> = [];
  for (const rec of records) {
    let lat = rec.position_lat as number | undefined;
    let lon = rec.position_long as number | undefined;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;

    // Guard semicircle vs degree units
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      const semiToDeg = 180 / 2147483648;
      lat *= semiToDeg;
      lon *= semiToDeg;
    }

    const eleRaw =
      typeof rec.enhanced_altitude === 'number'
        ? rec.enhanced_altitude
        : typeof rec.altitude === 'number'
          ? rec.altitude
          : 0;

    let timeMs = 0;
    if (rec.timestamp instanceof Date) {
      timeMs = rec.timestamp.getTime();
    } else if (typeof rec.timestamp === 'string' || typeof rec.timestamp === 'number') {
      timeMs = new Date(rec.timestamp).getTime();
    }

    raw.push({ lat, lon, ele: eleRaw, timeMs });
  }

  const { points, durationSec, distanceM, elevationGainM } = normalizePoints(raw);
  if (points.length < 2 || distanceM < 50) return null;

  const sessions = (parsed.sessions ?? []) as Array<Record<string, unknown>>;
  const sessionSport = sessions[0]?.sport ? String(sessions[0].sport) : undefined;
  const startTime = sessions[0]?.start_time
    ? String(sessions[0].start_time)
    : '';

  return {
    id: fileName,
    name: meta?.name || fileName.replace(/\.(fit|gz)+$/gi, ''),
    sport: normalizeSportName(meta?.sport || sessionSport || 'Run'),
    startDate: meta?.startDate || startTime,
    durationSec,
    distanceM,
    elevationGainM,
    startLat: points[0].lat,
    startLon: points[0].lon,
    points,
    fileName,
  };
}

function normalizeSportName(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (s.includes('trail')) return 'Trail Run';
  if (s.includes('run')) return 'Run';
  if (s.includes('ride') || s.includes('cycling') || s.includes('bike')) return 'Ride';
  if (s.includes('walk')) return 'Walk';
  if (s.includes('hike')) return 'Hike';
  if (!s || s === 'generic') return 'Run';
  return raw.trim().charAt(0).toUpperCase() + raw.trim().slice(1);
}

function decompressIfGzip(bytes: Uint8Array, name: string): {
  bytes: Uint8Array;
  innerName: string;
} {
  const hasGzipMagic = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  const innerName = name.replace(/\.gz$/i, '');

  if (!hasGzipMagic) {
    return { bytes, innerName };
  }

  const inflated = ungzip(bytes);
  return {
    bytes: inflated,
    innerName,
  };
}

async function parseSingleEntry(
  rawBytes: Uint8Array,
  fileName: string,
  metaMap: Map<string, CsvMeta>,
): Promise<ParsedActivity | null> {
  const { bytes, innerName } = decompressIfGzip(rawBytes, fileName);
  const lower = innerName.toLowerCase();
  const baseName = fileName.split('/').pop() || fileName;
  const meta = metaMap.get(fileName) || metaMap.get(baseName);

  if (lower.endsWith('.gpx')) {
    const text = new TextDecoder().decode(bytes);
    return parseGpxText(text, fileName, meta);
  }
  if (lower.endsWith('.tcx')) {
    const text = new TextDecoder().decode(bytes);
    return parseTcxText(text, fileName, meta);
  }
  if (lower.endsWith('.fit')) {
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return await parseFitBuffer(ab, fileName, meta);
  }
  return null;
}

export async function parseUploadedFiles(
  fileList: File[] | FileList,
  onProgress?: (progress: ParseProgress) => void,
): Promise<{
  activities: ParsedActivity[];
  skippedCount: number;
  errors: string[];
}> {
  const files = Array.from(fileList);
  const activities: ParsedActivity[] = [];
  let skippedCount = 0;
  const errors: string[] = [];

  const entries: Array<{
    name: string;
    loadBytes: () => Promise<Uint8Array>;
    metaMap: Map<string, CsvMeta>;
  }> = [];

  onProgress?.({ phase: 'reading', processed: 0, total: files.length });

  for (const file of files) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.zip')) {
      try {
        const zip = await JSZip.loadAsync(await file.arrayBuffer());
        let metaMap = new Map<string, CsvMeta>();

        // Look for Strava activities.csv inside the zip
        const csvEntry = Object.values(zip.files).find(
          (entry) =>
            !entry.dir &&
            entry.name.toLowerCase().endsWith('activities.csv'),
        );
        if (csvEntry) {
          const csvText = await csvEntry.async('string');
          metaMap = parseStravaActivitiesCsv(csvText);
        }

        for (const zipEntry of Object.values(zip.files)) {
          if (zipEntry.dir) continue;
          const entryName = zipEntry.name;
          if (entryName.startsWith('__MACOSX') || entryName.includes('/._')) continue;
          const entryLower = entryName.toLowerCase();
          if (
            /\.(fit|gpx|tcx)(\.gz)?$/i.test(entryLower)
          ) {
            entries.push({
              name: entryName,
              loadBytes: () => zipEntry.async('uint8array'),
              metaMap,
            });
          }
        }
      } catch (err) {
        errors.push(`Could not open ZIP "${file.name}": ${(err as Error).message}`);
      }
    } else if (/\.(fit|gpx|tcx)(\.gz)?$/i.test(lower)) {
      const emptyMeta = new Map<string, CsvMeta>();
      entries.push({
        name: file.name,
        loadBytes: async () => new Uint8Array(await file.arrayBuffer()),
        metaMap: emptyMeta,
      });
    }
  }

  const total = entries.length;
  for (let i = 0; i < total; i++) {
    const entry = entries[i];
    onProgress?.({
      phase: 'parsing',
      processed: i,
      total,
      currentFile: entry.name.split('/').pop() || entry.name,
    });

    try {
      const bytes = await entry.loadBytes();
      const parsed = await parseSingleEntry(bytes, entry.name, entry.metaMap);
      if (parsed) {
        activities.push(parsed);
      } else {
        skippedCount++;
      }
    } catch {
      skippedCount++;
    }

    // Yield periodically to keep browser UI responsive on huge exports
    if (i % 8 === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  onProgress?.({ phase: 'done', processed: total, total });

  return { activities, skippedCount, errors };
}
