import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Copy, Download, Hourglass, Search, SearchX, X } from 'lucide-react';
import type { GuardEvent } from '../types';
import { cn, EVENT_META, fmtClock, fmtDest } from '../lib/utils';
import { CardHeader, Reveal } from './ui/Reveal';
import { Inline } from './ui/Inline';
import { TaintTrail } from './TaintTrail';
import { eventKey } from '../lib/guardClient';
import { copyText, downloadEvents } from '../lib/incidents';

const FILTERS = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'threats', label: 'Threats', match: (e: GuardEvent) => e.type === 'BLOCK' || e.type === 'WOULD_BLOCK' || e.type === 'ERROR' },
  { key: 'network', label: 'Network', match: (e: GuardEvent) => e.type === 'ALLOW' || e.type === 'BLOCK' || e.type === 'WOULD_BLOCK' },
  { key: 'tags', label: 'Tagging', match: (e: GuardEvent) => ['TAG', 'TAG_INHERIT', 'UNTAG', 'TAINT'].includes(e.type) },
] as const;

const detail = (e: GuardEvent) => {
  if (e.hook === 'socket_create') return `${e.socket_family} · ${e.socket_type}`;
  if (e.type === 'TAINT') return `${e.taint?.kind} inode ${e.taint?.inode}`;
  if (e.type === 'ERROR') return e.message ?? 'Kernel error';
  if (e.daddr) return `→ ${fmtDest(e)}`;
  if (e.type === 'TAG_INHERIT') return `forked from ${e.parent_tgid}`;
  if (e.file) return e.file;
  if (e.type === 'READY') return `guard ready · ${e.mode}`;
  return '—';
};

const DetailField: React.FC<{ label: string; value: string | number }> = ({ label, value }) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copyable = ['file', 'destination', 'pid', 'parent'].includes(label);

  const copy = async (e: React.MouseEvent) => {
    if (!copyable) return;
    e.stopPropagation();
    try { await copyText(String(value)); setCopied(true); } catch { setCopied(false); }
  };

  return (
    <div
      className={cn('min-w-0', copyable && 'group/field cursor-pointer')}
      onClick={copy}
      title={copyable ? 'Click to copy' : String(value)}
    >
      <dt className="eyebrow !text-[13px] !text-zinc-500 flex items-center justify-between">
        <span>{label}</span>
        {copyable && (
          <span className="text-zinc-500 opacity-0 transition-opacity group-hover/field:opacity-100">
            {copied ? <Check size={12} className="text-signal-allow" /> : <Copy size={12} />}
          </span>
        )}
      </dt>
      <dd className="mt-1 flex items-center gap-1.5">
        <span className="truncate font-mono text-[15px] text-zinc-100" title={String(value)}>
          {value}
        </span>
        {copied && <span className="font-mono text-[13px] text-signal-allow">copied</span>}
      </dd>
    </div>
  );
};

const Row = React.memo(function Row({ e, animateArrival }: { e: GuardEvent; animateArrival: boolean }) {
  const [open, setOpen] = useState(false);
  const [copyState, setCopyState] = useState('Copy incident JSON');
  useEffect(() => {
    if (copyState !== 'Copied') return;
    const timer = window.setTimeout(() => setCopyState('Copy incident JSON'), 1600);
    return () => window.clearTimeout(timer);
  }, [copyState]);
  const m = EVENT_META[e.type];
  const hot = e.type === 'BLOCK' || e.type === 'ERROR';
  const Item = animateArrival ? motion.li : 'li';
  const fields: [string, string | number | null][] = [
    ['hook', e.hook],
    ['pid', e.tgid],
    ['parent', e.parent_tgid],
    ['file', e.file],
    ['destination', e.daddr ? fmtDest(e) : null],
    ['family', e.family],
    ['mode', e.mode],
    ['socket family', e.socket_family ?? null],
    ['socket type', e.socket_type ?? null],
    ['tainted inode', e.taint?.inode ?? null],
    ['medium', e.taint?.kind ?? null],
  ];
  return (
    <Item
      {...(animateArrival ? {
        initial: { opacity: 0, y: -18, backgroundColor: hot ? 'rgba(255,90,95,0.18)' : 'rgba(255,255,255,0.08)' },
        animate: { opacity: 1, y: 0, backgroundColor: 'rgba(255,255,255,0)' },
        transition: { duration: 0.9, ease: [0.22, 1, 0.36, 1] },
      } : {})}
      className="border-b hairline last:border-0"
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="grid w-full grid-cols-[96px_130px_minmax(0,1fr)_20px] items-center gap-4 px-6 py-3.5 text-left transition-colors hover:bg-white/[0.03] md:grid-cols-[110px_140px_190px_minmax(0,1fr)_20px]"
      >
        <span className="font-mono text-[15px] tabular text-zinc-400">{fmtClock(e.ts)}</span>
        <span className="flex items-center gap-2.5 text-[16px] font-medium" style={{ color: m.color }}>
          <i className="h-2 w-2 shrink-0 rounded-full" style={{ background: m.color }} />
          {m.label}
        </span>
        <span className="hidden truncate text-[16px] text-white md:block">
          {e.comm ? (
            <>
              {e.comm}
              <span className="ml-2 font-mono text-[14px] text-zinc-500">{e.tgid}</span>
            </>
          ) : (
            <span className="text-zinc-500">—</span>
          )}
        </span>
        <span className="truncate font-mono text-[15px] text-zinc-300" title={detail(e)}>
          {detail(e)}
        </span>
        <ChevronDown size={18} className={cn('text-zinc-500 transition-transform duration-300', open && 'rotate-180 text-white')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="flex flex-wrap items-center gap-3 px-6 pb-4">
              <button className="flex items-center gap-2 rounded-lg border hairline px-3 py-2 text-[14px] text-zinc-300 hover:text-white"
                onClick={async () => { try { await copyText(JSON.stringify(e, null, 2)); setCopyState('Copied'); } catch { setCopyState('Copy failed — retry'); } }}>
                <Copy size={16} />{copyState}
              </button>
            </div>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-3 px-6 pb-5 pt-1 md:grid-cols-4">
              {fields
                .filter(([, v]) => v !== null && v !== undefined)
                .map(([k, v]) => (
                  <DetailField key={k} label={k} value={v!} />
                ))}
            </dl>
            {e.lineage?.length ? <div className="px-6 pb-5"><TaintTrail lineage={e.lineage} file={e.file} /></div> : null}
          </motion.div>
        )}
      </AnimatePresence>
    </Item>
  );
});

