import type { ProjectedActivity } from '../types/activity';

export interface HistogramBucket {
  index: number;
  startSec: number;
  endSec: number;
  label: string;
  totalCount: number;
  completedCount: number;
}

export function buildFinishHistogram(
  activities: ProjectedActivity[],
  elapsedSec: number,
  maxDurationSec: number,
  bucketCount = 18,
): {
  buckets: HistogramBucket[];
  maxBucketTotal: number;
  stillRunning: number;
  finishedCount: number;
} {
  const safeMax = Math.max(60, maxDurationSec);
  const stepSec = safeMax / bucketCount;

  const buckets: HistogramBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const startSec = i * stepSec;
    const endSec = (i + 1) * stepSec;
    const mins = Math.round(startSec / 60);
    buckets.push({
      index: i,
      startSec,
      endSec,
      label: `${mins}m`,
      totalCount: 0,
      completedCount: 0,
    });
  }

  let stillRunning = 0;
  let finishedCount = 0;

  for (const act of activities) {
    const dur = Math.max(1, act.durationSec);
    const bIdx = Math.min(bucketCount - 1, Math.floor(dur / stepSec));
    buckets[bIdx].totalCount++;

    if (elapsedSec >= dur) {
      finishedCount++;
      buckets[bIdx].completedCount++;
    } else if (elapsedSec > 0) {
      stillRunning++;
    } else {
      // At t=0 before departure, all filtered runners are queued at start
      stillRunning++;
    }
  }

  let maxBucketTotal = 1;
  for (const b of buckets) {
    if (b.totalCount > maxBucketTotal) maxBucketTotal = b.totalCount;
  }

  return {
    buckets,
    maxBucketTotal,
    stillRunning,
    finishedCount,
  };
}
