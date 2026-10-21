const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
function source(name) {
  const filename = require('node:path').resolve(__dirname, '../src/lib', name + '.ts');
  const mod = new Module(filename, module);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
  return mod.exports;
}
const { GuardClient, eventKey, resolveBridgeUrl } = source('guardClient');
const { serializeEvents } = source('incidents');
const event = (type = 'ALLOW', extra = {}) => ({ v: 1, ts: 100, type, hook: 'connect', tgid: 7, parent_tgid: null,
  comm: 'python3', file: '/demo/.env', family: 'ipv4', daddr: '192.168.122.1', dport: 9999, mode: 'enforce', ...extra });
const snapshot = (extra = {}) => ({ v: 1, type: 'SNAPSHOT', mode: 'enforce', guard_connected: true,
  protect: ['/demo/.env'], allow: ['127.0.0.0/8'], tagged: [], recent: [], ...extra });
function harness() {
  let now = 0, seq = 0, view, updates = 0, pings = 0;
  const timers = new Map(), sockets = [];
  const client = new GuardClient('ws://localhost:8765', {
    socket: () => { const socket = { close() {} }; sockets.push(socket); return socket; },
    later: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: now + ms }); return id; },
    cancel: (id) => timers.delete(id),
  }, (state) => { view = state; updates++; }, () => pings++);
  const advance = (ms) => {
    const end = now + ms;
    while (true) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    now = end;
  };
  client.start(); sockets[0].onopen();
  const send = (msg) => sockets.at(-1).onmessage({ data: typeof msg === 'string' ? msg : JSON.stringify(msg) });
  send(snapshot());
  return { client, sockets, send, advance, timers, get view() { return view; }, get updates() { return updates; }, get pings() { return pings; } };
}
test('snapshot replaces policy, processes, history, stats and sticky errors; historical blocks do not ping', () => {
  const h = harness(); h.send(event('ERROR', { message: 'failure' })); h.advance(250);
  const past = Array.from({ length: 150 }, (_, ts) => event('BLOCK', { ts }));
  h.send(snapshot({ mode: null, guard_connected: false, protect: [], recent: past }));
  assert.equal(h.view.mode, null); assert.deepEqual(h.view.protect, []); assert.equal(h.view.alert, null);
  assert.equal(h.view.recentEvents.length, 100); assert.equal(h.view.recentEvents[0].ts, 149);
  assert.equal(h.view.stats.blockedCount, 100); assert.equal(h.pings, 0);
  h.send(event('TAG')); h.advance(250); assert.equal(h.view.taggedProcesses.length, 1);
  h.send(snapshot()); assert.equal(h.view.taggedProcesses.length, 0); assert.equal(h.view.recentEvents.length, 0);
});
test('block lasts 5000 ms, normal events do not clear it, repeated block resets timer; ERROR is sticky', () => {
  const h = harness(); h.send(event('BLOCK')); h.advance(4999); assert.equal(h.view.alert.type, 'BLOCK');
  h.advance(1); assert.equal(h.view.alert, null);
  h.send(event('BLOCK')); h.advance(4000); h.send(event()); h.send(event('BLOCK')); h.advance(4999);
  assert.equal(h.view.alert.type, 'BLOCK'); h.advance(1); assert.equal(h.view.alert, null);
  h.send(event('ERROR', { message: 'BPF load failed' })); h.advance(60000); assert.equal(h.view.alert.headline, 'BPF load failed');
  h.send({ v: 1, type: 'GUARD_STATE', connected: false }); assert.equal(h.view.alert.type, 'ERROR');
  h.send(event()); h.advance(250); assert.equal(h.view.alert, null);
});
test('disconnect immediately makes guard unknown; retries once every 2 seconds; stale callbacks and stop are harmless', () => {
  const h = harness(), old = h.sockets[0], staleMessage = old.onmessage;
  old.onerror(); assert.equal(h.view.bridgeConnected, false); assert.equal(h.view.guardConnected, null);
  h.advance(1999); assert.equal(h.sockets.length, 1); h.advance(1); assert.equal(h.sockets.length, 2);
  staleMessage({ data: JSON.stringify(event('BLOCK')) }); assert.equal(h.pings, 0);
  h.sockets[1].onopen(); assert.equal(h.view.guardConnected, null);
  h.send(snapshot()); assert.equal(h.view.guardConnected, true);
  h.send({ v: 1, type: 'GUARD_STATE', connected: false }); assert.equal(h.view.bridgeConnected, true);
  assert.equal(h.view.guardConnected, false); assert.equal(h.view.recentEvents.length, 0);
  h.send(event('BLOCK')); h.client.stop(); assert.equal(h.timers.size, 0); h.advance(10000); assert.equal(h.sockets.length, 2);
});
test('90,000 events at 50/sec remain bounded and publish at most 4 times/sec', () => {
  const h = harness(), start = h.updates;
  for (let i = 0; i < 90000; i++) { h.send(event('ALLOW', { ts: i })); h.advance(20); }
  h.advance(250);
  assert.equal(h.view.recentEvents.length, 100); assert.equal(h.view.recentEvents[0].ts, 89999);
  assert.equal(h.view.recentEvents.at(-1).ts, 89900); assert.equal(h.view.stats.totalEventsCount, 90000);
  assert.ok(h.updates - start <= 7201); h.client.stop(); assert.equal(h.timers.size, 0);
});
test('malformed/unsupported messages cannot poison charts or policy; repeated tags preserve original since', () => {
  const h = harness();
  for (const msg of ['bad', null, [], { v: 1, type: 'SURPRISE' }, event('ALLOW', { ts: 'bad' }), event('ALLOW', { dport: -1 }),
    snapshot({ protect: 3 }), { v: 1, type: 'GUARD_STATE', connected: 'false' }]) h.send(JSON.stringify(msg));
  h.advance(250); assert.equal(h.view.recentEvents.length, 0); assert.equal(h.view.guardConnected, true);
  h.send(event('TAG', { ts: 10 })); h.send(event('TAG', { ts: 20 }));
  h.send(event('TAG_INHERIT', { tgid: 8, parent_tgid: 7, ts: 30 }));
  h.advance(250); assert.equal(h.view.taggedProcesses[0].since, 10); assert.equal(h.view.taggedProcesses[1].parent_tgid, 7);
  h.send(event('UNTAG', { tgid: 7 })); h.advance(250); assert.deepEqual(h.view.taggedProcesses.map((p) => p.tgid), [8]);
});
test('same-timestamp identical payloads retain distinct stable row identities and exact raw JSON', () => {
  const h = harness(); h.send(event()); h.send(event()); h.advance(250);
  const [a,b] = h.view.recentEvents; assert.notEqual(eventKey(a), eventKey(b)); assert.equal(eventKey(a), eventKey(a));
  assert.deepEqual(JSON.parse(serializeEvents([a], 'json')), [event()]);
});
test('exports escape CSV quotes/newlines, preserve extra fields and neutralize formulas', () => {
  const e = event('ERROR', { message: '=HYPERLINK("evil")\nnext', extra: { detail: 1 } });
  assert.deepEqual(JSON.parse(serializeEvents([e], 'json')), [e]);
  const csv = serializeEvents([e], 'csv'); assert.ok(csv.includes('"\'=HYPERLINK(""evil"")\nnext"'));
  assert.ok(csv.includes('"extra"')); assert.ok(csv.includes('"{""detail"":1}"'));
});
test('preload takes precedence; browser query fallback accepts only WebSocket URLs', () => {
  assert.equal(resolveBridgeUrl('wss://vm:8765', '?bridge=ws://other'), 'wss://vm:8765');
  assert.equal(resolveBridgeUrl(undefined, '?bridge=ws%3A%2F%2Fvm%3A8765'), 'ws://vm:8765');
  assert.equal(resolveBridgeUrl(undefined, '?bridge=https://bad'), 'ws://127.0.0.1:8765');
});
test('production fallback has a classic deferred bundle, local assets and restricted network CSP', () => {
  const html = fs.readFileSync(require('node:path').join(__dirname, '../renderer/index.html'), 'utf8');
  assert.match(html, /<script defer src="\.\/assets\//); assert.doesNotMatch(html, /type="module"|crossorigin/);
  assert.match(html, /connect-src ws: wss:/); assert.doesNotMatch(html, /script-src[^;]*unsafe-inline/);
});
test('first threat and sticky-error clearance publish immediately; burst updates remain bounded', () => {
  const h = harness(); h.send(event('BLOCK')); assert.equal(h.view.alert.type, 'BLOCK');
  h.send(event('ERROR', { message: 'lost' })); assert.equal(h.view.alert.type, 'ERROR');
  h.send(event()); assert.equal(h.view.alert, null);
});
test('block audio is silent before a gesture, rate-limited, and closes its context', async () => {
  const { BlockAudio } = source('blockAudio');
  let starts = 0, disconnects = 0, closed = 0;
  const param = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
  let context;
  global.AudioContext = class {
    constructor() { this.state = 'suspended'; this.currentTime = 0; context = this; }
    async resume() { this.state = 'running'; }
    async close() { closed++; this.state = 'closed'; }
    createOscillator() { return { frequency: param, connect() {}, disconnect() { disconnects++; }, start() { starts++; }, stop() { this.onended(); } }; }
    createGain() { return { gain: param, connect() {}, disconnect() { disconnects++; } }; }
  };
  try {
    const audio = new BlockAudio(); audio.play(); assert.equal(starts, 0);
    await audio.unlock(); audio.play(); audio.play(); assert.equal(starts, 1);
    context.currentTime = 0.6; audio.play(); assert.equal(starts, 2); assert.equal(disconnects, 4);
    audio.close(); assert.equal(closed, 1); audio.play(); assert.equal(starts, 2);
  } finally { delete global.AudioContext; }
});
const rehearsal = require('./fixtures/rehearsal.json');
test('proposed stretch events require a mock snapshot and retain BLOCK categorization', () => {
  const raw = rehearsal.find(({ event }) => event.hook === 'socket_create').event;
  const h = harness(); h.send(raw); h.advance(250); assert.equal(h.view.recentEvents.length, 0);
  h.send(snapshot({ source: 'mock' })); h.send(raw);
  assert.equal(h.view.demo, true); assert.equal(h.view.alert.headline, 'Raw socket creation denied.');
  assert.equal(h.view.alert.socket_family, 'AF_PACKET'); assert.equal(h.view.stats.blockedCount, 1);
  h.send({ ...raw, type: 'WOULD_BLOCK', mode: 'audit' });
  assert.equal(h.view.alert.type, 'WOULD_BLOCK'); assert.equal(h.view.alert.headline, 'Would deny raw socket.');
  h.send(snapshot()); assert.equal(h.view.demo, false); h.send(raw); h.advance(250);
  assert.equal(h.view.recentEvents.length, 0);
});
test('mock taint writes do not invent readers; explicit multi-hop lineage survives snapshot restoration', () => {
  const h = harness(); h.send(snapshot({ source: 'mock' }));
  const write = rehearsal.find(({ event }) => event.type === 'TAINT').event;
  h.send(write); h.advance(250); assert.equal(h.view.taggedProcesses.length, 0);
  const tag = rehearsal.find(({ event }) => event.type === 'TAG' && event.lineage?.length === 2).event;
  h.send(tag); h.advance(250);
  const p = h.view.taggedProcesses[0]; assert.equal(p.parent_tgid, null); assert.deepEqual(p.lineage, tag.lineage);
  assert.equal(p.lineage[0].inode, '9007199254740993');
  h.send(snapshot({ source: 'mock', tagged: [p], recent: [write, tag] }));
  assert.deepEqual(h.view.taggedProcesses[0].lineage, tag.lineage);
  const block = rehearsal.find(({ event }) => event.type === 'BLOCK' && event.lineage).event;
  h.send(block); assert.deepEqual(h.view.alert.lineage, tag.lineage);
  h.send(event('UNTAG', { tgid: p.tgid })); h.advance(250); assert.equal(h.view.taggedProcesses.length, 0);
});
test('malformed, cyclic, disconnected and oversized taint chains are rejected', () => {
  const { isGuardEvent } = source('guardClient');
  const tag = rehearsal.find(({ event }) => event.type === 'TAG' && event.lineage?.length === 2).event;
  assert.equal(isGuardEvent(tag, true), true);
  const bad = [
    [],
    [{ ...tag.lineage[0], inode: 9007199254740992 }],
    [{ ...tag.lineage[0], reader_tgid: tag.lineage[0].writer_tgid }],
    [tag.lineage[0], { ...tag.lineage[1], writer_tgid: 999 }],
    [tag.lineage[0], { ...tag.lineage[1], reader_tgid: tag.lineage[0].writer_tgid }],
    Array(17).fill(tag.lineage[0]),
  ];
  for (const lineage of bad) assert.equal(isGuardEvent({ ...tag, lineage }, true), false);
});
test('complete mock storyboard remains bounded, cleans all processes and preserves exported lineage', () => {
  const h = harness(); h.send(snapshot({ source: 'mock' }));
  for (const { event: ev } of rehearsal) { h.send(ev); h.advance(300); }
  assert.equal(h.view.taggedProcesses.length, 0); assert.equal(h.view.stats.blockedCount, 6);
  assert.equal(h.view.recentEvents.filter((e) => e.type === 'TAINT').length, 2);
  const json = serializeEvents(h.view.recentEvents, 'json'); assert.ok(json.includes('9007199254740993'));
  assert.ok(serializeEvents(h.view.recentEvents, 'csv').includes('"lineage"'));
});

const { requestBatches, smoothRequestPath } = source('activity');
test('request graph uses fixed one-second batches and separates actual blocks from audit and lifecycle events', () => {
  const batches = requestBatches([
    event('ALLOW', { ts: 110.999 }), event('BLOCK', { ts: 112 }),
    event('ALLOW', { ts: 112 }), event('WOULD_BLOCK', { ts: 112 }),
    event('TAG', { ts: 111 }), event('UNTAG', { ts: 111 }),
    event('ALLOW', { ts: 113 }), event('ALLOW', { ts: 80 }),
  ], 112, 3);
  assert.deepEqual(batches, [
    { start: 110, allowed: 1, blocked: 0, wouldBlock: 0, total: 1 },
    { start: 111, allowed: 0, blocked: 0, wouldBlock: 0, total: 0 },
    { start: 112, allowed: 1, blocked: 1, wouldBlock: 1, total: 3 },
  ]);
  assert.deepEqual(requestBatches([], 112, 3).map(b => b.start), [110, 111, 112]);
  assert.deepEqual(requestBatches([], 112.999, 3).map(b => b.start), [110, 111, 112]);
  assert.deepEqual(requestBatches([], 113, 3).map(b => b.start), [111, 112, 113]);
  const curve = smoothRequestPath([{ x: 0, y: 10 }, { x: 30, y: 0 }, { x: 60, y: 10 }]);
  assert.equal(curve, 'M 0 10 C 10 10, 20 0, 30 0 C 40 0, 50 10, 60 10');
});
