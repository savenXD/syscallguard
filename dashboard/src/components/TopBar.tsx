import React, { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BookOpen, Bell, ChevronDown, Command, Keyboard, LifeBuoy, Search, Settings, ShieldAlert, TriangleAlert } from 'lucide-react';
import type { GuardEvent } from '../types';
import { cn, fmtClock, fmtDest, useClickOutside } from '../lib/utils';
import { Avatar } from './Avatar';

interface TopBarProps {
  events: GuardEvent[];
  mode: 'audit' | 'enforce' | null;
  guardConnected: boolean | null;
  bridgeConnected: boolean;
  onSearch: () => void;
  onSettings: () => void;
  onShortcuts: () => void;
  readmeOpen: boolean;
  onReadme: () => void;
}

const IconButton: React.FC<{ label: string; onClick: () => void; active?: boolean; children: React.ReactNode }> = ({ label, onClick, active, children }) => (
  <button onClick={onClick} aria-label={label} title={label}
    className={cn('relative flex h-10 w-10 items-center justify-center rounded-lg border text-zinc-300 transition-colors hover:border-white/30 hover:text-white', active ? 'border-white/30 bg-white/[0.08] text-white' : 'border-white/10')}>
    {children}
  </button>
);

const Menu: React.FC<{ open: boolean; width: string; children: React.ReactNode }> = ({ open, width, children }) => (
  <AnimatePresence>
    {open && (
      <motion.div initial={{ opacity: 0, y: -8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.97 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }} style={{ width }}
        className="absolute right-0 top-[calc(100%+10px)] z-50 origin-top-right overflow-hidden rounded-xl border border-white/15 bg-[#0a0a0a] shadow-[0_24px_60px_rgba(0,0,0,0.8)]">
        {children}
      </motion.div>
    )}
  </AnimatePresence>
);

