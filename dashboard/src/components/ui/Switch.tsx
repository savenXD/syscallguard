import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

export const Switch: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string }> = ({ checked, onChange, label }) => (
  <button role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
    className={cn('relative h-7 w-12 shrink-0 rounded-full border transition-colors', checked ? 'border-white bg-white' : 'border-white/20 bg-white/[0.04]')}>
    <motion.span layout transition={{ type: 'spring', stiffness: 500, damping: 32 }}
      className={cn('absolute top-[3px] h-5 w-5 rounded-full', checked ? 'right-[3px] bg-black' : 'left-[3px] bg-zinc-400')} />
  </button>
);
