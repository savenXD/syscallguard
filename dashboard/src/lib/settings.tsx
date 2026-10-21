import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { startSmoothScroll, stopSmoothScroll } from './smoothScroll';

export type Agent = 'none' | 'claude' | 'chatgpt';

export interface Settings {
  agent: Agent;
  audioAlerts: boolean;
  grain: boolean;
  smooth: boolean;
  toasts: boolean;
  reduceMotion: boolean;
}

const DEFAULTS: Settings = { agent: 'none', audioAlerts: false, grain: true, smooth: true, toasts: true, reduceMotion: false };
const KEY = 'sg.settings.v1';

const load = (): Settings => {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) || '{}');
    const result = { ...DEFAULTS };
    if (stored && typeof stored === 'object') {
      for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
        const value = (stored as Record<string, unknown>)[key];
        if (key === 'agent') { if (value === 'none' || value === 'claude' || value === 'chatgpt') result.agent = value; }
        else if (typeof value === 'boolean') (result as Record<string, unknown>)[key] = value;
      }
    }
    return result;
  } catch {
    return DEFAULTS;
  }
};

interface Ctx {
  settings: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  reset: () => void;
}

const SettingsContext = createContext<Ctx | null>(null);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<Settings>(load);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
    document.documentElement.dataset.grain = settings.grain ? 'on' : 'off';
    if (settings.smooth) startSmoothScroll(); else stopSmoothScroll();
  }, [settings]);

  useEffect(() => () => stopSmoothScroll(), []);

  const set = useCallback<Ctx['set']>((key, value) => setSettings((s) => ({ ...s, [key]: value })), []);
  const reset = useCallback(() => setSettings(DEFAULTS), []);
  const value = useMemo(() => ({ settings, set, reset }), [settings, set, reset]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};

export const useSettings = () => {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings outside provider');
  return ctx;
};
