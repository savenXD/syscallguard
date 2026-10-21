const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer, WebSocket } = require('ws');

/** In-process, loopback-only mock feed; never runs a guard, Python, or an attack. */
async function startDemo({ timeline, cycleMs = 60000 } = {}) {
  const story = timeline ?? JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'demo', 'story.json'), 'utf8'));
  const ready = story.find(({ event }) => event.type === 'READY').event;
  const state = { v: 1, type: 'SNAPSHOT', source: 'mock', mode: ready.mode, guard_connected: true,
    protect: ready.protect, allow: ready.allow, tagged: [], recent: [] };
  const tagged = new Map();
  const timers = new Set();
  let stopped = false;
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  server.on('connection', (socket) => {
    socket.on('error', () => {});
    socket.send(JSON.stringify({ ...state, tagged: [...tagged.values()] }));
  });
  function emit(payload) {
    const event = { ...payload, ts: Date.now() / 1000 };
    if (event.type === 'TAG' || event.type === 'TAG_INHERIT') {
      tagged.set(event.tgid, { tgid: event.tgid, comm: event.comm, file: event.file,
        parent_tgid: event.type === 'TAG_INHERIT' ? event.parent_tgid : null,
        since: tagged.get(event.tgid)?.since ?? event.ts, ...(event.lineage ? { lineage: event.lineage } : {}) });
    } else if (event.type === 'UNTAG') tagged.delete(event.tgid);
    if (event.type === 'READY') Object.assign(state, { mode: event.mode, protect: event.protect, allow: event.allow });
    state.recent = [event, ...state.recent.slice(0, 49)];
    const raw = JSON.stringify(event);
    for (const socket of server.clients) if (socket.readyState === WebSocket.OPEN) socket.send(raw);
  }
  function later(fn, ms) {
    const timer = setTimeout(() => { timers.delete(timer); if (!stopped) fn(); }, ms);
    timers.add(timer);
  }
  function cycle() {
    for (const { at, event } of story) later(() => emit(event), at * 1000);
    later(cycle, cycleMs);
  }
  cycle();
  return {
    url: `ws://127.0.0.1:${server.address().port}`,
    async stop() {
      if (stopped) return;
      stopped = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const socket of server.clients) socket.terminate();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
module.exports = { startDemo };
