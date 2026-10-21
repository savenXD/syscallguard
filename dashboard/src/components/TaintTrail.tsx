import React from 'react';
import { ArrowRight } from 'lucide-react';
import type { TaintHop } from '../types';
import { basename } from '../lib/utils';

/** Only explicit, validated writer → medium → reader hops. Never infer taint from fork ancestry. */
export const TaintTrail: React.FC<{ lineage: TaintHop[]; file?: string | null; compact?: boolean }> = ({ lineage, file, compact }) => {
  if (!lineage.length) return null;
  if (compact) return (
    <ul aria-label="Taint lineage" className="mt-2 space-y-1 text-[13px] text-zinc-300">
      {lineage.map((hop, i) => <li key={`${hop.inode}-${i}`} className="break-words">
        {hop.writer_comm ?? 'process'} <span className="font-mono">{hop.writer_tgid}</span>
        {' → '}{hop.kind} <span className="font-mono">{hop.inode}</span>
        {' → '}{hop.reader_comm ?? 'process'} <span className="font-mono">{hop.reader_tgid}</span>
      </li>)}
    </ul>
  );
  const steps = [
    ...(file ? [{ label: 'Protected file', value: basename(file), title: file }] : []),
    { label: 'Writer', value: `${lineage[0].writer_comm ?? 'process'} · ${lineage[0].writer_tgid}` },
    ...lineage.flatMap((hop) => [
      { label: `Tainted ${hop.kind}`, value: hop.path ?? `inode ${hop.inode}`, title: `${hop.path ?? hop.kind} · inode ${hop.inode}` },
      { label: 'Reader tagged', value: `${hop.reader_comm ?? 'process'} · ${hop.reader_tgid}` },
    ]),
  ];
  return (
    <ol aria-label="Data-flow taint chain" className="flex flex-wrap items-center gap-2">
      {steps.map((step, i) => <li key={i} className="flex min-w-0 max-w-full items-center gap-2">
        {i > 0 && <ArrowRight aria-hidden size={16} className="shrink-0 text-zinc-400" />}
        <span className="block min-w-0 max-w-full rounded-lg border hairline bg-black/40 px-3 py-2">
          <span className="block text-[13px] text-zinc-400">{step.label}</span>
          <span className="block truncate font-mono text-[15px] text-white" title={step.title ?? step.value}>{step.value}</span>
        </span>
      </li>)}
    </ol>
  );
};
