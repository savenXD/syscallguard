import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { GuardEvent } from '../types';
import { bucketize, cn, useNow } from '../lib/utils';
import { CardHeader, Reveal } from './ui/Reveal';
import { requestBatches, smoothRequestPath } from '../lib/activity';

const VIEWS = ['Bar', 'Line'] as const;
const WINDOW_SEC = 300;
const N = 30;
const LINE_N = 60;
const H = 280;
const PAD = { l: 34, r: 8, t: 12, b: 30 };

const SERIES = [
  { key: 'tag', label: 'Tag activity', color: '#52525b', pred: (e: GuardEvent) => e.type === 'TAG' || e.type === 'TAG_INHERIT' || e.type === 'UNTAG' || e.type === 'TAINT' },
  { key: 'allow', label: 'Allowed', color: '#6ee7a1', pred: (e: GuardEvent) => e.type === 'ALLOW' },
  { key: 'block', label: 'Blocked', color: '#ff5a5f', pred: (e: GuardEvent) => e.type === 'BLOCK' || e.type === 'WOULD_BLOCK' },
] as const;

export const ActivityChart: React.FC<{ events: GuardEvent[] }> = ({ events }) => {
  const [view, setView] = useState<(typeof VIEWS)[number]>('Bar');
  const gradientId = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(640);
  const box = useRef<HTMLDivElement>(null);
  const now = useNow(1000);

  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(1, e.contentRect.width - 48)));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  const data = useMemo(() => SERIES.map((s) => bucketize(events, now, WINDOW_SEC, N, s.pred)), [events, now]);
  const totals = data[0].map((_, i) => data.reduce((a, d) => a + d[i], 0));
  const batches = useMemo(() => requestBatches(events, now, LINE_N), [events, now]);
  const lineView = view === 'Line';
  const pointCount = lineView ? LINE_N : N;
  const max = Math.max(4, ...(lineView ? batches.map((b) => b.total) : totals));
  const niceMax = Math.ceil(max / 4) * 4;
  const innerW = Math.max(1, width - PAD.l - PAD.r);
  const innerH = H - PAD.t - PAD.b;
  const slot = innerW / pointCount;
  const bw = Math.max(4, slot * 0.62);
  const y = (v: number) => (v / niceMax) * innerH;
  const empty = lineView ? batches.every((b) => b.total === 0) : totals.every((t) => t === 0);
  const points = batches.map((b, i) => ({ x: PAD.l + (i + 0.5) * slot, y: PAD.t + innerH - y(b.total) }));
  const linePath = smoothRequestPath(points);
  const baseline = PAD.t + innerH;
  const areaPath = `${linePath} L ${points[LINE_N - 1].x} ${baseline} L ${points[0].x} ${baseline} Z`;
  const clock = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientX - r.left) * width / r.width - PAD.l) / slot);
    setHover(i >= 0 && i < pointCount ? i : null);
  };

  const secPer = WINDOW_SEC / N;
  const tickLabel = (i: number) => {
    const s = Math.round((N - i) * secPer);
    return s <= 0 ? 'now' : s >= 60 ? `-${Math.round(s / 60)}m` : `-${s}s`;
  };

  return (
    <Reveal delay={0.45} className="flex h-full flex-col">
      <CardHeader index="01" title="Activity" right={
        <div className="relative flex rounded-full border hairline bg-white/[0.03] p-1">
          {VIEWS.map((v) => (
            <button key={v} aria-pressed={view === v} onClick={() => { setView(v); setHover(null); }} className={cn('relative z-10 rounded-full px-4 py-1.5 font-mono text-[14px] transition-colors', view === v ? 'text-black' : 'text-zinc-300 hover:text-white')}>
              {view === v && <motion.span layoutId="graph-pill" className="absolute inset-0 -z-10 rounded-full bg-white" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
              {v}
            </button>
          ))}
        </div>
      } />
      {lineView && <p className="px-6 pb-2 text-[13px] text-zinc-400">Requests per second · last 60 seconds</p>}
      <div ref={box} className="relative px-6">
        <svg width={width} height={H} onMouseMove={onMove} onMouseLeave={() => setHover(null)} className="block max-w-full" role="img" aria-label={lineView ? "Requests in one-second batches, red dots indicate blocked attempts" : "Stacked event activity over five minutes"}>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#6ee7a1" stopOpacity="0.24" />
              <stop offset="100%" stopColor="#6ee7a1" stopOpacity="0.01" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3, 4].map((g) => {
            const gy = PAD.t + innerH - (g / 4) * innerH;
            return <g key={g}>
              <line x1={PAD.l} x2={width - PAD.r} y1={gy} y2={gy} stroke="#fff" strokeOpacity={g === 0 ? 0.25 : 0.08} strokeDasharray={g === 0 ? undefined : '2 5'} />
              <text x={PAD.l - 10} y={gy + 4} textAnchor="end" className="fill-zinc-400 font-mono" fontSize="13">{Math.round((g / 4) * niceMax)}</text>
            </g>;
          })}
          {lineView && <g>
            <path data-series="request-area" d={areaPath} fill={`url(#${gradientId})`} />
            <path data-series="requests" d={linePath} fill="none" stroke="#6ee7a1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            {hover !== null && <line x1={points[hover].x} x2={points[hover].x} y1={PAD.t} y2={baseline} stroke="white" strokeOpacity="0.2" strokeDasharray="3 5" />}
            {batches.map((batch, i) => batch.blocked > 0 ? <circle key={batch.start} data-series="blocked-dot" cx={points[i].x} cy={points[i].y} r="4" fill="#ff5a5f" stroke="#000" strokeWidth="1.5"><title>{`${clock(batch.start)}: ${batch.blocked} blocked of ${batch.total} requests`}</title></circle> : null)}
            {hover !== null && batches[hover].blocked === 0 && <circle cx={points[hover].x} cy={points[hover].y} r="4" fill="#6ee7a1" stroke="#000" strokeWidth="1.5" />}
          </g>}
          {!lineView && Array.from({ length: N }).map((_, i) => {
            let acc = 0;
            const x = PAD.l + i * slot + (slot - bw) / 2;
            return <g key={i} opacity={hover === null || hover === i ? 1 : 0.45} style={{ transition: 'opacity .2s' }}>
              {hover === i && <rect x={PAD.l + i * slot} y={PAD.t} width={slot} height={innerH} fill="#fff" fillOpacity="0.05" rx="4" />}
              {SERIES.map((s, si) => {
                const v = data[si][i];
                const h = Math.max(0, y(v));
                const top = PAD.t + innerH - y(acc) - h;
                acc += v;
                return <motion.rect key={s.key} x={x} width={bw} rx={Math.min(3, bw / 2)} fill={s.color}
                  initial={{ height: 0, y: PAD.t + innerH }} animate={{ height: h, y: top }}
                  transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: si === 0 ? i * 0.012 : 0 }} />;
              })}
            </g>;
          })}
          {(lineView ? [0, 29, 59] : [0, 7, 14, 21, 29]).map((i) => (
            <text key={i} x={PAD.l + i * slot + slot / 2} y={H - 6} textAnchor={i === pointCount - 1 ? 'end' : i === 0 ? 'start' : 'middle'} className="fill-zinc-400 font-mono" fontSize="13">{lineView ? (i === LINE_N - 1 ? 'Now' : clock(batches[i].start)) : tickLabel(i)}</text>
          ))}
        </svg>
        <AnimatePresence>
          {empty && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="rounded-full border hairline bg-black/60 px-5 py-2 text-[15px] text-zinc-300 backdrop-blur">{lineView ? 'No requests' : 'No events'} in the last {lineView ? '60s' : '5m'}</span>
          </motion.div>}
          {hover !== null && !empty && <motion.div key="tip" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="pointer-events-none absolute top-2 z-20 w-56 rounded-xl border border-white/20 bg-black/85 p-3.5 shadow-2xl backdrop-blur"
            style={{ left: Math.max(24, Math.min(width - 200, 24 + PAD.l + hover * slot - 90)) }}>
            <div className="mb-2 font-mono text-[13px] text-zinc-400">{lineView ? `${clock(batches[hover].start)} – ${clock(batches[hover].start + 1)}` : tickLabel(hover)}</div>
            {lineView && <div className="mb-2 flex justify-between text-[15px] text-white"><span>Total requests{hover === LINE_N - 1 ? ' · live' : ''}</span><span className="font-mono">{batches[hover].total}</span></div>}
            {(lineView ? [
              { key: 'allow', label: 'Allowed', color: '#6ee7a1', value: batches[hover].allowed },
              { key: 'block', label: 'Blocked', color: '#ff5a5f', value: batches[hover].blocked },
              ...(batches[hover].wouldBlock ? [{ key: 'audit', label: 'Would block', color: '#fbbf24', value: batches[hover].wouldBlock }] : []),
            ] : [...SERIES].reverse().map((s) => ({ ...s, value: data[SERIES.indexOf(s)][hover] }))).map((s) => (
              <div key={s.key} className="flex items-center justify-between py-0.5 text-[15px]">
                <span className="flex items-center gap-2 text-zinc-200"><i className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}</span>
                <span className="font-mono tabular text-white">{s.value}</span>
              </div>
            ))}
          </motion.div>}
        </AnimatePresence>
      </div>
      <div className="mt-auto flex flex-wrap gap-x-6 gap-y-2 border-t hairline px-6 py-4">
        {(lineView ? [{ key: 'requests', label: 'Total requests', color: '#6ee7a1' }, { key: 'block', label: 'Batch contains blocks', color: '#ff5a5f' }] : [...SERIES].reverse()).map((s) => (
          <span key={s.key} className="flex items-center gap-2 text-[15px] text-zinc-300"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>
        ))}
        {lineView && <span className="text-[13px] text-zinc-500">Local time · retained events</span>}
      </div>
    </Reveal>
  );
};
