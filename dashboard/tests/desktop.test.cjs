const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocket } = require('ws');
const { startDemo } = require('../desktop/demo-server.cjs');
const root = path.resolve(__dirname, '..');
const ready = require('../demo/story.json').find(({ event }) => event.type === 'READY').event;
const reader = require('./fixtures/rehearsal.json').find(({ event }) => event.lineage?.length === 2).event;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await pause(5); }
  throw new Error('Timed out waiting for the demo feed');
}
function client(url) {
  const messages = [];
  const socket = new WebSocket(url);
  socket.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
  return { socket, messages };
}

test('embedded demo is loopback-only, restores lineage and caps snapshots at 50 events', async (t) => {
  const timeline = [{ at: 0, event: ready }, { at: 0.05, event: reader }, { at: 0.1, event: reader },
    ...Array.from({ length: 65 }, () => ({ at: 0.15, event: { ...reader, type: 'ALLOW', hook: 'connect' } }))];
  const demo = await startDemo({ timeline });
  t.after(() => demo.stop());
  assert.match(demo.url, /^ws:\/\/127\.0\.0\.1:\d+$/);
  const first = client(demo.url); t.after(() => first.socket.terminate());
  await until(() => first.messages.filter((m) => m.type === 'ALLOW').length === 65);
  assert.equal(first.messages[0].type, 'SNAPSHOT'); assert.equal(first.messages[0].source, 'mock');
  const second = client(demo.url); t.after(() => second.socket.terminate());
  await until(() => second.messages.length);
  const snapshot = second.messages[0];
  assert.equal(snapshot.recent.length, 50); assert.equal(snapshot.guard_connected, true);
  assert.deepEqual(snapshot.tagged[0].lineage, reader.lineage);
  assert.equal(snapshot.tagged[0].since, first.messages.find((m) => m.type === 'TAG').ts);
  assert.equal(snapshot.tagged[0].lineage[0].inode, '9007199254740993');
  await demo.stop(); await demo.stop();
  await until(() => first.socket.readyState === WebSocket.CLOSED && second.socket.readyState === WebSocket.CLOSED);
});

test('branding has genuine vector masters, complete native formats and all requested raster sizes', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'branding/asset-manifest.json')));
  for (const filename of manifest.generated) assert.ok(fs.statSync(path.join(root, filename)).size > 0, filename);
  const svg = fs.readFileSync(path.join(root, 'branding/mark.svg'), 'utf8');
  assert.match(svg, /<path/); assert.doesNotMatch(svg, /<image|base64/);
  for (const size of [16,24,32,48,64,128,256,512,1024]) {
    const png = fs.readFileSync(path.join(root, `public/branding/app-icon-${size}.png`));
    assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size);
  }
  const ico = fs.readFileSync(path.join(root, 'build/icons/icon.ico'));
  assert.equal(ico.readUInt16LE(2), 1); assert.equal(ico.readUInt16LE(4), 7);
  const icns = fs.readFileSync(path.join(root, 'build/icons/icon.icns'));
  assert.equal(icns.toString('ascii', 0, 4), 'icns'); assert.equal(icns.readUInt32BE(4), icns.length);
  const html = fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8');
  assert.match(html, /branding\/favicon\.svg/); assert.match(html, /branding\/favicon\.ico/);
});
