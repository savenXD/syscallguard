import type { AlertBannerState, GuardEvent, SyscallStats, TaggedProcess } from '../types';

export const EVENT_LIMIT = 100;
export const RECONNECT_MS = 2000;
export const BANNER_MS = 5000;
const TYPES = new Set(['READY', 'TAG', 'TAG_INHERIT', 'ALLOW', 'BLOCK', 'WOULD_BLOCK', 'UNTAG', 'ERROR']);
const hooks = new Set<unknown>([null, 'file_open', 'connect', 'sendmsg', 'fork', 'exit']);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const nullableString = (v: unknown) => v === null || typeof v === 'string';
const nullableId = (v: unknown) => v === null || (Number.isSafeInteger(v) && Number(v) >= 0);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const medium = (v: unknown): boolean => record(v) && typeof v.inode === 'string' && /^[1-9][0-9]*$/.test(v.inode)
  && (v.kind === 'pipe' || v.kind === 'file') && nullableString(v.path);
export function validLineage(v: unknown, reader?: unknown): boolean {
  return Array.isArray(v) && v.length > 0 && v.length <= 16 && v.every((hop, i) => record(hop) && medium(hop)
    && typeof hop.writer_tgid === 'number' && nullableId(hop.writer_tgid) && hop.writer_tgid > 0
    && typeof hop.reader_tgid === 'number' && nullableId(hop.reader_tgid) && hop.reader_tgid > 0
    && hop.reader_tgid !== hop.writer_tgid && nullableString(hop.writer_comm) && nullableString(hop.reader_comm)
    && (i === 0 || v[i - 1].reader_tgid === hop.writer_tgid)
    && !v.slice(0, i).some((previous) => previous.writer_tgid === hop.reader_tgid))
    && (reader === undefined || v[v.length - 1].reader_tgid === reader);
}
export function isGuardEvent(v: unknown, demo = false): v is GuardEvent {
  if (!record(v)) return false;
  const stretch = v.hook === 'socket_create' || v.hook === 'file_permission' || v.type === 'TAINT'
    || v.lineage !== undefined || v.taint !== undefined || v.socket_family !== undefined || v.socket_type !== undefined;
  if (stretch && !demo) return false;
  if ((v.socket_family !== undefined || v.socket_type !== undefined) && v.hook !== 'socket_create') return false;
  if (v.socket_family !== undefined && !['AF_PACKET', 'AF_INET', 'AF_INET6'].includes(String(v.socket_family))) return false;
  if (v.socket_type !== undefined && !['SOCK_RAW', 'SOCK_DGRAM'].includes(String(v.socket_type))) return false;
  if (v.taint !== undefined && (v.type !== 'TAINT' || !medium(v.taint))) return false;
  if (v.hook === 'socket_create' && (!(v.type === 'BLOCK' || v.type === 'WOULD_BLOCK')
    || !['AF_PACKET', 'AF_INET', 'AF_INET6'].includes(String(v.socket_family))
    || !['SOCK_RAW', 'SOCK_DGRAM'].includes(String(v.socket_type))
    || (v.socket_family !== 'AF_PACKET' && v.socket_type !== 'SOCK_RAW'))) return false;
  if (v.type === 'TAINT' && (v.hook !== 'file_permission' || !medium(v.taint))) return false;
  if (v.hook === 'file_permission' && v.type !== 'TAINT' && v.type !== 'TAG') return false;
  if (v.hook === 'file_permission' && v.type === 'TAG' && !validLineage(v.lineage, v.tgid)) return false;
  if (v.lineage !== undefined && !validLineage(v.lineage, v.tgid)) return false;
  return record(v) && v.v === 1 && (TYPES.has(String(v.type)) || (demo && v.type === 'TAINT')) && typeof v.ts === 'number' && Number.isFinite(v.ts)
    && (hooks.has(v.hook) || (demo && (v.hook === 'socket_create' || v.hook === 'file_permission'))) && nullableId(v.tgid) && nullableId(v.parent_tgid)
    && nullableString(v.comm) && nullableString(v.file) && nullableString(v.daddr)
    && (v.family === null || v.family === 'ipv4' || v.family === 'ipv6')
    && (v.dport === null || (Number.isInteger(v.dport) && Number(v.dport) >= 0 && Number(v.dport) <= 65535))
    && (v.mode === 'audit' || v.mode === 'enforce')
    && (v.type !== 'READY' || (strings(v.protect) && strings(v.allow)))
    && (v.type !== 'ERROR' || typeof v.message === 'string');
}
const isTagged = (v: unknown, demo: boolean): v is TaggedProcess => record(v) && typeof v.tgid === 'number' && nullableId(v.tgid)
  && nullableString(v.comm) && nullableString(v.file) && nullableId(v.parent_tgid)
  && typeof v.since === 'number' && Number.isFinite(v.since)
  && (v.lineage === undefined || (demo && validLineage(v.lineage, v.tgid)));

