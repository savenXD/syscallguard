#!/usr/bin/env python3
"""Three independent mock bridge/Electron starts. This never runs a guard or attack.

Measures local bridge receipt to visible red headline, then restarts Electron mid
story and compares tagged PIDs restored from SNAPSHOT. Not VM/kernel acceptance.
"""
import argparse
import asyncio
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
import websockets

ROOT = Path(__file__).resolve().parents[1]


class CDP:
    def __init__(self, websocket):
        self.websocket = websocket
        self.sequence = 0
        self.errors = []

    async def call(self, method, params=None):
        self.sequence += 1
        ident = self.sequence
        await self.websocket.send(json.dumps({'id': ident, 'method': method, 'params': params or {}}))
        while True:
            message = json.loads(await asyncio.wait_for(self.websocket.recv(), 10))
            if message.get('method') == 'Runtime.exceptionThrown':
                self.errors.append(message)
            if message.get('method') == 'Log.entryAdded' and message['params']['entry'].get('level') == 'error':
                self.errors.append(message)
            if message.get('id') == ident:
                if 'error' in message:
                    raise RuntimeError(message)
                return message.get('result', {})

    async def js(self, expression):
        reply = await self.call('Runtime.evaluate', {'expression': expression, 'returnByValue': True, 'userGesture': True})
        if 'exceptionDetails' in reply:
            raise RuntimeError(reply)
        return reply['result'].get('value')


async def connect_cdp(port, process):
    for _ in range(100):
        if process.poll() is not None:
            raise RuntimeError(f'Electron exited with code {process.returncode}')
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/json', timeout=1) as response:
                pages = json.load(response)
            target = next(page for page in pages if page['type'] == 'page')
            ws = await websockets.connect(target['webSocketDebuggerUrl'], max_size=20_000_000)
            cdp = CDP(ws)
            await cdp.call('Runtime.enable')
            for _ in range(100):
                if await cdp.js("document.querySelector('#overview') !== null"):
                    return cdp
                await asyncio.sleep(0.05)
            await ws.close()
        except (OSError, StopIteration):
            pass
        await asyncio.sleep(0.1)
    raise TimeoutError('Electron debugging endpoint did not become ready')


def terminate(process):
    if process is None or process.poll() is not None:
        return
    os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=5)


async def one_run(number, args):
    report = {'run': number, 'source': 'mock', 'kernel_enforcement_tested': False,
              'attacker_bytes': None, 'cases': []}
    bridge = electron = cdp = None
    with tempfile.TemporaryDirectory(prefix='sg-rehearsal-') as directory:
        with open(Path(directory) / 'processes.log', 'w') as log:
            try:
                bridge = subprocess.Popen([sys.executable, str(ROOT / 'mock_bridge.py'), '--scenario', 'stage', '--quiet', '--port', str(args.bridge_port)],
                                          cwd=ROOT, stdout=log, stderr=log, start_new_session=True)
                url = f'ws://127.0.0.1:{args.bridge_port}'
                feed = None
                for _ in range(100):
                    try:
                        feed = await websockets.connect(url)
                        break
                    except OSError:
                        await asyncio.sleep(0.05)
                if feed is None:
                    raise TimeoutError('Mock bridge did not start')
                async with feed:
                    initial = json.loads(await feed.recv())
                    assert initial['type'] == 'SNAPSHOT' and initial['source'] == 'mock'
                    queue = asyncio.Queue()

                    async def observe():
                        async for raw in feed:
                            event = json.loads(raw)
                            if event.get('type') == 'BLOCK':
                                await queue.put((event, time.monotonic()))
                    observer = asyncio.create_task(observe())

                    def launch():
                        command = [str(ROOT / 'node_modules/.bin/electron'), '.', '--kiosk', '--bridge=' + url,
                                   '--remote-debugging-port=' + str(args.cdp_port)]
                        if args.headless:
                            command += ['--headless', '--ozone-platform=headless', '--disable-gpu']
                        return subprocess.Popen(command, cwd=ROOT, env={**os.environ, 'XDG_CONFIG_HOME': directory},
                                                stdout=log, stderr=log, start_new_session=True)
                    try:
                        electron = launch()
                        cdp = await connect_cdp(args.cdp_port, electron)
                        for vector, comm, hook in [('direct', 'python3', 'connect'), ('curl', 'curl', 'connect'), ('udp', 'python3', 'sendmsg')]:
                            event, received = await asyncio.wait_for(queue.get(), 35)
                            assert event['comm'] == comm and event['hook'] == hook, event
                            visible = False
                            while time.monotonic() - received < 1:
                                visible = await cdp.js('''(() => {const h=document.querySelector('#overview h2');
                                  const view=document.querySelector('#overview');
                                  return h?.textContent==='Exfiltration blocked.' && Number(getComputedStyle(h).opacity)>=0.9
                                    && view.textContent.includes('PID ''' + str(event['tgid']) + "')})()")
                                if visible:
                                    break
                                await asyncio.sleep(0.01)
                            elapsed = time.monotonic() - received
                            assert visible and elapsed < 1, f'{vector}: red banner took {elapsed:.3f}s'
                            case = {'vector': vector, 'hook': hook, 'banner_seconds_from_bridge_receipt': round(elapsed, 4)}
                            report['cases'].append(case)
                            print(json.dumps({'run': number, **case}), flush=True)
                            if vector == 'direct':
                                await cdp.websocket.close(); cdp = None
                                terminate(electron)
                                electron = launch()
                                cdp = await connect_cdp(args.cdp_port, electron)
                                async with websockets.connect(url) as peer:
                                    snapshot = json.loads(await peer.recv())
                                expected = sorted(p['tgid'] for p in snapshot['tagged'])
                                restored = None
                                for _ in range(30):
                                    restored = await cdp.js("[...document.querySelectorAll('#processes [role=button]')].map(e=>Number(e.textContent.match(/pid (\\d+)/)?.[1])).sort((a,b)=>a-b)")
                                    if restored == expected:
                                        break
                                    await asyncio.sleep(0.05)
                                assert restored == expected and expected, (restored, expected)
                                assert await cdp.js("document.querySelector('#overview').textContent.includes('Demo · mock feed')")
                                report['electron_restart_snapshot_pids'] = restored
                        assert not cdp.errors, cdp.errors
                        report['passed'] = True
                    finally:
                        observer.cancel()
                        await asyncio.gather(observer, return_exceptions=True)
            finally:
                if cdp:
                    await cdp.websocket.close()
                terminate(electron)
                terminate(bridge)
    return report


async def main(args):
    report = {'scope': 'mock dashboard rehearsal only', 'cold_vm_runs': False, 'runs': []}
    for number in range(1, 4):
        report['runs'].append(await one_run(number, args))
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(f'Three mock cold starts passed: {args.output}', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bridge-port', type=int, default=18766)
    parser.add_argument('--cdp-port', type=int, default=19226)
    parser.add_argument('--headless', action='store_true')
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/mock-cold-runs.json')
    args = parser.parse_args()
    asyncio.run(main(args))
