import { useEffect, useRef, useState } from 'react';
import { GuardClient, resolveBridgeUrl, type GuardView } from '../lib/guardClient';
import { useSettings } from '../lib/settings';
import { BlockAudio } from '../lib/blockAudio';

export function useSyscallGuard() {
  const { settings } = useSettings();
  const audioRef = useRef<BlockAudio | null>(null);
  const audioEnabled = useRef(settings.audioAlerts);
  audioEnabled.current = settings.audioAlerts;
  const [bridgeUrl] = useState(() => {
    const win = window as unknown as { bridgeUrl?: string; sgBridgeUrl?: string };
    return resolveBridgeUrl(win.bridgeUrl || win.sgBridgeUrl, window.location.search);
  });
  const [state, setState] = useState<GuardView>({ demo: false, bridgeConnected: false, guardConnected: null, mode: null,
    protect: [], allow: [], taggedProcesses: [], recentEvents: [], alert: null,
    stats: { blockedCount: 0, allowedCount: 0, totalEventsCount: 0 } });

  useEffect(() => {
    const audio = new BlockAudio();
    audioRef.current = audio;
    const unlock = () => { if (audioEnabled.current) void audio.unlock(); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    const client = new GuardClient(bridgeUrl, {
      socket: (url) => new WebSocket(url), later: (fn, ms) => window.setTimeout(fn, ms), cancel: (id) => window.clearTimeout(id),
    }, setState, () => { if (audioEnabled.current) audio.play(); });
    client.start();
    return () => {
      client.stop(); audio.close(); audioRef.current = null;
      window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock);
    };
  }, [bridgeUrl]);
  useEffect(() => { if (settings.audioAlerts) void audioRef.current?.unlock(); }, [settings.audioAlerts]);
  return { bridgeUrl, ...state };
}
