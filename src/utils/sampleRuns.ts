import type { ParsedActivity, TrackPoint } from '../types/activity';
import { haversineMeters } from './geo';

/**
 * Generates a realistic starter collection of 36 runs departing from a common
 * neighborhood origin (North Vancouver)
 * with overlapping shared corridors, varied paces, and coastal hill elevation
 * so users can immediately preview the 3D motion graphic before uploading a Strava ZIP.
 */
export function generateSampleActivities(): ParsedActivity[] {
  const homeLat = 49.3167;
  const homeLon = -123.0667;

  // Deterministic PRNG so sample runs look consistent across reloads
  let seed = 4219;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  interface CorridorTemplate {
    label: string;
    sport: string;
    waypoints: Array<[number, number]>; // [dLat, dLon] offsets
    baseSpeedMps: number;
    count: number;
  }

  const corridors: CorridorTemplate[] = [
    {
      label: 'Crissy Waterfront Out & Back',
      sport: 'Run',
      waypoints: [
        [0, 0],
        [0.0045, 0.001],
        [0.006, 0.008],
        [0.0068, 0.019],
        [0.0075, 0.031],
        [0.0068, 0.019],
        [0.006, 0.008],
        [0.0045, 0.001],
        [0, 0],
      ],
      baseSpeedMps: 3.45,
      count: 10,
    },
    {
      label: 'Golden Gate Bridge Climb',
      sport: 'Run',
      waypoints: [
        [0, 0],
        [0.0045, 0.001],
        [0.006, -0.008],
        [0.0072, -0.019],
        [0.0095, -0.028],
        [0.021, -0.03],
        [0.0095, -0.028],
        [0.0072, -0.019],
        [0.0045, 0.001],
        [0, 0],
      ],
      baseSpeedMps: 3.2,
      count: 8,
    },
    {
      label: 'Presidio Ridge Loop',
      sport: 'Trail Run',
      waypoints: [
        [0, 0],
        [-0.003, -0.005],
        [-0.009, -0.012],
        [-0.013, -0.022],
        [-0.007, -0.029],
        [0.002, -0.023],
        [0.005, -0.011],
        [0.002, -0.003],
        [0, 0],
      ],
      baseSpeedMps: 2.95,
      count: 7,
    },
    {
      label: 'Fort Mason & Aquatic Park',
      sport: 'Run',
      waypoints: [
        [0, 0],
        [0.0045, 0.001],
        [0.006, 0.008],
        [0.007, 0.022],
        [0.0082, 0.038],
        [0.003, 0.041],
        [0.001, 0.028],
        [0.0035, 0.012],
        [0, 0],
      ],
      baseSpeedMps: 3.65,
      count: 6,
    },
    {
      label: 'Lands End Coastal Tempo',
      sport: 'Run',
      waypoints: [
        [0, 0],
        [-0.003, -0.005],
        [-0.007, -0.018],
        [-0.011, -0.036],
        [-0.018, -0.049],
        [-0.024, -0.056],
        [-0.015, -0.042],
        [-0.006, -0.021],
        [0, 0],
      ],
      baseSpeedMps: 3.35,
      count: 5,
    },
  ];

  // Smooth coastal hill elevation function (meters)
  const elevationAt = (lat: number, lon: number): number => {
    const dx = (lon - homeLon) * 88000;
    const dz = (lat - homeLat) * 111000;
    const ridge1 = Math.max(0, 95 * Math.exp(-Math.pow((dz + 900) / 700, 2) - Math.pow((dx + 1400) / 1200, 2)));
    const ridge2 = Math.max(0, 72 * Math.exp(-Math.pow((dz - 1400) / 600, 2) - Math.pow((dx + 2500) / 800, 2)));
    const coastDrop = dz > 350 ? 3 : 16 + Math.max(0, -dz * 0.025);
    return Math.round((coastDrop + ridge1 + ridge2) * 10) / 10;
  };

  const activities: ParsedActivity[] = [];
  let idx = 0;

  for (const corridor of corridors) {
    for (let k = 0; k < corridor.count; k++) {
      idx++;
      // Subtle personal start offset inside ~90m of home + path jitter
      const startJitterLat = (rand() - 0.5) * 0.0007;
      const startJitterLon = (rand() - 0.5) * 0.0009;
      const paceFactor = 0.82 + rand() * 0.36;
      const speedMps = corridor.baseSpeedMps * paceFactor;
      const loopExtent = k === corridor.count - 1 ? 0.85 : 0.92 + rand() * 0.16;

      // Interpolate dense points along waypoints
      const denseLatLon: Array<{ lat: number; lon: number }> = [];
      const wps = corridor.waypoints;
      const stepsPerLeg = 18;

      for (let w = 0; w < wps.length - 1; w++) {
        const [latA, lonA] = wps[w];
        const [latB, lonB] = wps[w + 1];
        const wigA = w === 0 ? 0 : (rand() - 0.5) * 0.0011;
        const wigB = w + 1 === wps.length - 1 ? 0 : (rand() - 0.5) * 0.0011;

        for (let s = 0; s < stepsPerLeg; s++) {
          const u = s / stepsPerLeg;
          const lat =
            homeLat +
            startJitterLat +
            (latA * (1 - u) + latB * u) * loopExtent +
            Math.sin(u * Math.PI) * wigA;
          const lon =
            homeLon +
            startJitterLon +
            (lonA * (1 - u) + lonB * u) * loopExtent +
            Math.sin(u * Math.PI) * wigB;
          denseLatLon.push({ lat, lon });
        }
      }
      denseLatLon.push({
        lat: homeLat + startJitterLat,
        lon: homeLon + startJitterLon,
      });

      const points: TrackPoint[] = [];
      let totalDist = 0;
      let totalTime = 0;
      let elevGain = 0;

      for (let i = 0; i < denseLatLon.length; i++) {
        const { lat, lon } = denseLatLon[i];
        const ele = elevationAt(lat, lon);
        if (i > 0) {
          const prev = denseLatLon[i - 1];
          const segDist = haversineMeters(prev.lat, prev.lon, lat, lon);
          const dEle = ele - points[i - 1].ele;
          if (dEle > 0) elevGain += dEle;
          // Slightly slower uphill, faster downhill
          const grade = segDist > 1 ? dEle / segDist : 0;
          const gradeSpeed = Math.max(1.6, speedMps * (1 - grade * 1.8));
          totalDist += segDist;
          totalTime += segDist / gradeSpeed;
        }
        points.push({
          lat,
          lon,
          ele,
          t: totalTime,
          dist: totalDist,
          x: 0,
          z: 0,
        });
      }

      const day = String(((idx * 3) % 28) + 1).padStart(2, '0');
      const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'][idx % 6];

      activities.push({
        id: `sample-${idx}`,
        name: `${corridor.label} #${k + 1}`,
        sport: corridor.sport,
        startDate: `${month} ${day}, 2026`,
        durationSec: totalTime,
        distanceM: totalDist,
        elevationGainM: Math.round(elevGain),
        startLat: points[0].lat,
        startLon: points[0].lon,
        points,
        fileName: `sample_${idx}.gpx`,
      });
    }
  }

  return activities;
}
