import React, { useState } from 'react';
import { ArrowRight, Check, Copy, Radio, ServerCog, Terminal, Webhook } from 'lucide-react';
import { cn } from '../lib/utils';
import { Reveal } from './ui/Reveal';

const copy = (text: string, done: () => void) => {
  try { void navigator.clipboard.writeText(text).then(done); } catch { /* clipboard unavailable */ }
};

const Code: React.FC<{ code: string; label?: string }> = ({ code, label }) => {
  const [ok, setOk] = useState(false);
  return (
    <div className="relative overflow-hidden rounded-xl border hairline bg-black/60">
      {label && <div className="border-b hairline px-4 py-2 font-mono text-[12px] uppercase tracking-wider text-zinc-500">{label}</div>}
      <button onClick={() => copy(code, () => { setOk(true); setTimeout(() => setOk(false), 1400); })} aria-label="Copy"
        className="absolute right-2.5 top-2 flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-zinc-400 hover:text-white">
        {ok ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <pre className="overflow-x-auto px-4 py-3.5 pr-12 font-mono text-[13px] leading-relaxed text-zinc-200">{code}</pre>
    </div>
  );
};

const Section: React.FC<{ n: string; title: string; sub?: string; children: React.ReactNode }> = ({ n, title, sub, children }) => (
  <Reveal className="p-6 lg:p-8">
    <div className="mb-5 flex items-baseline gap-3">
      <span className="font-mono text-[13px] text-zinc-500">{n}</span>
      <div>
        <h2 className="text-[20px] font-semibold tracking-tight text-white">{title}</h2>
        {sub && <p className="mt-1 max-w-2xl text-[15px] text-zinc-400">{sub}</p>}
      </div>
    </div>
    {children}
  </Reveal>
);

const FLOW = [
  { Icon: Terminal, title: 'guard.py', sub: 'prints JSON lines to stdout' },
  { Icon: ServerCog, title: 'bridge.py', sub: 'reads stdin, keeps state' },
  { Icon: Radio, title: 'WebSocket', sub: 'ws://host:8765' },
  { Icon: Webhook, title: 'Dashboard', sub: 'this page' },
];

const RULES = [
  ['One JSON object per line', 'Newline-separated. No arrays, no pretty-printing across lines.'],
  ['Nothing else on stdout', 'Logs and debug text go to stderr. A line that is not valid JSON is skipped.'],
  ['Flush after every line', 'Otherwise events sit in a buffer and the dashboard looks frozen.'],
  ['Forwarded unchanged', 'The bridge broadcasts each line as it received it. It does not rewrite fields.'],
];

const FIELDS: [string, string, string][] = [
  ['v', 'int', 'Schema version. Always 1.'],
  ['ts', 'float', 'Unix time in seconds, e.g. 1760600000.123.'],
  ['type', 'string', 'Event kind. See the list below.'],
  ['hook', 'string | null', 'file_open, connect, sendmsg, fork, exit. null on READY / ERROR.'],
  ['tgid', 'int | null', 'Process id (thread group).'],
  ['parent_tgid', 'int | null', 'Parent process id, when known.'],
  ['comm', 'string | null', 'Process name, e.g. python3 or curl.'],
  ['file', 'string | null', 'The protected file that caused the tag.'],
  ['family', '"ipv4" | "ipv6" | null', 'Address family of the destination.'],
  ['daddr', 'string | null', 'Destination IP address.'],
  ['dport', 'int | null', 'Destination port.'],
  ['mode', '"audit" | "enforce"', 'Guard mode at the time of the event.'],
];

const EVENTS: { type: string; tone: string; when: string; extra?: string; json: string }[] = [
  { type: 'READY', tone: '#a1a1aa', when: 'Guard finished loading. Send this first.', extra: 'Also needs protect[] and allow[]. This is where the Policy panel gets its data.',
    json: '{"v":1,"ts":1760600000.0,"type":"READY","hook":null,"tgid":null,"parent_tgid":null,"comm":null,"file":null,"family":null,"daddr":null,"dport":null,"mode":"enforce","protect":["/home/demo/project/.env"],"allow":["127.0.0.1/32"]}' },
  { type: 'TAG', tone: '#fbbf24', when: 'A process read a protected file.',
    json: '{"v":1,"ts":1760600001.2,"type":"TAG","hook":"file_open","tgid":4421,"parent_tgid":null,"comm":"python3","file":"/home/demo/project/.env","family":null,"daddr":null,"dport":null,"mode":"enforce"}' },
  { type: 'TAG_INHERIT', tone: '#fbbf24', when: 'A tagged process forked a child.',
    json: '{"v":1,"ts":1760600003.0,"type":"TAG_INHERIT","hook":"fork","tgid":4430,"parent_tgid":4421,"comm":"python3","file":"/home/demo/project/.env","family":null,"daddr":null,"dport":null,"mode":"enforce"}' },
  { type: 'ALLOW', tone: '#6ee7a1', when: 'A tagged process connected to an approved destination.',
    json: '{"v":1,"ts":1760600002.0,"type":"ALLOW","hook":"connect","tgid":4421,"parent_tgid":null,"comm":"python3","file":"/home/demo/project/.env","family":"ipv4","daddr":"127.0.0.1","dport":8080,"mode":"enforce"}' },
  { type: 'BLOCK', tone: '#ff5a5f', when: 'Enforce mode denied a connection.',
    json: '{"v":1,"ts":1760600004.0,"type":"BLOCK","hook":"connect","tgid":4430,"parent_tgid":4421,"comm":"curl","file":"/home/demo/project/.env","family":"ipv4","daddr":"192.168.122.1","dport":9999,"mode":"enforce"}' },
  { type: 'WOULD_BLOCK', tone: '#fbbf24', when: 'Audit mode saw a connection it would deny.',
    json: '{"v":1,"ts":1760600004.0,"type":"WOULD_BLOCK","hook":"connect","tgid":4430,"parent_tgid":4421,"comm":"curl","file":"/home/demo/project/.env","family":"ipv4","daddr":"192.168.122.1","dport":9999,"mode":"audit"}' },
  { type: 'UNTAG', tone: '#a1a1aa', when: 'A tagged process exited.',
    json: '{"v":1,"ts":1760600006.0,"type":"UNTAG","hook":"exit","tgid":4421,"parent_tgid":null,"comm":"python3","file":null,"family":null,"daddr":null,"dport":null,"mode":"enforce"}' },
  { type: 'ERROR', tone: '#ff5a5f', when: 'The guard hit a fault.', extra: 'Also needs a message string.',
    json: '{"v":1,"ts":1760600007.0,"type":"ERROR","hook":null,"tgid":null,"parent_tgid":null,"comm":null,"file":null,"family":null,"daddr":null,"dport":null,"mode":"enforce","message":"BPF load failed"}' },
];

export const Readme: React.FC = () => {
  const [sel, setSel] = useState(0);
  const ev = EVENTS[sel];
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="px-1 pt-2">
        <div className="eyebrow mb-3">Readme · bridge.py input</div>
        <h1 className="text-[clamp(30px,3.6vw,44px)] font-semibold leading-[1.05] tracking-tight text-white">What bridge.py accepts</h1>
        <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-zinc-300">
          The bridge reads <b className="font-medium text-white">JSON lines from stdin</b> and pushes them to this dashboard. If your guard prints lines in the shape below, everything on screen lights up.
        </p>
      </div>

      <Section n="01" title="How data flows">
        <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center">
          {FLOW.map(({ Icon, title, sub }, i) => (
            <React.Fragment key={title}>
              <div className="flex-1 rounded-xl border hairline bg-black/40 px-4 py-3.5">
                <div className="flex items-center gap-2.5 text-white"><Icon size={18} strokeWidth={1.6} className="text-zinc-400" /><span className="font-mono text-[15px]">{title}</span></div>
                <div className="mt-1 text-[13px] text-zinc-400">{sub}</div>
              </div>
              {i < FLOW.length - 1 && <ArrowRight size={18} className="hidden shrink-0 text-zinc-600 md:block" />}
            </React.Fragment>
          ))}
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <Code label="Real guard (needs root, Linux)" code="sudo python3 guard/guard.py -p policy/policy.toml | python3 bridge/bridge.py --host 0.0.0.0 --port 8765" />
          <Code label="No kernel, any OS" code="python3 bridge/bridge.py --fake --port 8765" />
        </div>
      </Section>

      <Section n="02" title="The four rules" sub="Break any of these and events silently disappear.">
        <div className="grid gap-3 sm:grid-cols-2">
          {RULES.map(([t, d], i) => (
            <div key={t} className="flex gap-3.5 rounded-xl border hairline bg-black/40 p-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/15 font-mono text-[13px] text-zinc-300">{i + 1}</span>
              <div><div className="text-[15px] font-medium text-white">{t}</div><div className="mt-0.5 text-[14px] text-zinc-400">{d}</div></div>
            </div>
          ))}
        </div>
      </Section>

      <Section n="03" title="Every event has these fields" sub="Unused fields are sent as null, not left out.">
        <div className="overflow-hidden rounded-xl border hairline">
          {FIELDS.map(([k, t, d]) => (
            <div key={k} className="grid grid-cols-[110px_1fr] items-baseline gap-x-4 gap-y-0.5 border-b hairline px-4 py-2.5 last:border-0 sm:grid-cols-[130px_190px_1fr]">
              <code className="font-mono text-[14px] text-white">{k}</code>
              <span className="font-mono text-[13px] text-zinc-500">{t}</span>
              <span className="col-span-2 text-[14px] text-zinc-300 sm:col-span-1">{d}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section n="04" title="Event types" sub="Pick one to see the exact line to print.">
        <div className="flex flex-wrap gap-2">
          {EVENTS.map((e, i) => (
            <button key={e.type} onClick={() => setSel(i)}
              className={cn('flex items-center gap-2 rounded-full border px-3.5 py-1.5 font-mono text-[13px] transition-colors', sel === i ? 'border-white/30 bg-white/[0.08] text-white' : 'border-white/10 text-zinc-400 hover:text-white')}>
              <span className="h-2 w-2 rounded-full" style={{ background: e.tone }} />{e.type}
            </button>
          ))}
        </div>
        <div className="mt-4 text-[15px] text-zinc-200">{ev.when}{ev.extra && <span className="text-zinc-400"> {ev.extra}</span>}</div>
        <div className="mt-3"><Code code={ev.json} /></div>
      </Section>

      <Section n="05" title="What the dashboard receives" sub="The bridge forwards your events and adds two messages of its own.">
        <div className="grid gap-3 md:grid-cols-2">
          <Code label="SNAPSHOT · sent once on connect" code={'{"v":1,"type":"SNAPSHOT","mode":"enforce",\n "guard_connected":true,\n "protect":[...],"allow":[...],\n "tagged":[{"tgid":4421,"comm":"python3",\n  "file":"...","since":1760600001.2,\n  "parent_tgid":null}],\n "recent":[ ...last 50 events... ]}'} />
          <Code label="GUARD_STATE · when stdin closes" code={'{"v":1,"type":"GUARD_STATE","connected":false}'} />
        </div>
        <p className="mt-4 text-[14px] text-zinc-400">The feed is read-only: messages sent from the dashboard to the bridge are ignored. Before READY arrives, mode is <code className="font-mono text-zinc-300">null</code>.</p>
      </Section>
    </div>
  );
};
