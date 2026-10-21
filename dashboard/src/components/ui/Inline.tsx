import React from 'react';
import type { LucideIcon } from 'lucide-react';

/** Icon sized to the surrounding text (1.1em), inheriting its colour, sitting on the baseline. */
export const Inline: React.FC<{ Icon: LucideIcon; className?: string }> = ({ Icon, className = '' }) => (
  <Icon size="1.1em" strokeWidth={1.75} className={`mr-[0.45em] inline-block shrink-0 align-[-0.17em] ${className}`} aria-hidden />
);
