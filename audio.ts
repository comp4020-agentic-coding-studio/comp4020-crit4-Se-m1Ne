// Live Web Audio synthesis for the six cosmic sound brushes. No samples, no
// prerecorded loops -- everything here is oscillators, filters and gain
// envelopes, including the reverb tail (a synthesized noise impulse fed
// through a ConvolverNode, not a recorded space).
//
// All six voices share one signal path -- a dry send plus a shared reverb
// send, both landing on the same bus -- because that shared "room" is what
// makes six different timbres read as six materials in one space rather
// than six unrelated effects. An always-on, very quiet drone is started the
// first time the engine wakes up, so the space itself is never truly silent
// between triggers.
//
// Voice bookkeeping (per-brush caps + a load-dependent gain trim) exists so
// that painting densely with a long-tailed brush, or clicking rapidly, can't
// clip the mix or stack an unbounded number of ringing voices -- without
// ever refusing a trigger the player can hear as "blocked."
import { midiToFreq } from "./scale";
import type { BrushType } from "./types";

interface Bus {
  ctx: AudioContext;
  bus: GainNode;
  convolver: ConvolverNode;
}

// Hard per-brush polyphony ceiling. Short/dense brushes get room to breathe
// under fast painting; long/atmospheric brushes are capped hard so a few
// seconds of dragging can't stack a wall of Deep Synth or Shimmer tails.
const MAX_VOICES: Record<BrushType, number> = {
  drop: 18,
  bell: 10,
  crystal: 8,
  metal: 6,
  shimmer: 3,
  deep: 3,
};

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private noiseCache: AudioBuffer | null = null;
  private ambientStarted = false;

  private activeVoices: Record<BrushType, number> = {
    bell: 0,
    crystal: 0,
    drop: 0,
    deep: 0,
    metal: 0,
    shimmer: 0,
  };
  private totalActive = 0;

  private ensure(): Bus {
    if (!this.ctx || !this.bus || !this.convolver) {
      const ctx = new AudioContext();

      const bus = ctx.createGain();
      bus.gain.value = 0.9;

      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -16;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.006;
      compressor.release.value = 0.25;
      bus.connect(compressor).connect(ctx.destination);

      // A synthesized "room": exponentially-decaying stereo noise through a
      // convolver, then softened with a lowpass so the wet tail blends
      // instead of hissing. This is the shared space every voice sends into.
      const convolver = ctx.createConvolver();
      convolver.buffer = this.makeImpulseResponse(ctx);
      const reverbFilter = ctx.createBiquadFilter();
      reverbFilter.type = "lowpass";
      reverbFilter.frequency.value = 4200;
      const reverbGain = ctx.createGain();
      reverbGain.gain.value = 0.5;
      convolver.connect(reverbFilter).connect(reverbGain).connect(bus);

      this.ctx = ctx;
      this.bus = bus;
      this.convolver = convolver;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    if (!this.ambientStarted) {
      this.ambientStarted = true;
      this.startAmbient(this.ctx, this.bus);
    }
    return { ctx: this.ctx, bus: this.bus, convolver: this.convolver };
  }

  /** Call on the first user gesture to satisfy autoplay policy. Safe to call repeatedly. */
  unlock(): void {
    this.ensure();
  }

  // --- shared plumbing ------------------------------------------------------

  // Every voice ends here: a stereo pan (tying left/right to the mark's x
  // position, so the stereo field mirrors the painting) split into a dry
  // send and a reverb send, both landing on the same bus.
  private output(node: AudioNode, pan: number, wet: number): void {
    const { ctx, bus, convolver } = this.ensure();
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(panner);
    panner.connect(bus);
    if (wet > 0) {
      const wetGain = ctx.createGain();
      wetGain.gain.value = wet;
      panner.connect(wetGain).connect(convolver);
    }
  }

  // Registers one voice of `brush` for `durationSec`. Returns false (and
  // triggers nothing) if that brush is already at its polyphony ceiling --
  // a silent, graceful drop rather than an audible glitch. Returns a gain
  // multiplier that gently ducks new voices when the overall mix is already
  // busy, so twenty overlapping ripples thin out instead of clipping.
  private beginVoice(brush: BrushType, durationSec: number): number | null {
    if (this.activeVoices[brush] >= MAX_VOICES[brush]) return null;
    const scale = 1 / Math.sqrt(1 + this.totalActive * 0.15);
    this.activeVoices[brush]++;
    this.totalActive++;
    setTimeout(() => {
      this.activeVoices[brush] = Math.max(0, this.activeVoices[brush] - 1);
      this.totalActive = Math.max(0, this.totalActive - 1);
    }, durationSec * 1000);
    return scale;
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseCache && this.noiseCache.sampleRate === ctx.sampleRate) return this.noiseCache;
    const length = Math.floor(ctx.sampleRate * 1.5);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseCache = buffer;
    return buffer;
  }

  private makeImpulseResponse(ctx: AudioContext): AudioBuffer {
    const duration = 3.2;
    const length = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
      }
    }
    return buffer;
  }

  // An always-on, barely-audible texture so the space between triggers
  // never reads as dead silence. Two very slowly detuned low sines (a soft
  // beating, no discernible pitch centre) under a slow-sweeping lowpass --
  // no melody, no rhythm, gain low enough that it should be felt more than
  // consciously heard.
  private startAmbient(ctx: AudioContext, bus: GainNode): void {
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.028;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 420;
    filter.Q.value = 0.5;

    const base = midiToFreq(36); // low C -- well under any brush's register
    const osc1 = ctx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.value = base;
    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.value = base * 1.004; // slow beating against osc1

    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.035; // one sweep roughly every half minute
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain).connect(filter.frequency);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(droneGain).connect(bus);

    osc1.start();
    osc2.start();
    lfo.start();
  }

  // --- the six brushes --------------------------------------------------------

  /** Bell -- clear, bright, pure. Fast attack, moderate decay. "TING~~" */
  playBell(midi: number, pan: number): void {
    const scale = this.beginVoice("bell", 2.2);
    if (scale === null) return;
    const { ctx } = this.ensure();
    const freq = midiToFreq(midi);
    const now = ctx.currentTime;
    const peak = 0.3 * scale;

    const sum = ctx.createGain();
    const partials: [number, number, number][] = [
      [1, 1, 1.7],
      [2.4, 0.35, 0.9],
      [3.8, 0.16, 0.5],
    ];
    for (const [ratio, gainMul, decay] of partials) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq * ratio, now);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(peak * gainMul, now + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, now + decay);
      osc.connect(g).connect(sum);
      osc.start(now);
      osc.stop(now + decay + 0.05);
    }

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = freq * 6;
    sum.connect(filter);
    this.output(filter, pan, 0.22);
  }

  /** Crystal -- glassy, more complex partials, softer attack, longer resonance. "dliiing~~~~" */
  playCrystal(midi: number, pan: number): void {
    const scale = this.beginVoice("crystal", 3.4);
    if (scale === null) return;
    const { ctx } = this.ensure();
    const freq = midiToFreq(midi);
    const now = ctx.currentTime;
    const peak = 0.22 * scale;

    const sum = ctx.createGain();
    const partials: [number, number][] = [
      [1, 1],
      [2.01, 0.5],
      [3.98, 0.28],
      [5.4, 0.14],
    ];
    for (const [ratio, gainMul] of partials) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq * ratio, now);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(peak * gainMul, now + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 2.6 + gainMul * 0.4);
      osc.connect(g).connect(sum);
      osc.start(now);
      osc.stop(now + 3.2);
    }

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 2.4;
    filter.frequency.setValueAtTime(freq * 2.5, now);
    filter.frequency.exponentialRampToValueAtTime(freq * 1.4, now + 2.8);
    sum.connect(filter);
    this.output(filter, pan, 0.42);
  }

  /**
   * Drop -- a water droplet: soft plip/bloop, short and delicate. Provides
   * rhythmic detail in place of a percussion kit. `ny` (0 = top of canvas)
   * gives a restrained pitch nudge and controls brightness.
   */
  playDrop(midi: number, ny: number, pan: number): void {
    const scale = this.beginVoice("drop", 0.35);
    if (scale === null) return;
    const { ctx } = this.ensure();
    const freq = midiToFreq(midi);
    const now = ctx.currentTime;
    const peak = 0.22 * scale;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * 1.8, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.85, now + 0.09);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 700 + (1 - ny) * 3200; // brighter near the top of the canvas

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(peak, now + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    osc.connect(filter).connect(g);
    osc.start(now);
    osc.stop(now + 0.3);
    this.output(g, pan, 0.16);
  }

  /**
   * Deep Synth -- deep, warm, atmospheric. Soft attack into sustained
   * resonance and a slow fade -- deliberately no percussive "BOOM". Provides
   * the low-frequency floor under everything else.
   */
  playDeep(midi: number, pan: number): void {
    const scale = this.beginVoice("deep", 7.4);
    if (scale === null) return;
    const { ctx } = this.ensure();
    const freq = midiToFreq(midi);
    const now = ctx.currentTime;
    const peak = 0.27 * scale;

    const osc1 = ctx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(freq, now);
    const osc2 = ctx.createOscillator();
    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(freq * 1.005, now); // slight detune, slow beating width

    const sum = ctx.createGain();
    osc1.connect(sum);
    osc2.connect(sum);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(freq * 1.6, now);

    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.15;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = freq * 0.7;
    lfo.connect(lfoGain).connect(filter.frequency);

    sum.connect(filter);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(peak, now + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 7.0);
    filter.connect(g);

    osc1.start(now);
    osc2.start(now);
    lfo.start(now);
    osc1.stop(now + 7.2);
    osc2.stop(now + 7.2);
    lfo.stop(now + 7.2);
    this.output(g, pan, 0.38);
  }

  /**
   * Metal -- a distant resonant plate, not a clang. Soft attack, long,
   * inharmonic decay, occupying the space between Bell/Crystal and Deep Synth.
   */
  playMetal(midi: number, pan: number): void {
    const scale = this.beginVoice("metal", 5.0);
    if (scale === null) return;
    const { ctx } = this.ensure();
    const freq = midiToFreq(midi);
    const now = ctx.currentTime;
    const peak = 0.2 * scale;

    const sum = ctx.createGain();
    const ratios = [1, 1.41, 2.37, 3.12, 4.23];
    for (const ratio of ratios) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq * ratio, now);
      const decay = 3.4 / Math.sqrt(ratio);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime((peak / ratios.length / Math.sqrt(ratio)) * 3, now + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, now + decay);
      osc.connect(g).connect(sum);
      osc.start(now);
      osc.stop(now + decay + 0.1);
    }

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq * 1.6;
    filter.Q.value = 1.2;
    sum.connect(filter);
    this.output(filter, pan, 0.5);
  }

  /**
   * Shimmer -- light, airy, high, slowly emerging, long tail. No percussive
   * attack: more like light becoming audible. Used sparingly (tight
   * per-brush voice cap) so it adds space rather than crowding the mix.
   */
  playShimmer(midi: number, pan: number): void {
    const scale = this.beginVoice("shimmer", 5.8);
    if (scale === null) return;
    const { ctx } = this.ensure();
    const freq = midiToFreq(midi);
    const now = ctx.currentTime;
    const peak = 0.13 * scale;

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(ctx);
    noise.loop = true;
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.value = freq * 2;
    bandpass.Q.value = 6;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.linearRampToValueAtTime(peak, now + 1.3);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 5.4);
    noise.connect(bandpass).connect(noiseGain);

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.0001, now);
    oscGain.gain.linearRampToValueAtTime(peak * 0.6, now + 1.0);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 4.9);
    osc.connect(oscGain);

    const sum = ctx.createGain();
    noiseGain.connect(sum);
    oscGain.connect(sum);

    noise.start(now);
    noise.stop(now + 5.5);
    osc.start(now);
    osc.stop(now + 5.1);
    this.output(sum, pan, 0.6);
  }
}
