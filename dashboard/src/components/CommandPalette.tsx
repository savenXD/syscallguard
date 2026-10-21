import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CornerDownLeft, Grip, MousePointer2, Search, Settings as SettingsIcon, Sparkles } from 'lucide-react';
import { cn } from '../lib/utils';
import { NAV } from './Sidebar';
import { scrollToId } from '../lib/smoothScroll';
import { useSettings } from '../lib/settings';

interface Item { id: string; label: string; group: string; Icon: React.ElementType; run: () => void }

export const CommandPalette: React.FC<{ open: boolean; onClose: () => void; onSettings: () => void }> = ({ open, onClose, onSettings }) => {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const { settings, set } = useSettings();

  const items = useMemo<Item[]>(() => [
    ...NAV.map((n) => ({ id: n.id, label: `Go to ${n.label}`, group: 'Navigate', Icon: n.Icon, run: () => scrollToId(n.id) })),
    { id: 'settings', label: 'Open settings', group: 'Actions', Icon: SettingsIcon, run: onSettings },
    { id: 'grain', label: `${settings.grain ? 'Turn off' : 'Turn on'} background grain`, group: 'Actions', Icon: Grip, run: () => set('grain', !settings.grain) },
    { id: 'smooth', label: `${settings.smooth ? 'Turn off' : 'Turn on'} smooth scrolling`, group: 'Actions', Icon: MousePointer2, run: () => set('smooth', !settings.smooth) },
    { id: 'motion', label: `${settings.reduceMotion ? 'Allow' : 'Reduce'} animations`, group: 'Actions', Icon: Sparkles, run: () => set('reduceMotion', !settings.reduceMotion) },
  ], [settings, set, onSettings]);

  const shown = items.filter((i) => i.label.toLowerCase().includes(q.trim().toLowerCase()));

  useEffect(() => { if (open) { setQ(''); setIdx(0); setTimeout(() => input.current?.focus(), 30); } }, [open]);
  useEffect(() => setIdx(0), [q]);

  const run = (i: Item | undefined) => { if (!i) return; onClose(); setTimeout(i.run, 120); };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(shown.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') run(shown[idx]);
    else if (e.key === 'Escape') onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[14vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div initial={{ opacity: 0, y: -16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.98 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-white/15 bg-[#0a0a0a] shadow-[0_30px_80px_rgba(0,0,0,0.9)]" onKeyDown={onKey}>
            <div className="flex items-center gap-3 border-b hairline px-5">
              <Search size={19} className="text-zinc-400" />
              <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a command or section…" className="h-14 flex-1 bg-transparent text-[17px] text-white outline-none placeholder:text-zinc-500" />
              <kbd className="rounded-md border border-white/15 px-1.5 py-0.5 font-mono text-[13px] text-zinc-400">esc</kbd>
            </div>
            <ul className="max-h-[360px] overflow-y-auto p-2">
              {shown.length === 0 && <li className="px-4 py-10 text-center text-[15px] text-zinc-400">Nothing matches “{q}”.</li>}
              {shown.map((it, i) => (
                <React.Fragment key={it.id}>
                  {(i === 0 || shown[i - 1].group !== it.group) && <li className="eyebrow !text-[13px] px-3 pb-1.5 pt-3 !text-zinc-500">{it.group}</li>}
                  <li>
                    <button onMouseEnter={() => setIdx(i)} onClick={() => run(it)} className={cn('flex w-full items-center gap-3.5 rounded-lg px-3 py-2.5 text-left text-[16px] transition-colors', i === idx ? 'bg-white/[0.09] text-white' : 'text-zinc-300')}>
                      <it.Icon size={18} strokeWidth={1.7} className={i === idx ? 'text-white' : 'text-zinc-500'} />
                      <span className="flex-1">{it.label}</span>
                      {i === idx && <CornerDownLeft size={15} className="text-zinc-400" />}
                    </button>
                  </li>
                </React.Fragment>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
