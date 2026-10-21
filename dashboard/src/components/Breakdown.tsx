import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import type { EventType, GuardEvent } from '../types';
import { cn, EVENT_META } from '../lib/utils';
import { CardHeader, Reveal } from './ui/Reveal';
import { Count } from './ui/Count';

const R = 78;
const C = 2 * Math.PI * R;
const GAP = 4;

export const Breakdown: React.FC<{ events: GuardEvent[] }> = ({ events }) => {
  const [hoveredType, setHoveredType] = useState<EventType | null>(null);
  const rows = useMemo(() => {
    const counts = new Map<EventType, number>();
    events.forEach((e) => counts.set(e.type, (counts.get(e.type) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [events]);
  const total = events.length;

  let acc = 0;
  return (
    <Reveal delay={0.5} className="flex h-full flex-col">
      <CardHeader index="02" title="Event mix" />
      <div className="flex flex-1 flex-col items-center gap-6 px-6 pb-6">
        <div className="relative h-[190px] w-[190px] shrink-0">
          <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90">
            <circle cx="100" cy="100" r={R} fill="none" stroke="#fff" strokeOpacity="0.07" strokeWidth="14" />
            {rows.map(([type, n]) => {
              const len = Math.max(0, (n / total) * C - (rows.length > 1 ? GAP : 0));
              const off = -acc;
              acc += (n / total) * C;
              const isHovered = hoveredType === type;
              const isDimmed = hoveredType !== null && !isHovered;
              return (
                <motion.circle
                  key={type}
                  cx="100"
                  cy="100"
                  r={R}
                  fill="none"
                  stroke={EVENT_META[type].color}
                  strokeWidth={isHovered ? 18 : 14}
                  strokeLinecap="butt"
                  opacity={isDimmed ? 0.35 : 1}
                  style={{ transition: 'stroke-width 0.2s, opacity 0.2s' }}
                  initial={{ strokeDasharray: `0 ${C}`, strokeDashoffset: off }}
                  animate={{ strokeDasharray: `${len} ${C - len}`, strokeDashoffset: off }}
                  transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
                />
              );
            })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-display text-[48px] font-medium leading-none tracking-[-0.04em] tabular text-white"><Count value={total} /></span>
            <span className="mt-1 text-[14px] text-zinc-400">events</span>
          </div>
        </div>

        <ul className="w-full space-y-1">
          {rows.length === 0 && <li className="py-2 text-center text-[15px] text-zinc-400">Nothing received yet</li>}
          {rows.map(([type, n], i) => {
            const isHovered = hoveredType === type;
            return (
              <motion.li
                key={type}
                layout
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.6 + i * 0.05 }}
                onMouseEnter={() => setHoveredType(type)}
                onMouseLeave={() => setHoveredType(null)}
                className={cn(
                  'flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[15px] transition-colors cursor-default',
                  isHovered ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
                )}
              >
                <span className="flex items-center gap-3 text-zinc-200">
                  <i
                    className="h-2.5 w-2.5 rounded-full transition-transform"
                    style={{
                      background: EVENT_META[type].color,
                      transform: isHovered ? 'scale(1.3)' : 'scale(1)',
                    }}
                  />
                  {EVENT_META[type].label}
                </span>
                <span className="font-mono tabular text-white">
                  {n}
                  <span className="ml-2 text-zinc-500">{Math.round((n / total) * 100)}%</span>
                </span>
              </motion.li>
            );
          })}
        </ul>
      </div>
    </Reveal>
  );
};
