export type EventType =
  | 'READY'
  | 'TAG'
  | 'TAG_INHERIT'
  | 'ALLOW'
  | 'BLOCK'
  | 'WOULD_BLOCK'
  | 'UNTAG'
  | 'ERROR'
  | 'TAINT';

export type HookType =
  | 'socket_create'
  | 'file_permission'
  | 'file_open'
  | 'connect'
  | 'sendmsg'
  | 'fork'
  | 'exit'
  | null;

/** Proposed mock-only stretch payload; not yet a production kernel contract. */
export interface TaintMedium {
  inode: string;
  kind: 'pipe' | 'file';
  path: string | null;
}
export interface TaintHop extends TaintMedium {
  writer_tgid: number;
  writer_comm: string | null;
  reader_tgid: number;
  reader_comm: string | null;
}
export interface StretchFields {
  socket_family?: 'AF_PACKET' | 'AF_INET' | 'AF_INET6';
  socket_type?: 'SOCK_RAW' | 'SOCK_DGRAM';
  taint?: TaintMedium;
  lineage?: TaintHop[];
}
export interface GuardEvent extends StretchFields {
  v: number;
  ts: number;
  type: EventType;
  hook: HookType;
  tgid: number | null;
  parent_tgid: number | null;
  comm: string | null;
  file: string | null;
  family: 'ipv4' | 'ipv6' | null;
  daddr: string | null;
  dport: number | null;
  mode: 'audit' | 'enforce';
  protect?: string[];
  allow?: string[];
  message?: string;
}

export interface TaggedProcess {
  lineage?: TaintHop[];
  tgid: number;
  comm: string | null;
  file: string | null;
  since: number;
  parent_tgid: number | null;
}

export interface SnapshotMessage {
  source?: 'mock';
  v: number;
  type: 'SNAPSHOT';
  mode: 'audit' | 'enforce' | null;
  guard_connected: boolean;
  protect: string[];
  allow: string[];
  tagged: TaggedProcess[];
  recent: GuardEvent[];
}

export interface GuardStateMessage {
  v: number;
  type: 'GUARD_STATE';
  connected: boolean;
}

export type BridgeMessage = SnapshotMessage | GuardStateMessage | GuardEvent;

export interface AlertBannerState extends StretchFields {
  hook?: HookType;
  type: 'BLOCK' | 'WOULD_BLOCK' | 'ERROR';
  headline: string;
  subline?: string;
  comm?: string | null;
  tgid?: number | null;
  file?: string | null;
  daddr?: string | null;
  dport?: number | null;
  timestamp: number;
  sticky?: boolean;
}

export interface SyscallStats {
  blockedCount: number;
  allowedCount: number;
  totalEventsCount: number;
}
