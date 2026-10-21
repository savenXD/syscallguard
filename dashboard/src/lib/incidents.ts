import type { GuardEvent } from '../types';
export async function copyText(text: string): Promise<void> {
  try { if (navigator.clipboard) { await navigator.clipboard.writeText(text); return; } } catch { /* Fall back for file URLs or denied permissions. */ }
  const input = document.createElement('textarea');
  input.value = text; input.style.position = 'fixed'; input.style.opacity = '0';
  const previous = document.activeElement;
  document.body.append(input); input.select();
  try { if (!document.execCommand('copy')) throw new Error('Clipboard unavailable'); }
  finally { input.remove(); if (previous instanceof HTMLElement) previous.focus(); }
}
export function serializeEvents(events: GuardEvent[], format: 'json' | 'csv'): string {
  if (format === 'json') return JSON.stringify(events, null, 2) + '\n';
  const fields = [...new Set(events.flatMap((e) => Object.keys(e)))];
  const cell = (value: unknown) => {
    let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  return [fields.map(cell).join(','), ...events.map((e) => fields.map((k) => cell((e as unknown as Record<string, unknown>)[k])).join(','))].join('\r\n') + '\r\n';
}
export function downloadEvents(events: GuardEvent[], format: 'json' | 'csv') {
  const blob = new Blob([serializeEvents(events, format)], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `syscallguard-events-${new Date().toISOString().replace(/[:.]/g, '-')}.${format}`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
