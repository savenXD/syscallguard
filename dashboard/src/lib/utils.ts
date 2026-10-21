import type React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useEffect, useState } from 'react';
import type { EventType, GuardEvent } from '../types';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

/** Re-renders every `ms` and returns the current unix time in seconds. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() / 1000), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

export const fmtClock = (ts: number) => {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0').slice(0, 2);
};

export const fmtDuration = (sec: number) => {
  sec = Math.max(0, Math.floor(sec));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
};

export const basename = (p: string | null) => (p ? p.split('/').filter(Boolean).pop() ?? p : '—');

export const fmtDest = (e: Pick<GuardEvent, 'daddr' | 'dport' | 'family'>) =>
  e.daddr ? ((e.family === 'ipv6' ? `[${e.daddr}]` : e.daddr) + (e.dport === null ? '' : `:${e.dport}`)) : '—';

export const EVENT_META: Record<EventType, { label: string; color: string }> = {
  BLOCK: { label: 'Blocked', color: '#ff5a5f' },
  WOULD_BLOCK: { label: 'Would block', color: '#fbbf24' },
  ALLOW: { label: 'Allowed', color: '#6ee7a1' },
  TAG: { label: 'Tagged', color: '#ffffff' },
  TAG_INHERIT: { label: 'Inherited', color: '#d4d4d8' },
  UNTAG: { label: 'Released', color: '#71717a' },
  READY: { label: 'Ready', color: '#a1a1aa' },
  ERROR: { label: 'Error', color: '#ff5a5f' },
  TAINT: { label: 'Tainted', color: '#d4d4d8' },
};

/** Counts events matching `pred` into `n` equal buckets spanning the last `windowSec`. */
export function bucketize(events: GuardEvent[], now: number, windowSec: number, n: number, pred: (e: GuardEvent) => boolean) {
  const out = new Array<number>(n).fill(0);
  const start = now - windowSec;
  for (const e of events) {
    if (!pred(e)) continue;
    const i = Math.floor(((e.ts - start) / windowSec) * n);
    if (i >= 0 && i < n) out[i]++;
  }
  return out;
}

/** Calls `onOutside` when a mousedown lands outside `ref`, or Escape is pressed. */
export function useClickOutside(ref: React.RefObject<HTMLElement>, active: boolean, onOutside: () => void) {
  useEffect(() => {
    if (!active) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOutside(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onOutside(); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [ref, active, onOutside]);
}
