import type { ParsedActivity } from '../types/activity';
import { parseUploadedFiles } from './stravaParser';

const DEFAULT_ACTIVITY_MODULES = import.meta.glob('../activities/*.fit.gz', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

let cachedDefaultActivities: ParsedActivity[] | null = null;

/**
 * Loads and parses the bundled .fit.gz activities from src/activities/
 * as the default startup dataset.
 */
export async function loadDefaultActivities(): Promise<ParsedActivity[]> {
  if (cachedDefaultActivities && cachedDefaultActivities.length > 0) {
    return cachedDefaultActivities;
  }

  const entries = Object.entries(DEFAULT_ACTIVITY_MODULES).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (entries.length === 0) return [];

  const files = await Promise.all(
    entries.map(async ([path, url]) => {
      const fileName = path.split('/').pop() || 'activity.fit.gz';
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to fetch default activity ${fileName}`);
      }
      const buf = await res.arrayBuffer();
      return new File([buf], fileName, { type: 'application/gzip' });
    }),
  );

  const parsed = await parseUploadedFiles(files);
  cachedDefaultActivities = parsed.activities;
  return parsed.activities;
}
