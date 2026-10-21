import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Copy, RotateCcw, X } from 'lucide-react';
import { useSettings, type Settings } from '../lib/settings';
import { Switch } from './ui/Switch';
import { AGENTS, AgentLogo } from './AgentBadge';

const ROWS: { section: string; items: { key: Exclude<keyof Settings, 'agent'>; title: string; desc: string }[] }[] = [
  { section: 'Appearance', items: [
    { key: 'grain', title: 'Background grain', desc: 'A faint film-grain texture behind the page.' },
    { key: 'smooth', title: 'Smooth scrolling', desc: 'Eased, inertial scrolling with Lenis.' },
    { key: 'reduceMotion', title: 'Reduce animations', desc: 'Turns off most motion, for focus or older machines.' },
  ] },
  { section: 'Alerts', items: [
    { key: 'audioAlerts', title: 'Audio alerts on block', desc: 'A quiet local ping on blocks. Starts after an interaction; rapid bursts are rate-limited.' },
    { key: 'toasts', title: 'Pop-up alerts', desc: 'Show a toast when the guard blocks or flags a connection.' },
  ] },
];

export const SettingsDrawer: React.FC<{ open: boolean; onClose: () => void; bridgeUrl: string; mode: 'audit' | 'enforce' | null }> = ({ open, onClose, bridgeUrl, mode }) => {
  const { settings, set, reset } = useSettings();
  const [copiedBridge, setCopiedBridge] = useState(false);

  const copyBridge = () => {
    navigator.clipboard.writeText(bridgeUrl);
    setCopiedBridge(true);
    setTimeout(() => setCopiedBridge(false), 1800);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[55]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
          <motion.aside initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 320, damping: 36 }}
            className="absolute inset-y-0 right-0 flex w-full max-w-[460px] flex-col border-l border-white/15 bg-[#080808]">
            <div className="flex h-16 items-center justify-between border-b hairline px-6">
              <h2 className="text-lg font-medium text-white">Settings</h2>
              <button onClick={onClose} aria-label="Close settings" className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-zinc-300 hover:border-white/30 hover:text-white"><X size={18} /></button>
            </div>

            <div className="flex-1 space-y-9 overflow-y-auto px-6 py-7">
              <section>
                <div className="eyebrow mb-3">Coding agent</div>
                <div className="grid grid-cols-3 gap-2.5">
                  {AGENTS.map((a) => (
                    <button key={a.id} onClick={() => set('agent', a.id)} aria-pressed={settings.agent === a.id}
                      className={`flex flex-col items-center gap-2.5 rounded-xl border px-3 py-4 text-[14px] transition-colors ${settings.agent === a.id ? 'border-white/40 bg-white/[0.08] text-white' : 'border-white/10 text-zinc-400 hover:border-white/25 hover:text-white'}`}>
                      <AgentLogo agent={a.id} size={26} color={a.id === "chatgpt" ? "#ffffff" : undefined} />{a.label}
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-[14px] leading-relaxed text-zinc-500">Which agent is running inside the guarded environment. Shown on the overview.</p>
              </section>

              {ROWS.map((g) => (
                <section key={g.section}>
                  <div className="eyebrow mb-3">{g.section}</div>
                  <div className="divide-y divide-white/[0.08] rounded-xl border hairline">
                    {g.items.map((it) => (
                      <div key={it.key} className="flex items-center justify-between gap-5 px-5 py-4">
                        <div>
                          <div className="text-[16px] text-white">{it.title}</div>
                          <div className="mt-0.5 text-[14.5px] leading-snug text-zinc-400">{it.desc}</div>
                        </div>
                        <Switch checked={settings[it.key]} onChange={(v) => set(it.key, v)} label={it.title} />
                      </div>
                    ))}
                  </div>
                </section>
              ))}

              <section>
                <div className="eyebrow mb-3">Connection</div>
                <dl className="divide-y divide-white/[0.08] rounded-xl border hairline text-[15px]">
                  <div className="flex items-center justify-between gap-4 px-5 py-4">
                    <dt className="text-zinc-400">Bridge URL</dt>
                    <dd className="flex items-center gap-2">
                      <span className="max-w-[200px] truncate font-mono text-white" title={bridgeUrl}>{bridgeUrl}</span>
                      <button onClick={copyBridge} className="rounded p-1 text-zinc-400 hover:text-white transition-colors" title="Copy bridge address" aria-label="Copy bridge address">
                        {copiedBridge ? <Check size={14} className="text-signal-allow" /> : <Copy size={14} />}
                      </button>
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-4 px-5 py-4"><dt className="text-zinc-400">Guard mode</dt><dd className="font-mono capitalize text-white">{mode ?? 'unknown'}</dd></div>
                  <div className="flex items-center justify-between gap-4 px-5 py-4"><dt className="text-zinc-400">Reconnect</dt><dd className="font-mono text-white">every 2s</dd></div>
                </dl>
                <p className="mt-3 text-[14px] leading-relaxed text-zinc-500">The bridge address is set at launch with <span className="font-mono text-zinc-300">--bridge=</span> or <span className="font-mono text-zinc-300">SG_BRIDGE_URL</span>.</p>
              </section>
            </div>

            <div className="border-t hairline p-5">
              <button onClick={reset} className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-white/15 py-3 text-[15px] text-zinc-200 transition-colors hover:border-white/35 hover:text-white"><RotateCcw size={16} />Reset to defaults</button>
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
