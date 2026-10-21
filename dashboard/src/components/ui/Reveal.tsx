import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

interface RevealProps {
  delay?: number;
  className?: string;
  children: React.ReactNode;
}

/** Card wrapper: fades and rises in on mount. */
export const Reveal: React.FC<RevealProps> = ({ delay = 0, className, children }) => (
  <motion.div
    initial={{ opacity: 0, y: 24, filter: 'blur(6px)' }}
    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
    transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
    className={cn('card', className)}
  >
    {children}
  </motion.div>
);

export const CardHeader: React.FC<{ index: string; title: string; right?: React.ReactNode }> = ({ index, title, right }) => (
  <div className="flex flex-wrap items-center justify-between gap-4 px-6 pt-5 pb-4">
    <div className="flex shrink-0 items-baseline gap-3">
      <span className="eyebrow !text-zinc-500">{index}</span>
      <h2 className="text-lg font-medium tracking-tight text-white">{title}</h2>
    </div>
    {right}
  </div>
);
