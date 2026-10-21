import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';

const KEYS: [string, string[]][] = [
  ['Open command palette', ['Ctrl', 'K']],
  ['Open settings', ['Ctrl', ',']],
  ['Move in palette', ['↑', '↓']],
  ['Run selected', ['Enter']],
  ['Close any panel', ['Esc']],
];

export const ShortcutsModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => (
  <AnimatePresence>
    {open && (
      <motion.div className="fixed inset-0 z-[60] flex items-center justify-center px-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
        <motion.div initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.98 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/15 bg-[#0a0a0a]">
          <div className="flex items-center justify-between border-b hairline px-6 py-4">
            <h2 className="text-lg font-medium text-white">Keyboard shortcuts</h2>
            <button onClick={onClose} aria-label="Close" className="text-zinc-400 hover:text-white"><X size={19} /></button>
          </div>
          <ul className="divide-y divide-white/[0.08] px-6">
            {KEYS.map(([label, keys]) => (
              <li key={label} className="flex items-center justify-between py-3.5 text-[16px] text-zinc-200">
                {label}
                <span className="flex gap-1.5">{keys.map((k) => <kbd key={k} className="min-w-[30px] rounded-md border border-white/20 bg-white/[0.04] px-2 py-1 text-center font-mono text-[13px] text-white">{k}</kbd>)}</span>
              </li>
            ))}
          </ul>
          <div className="h-3" />
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);
