#!/usr/bin/env python3
"""Inspect a running packaged desktop app over an explicitly enabled local CDP port."""
import argparse
import asyncio
import base64
import json
import urllib.request
from pathlib import Path
import websockets
from rehearse_demo import CDP


async def verify(args):
    with urllib.request.urlopen(f'http://127.0.0.1:{args.port}/json', timeout=5) as response:
        pages = json.load(response)
    target = next(page for page in pages if page['type'] == 'page')
    assert '/app.asar/renderer/index.html' in target['url'], 'Expected the packaged renderer, not the source checkout'
    async with websockets.connect(target['webSocketDebuggerUrl'], max_size=20_000_000) as socket:
        cdp = CDP(socket)
        await cdp.call('Runtime.enable')
        await cdp.call('Page.enable')
        await cdp.call('Log.enable')
        await cdp.call('Page.reload')
        await asyncio.sleep(3)
        reply = await cdp.call('Runtime.evaluate', {'expression': '''(async () => {
          await document.fonts.ready;
          const images = await Promise.all([...document.querySelectorAll('link[rel="icon"],link[rel="apple-touch-icon"]')].map(link => new Promise(resolve => {
            const image = new Image(); image.onload=()=>resolve({href:link.href,loaded:true}); image.onerror=()=>resolve({href:link.href,loaded:false}); image.src=link.href;
          })));
          const mark = document.querySelector('header img');
          return {title:document.title, bridge:window.bridgeUrl, demo:document.querySelector('#overview').textContent.includes('Demo · mock feed'),
            packagedLogo:mark.currentSrc, logoLoaded:mark.complete&&mark.naturalWidth>0, fonts:document.fonts.status,
            images, rows:document.querySelectorAll('#events ul > li').length, width:innerWidth, scrollWidth:document.documentElement.scrollWidth};
        })()''', 'awaitPromise': True, 'returnByValue': True})
        if 'exceptionDetails' in reply:
            raise RuntimeError(reply)
        result = reply['result']['value']
        assert result['demo'] and result['bridge'].startswith('ws://127.0.0.1:'), result
        assert result['logoLoaded'] and result['fonts'] == 'loaded' and all(image['loaded'] for image in result['images']), result
        assert result['rows'] > 0 and result['scrollWidth'] <= result['width'], result
        assert not cdp.errors, cdp.errors
        result['consoleErrors'] = cdp.errors
        shot = await cdp.call('Page.captureScreenshot', {'format': 'png'})
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.with_suffix('.png').write_bytes(base64.b64decode(shot['data']))
        args.output.write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result, indent=2), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=19224)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'artifacts/desktop-app-check.json')
    asyncio.run(verify(parser.parse_args()))
