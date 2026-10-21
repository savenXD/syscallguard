import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ShieldAlert, TriangleAlert, X } from 'lucide-react';

export interface Toast { id: number; kind: 'block' | 'warn' | 'error'; title: string; body: string }

const Item: React.FC<{ t: Toast; onClose: (id: number) => void }> = ({ t, onClose }) => {
  useEffect(() => { const id = window.setTimeout(() => onClose(t.id), 6000); return () => window.clearTimeout(id); }, [t.id, onClose]);
  const color = t.kind === 'warn' ? '#fbbf24' : '#ff5a5f';
  const Icon = t.kind === 'warn' ? TriangleAlert : ShieldAlert;
  return (
    <motion.div layout initial={{ opacity: 0, x: 60, scale: 0.95 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 60, scale: 0.95 }} transition={{ type: 'spring', stiffness: 360, damping: 32 }}
      className="relative w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border bg-[#0a0a0a] p-4 shadow-[0_20px_50px_rgba(0,0,0,0.8)]" style={{ borderColor: `${color}66` }}>
      <div className="flex gap-3.5">
        <Icon size={22} className="mt-0.5 shrink-0" style={{ color }} />
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-medium text-white">{t.title}</div>
          <div className="mt-0.5 truncate font-mono text-[14px] text-zinc-300">{t.body}</div>
        </div>
        <button onClick={() => onClose(t.id)} aria-label="Dismiss" className="self-start text-zinc-500 hover:text-white"><X size={17} /></button>
      </div>
      <motion.div className="absolute bottom-0 left-0 h-[2px]" style={{ background: color }} initial={{ width: '100%' }} animate={{ width: '0%' }} transition={{ duration: 6, ease: 'linear' }} />
    </motion.div>
  );
};

export const Toasts: React.FC<{ toasts: Toast[]; onClose: (id: number) => void }> = ({ toasts, onClose }) => (
  <div className="pointer-events-none fixed right-5 top-20 z-[70] flex flex-col gap-3 [&>*]:pointer-events-auto">
    <AnimatePresence>{toasts.map((t) => <Item key={t.id} t={t} onClose={onClose} />)}</AnimatePresence>
  </div>
);
