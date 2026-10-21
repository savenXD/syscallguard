import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Eye, FileLock2, Globe, Network, ShieldAlert, ShieldCheck, ShieldOff, TriangleAlert, WifiOff } from 'lucide-react';
import type { AlertBannerState, GuardEvent, TaggedProcess } from '../types';
import { basename, fmtDest } from '../lib/utils';
import { useSettings } from '../lib/settings';
import { AgentBadge } from './AgentBadge';
import { Reveal } from './ui/Reveal';
import { Inline } from './ui/Inline';
import { TaintTrail } from './TaintTrail';

interface HeroProps {
  demo: boolean;
  alert: AlertBannerState | null;
  mode: 'audit' | 'enforce' | null;
  bridgeConnected: boolean;
  guardConnected: boolean | null;
  tagged: TaggedProcess[];
  protect: string[];
  allow: string[];
  events: GuardEvent[];
}

type Tone = 'calm' | 'block' | 'warn' | 'error' | 'offline' | 'waiting';

const TONES: Record<Tone, { color: string; headline: string; sub: string; Icon: React.ElementType }> = {
  calm: { color: '#6ee7a1', headline: 'Perimeter secure.', sub: 'Every process that touches a protected file is tagged and watched.', Icon: ShieldCheck },
  block: { color: '#ff5a5f', headline: 'Exfiltration blocked.', sub: 'A process that read a protected file tried to reach an unapproved destination. The kernel stopped it.', Icon: ShieldAlert },
  warn: { color: '#fbbf24', headline: 'Would have blocked.', sub: 'Audit mode: this connection would be denied once enforcement is switched on.', Icon: TriangleAlert },
  error: { color: '#ff5a5f', headline: 'Kernel error.', sub: 'The guard reported a fault.', Icon: ShieldOff },
  offline: { color: '#71717a', headline: 'Bridge offline.', sub: 'Trying to reconnect every two seconds.', Icon: WifiOff },
  waiting: { color: '#a1a1aa', headline: 'Waiting for the guard.', sub: 'The bridge is up, but no guard is feeding it events yet.', Icon: ShieldOff },
};

/** One travelling dot per tagged process, keyed by PID across live updates. */
const Wire: React.FC<{ processes: TaggedProcess[]; active: boolean; color: string; stopAt?: number; broken?: boolean }> = ({ processes, active, color, stopAt = 1, broken }) => (
  <div role="img" aria-label={`${processes.length} tagged processes · one dot per process${active ? '' : ' · paused'}`}
    className="relative mx-1 hidden h-[2px] min-w-[28px] flex-[0.7] self-center md:block">
    <div className="absolute inset-0" style={{ background: broken ? `repeating-linear-gradient(90deg, ${color}99 0 6px, transparent 6px 12px)` : 'rgba(255,255,255,0.14)' }} />
    {processes.map((process, i) => (
      <span key={process.tgid} data-process-pid={process.tgid}
        title={`${process.comm ?? 'Unknown process'} · PID ${process.tgid}`}
        className="wire-dot absolute -top-[3px] h-2 w-2 rounded-full"
        style={{
          background: color, boxShadow: `0 0 12px ${color}`, opacity: active ? 1 : 0.4,
          ['--wire-end' as string]: `calc(${stopAt * 100}% - 8px)`,
          animationDelay: `${-(i * 2.2) / processes.length}s`,
          animationPlayState: active ? 'running' : 'paused',
        }} />
    ))}
    {broken && <span className="absolute -top-[11px] left-1/2 -translate-x-1/2 rounded-full bg-black px-1.5 text-[18px] leading-none" style={{ color: '#ff5a5f' }}>✕</span>}
  </div>
);

const Node: React.FC<{ Icon: React.ElementType; label: string; value: string; sub?: string; color?: string; pulse?: boolean; delay: number }> = ({ Icon, label, value, sub, color = '#fff', pulse, delay }) => (
  <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
    className="relative w-full min-w-0 rounded-xl border bg-black/40 px-4 py-3 md:flex-[2]"
    style={{ borderColor: `${color}55` }}>
    {pulse && <motion.span className="pointer-events-none absolute inset-0 rounded-xl border" style={{ borderColor: color }} animate={{ opacity: [0.9, 0], scale: [1, 1.07] }} transition={{ duration: 1.1, repeat: Infinity }} />}
    <div className="flex items-center gap-2.5">
      <Icon size={18} strokeWidth={1.6} style={{ color }} />
      <span className="eyebrow !text-[13px]">{label}</span>
    </div>
    <AnimatePresence mode="wait">
      <motion.div key={value} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}
        className="mt-1.5 truncate font-mono text-[16px] text-white" title={value}>{value}</motion.div>
    </AnimatePresence>
    <div className="mt-0.5 truncate text-[13px] text-zinc-400">{sub ?? ' '}</div>
  </motion.div>
);