export interface GuardView {
  demo: boolean;
  bridgeConnected: boolean;
  guardConnected: boolean | null;
  mode: 'audit' | 'enforce' | null;
  protect: string[];
  allow: string[];
  taggedProcesses: TaggedProcess[];
  recentEvents: GuardEvent[];
  alert: AlertBannerState | null;
  stats: SyscallStats;
}
const initial = (): GuardView => ({ demo: false, bridgeConnected: false, guardConnected: null, mode: null, protect: [], allow: [],
  taggedProcesses: [], recentEvents: [], alert: null, stats: { blockedCount: 0, allowedCount: 0, totalEventsCount: 0 } });

// Raw payloads stay untouched for incident export. Identity belongs to the view, not the wire protocol.
const identities = new WeakMap<GuardEvent, number>();
let sequence = 0;
export function eventKey(event: GuardEvent): number {
  let id = identities.get(event);
  if (id === undefined) { id = ++sequence; identities.set(event, id); }
  return id;
}
export function resolveBridgeUrl(preload: unknown, search: string): string {
  const candidate = typeof preload === 'string' && preload ? preload : new URLSearchParams(search).get('bridge') || 'ws://127.0.0.1:8765';
  try { const url = new URL(candidate); if (url.protocol === 'ws:' || url.protocol === 'wss:') return candidate; } catch { /* invalid launch configuration */ }
  return 'ws://127.0.0.1:8765';
}

export interface ClientRuntime {
  socket: (url: string) => WebSocket;
  later: (fn: () => void, ms: number) => number;
  cancel: (id: number) => void;
}

