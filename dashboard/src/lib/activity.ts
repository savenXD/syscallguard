import type { GuardEvent } from '../types';

/** Fixed clock-aligned batches; the final batch is still collecting live events. */
export function requestBatches(events: GuardEvent[], now: number, count = 60) {
  const current = Math.floor(now);
  const start = current - (count - 1);
  const batches = Array.from({ length: count }, (_, i) => ({ start: start + i, allowed: 0, blocked: 0, wouldBlock: 0, total: 0 }));
  for (const event of events) {
    if (event.ts > now) continue;
    const i = Math.floor((event.ts - start));
    if (i < 0 || i >= count) continue;
    const batch = batches[i];
    if (event.type === 'ALLOW') batch.allowed++;
    else if (event.type === 'BLOCK') batch.blocked++;
    else if (event.type === 'WOULD_BLOCK') batch.wouldBlock++;
    else continue;
    batch.total++;
  }
  return batches;
}

/** Smooth cubic segments stay between their endpoints, without invented peaks. */
export function smoothRequestPath(points: { x: number; y: number }[]) {
  return points.map((point, i) => {
    if (i === 0) return `M ${point.x} ${point.y}`;
    const prev = points[i - 1];
    const third = (point.x - prev.x) / 3;
    return `C ${prev.x + third} ${prev.y}, ${point.x - third} ${point.y}, ${point.x} ${point.y}`;
  }).join(' ');
}
