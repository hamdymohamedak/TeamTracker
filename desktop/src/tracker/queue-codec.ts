/**
 * Pure offline-queue JSON helpers (no Electron).
 */
import type { TrackedActivity } from './types.js';

/** Serialize a queue to a JSON string for disk persistence. */
export function serializeQueue(queue: TrackedActivity[]): string {
  return JSON.stringify(queue, null, 2);
}

/**
 * Deserialize a raw JSON string into a deduped TrackedActivity array.
 * Silently drops entries with duplicate `id` fields (keeps the first).
 * Returns an empty array for any malformed or non-array input.
 */
export function deserializeQueue(raw: string): TrackedActivity[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const result: TrackedActivity[] = [];
  for (const item of data) {
    if (item?.id && seen.has(item.id)) continue;
    if (item?.id) seen.add(item.id);
    result.push(item as TrackedActivity);
  }
  return result;
}
