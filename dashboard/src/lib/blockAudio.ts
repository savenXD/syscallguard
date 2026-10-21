/** Local synthesis only. Browsers require an operator gesture before audio can play. */
export class BlockAudio {
  private context: AudioContext | null = null;
  private last = -Infinity;
  async unlock() {
    try {
      this.context ??= new AudioContext();
      if (this.context.state === 'suspended') await this.context.resume();
    } catch { /* Audio is optional; unsupported or denied audio must never interrupt telemetry. */ }
  }
  play() {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || ctx.currentTime - this.last < 0.5) return;
    this.last = ctx.currentTime;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(180, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(95, ctx.currentTime + 0.09);
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
    oscillator.connect(gain); gain.connect(ctx.destination);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(); oscillator.stop(ctx.currentTime + 0.11);
  }
  close() { if (this.context) void this.context.close().catch(() => {}); this.context = null; }
}