interface EventStreamProps {
  events: GuardEvent[];
  filterPid?: number | null;
  onClearPidFilter?: () => void;
}

export const EventStream: React.FC<EventStreamProps> = ({ events, filterPid, onClearPidFilter }) => {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  const [q, setQ] = useState('');
  const [exportError, setExportError] = useState('');

  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!;
    const needle = q.trim().toLowerCase();
    return events.filter((e) => {
      if (!f.match(e)) return false;
      if (filterPid !== null && filterPid !== undefined && e.tgid !== filterPid && e.parent_tgid !== filterPid && !e.lineage?.some((hop) => hop.writer_tgid === filterPid || hop.reader_tgid === filterPid)) return false;
      if (needle && !`${e.comm} ${e.file} ${e.daddr} ${e.type} ${e.tgid} ${e.socket_family ?? ''} ${e.socket_type ?? ''} ${e.taint?.inode ?? ''} ${JSON.stringify(e.lineage ?? [])}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [events, filter, q, filterPid]);

  return (
    <Reveal delay={0.7} className="flex flex-col">
      <CardHeader
        index="05"
        title="Event stream"
        right={
          <div className="flex flex-wrap items-center gap-3">
            {(['json', 'csv'] as const).map((format) => (
              <button key={format} disabled={!shown.length} onClick={() => {
                try { downloadEvents(shown, format); setExportError(''); } catch { setExportError('Export failed. Please retry.'); }
              }} className="flex items-center gap-2 rounded-lg border hairline px-3 py-2 text-[14px] text-zinc-300 hover:text-white disabled:opacity-40" aria-label={`Export visible events as ${format.toUpperCase()}`}>
                <Download size={16} />{format.toUpperCase()}
              </button>
            ))}
            {filterPid !== null && filterPid !== undefined && (
              <div className="flex items-center gap-2 rounded-full border border-white/25 bg-white/[0.08] px-3.5 py-1.5 font-mono text-[13.5px] text-white">
                <span>pid {filterPid}</span>
                <button
                  onClick={onClearPidFilter}
                  className="rounded-full p-0.5 text-zinc-400 hover:bg-white/10 hover:text-white"
                  title="Clear PID filter"
                  aria-label="Clear PID filter"
                >
                  <X size={14} />
                </button>
              </div>
            )}
            <label className="flex items-center gap-2 rounded-full border hairline bg-white/[0.03] px-4 py-2 focus-within:border-white/40">
              <Search size={16} className="text-zinc-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter"
                className="w-28 bg-transparent text-[15px] text-white outline-none placeholder:text-zinc-500"
              />
            </label>
            <div className="flex rounded-full border hairline bg-white/[0.03] p-1">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    'relative rounded-full px-4 py-1.5 text-[15px] transition-colors',
                    filter === f.key ? 'text-black' : 'text-zinc-300 hover:text-white'
                  )}
                >
                  {filter === f.key && (
                    <motion.span
                      layoutId="stream-pill"
                      className="absolute inset-0 rounded-full bg-white"
                      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    />
                  )}
                  <span className="relative">{f.label}</span>
                </button>
              ))}
            </div>
          </div>
        }
      />
      {exportError && <p role="status" className="px-6 pb-3 text-[14px] text-signal-red">{exportError}</p>}
      <div className="max-h-[520px] min-h-[200px] overflow-y-auto border-t hairline">
        {shown.length === 0 ? (
          <p className="px-6 py-16 text-center text-[16px] text-zinc-400">
            {events.length === 0 ? (
              <>
                <Inline Icon={Hourglass} />
                Waiting for the first event…
              </>
            ) : (
              <>
                <Inline Icon={SearchX} />
                No events match this filter.
              </>
            )}
          </p>
        ) : (
          <ul>
              {shown.map((e) => (
                <Row key={eventKey(e)} e={e} animateArrival={events.length < 2 || Math.abs(events[0].ts - events[1].ts) >= 0.1} />
              ))}
          </ul>
        )}
      </div>
    </Reveal>
  );
};
