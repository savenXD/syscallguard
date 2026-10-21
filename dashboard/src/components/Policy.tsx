import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, CircleHelp, Copy, Eye, Globe, Lock, ShieldCheck } from 'lucide-react';
import { cn } from '../lib/utils';
import { CardHeader, Reveal } from './ui/Reveal';
import { Inline } from './ui/Inline';

interface PolicyProps {
  mode: 'audit' | 'enforce' | null;
  protect: string[];
  allow: string[];
}

const Section: React.FC<{ title: string; hint: React.ReactNode; children: React.ReactNode }> = ({ title, hint, children }) => (
  <div>
    <div className="mb-3 flex items-baseline justify-between">
      <span className="eyebrow">{title}</span>
      <span className="text-[14px] text-zinc-500">{hint}</span>
    </div>
    {children}
  </div>
);

export const Policy: React.FC<PolicyProps> = ({ mode, protect, allow }) => {
  const [copiedItem, setCopiedItem] = useState<string | null>(null);

  const copyItem = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedItem(text);
    setTimeout(() => setCopiedItem((curr) => (curr === text ? null : curr)), 1800);
  };

  return (
    <Reveal delay={0.6} className="flex h-full flex-col">
      <CardHeader index="04" title="Active policy" />
      <div className="flex flex-1 flex-col gap-7 px-6 pb-6">
        <Section
          title="Mode"
          hint={
            mode === 'enforce' ? (
              <>
                <Inline Icon={ShieldCheck} />violations are stopped
              </>
            ) : mode === 'audit' ? (
              <>
                <Inline Icon={Eye} />violations are only logged
              </>
            ) : (
              <>
                <Inline Icon={CircleHelp} />unknown
              </>
            )
          }
        >
          <div className="relative grid grid-cols-2 rounded-xl border hairline bg-white/[0.03] p-1">
            {(['audit', 'enforce'] as const).map((m) => (
              <div
                key={m}
                className={cn(
                  'relative rounded-lg py-2.5 text-center text-[16px] font-medium capitalize transition-colors',
                  mode === m ? 'text-black' : 'text-zinc-400'
                )}
              >
                {mode === m && (
                  <motion.span
                    layoutId="mode-pill"
                    className="absolute inset-0 rounded-lg bg-white"
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  />
                )}
                <span className="relative">{m}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Protected files" hint={`${protect.length} path${protect.length === 1 ? '' : 's'}`}>
          <ul className="space-y-2">
            {protect.length === 0 && <li className="text-[15px] text-zinc-400">None configured</li>}
            {protect.map((p, i) => (
              <motion.li
                key={p}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.7 + i * 0.06 }}
                role="button"
                tabIndex={0}
                onClick={() => copyItem(p)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    copyItem(p);
                  }
                }}
                title="Click to copy file path"
                className="group flex cursor-pointer items-center justify-between gap-3 rounded-xl border hairline bg-white/[0.025] px-4 py-3 transition-colors hover:border-white/25 hover:bg-white/[0.04]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  {copiedItem === p ? (
                    <Check size={17} className="shrink-0 text-signal-allow" />
                  ) : (
                    <Lock size={17} className="shrink-0 text-zinc-300" />
                  )}
                  <span className="break-all font-mono text-[15px] leading-snug text-zinc-100">{p}</span>
                </div>
                <span className="shrink-0 text-zinc-500 opacity-0 transition-opacity group-hover:opacity-100">
                  {copiedItem === p ? (
                    <span className="font-mono text-[13px] text-signal-allow">Copied!</span>
                  ) : (
                    <Copy size={14} />
                  )}
                </span>
              </motion.li>
            ))}
          </ul>
        </Section>

        <Section title="Allowed destinations" hint="tagged processes may reach">
          <div className="flex flex-wrap gap-2.5">
            {allow.length === 0 && <span className="text-[15px] text-zinc-400">Nothing allowed: all egress blocked</span>}
            {allow.map((a, i) => (
              <motion.button
                key={a}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.8 + i * 0.06, type: 'spring', stiffness: 300, damping: 22 }}
                onClick={() => copyItem(a)}
                title="Click to copy CIDR"
                className="group inline-flex items-center gap-2 rounded-full border border-signal-allow/30 bg-signal-allow/[0.07] px-4 py-2 font-mono text-[15px] text-signal-allow transition-colors hover:border-signal-allow/60"
              >
                {copiedItem === a ? <Check size={15} /> : <Globe size={15} />}
                <span>{a}</span>
                {copiedItem === a && <span className="font-sans text-[13px]">copied</span>}
              </motion.button>
            ))}
          </div>
        </Section>
      </div>
    </Reveal>
  );
};