/** One owned socket, bounded history, and at most 4 React updates/sec during bursts. */
export class GuardClient {
  private state = initial();
  private socket: WebSocket | null = null;
  private stopped = true;
  private retry: number | undefined;
  private banner: number | undefined;
  private publishTimer: number | undefined;
  private tagged = new Map<number, TaggedProcess>();
  constructor(private url: string, private runtime: ClientRuntime, private publish: (state: GuardView) => void,
    private onBlock: () => void = () => {}) {}
  start() { this.stopped = false; this.connect(); }
  stop() {
    this.stopped = true;
    for (const id of [this.retry, this.banner, this.publishTimer]) if (id !== undefined) this.runtime.cancel(id);
    this.retry = this.banner = this.publishTimer = undefined;
    const socket = this.socket; this.socket = null;
    if (socket) { socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null; socket.close(); }
  }
  private flush = () => {
    if (this.publishTimer !== undefined) this.runtime.cancel(this.publishTimer);
    this.publishTimer = undefined;
    this.publish({ ...this.state, taggedProcesses: Array.from(this.tagged.values()) });
  };
  private queue() { if (this.publishTimer === undefined) this.publishTimer = this.runtime.later(this.flush, 250); }
  private clearBanner() { if (this.banner !== undefined) this.runtime.cancel(this.banner); this.banner = undefined; }
  private connect() {
    if (this.stopped) return;
    try {
      const socket = this.runtime.socket(this.url); this.socket = socket;
      socket.onopen = () => {
        if (this.socket !== socket || this.stopped) return;
        this.state = { ...this.state, bridgeConnected: true, guardConnected: null }; this.flush();
      };
      socket.onmessage = (e) => { if (this.socket === socket && !this.stopped && typeof e.data === 'string') this.receive(e.data); };
      const lost = () => {
        if (this.socket !== socket || this.stopped) return;
        this.socket = null;
        socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
        socket.close(); this.disconnected();
      };
      socket.onclose = lost; socket.onerror = lost;
    } catch { this.disconnected(); }
  }
  private disconnected() {
    this.clearBanner();
    this.state = { ...this.state, bridgeConnected: false, guardConnected: null, alert: null }; this.flush();
    if (this.retry !== undefined) this.runtime.cancel(this.retry);
    this.retry = this.runtime.later(() => { this.retry = undefined; this.connect(); }, RECONNECT_MS);
  }
  private receive(raw: string) {
    let data: unknown;
    try { data = JSON.parse(raw); } catch { return; }
    if (!record(data) || data.v !== 1) return;
    if (data.type === 'SNAPSHOT') {
      const demo = data.source === 'mock';
      if (!(data.mode === null || data.mode === 'audit' || data.mode === 'enforce') || typeof data.guard_connected !== 'boolean'
        || !strings(data.protect) || !strings(data.allow) || !Array.isArray(data.tagged) || !data.tagged.every((p) => isTagged(p, demo))
        || !Array.isArray(data.recent) || !data.recent.every((e) => isGuardEvent(e, demo))) return;
      this.clearBanner();
      this.tagged = new Map(data.tagged.map((p) => [p.tgid, p]));
      // Bridge histories may be chronological or newest-first. Stable sorting preserves equal timestamp order.
      const recent = [...data.recent].sort((a, b) => b.ts - a.ts).slice(0, EVENT_LIMIT);
      this.state = { ...this.state, demo, mode: data.mode, guardConnected: data.guard_connected, protect: data.protect, allow: data.allow,
        recentEvents: recent, alert: null, stats: { blockedCount: recent.filter((e) => e.type === 'BLOCK').length,
          allowedCount: recent.filter((e) => e.type === 'ALLOW').length, totalEventsCount: recent.length } };
      this.flush(); return;
    }
    if (data.type === 'GUARD_STATE') {
      if (typeof data.connected === 'boolean') { this.state = { ...this.state, guardConnected: data.connected }; this.flush(); }
      return;
    }
    if (!isGuardEvent(data, this.state.demo)) return;
    const ev = data;
    const previousAlert = this.state.alert;
    this.state = { ...this.state, recentEvents: [ev, ...this.state.recentEvents.slice(0, EVENT_LIMIT - 1)],
      stats: { blockedCount: this.state.stats.blockedCount + Number(ev.type === 'BLOCK'),
        allowedCount: this.state.stats.allowedCount + Number(ev.type === 'ALLOW'), totalEventsCount: this.state.stats.totalEventsCount + 1 } };
    if (ev.type === 'READY') this.state = { ...this.state, mode: ev.mode, protect: ev.protect!, allow: ev.allow! };
    if ((ev.type === 'TAG' || ev.type === 'TAG_INHERIT') && ev.tgid !== null) {
      this.tagged.set(ev.tgid, { tgid: ev.tgid, comm: ev.comm, file: ev.file,
        since: this.tagged.get(ev.tgid)?.since ?? ev.ts, parent_tgid: ev.type === 'TAG_INHERIT' ? ev.parent_tgid : null,
        ...(ev.lineage ? { lineage: ev.lineage } : {}) });
    } else if (ev.type === 'UNTAG' && ev.tgid !== null) this.tagged.delete(ev.tgid);
    if (ev.type === 'BLOCK' || ev.type === 'WOULD_BLOCK' || ev.type === 'ERROR') {
      this.clearBanner();
      this.state = { ...this.state, alert: { type: ev.type, headline: ev.type === 'ERROR' ? ev.message! : ev.hook === 'socket_create' ? (ev.type === 'BLOCK' ? 'Raw socket creation denied.' : 'Would deny raw socket.') : ev.type === 'BLOCK' ? 'Connection blocked' : 'Would have blocked',
        comm: ev.comm, tgid: ev.tgid, file: ev.file, daddr: ev.daddr, dport: ev.dport, timestamp: ev.ts, sticky: ev.type === 'ERROR', hook: ev.hook, socket_family: ev.socket_family, socket_type: ev.socket_type, lineage: ev.lineage } };
      if (ev.type !== 'ERROR') this.banner = this.runtime.later(() => {
        this.banner = undefined; this.state = { ...this.state, alert: null }; this.flush();
      }, BANNER_MS);
      if (ev.type === 'BLOCK') this.onBlock();
    } else if (this.state.alert?.sticky) this.state = { ...this.state, alert: null };
    if (this.state.alert?.type !== previousAlert?.type) this.flush();
    else this.queue();
  }
}