export const TopBar: React.FC<TopBarProps> = ({ events, mode, guardConnected, bridgeConnected, onSearch, onSettings, onShortcuts, readmeOpen, onReadme }) => {
  const [menu, setMenu] = useState<'bell' | 'profile' | null>(null);
  const [seen, setSeen] = useState(() => Date.now() / 1000);
  const bellRef = useRef<HTMLDivElement>(null);
  const profRef = useRef<HTMLDivElement>(null);
  useClickOutside(bellRef, menu === 'bell', () => setMenu(null));
  useClickOutside(profRef, menu === 'profile', () => setMenu(null));

  const threats = useMemo(() => events.filter((e) => e.type === 'BLOCK' || e.type === 'WOULD_BLOCK' || e.type === 'ERROR').slice(0, 8), [events]);
  const unread = threats.filter((e) => e.ts > seen).length;
  const live = bridgeConnected && guardConnected;

  const toggleBell = () => {
    setMenu((m) => (m === 'bell' ? null : 'bell'));
    setSeen(Date.now() / 1000);
  };

  return (
    <header className="fixed inset-x-0 top-0 z-40 flex h-16 border-b hairline bg-black">
      {/* Brand cell sits exactly above the sidebar */}
      <div className="flex shrink-0 items-center gap-3.5 px-5">
        <img src="./logo.svg" alt="" className="h-9 w-9 shrink-0 object-contain" draggable={false} />
        <span className="text-[19px] font-semibold leading-none tracking-[-0.02em] text-white">Syscall<span className="text-zinc-400">Guard</span></span>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-4 px-5 lg:px-8">
        <button onClick={onSearch} className="group flex h-10 w-full max-w-md items-center gap-3 rounded-lg border border-white/10 bg-white/[0.025] px-3.5 text-left transition-colors hover:border-white/25">
          <Search size={17} className="shrink-0 text-zinc-400 group-hover:text-white" />
          <span className="flex-1 truncate text-[15px] text-zinc-400">Search or jump to…</span>
          <kbd className="hidden items-center gap-1 rounded-md border border-white/15 px-1.5 py-0.5 font-mono text-[13px] text-zinc-400 sm:flex"><Command size={11} />K</kbd>
        </button>

        <div className="ml-auto flex items-center gap-3">
          <button onClick={onReadme} aria-pressed={readmeOpen}
            className={cn('flex h-10 items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium transition-colors hover:text-white', readmeOpen ? 'border-white/30 bg-white/[0.08] text-white' : 'border-white/10 text-zinc-300 hover:border-white/30')}>
            <BookOpen size={15} strokeWidth={1.8} />Readme
          </button>

          <div className="hidden h-10 items-center overflow-hidden rounded-full border border-white/10 bg-white/[0.03] text-[13px] font-medium xl:flex" title="Guard feed">
            <span className="flex items-center gap-2 pl-3.5 pr-3 text-zinc-100">
              <span className="relative flex h-2 w-2">
                {live && <span className="absolute inset-0 animate-ping rounded-full bg-signal-allow opacity-60" />}
                <span className={cn('relative h-2 w-2 rounded-full', live ? 'bg-signal-allow' : 'bg-zinc-600')} />
              </span>
              {!bridgeConnected ? 'Offline' : guardConnected === null ? 'Unknown' : live ? 'Live' : 'Idle'}
            </span>
            {mode && (
              <span className={cn('flex h-full items-center border-l border-white/10 px-3.5 text-[12px] font-semibold uppercase tracking-[0.12em]', mode === 'enforce' ? 'bg-signal-allow/10 text-signal-allow' : 'bg-signal-amber/10 text-signal-amber')}>{mode}</span>
            )}
          </div>

          <div ref={bellRef} className="relative">
            <IconButton label="Notifications" onClick={toggleBell} active={menu === 'bell'}>
              <Bell size={18} strokeWidth={1.7} />
              <AnimatePresence>
                {unread > 0 && (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-signal-red px-1 font-mono text-[13px] font-semibold text-black">{unread}</motion.span>
                )}
              </AnimatePresence>
            </IconButton>
            <Menu open={menu === 'bell'} width="380px">
              <div className="flex items-center justify-between border-b hairline px-4 py-3">
                <span className="text-[15px] font-medium text-white">Alerts</span>
                <span className="font-mono text-[13px] text-zinc-500">{threats.length} recent</span>
              </div>
              <ul className="max-h-[360px] overflow-y-auto">
                {threats.length === 0 && <li className="px-4 py-10 text-center text-[15px] text-zinc-400">No alerts. All quiet.</li>}
                {threats.map((e, i) => {
                  const Icon = e.type === 'WOULD_BLOCK' ? TriangleAlert : ShieldAlert;
                  const color = e.type === 'WOULD_BLOCK' ? '#fbbf24' : '#ff5a5f';
                  return (
                    <li key={`${e.ts}-${i}`} className="flex gap-3 border-b hairline px-4 py-3 last:border-0 hover:bg-white/[0.03]">
                      <Icon size={18} className="mt-0.5 shrink-0" style={{ color }} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[15px] text-white">{e.hook === 'socket_create' ? 'Raw socket creation denied' : e.type === 'BLOCK' ? 'Connection blocked' : e.type === 'WOULD_BLOCK' ? 'Would have blocked' : 'Kernel error'}</div>
                        <div className="truncate font-mono text-[13.5px] text-zinc-400">{e.type === 'ERROR' ? e.message : e.hook === 'socket_create' ? `${e.comm} · ${e.socket_family} · ${e.socket_type}` : `${e.comm} → ${fmtDest(e)}`}</div>
                      </div>
                      <span className="shrink-0 font-mono text-[13px] text-zinc-500">{fmtClock(e.ts).slice(0, 8)}</span>
                    </li>
                  );
                })}
              </ul>
            </Menu>
          </div>

          <IconButton label="Settings" onClick={onSettings}><Settings size={18} strokeWidth={1.7} /></IconButton>

          <div className="mx-1 hidden h-7 w-px bg-white/10 sm:block" />

          <div ref={profRef} className="relative">
            <button onClick={() => setMenu((m) => (m === 'profile' ? null : 'profile'))} className="flex items-center gap-3 rounded-lg py-1 pl-1 pr-2 transition-colors hover:bg-white/[0.05]">
              <Avatar size={36} />
              <div className="hidden text-left leading-tight md:block">
                <div className="text-[14px] font-medium text-white">Operator</div>
                <div className="text-[12px] text-zinc-400">Security analyst</div>
              </div>
              <ChevronDown size={16} className={cn('hidden text-zinc-400 transition-transform md:block', menu === 'profile' && 'rotate-180')} />
            </button>
            <Menu open={menu === 'profile'} width="272px">
              <div className="flex items-center gap-3.5 border-b hairline p-4">
                <Avatar size={48} />
                <div>
                  <div className="text-[16px] font-medium text-white">Operator</div>
                  <div className="text-[14px] text-zinc-400">Security analyst</div>
                  <div className="mt-0.5 font-mono text-[13px] text-zinc-500">ID SG-0412</div>
                </div>
              </div>
              <div className="p-1.5">
                {[
                  { Icon: Settings, label: 'Settings', run: onSettings },
                  { Icon: Keyboard, label: 'Keyboard shortcuts', run: onShortcuts },
                  { Icon: LifeBuoy, label: 'Search commands', run: onSearch },
                ].map(({ Icon, label, run }) => (
                  <button key={label} onClick={() => { setMenu(null); run(); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[15px] text-zinc-200 transition-colors hover:bg-white/[0.07] hover:text-white">
                    <Icon size={17} strokeWidth={1.7} className="text-zinc-400" />{label}
                  </button>
                ))}
              </div>
            </Menu>
          </div>
        </div>
      </div>
    </header>
  );
};
