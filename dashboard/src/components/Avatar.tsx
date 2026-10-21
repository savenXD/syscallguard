import React from 'react';
import { ShieldCheck } from 'lucide-react';

/** Operator avatar: monochrome shield glyph on black with a thin light ring. */
export const Avatar: React.FC<{ size?: number; className?: string }> = ({ size = 38, className }) => (
  <span role="img" aria-label="Operator avatar"
    className={`flex shrink-0 items-center justify-center rounded-full border border-white/25 bg-black text-white ${className ?? ''}`}
    style={{ width: size, height: size }}>
    <ShieldCheck size={size * 0.48} strokeWidth={1.6} />
  </span>
);
