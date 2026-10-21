import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CornerDownRight, FileText, ScanEye } from 'lucide-react';
import type { TaggedProcess } from '../types';
import { basename, cn, fmtDuration, useNow } from '../lib/utils';
import { CardHeader, Reveal } from './ui/Reveal';
import { TaintTrail } from './TaintTrail';

interface ProcessesProps {
  processes: TaggedProcess[];
  selectedPid?: number | null;
  onSelectPid?: (pid: number) => void;
}

export const Processes: React.FC<ProcessesProps> = ({ processes, selectedPid, onSelectPid }) => {
  const now = useNow(1000);
  const pids = new Set(processes.map((p) => p.tgid));
  // Roots first, children right after their parent
  const ordered: { p: TaggedProcess; depth: number }[] = [];
  const walk = (p: TaggedProcess, depth: number) => {
    ordered.push({ p, depth });
    processes.filter((c) => c.parent_tgid === p.tgid).forEach((c) => walk(c, depth + 1));
  };
  processes.filter((p) => !p.parent_tgid || !pids.has(p.parent_tgid)).forEach((p) => walk(p, 0));

  return (
    <Reveal delay={0.55} className="flex h-full min-h-[360px] flex-col">
      <CardHeader index="03" title="Tagged processes" right={<span className="rounded-full border hairline px-3 py-1 font-mono text-[14px] text-zinc-300">{processes.length} live</span>} />
      <div className="relative flex-1 overflow-y-auto px-3 pb-3">
        <AnimatePresence initial={false} mode="popLayout">
          {ordered.length === 0 ? (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex h-full min-h-[240px] flex-col items-center justify-center gap-4 text-center">
              <motion.div animate={{ scale: [1, 1.08, 1], opacity: [0.5, 1, 0.5] }} transition={{ duration: 3, repeat: Infinity }} className="rounded-full border hairline p-5 text-zinc-400"><ScanEye size={30} strokeWidth={1.4} /></motion.div>
              <p className="max-w-xs text-[16px] leading-relaxed text-zinc-300">No process is carrying a tag. One appears here the moment it opens a protected file.</p>
            </motion.div>
          ) : (
            ordered.map(({ p, depth }) => {
              const isSelected = selectedPid === p.tgid;
              return (
                <motion.div
                  key={p.tgid}
                  layout
                  initial={{ opacity: 0, x: -20, scale: 0.97 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: 20, scale: 0.97 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectPid?.(p.tgid)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectPid?.(p.tgid);
                    }
                  }}
                  title={isSelected ? 'Click to clear filter' : 'Click to filter events for this process'}
                  className={cn(
                    'group mb-1.5 flex cursor-pointer items-center gap-4 rounded-xl border px-4 py-3.5 transition-all',
                    isSelected
                      ? 'border-white/30 bg-white/[0.08] shadow-[0_0_20px_rgba(255,255,255,0.06)]'
                      : 'border-transparent hover:border-white/10 hover:bg-white/[0.035]'
                  )}
                  style={{ marginLeft: depth * 26 }}
                >
                  {depth > 0 ? <CornerDownRight size={18} className="shrink-0 text-zinc-500" /> : <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.7)]" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-3">
                      <span className="truncate text-[18px] font-medium text-white">{p.comm ?? 'unknown'}</span>
                      <span className="font-mono text-[15px] text-zinc-400">pid {p.tgid}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[15px] text-zinc-400">
                      <FileText size={15} className="shrink-0" />
                      <span className="truncate font-mono" title={p.file ?? ''}>{basename(p.file)}</span>
                      {p.parent_tgid ? <span className="shrink-0 text-zinc-500">· inherited from {p.parent_tgid}</span> : null}
                    </div>
                    {p.lineage?.length ? <TaintTrail lineage={p.lineage} compact /> : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {isSelected ? (
                      <span className="rounded-full border border-white/25 bg-white/10 px-2.5 py-0.5 font-mono text-[13px] text-white">
                        Filtered
                      </span>
                    ) : (
                      <span className="hidden font-mono text-[13px] text-zinc-400 group-hover:inline-block">
                        Filter →
                      </span>
                    )}
                    <span className="font-mono text-[15px] tabular text-zinc-300">{fmtDuration(now - p.since)}</span>
                  </div>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>
    </Reveal>
  );
};