export const Hero: React.FC<HeroProps> = ({ alert, mode, demo, bridgeConnected, guardConnected, tagged, protect, allow, events }) => {
  const { settings } = useSettings();
  const tone: Tone = !bridgeConnected ? 'offline'
    : alert?.type === 'BLOCK' ? 'block'
    : alert?.type === 'WOULD_BLOCK' ? 'warn'
    : alert?.type === 'ERROR' ? 'error'
    : !guardConnected ? 'waiting' : 'calm';
  const t = TONES[tone];
  const rawSocket = alert?.hook === 'socket_create';
  const headline = (tone === 'error' || (rawSocket && (tone === 'block' || tone === 'warn'))) && alert ? alert.headline : t.headline;
  const traced = tagged.filter((p) => p.lineage?.length).sort((a, b) => b.since - a.since || (b.lineage?.length ?? 0) - (a.lineage?.length ?? 0))[0];
  const lineage = alert ? alert.lineage : traced?.lineage;
  const chainFile = alert ? alert.file ?? null : traced?.file ?? null;
  const denied = tone === 'block' || tone === 'warn';
  const live = tagged.length > 0 && bridgeConnected;
  const lastAllow = events.find((e) => e.type === 'ALLOW');

  const procValue = denied ? [alert?.comm, alert?.tgid != null ? `PID ${alert.tgid}` : null].filter(Boolean).join(' · ') || 'Not reported' : tagged.length ? [...new Set(tagged.map((p) => p.comm ?? '?'))].join(', ') : 'none tagged';
  const fileValue = denied ? (alert?.file ? basename(alert.file) : 'Not reported') : protect.length ? `${protect.slice(0, 2).map(basename).join(', ')}${protect.length > 2 ? ` +${protect.length - 2}` : ''}` : 'no files';
  const destValue = denied
    ? (alert?.daddr ? fmtDest({ daddr: alert.daddr, dport: alert.dport ?? null, family: alert.daddr.includes(':') ? 'ipv6' : 'ipv4' }) : 'Not reported')
    : lastAllow ? fmtDest(lastAllow) : allow[0] ?? 'none allowed';

  return (
    <Reveal delay={0.1} className="overflow-hidden">
      <motion.div aria-hidden className="pointer-events-none absolute inset-0"
        animate={{ background: `radial-gradient(ellipse 60% 70% at 70% 100%, ${t.color}22, transparent 70%)` }} transition={{ duration: 0.8 }} />
      <motion.div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px"
        animate={{ background: `linear-gradient(90deg, transparent, ${t.color}, transparent)` }} transition={{ duration: 0.8 }} />

      <div className="relative p-6 lg:px-8 lg:py-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2.5">
              <motion.span className="h-2 w-2 rounded-full" animate={{ backgroundColor: t.color, scale: denied ? [1, 1.5, 1] : 1 }} transition={{ duration: 1, repeat: denied ? Infinity : 0 }} />
              <span className="eyebrow !text-[13px] !text-zinc-300">Live status</span>
              {demo && <span className="rounded-full border hairline px-3 py-1 text-[13px] text-signal-amber">Demo · mock feed</span>}
              <span className="text-[13px] text-zinc-400">· {bridgeConnected ? 'Bridge connected' : 'Bridge reconnecting'}</span>
              <span className="text-[13px] text-zinc-400">· {!bridgeConnected || guardConnected === null ? 'Guard unknown' : guardConnected ? 'Guard feeding' : 'Guard not feeding'}</span>
            </div>
            <div className="mt-3 min-h-[58px]">
              <AnimatePresence mode="wait">
                <motion.h2 key={headline} initial={{ opacity: 0, y: 18, filter: 'blur(8px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -12, filter: 'blur(6px)' }}
                  transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }} className="font-display text-[clamp(36px,4vw,58px)] font-medium leading-[1.02] tracking-[-0.04em] text-white">
                  {headline}
                </motion.h2>
              </AnimatePresence>
            </div>
            <p className="mt-2.5 max-w-2xl text-[15px] leading-relaxed text-zinc-300"><Inline Icon={Eye} />{rawSocket && (tone === 'block' || tone === 'warn') ? 'A tagged process attempted to create a raw or packet socket.' : t.sub}</p>
          </div>
          <AgentBadge agent={settings.agent} running={bridgeConnected && !!guardConnected} />
        </div>

        {/* The mechanism: protected file → tagged process → kernel gate → destination */}
        <div className="mt-6 border-t hairline pt-5">
          <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-stretch md:gap-0">
            {lineage?.length ? <div className="min-w-0 md:flex-[4.7]"><TaintTrail lineage={lineage} file={chainFile} /></div> : <>
            <Node delay={0.3} Icon={FileLock2} label="Protected file" value={fileValue} sub={protect.length > 1 ? `${protect.length} protected files` : 'read triggers a tag'} />
            <Wire processes={tagged} active={live} color="#ffffff" />
            <Node delay={0.4} Icon={Network} label="Tagged process" value={procValue} sub={`${tagged.length} under watch`} />
            </>}
            <Wire processes={tagged} active={live || denied} color={denied ? t.color : '#ffffff'} stopAt={denied && tone === 'block' ? 0.92 : 1} />
            <Node delay={0.5} Icon={t.Icon} label="Kernel guard" value={mode === 'enforce' ? 'Enforcing' : mode === 'audit' ? 'Audit only' : 'No mode'} sub={`eBPF LSM · ${alert?.hook ?? 'connect'}()`} color={t.color} pulse={denied} />
            <Wire processes={denied ? [] : tagged} active={!!lastAllow && live} color={tone === 'block' ? '#ff5a5f' : '#6ee7a1'} broken={tone === 'block'} />
            <Node delay={0.6} Icon={Globe} label={rawSocket ? 'Socket request' : tone === 'block' ? 'Denied destination' : 'Destination'} value={rawSocket ? `${alert?.socket_family} · ${alert?.socket_type}` : destValue} sub={rawSocket ? 'creation denied before use' : tone === 'block' ? 'connection refused' : lastAllow ? 'last allowed' : 'approved networks'} color={tone === 'block' ? '#ff5a5f' : '#6ee7a1'} />
          </div>
        </div>
      </div>
    </Reveal>
  );
};
