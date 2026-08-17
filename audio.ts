// Live Web Audio synthesis for the four sound brushes. No samples, no
// prerecorded loops. A single master bus (gain -> compressor -> destination)
// keeps overlapping voices from clipping when several ripples hit at once.
import { midiToFreq } from "./scale";
import type { PercussionZone } from "./scale";

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseCache: AudioBuffer | null = null;

  private ensure(): { ctx: AudioContext; master: GainNode } {
    if (!this.ctx || !this.master) {
      const ctx = new AudioContext();
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.ratio.value = 6;
      const master = ctx.createGain();
      master.gain.value = 0.85;
      master.connect(compressor).connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return { ctx: this.ctx, master: this.master };
  }

  /** Call on the first user gesture to satisfy autoplay policy. Safe to call repeatedly. */
  unlock(): void {
    this.ensure();
  }

  playGlow(midi: number): void {
    const { ctx, master } = this.ensure();
    const freq = midiToFreq(midi);
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = freq * 3;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.09);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);

    osc.connect(filter).connect(gain).connect(master);
    osc.start(now);
    osc.stop(now + 1.7);
  }

  playSpark(midi: number): void {
    const { ctx, master } = this.ensure();
    const freq = midiToFreq(midi + 12);
    const now = ctx.currentTime;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);

    const osc1 = ctx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(freq, now);

    // A slightly detuned high partial gives the bell-like shimmer.
    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(freq * 2.01, now);
    const partialGain = ctx.createGain();
    partialGain.gain.value = 0.16;

    osc1.connect(gain).connect(master);
    osc2.connect(partialGain).connect(gain);
    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.6);
    osc2.stop(now + 0.6);
  }

  playInk(midi: number): void {
    const { ctx, master } = this.ensure();
    const freq = midiToFreq(midi);
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(freq, now);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(freq * 2.2, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.7), now + 1.0);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.3);

    osc.connect(filter).connect(gain).connect(master);
    osc.start(now);
    osc.stop(now + 1.4);
  }

  playGrain(zone: PercussionZone): void {
    const { ctx, master } = this.ensure();
    const now = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx);

    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    let duration = 0.16;

    if (zone === "hi") {
      filter.type = "highpass";
      filter.frequency.value = 6000;
      duration = 0.08;
      gain.gain.setValueAtTime(0.16, now);
    } else if (zone === "mid") {
      filter.type = "bandpass";
      filter.frequency.value = 1800;
      filter.Q.value = 0.7;
      duration = 0.18;
      gain.gain.setValueAtTime(0.22, now);
    } else {
      filter.type = "lowpass";
      filter.frequency.value = 300;
      duration = 0.32;
      gain.gain.setValueAtTime(0.3, now);
    }
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    src.connect(filter).connect(gain).connect(master);
    src.start(now);
    src.stop(now + duration + 0.02);

    if (zone === "low") {
      // The noise alone reads as a click; a short sine thump gives it a kick's body.
      const thump = ctx.createOscillator();
      thump.type = "sine";
      thump.frequency.setValueAtTime(150, now);
      thump.frequency.exponentialRampToValueAtTime(45, now + 0.12);
      const thumpGain = ctx.createGain();
      thumpGain.gain.setValueAtTime(0.38, now);
      thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      thump.connect(thumpGain).connect(master);
      thump.start(now);
      thump.stop(now + 0.25);
    }
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseCache && this.noiseCache.sampleRate === ctx.sampleRate) return this.noiseCache;
    const length = Math.floor(ctx.sampleRate * 0.5);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseCache = buffer;
    return buffer;
  }
}
