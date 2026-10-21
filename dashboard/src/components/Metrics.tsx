import React from 'react';
import { Ban, CheckCircle2, Network, ArrowUpRight, Eye, Activity } from 'lucide-react';
import type { GuardEvent, SyscallStats } from '../types';
import { bucketize, useNow } from '../lib/utils';
import { Reveal } from './ui/Reveal';
import { Count } from './ui/Count';
import { Sparkline } from './ui/Sparkline';
import { Inline } from './ui/Inline';

interface MetricsProps {
  stats: SyscallStats;
  taggedCount: number;
  events: GuardEvent[];
}

export const Metrics: React.FC<MetricsProps> = ({ stats, taggedCount, events }) => {
  const now = useNow(2000);
  const spark = (pred: (e: GuardEvent) => boolean) => bucketize(events, now, 300, 16, pred);

  const cards = [
    { label: 'Total requests', value: stats.allowedCount + stats.blockedCount, note: 'reported allowed + blocked attempts', NoteIcon: Activity, color: '#ffffff', Icon: Activity, data: spark((e) => e.type === 'ALLOW' || e.type === 'BLOCK') },
    { label: 'Total allowed', value: stats.allowedCount, note: 'to approved destinations', NoteIcon: ArrowUpRight, color: '#6ee7a1', Icon: CheckCircle2, data: spark((e) => e.type === 'ALLOW') },
    { label: 'Total blocked', value: stats.blockedCount, note: 'attempts stopped', NoteIcon: Ban, color: '#ff5a5f', Icon: Ban, data: spark((e) => e.type === 'BLOCK') },
    { label: 'Tagged now', value: taggedCount, note: 'processes under watch', NoteIcon: Eye, color: '#ffffff', Icon: Network, data: spark((e) => e.type === 'TAG' || e.type === 'TAG_INHERIT') },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((c, i) => (
        <Reveal key={c.label} delay={0.2 + i * 0.05} className="group relative overflow-hidden p-5">
          <div className="flex items-center justify-between">
            <span className="eyebrow !text-[13px]">{c.label}</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04]">
              <c.Icon size={15} strokeWidth={1.8} style={{ color: c.color }} />
            </div>
          </div>
          <div className="mt-3.5 flex items-end justify-between gap-3">
            <div className="font-display text-[44px] font-medium leading-none text-white tracking-[-0.04em] tabular">
              <Count value={c.value} />
            </div>
            {c.data && <Sparkline data={c.data} color={c.color} width={88} height={34} />}
          </div>
          <p className="mt-3 text-[13.5px] text-zinc-400">
            <Inline Icon={c.NoteIcon} />
            {c.note}
          </p>
          <div
            className="absolute inset-x-5 bottom-0 h-px opacity-0 transition-opacity duration-500 group-hover:opacity-100"
            style={{ background: `linear-gradient(90deg, transparent, ${c.color}, transparent)` }}
          />
        </Reveal>
      ))}
    </div>
  );
};
