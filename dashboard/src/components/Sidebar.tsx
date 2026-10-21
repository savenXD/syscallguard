import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, FileLock2, LayoutDashboard, Network, ScrollText, Settings } from 'lucide-react';
import { cn, fmtClock, useNow } from '../lib/utils';
import { scrollToId } from '../lib/smoothScroll';

export const NAV = [
  { id: 'overview', label: 'Overview', Icon: LayoutDashboard },
  { id: 'activity', label: 'Activity', Icon: Activity },
  { id: 'processes', label: 'Processes', Icon: Network },
  { id: 'policy', label: 'Policy', Icon: FileLock2 },
  { id: 'events', label: 'Event stream', Icon: ScrollText },
] as const;

interface SidebarProps {
  bridgeConnected: boolean;
  guardConnected: boolean | null;
  bridgeUrl: string;
  mode: 'audit' | 'enforce' | null;
  onSettings: () => void;
  onShortcuts: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ bridgeConnected, guardConnected, bridgeUrl, mode, onSettings }) => {
  const [active, setActive] = useState<string>('overview');
  const [isHovered, setIsHovered] = useState<boolean>(false);
  const now = useNow(1000);

  // Scroll-spy: active item follows the last section whose top has passed 30% of the viewport
  const lockUntil = useRef(0);
  useEffect(() => {
    const update = () => {
      if (Date.now() < lockUntil.current) return;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      let current: string = NAV[0].id;
      let bestTop = -Infinity;
      for (const n of NAV) {
        const el = document.getElementById(n.id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top <= window.innerHeight * 0.3 && top > bestTop + 1) { current = n.id; bestTop = top; }
      }
      setActive(atBottom ? NAV[NAV.length - 1].id : current);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { window.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, []);

  const go = (id: string) => {
    setActive(id);
    lockUntil.current = Date.now() + 900;
    scrollToId(id);
  };

  return (
    <>
      <aside
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={cn(
          'fixed left-0 top-16 z-30 hidden h-[calc(100vh-4rem)] shrink-0 flex-col overflow-hidden border-r hairline bg-black/75 backdrop-blur-2xl select-none lg:flex',
          'transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]'
        )}
        style={{ width: isHovered ? 216 : 68 }}
      >
        {/* Navigation list */}
        <nav className="flex-1 overflow-hidden px-2.5 pt-5">
          <div className="flex h-6 shrink-0 items-center px-3 mb-1">
            <span
              className={cn(
                'eyebrow text-[13px] text-zinc-500 whitespace-nowrap transition-opacity duration-200',
                isHovered ? 'opacity-100' : 'opacity-0 pointer-events-none'
              )}
            >
              Monitor
            </span>
          </div>
          <ul className="space-y-1">
            {NAV.map(({ id, label, Icon }) => {
              const isCurrent = active === id;
              return (
                <li key={id}>
                  <button
                    onClick={() => go(id)}
                    title={!isHovered ? label : undefined}
                    className={cn(
                      'relative flex h-10 w-full items-center rounded-xl px-3.5 text-left transition-colors',
                      isCurrent ? 'text-white' : 'text-zinc-400 hover:text-white'
                    )}
                  >
                    {isCurrent && (
                      <motion.span
                        layoutId="nav-active"
                        className="absolute inset-0 rounded-xl border border-white/15 bg-white/[0.07]"
                        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                      />
                    )}
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                      <Icon size={18} strokeWidth={1.6} className="relative shrink-0" />
                    </div>
                    <span
                      className={cn(
                        'relative ml-3 whitespace-nowrap text-[15px] font-normal transition-all duration-200',
                        isHovered ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2 pointer-events-none'
                      )}
                    >
                      {label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mb-1 mt-6 flex h-6 shrink-0 items-center px-3">
            <span className={cn('eyebrow whitespace-nowrap text-[13px] text-zinc-500 transition-opacity duration-200', isHovered ? 'opacity-100' : 'opacity-0 pointer-events-none')}>System</span>
          </div>
          <ul className="space-y-1">
            {[{ label: 'Settings', Icon: Settings, run: onSettings }].map(({ label, Icon, run }) => (
              <li key={label}>
                <button onClick={run} title={!isHovered ? label : undefined} className="relative flex h-10 w-full items-center rounded-xl px-3.5 text-left text-zinc-400 transition-colors hover:text-white">
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center"><Icon size={18} strokeWidth={1.6} className="shrink-0" /></div>
                  <span className={cn('ml-3 whitespace-nowrap text-[15px] transition-all duration-200', isHovered ? 'translate-x-0 opacity-100' : '-translate-x-2 opacity-0 pointer-events-none')}>{label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Footer: fixed height to prevent ANY vertical shift */}
        <div className="shrink-0 border-t hairline px-2.5 py-3">
          <div className="space-y-0.5">
            <div
              className="flex h-7 items-center rounded-lg px-3.5 text-zinc-300"
              title={!isHovered ? (bridgeConnected ? 'Bridge connected' : 'Bridge offline') : undefined}
            >
              <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                <span className="relative flex h-2 w-2 shrink-0">
                  {bridgeConnected && (
                    <motion.span
                      className="absolute inset-0 rounded-full bg-signal-allow"
                      animate={{ scale: [1, 2.4], opacity: [0.6, 0] }}
                      transition={{ duration: 1.8, repeat: Infinity }}
                    />
                  )}
                  <span
                    className={cn(
                      'relative h-2 w-2 rounded-full',
                      bridgeConnected ? 'bg-signal-allow' : 'bg-zinc-600'
                    )}
                  />
                </span>
              </div>
              <span
                className={cn(
                  'ml-3 whitespace-nowrap text-[13px] transition-all duration-200',
                  isHovered ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2 pointer-events-none'
                )}
              >
                {bridgeConnected ? 'Bridge connected' : 'Bridge offline'}
              </span>
            </div>

            <div
              className="flex h-7 items-center rounded-lg px-3.5 text-zinc-300"
              title={!isHovered ? (guardConnected === null ? 'Guard unknown' : guardConnected ? 'Guard streaming' : 'Guard not feeding') : undefined}
            >
              <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                <span className="relative flex h-2 w-2 shrink-0">
                  {guardConnected && (
                    <motion.span
                      className="absolute inset-0 rounded-full bg-signal-allow"
                      animate={{ scale: [1, 2.4], opacity: [0.6, 0] }}
                      transition={{ duration: 1.8, repeat: Infinity }}
                    />
                  )}
                  <span
                    className={cn(
                      'relative h-2 w-2 rounded-full',
                      guardConnected ? 'bg-signal-allow' : 'bg-zinc-600'
                    )}
                  />
                </span>
              </div>
              <span
                className={cn(
                  'ml-3 whitespace-nowrap text-[13px] transition-all duration-200',
                  isHovered ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2 pointer-events-none'
                )}
              >
                {guardConnected === null ? 'Guard unknown' : guardConnected ? 'Guard streaming' : 'Guard not feeding'}
              </span>
            </div>
          </div>

          <div
            className={cn(
              'space-y-1.5 overflow-hidden px-3.5 transition-all duration-200',
              isHovered ? 'max-h-20 pt-2.5 opacity-100' : 'max-h-0 pt-0 opacity-0 pointer-events-none'
            )}
          >
            <div className="flex items-center justify-between">
              <span className="rounded-full border hairline px-2 py-0.5 font-mono text-[13px] uppercase tracking-wider text-zinc-300">
                {mode ?? 'no mode'}
              </span>
              <span className="font-mono text-[13px] tabular text-zinc-400">
                {fmtClock(now).slice(0, 8)}
              </span>
            </div>
            <p className="truncate font-mono text-[12px] text-zinc-500" title={bridgeUrl}>
              {bridgeUrl}
            </p>
          </div>
        </div>
      </aside>

      {/* In-flow spacer keeping the main dashboard grid in exact alignment */}
      <div
        className="hidden shrink-0 lg:block transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ width: isHovered ? 216 : 68 }}
        aria-hidden="true"
      />
    </>
  );
};
