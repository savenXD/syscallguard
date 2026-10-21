#!/usr/bin/env python3
"""CDP acceptance/soak checks for a separately launched Chrome or Electron.

Requires Python websockets (also used by mock_bridge.py). Never launches a guard.
TaskDuration measures renderer main-thread work, not total host CPU; verify total
app CPU and RSS with the host's process monitor for final sign-off.
"""
import argparse
import asyncio
import base64
import json
import time
import urllib.request
from pathlib import Path
import websockets


async def verify(args):
    pages = json.load(urllib.request.urlopen(f'http://127.0.0.1:{args.port}/json', timeout=10))
    target = next(p for p in pages if p['type'] == 'page')
    report = {'errors': [], 'layouts': [], 'samples': []}
    async with websockets.connect(target['webSocketDebuggerUrl'], max_size=20_000_000) as ws:
        sequence = 0

        async def call(method, params=None):
            nonlocal sequence
            sequence += 1
            ident = sequence
            await ws.send(json.dumps({'id': ident, 'method': method, 'params': params or {}}))
            while True:
                reply = json.loads(await asyncio.wait_for(ws.recv(), 30))
                if reply.get('method') == 'Runtime.exceptionThrown':
                    report['errors'].append(reply)
                if reply.get('method') == 'Log.entryAdded' and reply['params']['entry'].get('level') == 'error':
                    report['errors'].append(reply)
                if reply.get('id') == ident:
                    if 'error' in reply:
                        raise RuntimeError(reply)
                    return reply.get('result', {})

        async def js(expression):
            reply = await call('Runtime.evaluate', {'expression': expression, 'returnByValue': True, 'awaitPromise': True, 'userGesture': True})
            if 'exceptionDetails' in reply:
                raise RuntimeError(reply)
            return reply['result'].get('value')

        for method in ['Runtime.enable', 'Log.enable', 'Page.enable', 'Performance.enable']:
            await call(method)
        url = args.url or (Path(__file__).resolve().parents[1] / 'renderer/index.html').as_uri() + '?bridge=' + args.bridge
        await call('Page.navigate', {'url': url})
        await asyncio.sleep(3)
        report['preloadBridge'] = await js('window.bridgeUrl ?? null')
        report['userAgent'] = await js('navigator.userAgent')
        for width, height in [(1920, 1080), (1440, 900)]:
            for scale in [1, 1.25, 1.5]:
                await call('Emulation.setDeviceMetricsOverride', {'width': round(width / scale), 'height': round(height / scale), 'deviceScaleFactor': scale, 'mobile': False})
                await asyncio.sleep(1)
                metrics = await js('''(() => ({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
                  fontStatus:document.fonts.status, rows:document.querySelectorAll('#events ul > li').length,
                  overflow:[...document.querySelectorAll('main *')].filter(x=>x.getBoundingClientRect().right>innerWidth+2).map(x=>x.tagName).slice(0,10)
                }))()''')
                report['layouts'].append({'display': [width, height], 'scale': scale, **metrics})
                assert metrics['scrollWidth'] <= metrics['width'] and not metrics['overflow'], metrics
                assert metrics['rows'] <= 100, metrics
        await call('Emulation.setDeviceMetricsOverride', {'width': 1440, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False})
        report['audioDefault'] = await js("JSON.parse(localStorage.getItem('sg.settings.v1') || '{}').audioAlerts")
        assert report['audioDefault'] is False, 'Use a fresh browser profile to check audio defaults'
        await js("document.querySelector('[aria-label=\"Settings\"]').click()")
        await asyncio.sleep(0.5)
        assert await js("document.body.textContent.includes('Audio alerts on block')")
        await js("document.querySelector('[aria-label=\"Close settings\"]').click()")
        report['incidentCopy'] = await js("(() => {const row=document.querySelector('#events ul > li button'); if(!row)return false; row.click(); return true;})()")
        await asyncio.sleep(0.5)
        assert await js("document.querySelector('#events').textContent.includes('Copy incident JSON')")
        report['exportActions'] = await js("[...document.querySelectorAll('#events button')].filter(x=>x.getAttribute('aria-label')?.startsWith('Export visible')).map(x=>x.getAttribute('aria-label'))")
        assert len(report['exportActions']) == 2
        await call('Page.setDownloadBehavior', {'behavior': 'allow', 'downloadPath': '/tmp/sg-phase3-downloads'})
        await js("[...document.querySelectorAll('#events button')].find(x=>x.textContent==='Threats').click()")
        await asyncio.sleep(0.3)
        for format in ['JSON', 'CSV']:
            await js(f"document.querySelector('[aria-label=\"Export visible events as {format}\"]').click()")
        report['filteredExportRows'] = await js("document.querySelectorAll('#events ul > li').length")
        await js("[...document.querySelectorAll('#events button')].find(x=>x.textContent==='All').click()")
        await asyncio.sleep(0.3)
        start = time.monotonic()
        while True:
            metrics = {m['name']: m['value'] for m in (await call('Performance.getMetrics'))['metrics']}
            dom = await js("({rows:document.querySelectorAll('#events ul > li').length,invalidSVG:[...document.querySelectorAll('svg [height],svg [r]')].filter(e=>['height','r'].some(k=>e.hasAttribute(k)&&(!Number.isFinite(parseFloat(e.getAttribute(k)))||parseFloat(e.getAttribute(k))<0))).length})")
            sample = {'seconds': round(time.monotonic() - start, 2), 'heapBytes': metrics['JSHeapUsedSize'], 'taskSeconds': metrics['TaskDuration'], **dom}
            report['samples'].append(sample)
            assert dom['rows'] <= 100 and dom['invalidSVG'] == 0, dom
            print(json.dumps(sample), flush=True)
            if sample['seconds'] >= args.duration:
                break
            await asyncio.sleep(min(10, args.duration - sample['seconds']))
        if len(report['samples']) > 1:
            first, last = report['samples'][0], report['samples'][-1]
            report['rendererMainThreadPercent'] = 100 * (last['taskSeconds'] - first['taskSeconds']) / (last['seconds'] - first['seconds'])
        if args.screenshot:
            shot = await call('Page.captureScreenshot', {'format': 'png'})
            Path(args.screenshot).write_bytes(base64.b64decode(shot['data']))
        assert not report['errors'], report['errors']
    Path(args.output).write_text(json.dumps(report, indent=2) + '\n')
    print(f'Passed browser checks; report: {args.output}', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=19223)
    parser.add_argument('--bridge', default='ws://127.0.0.1:8765')
    parser.add_argument('--url')
    parser.add_argument('--duration', type=float, default=1800)
    parser.add_argument('--output', default='/tmp/syscallguard-browser-report.json')
    parser.add_argument('--screenshot')
    args = parser.parse_args()
    if args.duration < 0:
        parser.error('duration must be nonnegative')
    asyncio.run(verify(args))
