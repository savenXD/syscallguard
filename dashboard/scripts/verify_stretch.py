#!/usr/bin/env python3
"""Deterministic browser checks using the mock-only stretch fixtures, never a guard."""
import argparse
import asyncio
import base64
import importlib.util
import json
import time
import urllib.request
from pathlib import Path
import websockets
from rehearse_demo import CDP

ROOT = Path(__file__).resolve().parents[1]


async def verify(args):
    spec = importlib.util.spec_from_file_location('mock_bridge', ROOT / 'mock_bridge.py')
    mock = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mock)
    mock.QUIET = True
    clients_ready = asyncio.Event()

    async def handler(socket):
        mock.CLIENTS.add(socket)
        try:
            await socket.send(json.dumps(mock.STATE))
            clients_ready.set()
            await socket.wait_closed()
        finally:
            mock.CLIENTS.discard(socket)

    events = json.loads((ROOT / 'tests/fixtures/rehearsal.json').read_text())
    raw = next(scene['event'] for scene in events if scene['event']['hook'] == 'socket_create')
    chain = [scene['event'] for scene in events if 50 <= scene['at'] <= 52]
    report = {'source': 'mock', 'production_contract_changed': False, 'layouts': []}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    async with websockets.serve(handler, '127.0.0.1', args.bridge_port):
        with urllib.request.urlopen(f'http://127.0.0.1:{args.cdp_port}/json', timeout=5) as response:
            pages = json.load(response)
        target = next(page for page in pages if page['type'] == 'page')
        async with websockets.connect(target['webSocketDebuggerUrl'], max_size=20_000_000) as socket:
            cdp = CDP(socket)
            await cdp.call('Runtime.enable')
            await cdp.call('Page.enable')
            await cdp.call('Emulation.setDeviceMetricsOverride', {'width': 1440, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False})
            await cdp.call('Page.navigate', {'url': (ROOT / 'renderer/index.html').as_uri() + f'?bridge=ws://127.0.0.1:{args.bridge_port}'})
            await asyncio.wait_for(clients_ready.wait(), 10)
            await asyncio.sleep(1.5)
            assert await cdp.js("document.querySelector('#overview').textContent.includes('Demo · mock feed')")
            raw['ts'] = time.time()
            await mock.broadcast(raw)
            await asyncio.sleep(1)
            assert await cdp.js("document.querySelector('#overview h2').textContent==='Raw socket creation denied.'")
            assert await cdp.js("document.querySelector('#events').textContent.includes('AF_PACKET · SOCK_RAW')")
            image = await cdp.call('Page.captureScreenshot', {'format': 'png'})
            (args.output.parent / 'raw-socket-demo.png').write_bytes(base64.b64decode(image['data']))
            report['raw_socket_banner'] = True
            for event in chain:
                event['ts'] = time.time()
                await mock.broadcast(event)
                await asyncio.sleep(0.05)
            await asyncio.sleep(1)
            assert await cdp.js("document.querySelector('#overview [aria-label=\"Data-flow taint chain\"]').textContent.includes('9007199254740993')")
            assert await cdp.js("document.querySelector('#processes').textContent.includes('curl') && document.querySelector('#processes').textContent.includes('9007199254740995')")
            image = await cdp.call('Page.captureScreenshot', {'format': 'png'})
            (args.output.parent / 'taint-chain-demo.png').write_bytes(base64.b64decode(image['data']))
            for width, height, scale in [(1920, 1080, 1), (1920, 1080, 1.25), (1920, 1080, 1.5), (1440, 900, 1), (1440, 900, 1.25), (1440, 900, 1.5), (1100, 900, 1)]:
                await cdp.call('Emulation.setDeviceMetricsOverride', {'width': round(width / scale), 'height': round(height / scale), 'deviceScaleFactor': scale, 'mobile': False})
                await asyncio.sleep(0.4)
                layout = await cdp.js('''({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
                  overflow:[...document.querySelectorAll('main *')].filter(x=>x.getBoundingClientRect().right>innerWidth+2).map(x=>({tag:x.tagName,cls:x.getAttribute('class')})).slice(0,10)})''')
                report['layouts'].append({'display': [width, height], 'scale': scale, **layout})
                assert layout['scrollWidth'] <= layout['width'] and not layout['overflow'], layout
            await cdp.js("[...document.querySelectorAll('#processes [role=button]')].find(x=>x.textContent.includes('pid 4601')).click()")
            await asyncio.sleep(1)
            assert await cdp.js("document.querySelector('#events').textContent.includes('pid 4601')")
            assert await cdp.js("[...document.querySelectorAll('#events ul > li')].some(x=>x.textContent.includes('curl'))")
            await cdp.js("[...document.querySelectorAll('#events ul > li')].find(x=>x.textContent.includes('curl')).querySelector('button').click()")
            await asyncio.sleep(0.4)
            await cdp.js("[...document.querySelectorAll('#events button')].find(x=>x.textContent==='Copy incident JSON').click()")
            await asyncio.sleep(0.3)
            assert await cdp.js("document.querySelector('#events').textContent.includes('Copied')")
            report['writer_pid_filter_includes_reader'] = True
            report['incident_copy'] = True
            await cdp.call('Page.reload')
            await asyncio.sleep(1.5)
            assert await cdp.js("document.querySelector('#processes').textContent.includes('9007199254740995')")
            report['lineage_restored_from_snapshot'] = True
            assert not cdp.errors, cdp.errors
            report['console_errors'] = cdp.errors
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(f'Stretch mock browser checks passed: {args.output}', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bridge-port', type=int, default=18767)
    parser.add_argument('--cdp-port', type=int, default=19223)
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/stretch-browser-checks.json')
    asyncio.run(verify(parser.parse_args()))
