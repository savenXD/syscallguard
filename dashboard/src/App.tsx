import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MotionConfig, motion } from 'framer-motion';
import { Fingerprint } from 'lucide-react';
import { useSyscallGuard } from './hooks/useSyscallGuard';
import { useSettings } from './lib/settings';
import { fmtDest } from './lib/utils';
import { scrollToId } from './lib/smoothScroll';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { CommandPalette } from './components/CommandPalette';
import { SettingsDrawer } from './components/SettingsDrawer';
import { ShortcutsModal } from './components/ShortcutsModal';
import { Toasts, type Toast } from './components/Toasts';
import { Hero } from './components/Hero';
import { Metrics } from './components/Metrics';
import { ActivityChart } from './components/ActivityChart';
import { Breakdown } from './components/Breakdown';
import { Processes } from './components/Processes';
import { Policy } from './components/Policy';
import { Readme } from './components/Readme';
import { EventStream } from './components/EventStream';

export const App: React.FC = () => {
  const g = useSyscallGuard();
  const { settings } = useSettings();
  const [palette, setPalette] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [readme, setReadme] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const lastAlertTs = useRef<number | null>(null);

  const handleSelectPid = useCallback((pid: number) => {
    setSelectedPid((prev) => {
      if (prev === pid) return null;
      scrollToId('events');
      return pid;
    });
  }, []);

  const closeToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  // Global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); }
      else if (mod && e.key === ',') { e.preventDefault(); setDrawer((d) => !d); }
      else if (e.key === 'Escape') { setPalette(false); setDrawer(false); setShortcuts(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Toast on each new alert from the guard
  useEffect(() => {
    const a = g.alert;
    if (!a || a.timestamp === lastAlertTs.current) return;
    lastAlertTs.current = a.timestamp;
    if (!settings.toasts) return;
    const dest = a.daddr ? fmtDest({ daddr: a.daddr, dport: a.dport ?? null, family: a.daddr.includes(':') ? 'ipv6' : 'ipv4' }) : '';
    setToasts((t) => [...t.slice(-2), {
      id: Date.now(),
      kind: a.type === 'BLOCK' ? 'block' : a.type === 'WOULD_BLOCK' ? 'warn' : 'error',
      title: a.hook === 'socket_create' ? a.headline : a.type === 'BLOCK' ? 'Connection blocked' : a.type === 'WOULD_BLOCK' ? 'Would have blocked' : 'Kernel error',
      body: a.type === 'ERROR' ? a.headline : a.hook === 'socket_create' ? [a.comm, a.socket_family, a.socket_type].filter(Boolean).join(' · ') : `${a.comm ?? 'process'} → ${dest}`,
    }]);
  }, [g.alert, settings.toasts]);

  const openSettings = useCallback(() => { setPalette(false); setDrawer(true); }, []);
  const openShortcuts = useCallback(() => setShortcuts(true), []);

  return (
    <MotionConfig reducedMotion={settings.reduceMotion ? 'always' : 'user'}>
      <div className="relative z-10 min-h-screen w-full pt-16">
        <TopBar events={g.recentEvents} mode={g.mode} guardConnected={g.guardConnected} bridgeConnected={g.bridgeConnected}
          onSearch={() => setPalette(true)} onSettings={openSettings} onShortcuts={openShortcuts}
          readmeOpen={readme} onReadme={() => { setReadme((r) => !r); window.scrollTo({ top: 0 }); }} />

        <div className="flex">
          <Sidebar bridgeConnected={g.bridgeConnected} guardConnected={g.guardConnected} bridgeUrl={g.bridgeUrl} mode={g.mode} onSettings={openSettings} onShortcuts={openShortcuts} />

          <main className="flex min-w-0 flex-1 flex-col gap-6 px-5 py-7 md:px-8 xl:px-10">
            {readme ? <Readme /> : <>
            <section id="overview">
              <Hero alert={g.alert} mode={g.mode} bridgeConnected={g.bridgeConnected} guardConnected={g.guardConnected} demo={g.demo} tagged={g.taggedProcesses} protect={g.protect} allow={g.allow} events={g.recentEvents} />
            </section>

            <section id="activity" className="space-y-5">
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
                <div className="xl:col-span-8"><ActivityChart events={g.recentEvents} /></div>
                <div className="xl:col-span-4"><Breakdown events={g.recentEvents} /></div>
              </div>
              <Metrics stats={g.stats} taggedCount={g.taggedProcesses.length} events={g.recentEvents} />
            </section>

            <section className="grid grid-cols-1 gap-5 xl:grid-cols-12">
              <div id="processes" className="xl:col-span-7">
                <Processes processes={g.taggedProcesses} selectedPid={selectedPid} onSelectPid={handleSelectPid} />
              </div>
              <div id="policy" className="xl:col-span-5">
                <Policy mode={g.mode} protect={g.protect} allow={g.allow} />
              </div>
            </section>

            <section id="events">
              <EventStream
                events={g.recentEvents}
                filterPid={selectedPid}
                onClearPidFilter={() => setSelectedPid(null)}
              />
            </section>
            </>}

            <motion.footer initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }} className="pb-2 pt-4 text-center text-[14px] text-zinc-500">
              <Fingerprint size="1.1em" className="mr-2 inline-block align-[-0.17em]" />{g.demo ? 'Demo mode · mock telemetry. Kernel enforcement is not running in this rehearsal.' : 'Everything on this screen comes from the connected guard feed.'}
            </motion.footer>
          </main>
        </div>

        <CommandPalette open={palette} onClose={() => setPalette(false)} onSettings={openSettings} />
        <SettingsDrawer open={drawer} onClose={() => setDrawer(false)} bridgeUrl={g.bridgeUrl} mode={g.mode} />
        <ShortcutsModal open={shortcuts} onClose={() => setShortcuts(false)} />
        <Toasts toasts={toasts} onClose={closeToast} />
      </div>
    </MotionConfig>
  );
};

export default App;
