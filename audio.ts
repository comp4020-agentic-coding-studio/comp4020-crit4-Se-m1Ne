// Live Web Audio synthesis for the eight dream-pop sound brushes. No samples,
// no prerecorded loops -- everything here is oscillators, filters and gain
// envelopes, including the reverb tail (a synthesized noise impulse fed
// through a ConvolverNode, not a recorded space) and the delay (a plain
// DelayNode feedback loop, not an effects plugin).
//
// All eight voices share one signal path -- a dry send, a shared reverb
// send, and a selective delay send -- because that shared "room" is what
// makes eight different timbres read as one washed-out dream-pop space
// rather than eight unrelated effects. An always-on, very quiet drone is
// started the first time the engine wakes up, so the space itself is never
// truly silent between triggers.
//
// Every brush here follows the same envelope philosophy: fade in, sit in a
// body/resonance, fade out -- never an instant attack straight into a stop.
// A ripple should wake a sound up, not press a sound-effect button.
//
// Voice bookkeeping (per-brush caps + a load-dependent gain trim) exists so
// that painting densely with a long-tailed brush, or clicking rapidly, can't
// clip the mix or stack an unbounded number of ringing voices -- without
// ever refusing a trigger the player can hear as "blocked." Haze in
// particular gets a hard, low cap: a washed-out pad is exactly the kind of
// sound that turns into mud if more than a couple stack at once.
import { midiToFreq } from "./scale";
import type { BrushType } from "./types";

interface Bus {
  ctx: AudioContext;
  bus: GainNode;
  convolver: ConvolverNode;
  delay: DelayNode;
}

// Hard per-brush polyphony ceiling. Short/dense brushes get room to breathe
// under fast painting; long/atmospheric brushes are capped hard so a few
// seconds of dragging or holding can't stack a wall of Haze, Deep, or
// Shimmer tails on top of each other.
const MAX_VOICES: Record<BrushType, number> = {
  pluck: 16,
  bell: 8,
  glass: 6,
  bloom: 4,
  veil: 4,
  shimmer: 3,
  deep: 3,
  haze: 2,
};

// How much longer a brush's own decay/sustain/tail can stretch under a full
// hold, as a multiplier on top of its quick-tap (resonance = 0) length.
// Different per brush on purpose: "hold longer" means "more resonance within
// this brush's own character," not "every brush becomes equally long" --
// Pluck stays short and rhythmic even at a full hold, while Bloom, Haze and
// Deep have the most room to grow into something genuinely sustained.
const RESONANCE_GROWTH: Record<BrushType, number> = {
  bell: 1.4,
  glass: 1.8,
  pluck: 0.5,
  bloom: 2.2,
  haze: 2.5,
  deep: 1.8,
  shimmer: 1.3,
  veil: 1.6,
};

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private delay: DelayNode | null = null;
  private noiseCache: AudioBuffer | null = null;
  private ambientStarted = false;

  private activeVoices: Record<BrushType, number> = {
    bell: 0,
    glass: 0,
    pluck: 0,
    bloom: 0,
    haze: 0,
    deep: 0,
    shimmer: 0,
    veil: 0,
  };
  private totalActive = 0;

  private ensure(): Bus {
    if (!this.ctx || !this.bus || !this.convolver || !this.delay) {
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
      // convolver, softened with a lowpass tuned dark enough that the wet
      // tail reads as a warm, washed space rather than a bright hall.
      const convolver = ctx.createConvolver();
      convolver.buffer = this.makeImpulseResponse(ctx);
      const reverbFilter = ctx.createBiquadFilter();
      reverbFilter.type = "lowpass";
      reverbFilter.frequency.value = 3200;
      const reverbGain = ctx.createGain();
      reverbGain.gain.value = 0.55;
      convolver.connect(reverbFilter).connect(reverbGain).connect(bus);

      // A quiet, selectively-used feedback delay -- not applied to every
      // brush. Used to make a handful of sounds (Bell's chime, Glass, Veil)
      // read as "arriving from further away" rather than sitting right on
      // top of the dry signal: an echo quiet enough that it's felt as
      // distance, not heard as an obvious delay effect.
      const delay = ctx.createDelay(2.0);
      delay.delayTime.value = 0.34;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.26;
      const delayDamp = ctx.createBiquadFilter();
      delayDamp.type = "lowpass";
      delayDamp.frequency.value = 2000;
      delay.connect(feedback).connect(delayDamp).connect(delay);
      const delayOut = ctx.createGain();
      delayOut.gain.value = 0.55;
      delay.connect(delayOut).connect(bus);
      // The delay's own repeats should also dissolve into the same room
      // rather than staying dry and separate.
      delayOut.connect(convolver);

      this.ctx = ctx;
      this.bus = bus;
      this.convolver = convolver;
      this.delay = delay;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    if (!this.ambientStarted) {
      this.ambientStarted = true;
      this.startAmbient(this.ctx, this.bus);
    }
    return { ctx: this.ctx, bus: this.bus, convolver: this.convolver, delay: this.delay };
  }

  /** Call on the first user gesture to satisfy autoplay policy. Safe to call repeatedly. */
  unlock(): void {
    this.ensure();
  }

  /**
   * How much longer `brush`'s envelope should stretch for a given hold
   * amount (0 = quick tap, 1 = held to the maximum). Exposed publicly so the
   * canvas can size a mark's visual pulse to match its actual sound length,
   * without duplicating each brush's envelope math.
   */
  durationScale(brush: BrushType, resonance: number): number {
    return 1 + clamp01(resonance) * RESONANCE_GROWTH[brush];
  }

  // --- shared plumbing ------------------------------------------------------

  // Every voice ends here: a stereo pan (tying left/right to the mark's x
  // position, so the stereo field mirrors the painting) split into a dry
  // send, a reverb send, and (for the handful of brushes that want it) a
  // delay send, all landing on the same bus.
  private output(node: AudioNode, pan: number, wet: number, delayWet = 0): void {
    const { ctx, bus, convolver, delay } = this.ensure();
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(panner);
    panner.connect(bus);
    if (wet > 0) {
      const wetGain = ctx.createGain();
      wetGain.gain.value = wet;
      panner.connect(wetGain).connect(convolver);
    }
    if (delayWet > 0) {
      const delaySend = ctx.createGain();
      delaySend.gain.value = delayWet;
      panner.connect(delaySend).connect(delay);
    }
  }

  // Builds a small bank of detuned oscillators mixed into one gain node --
  // the "single beeeeep becomes wwaaaahhh" trick used by every pad-like
  // brush (Bloom, Haze, Deep, Veil). Detune stays subtle on purpose: this
  // should read as width and warmth, never as an out-of-tune chord.
  private chorusVoice(
    ctx: AudioContext,
    freq: number,
    type: OscillatorType,
    ratios: number[],
    now: number,
    stopAt: number,
  ): { sum: GainNode; oscillators: OscillatorNode[] } {
    const sum = ctx.createGain();
    const oscillators: OscillatorNode[] = [];
    for (const ratio of ratios) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq * ratio, now);
      osc.connect(sum);
      osc.start(now);
      osc.stop(stopAt);
      oscillators.push(osc);
    }
    return { sum, oscillators };
  }

  // Registers one voice of `brush` for `durationSec`. Returns false (and
  // triggers nothing) if that brush is already at its polyphony ceiling --
  // a silent, graceful drop rather than an audible glitch. Returns a gain
  // multiplier that gently ducks new voices when the overall mix is already
  // busy, so many overlapping ripples thin out instead of clipping.
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
    const duration = 4.2;
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
  // never reads as dead silence -- "musical air," not a spaceship hum.
  // Three gently detuned sines (a subtle chorus, not a beating drone) sit
  // under a slow-sweeping lowpass; a whisper-quiet high-passed noise layer
  // adds a breath of air on top so the whole thing doesn't read as bass
  // rumble. No melody, no rhythm, no dramatic movement -- gain low enough
  // that it should be felt more than consciously heard.
  private startAmbient(ctx: AudioContext, bus: GainNode): void {
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.02;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 560;
    filter.Q.value = 0.5;

    const base = midiToFreq(43); // low G -- under every brush's register, but not sub-bass rumble
    for (const ratio of [1, 1.003, 0.997]) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = base * ratio;
      osc.connect(filter);
      osc.start();
    }

    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.03; // one sweep roughly every half minute
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 140;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();

    filter.connect(droneGain).connect(bus);

    // A whisper of high-passed noise -- "air," not hiss -- panned slowly
    // between channels so the space feels wide rather than static.
    const air = ctx.createBufferSource();
    air.buffer = this.noiseBuffer(ctx);
    air.loop = true;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = "highpass";
    airFilter.frequency.value = 5200;
    const airGain = ctx.createGain();
    airGain.gain.value = 0.006;
    const airPanner = ctx.createStereoPanner();
    const panLfo = ctx.createOscillator();
    panLfo.type = "sine";
    panLfo.frequency.value = 0.017;
    const panLfoGain = ctx.createGain();
    panLfoGain.gain.value = 0.6;
    panLfo.connect(panLfoGain).connect(airPanner.pan);
    panLfo.start();
    air.connect(airFilter).connect(airGain).connect(airPanner).connect(bus);
    air.start();
  }

  // --- the eight brushes -----------------------------------------------------

  /**
   * Bell -- clear, bright, light, slightly distant. Fast but softened
   * attack, medium decay, a quiet delay send so it reads as "ting~~~ ...
   * ting... ... ting....." rather than one isolated chime. Kept one of the
   * clearest transients in the palette on purpose, so ripple collisions
   * stay audible even inside a dense, washed mix. `resonance` (0 = tap, 1 =
   * full hold) stretches how long each partial rings on -- the attack stays
   * fixed and soft regardless of hold length, so it never turns harsh.
   */
  playBell(midi: number, pan: number, resonance: number): void {
    const stretch = this.durationScale("bell", resonance);
    const { ctx } = this.ensure();
    const freq = midiToFreq(midi);
    const now = ctx.currentTime;

    const partials: [number, number, number][] = [
      [1, 1, 1.9 * stretch],
      [2.4, 0.32, 1.0 * stretch],
      [3.8, 0.14, 0.55 * stretch],
    ];
    const scale = this.beginVoice("bell", partials[0][2] + 0.3);
    if (scale === null) return;
    const peak = 0.27 * scale;

    const sum = ctx.createGain();
    for (const [ratio, gainMul, decay] of partials) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq * ratio, now);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(peak * gainMul, now + 0.014);
      g.gain.exponentialRampToValueAtTime(0.0001, now + decay);
      osc.connect(g).connect(sum);
      osc.start(now);
      osc.stop(now + decay + 0.05);
    }

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = freq * 4.5;
    sum.connect(filter);
    // A longer hold also sends a touch more into the shared reverb, so a
    // resonant Bell reads as more spacious, not just longer.
    this.output(filter, pan, 0.24 + resonance * 0.16, 0.1);
  }

  /**
   * Glass -- transparent, soft, glass-like, dreamlike. A softer, slower
   * attack than Bell and a longer tail, with a second, faintly detuned
   * voice underneath so the partials feel refracted rather than pure --
   * "diiing~~~~", not "TING!". `resonance` stretches the decay and the
   * bandpass sweep together so the glassy motion still matches the tail.
   */
  playGlass(midi: number, pan: number, resonance: number): void {
    const stretch = this.durationScale("glass", resonance);
    const { ctx } = this.ensure();
    const freq = midiToFreq(midi);
    const now = ctx.currentTime;

    const scale = this.beginVoice("glass", 3.8 * stretch);
    if (scale === null) return;
    const peak = 0.2 * scale;

    const sum = ctx.createGain();
    const partials: [number, number][] = [
      [1, 1],
      [2.01, 0.46],
      [3.98, 0.24],
      [5.4, 0.12],
    ];
    for (const detune of [1, 1.006]) {
      for (const [ratio, gainMul] of partials) {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq * ratio * detune, now);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime((peak * gainMul) / 2, now + 0.09);
        g.gain.exponentialRampToValueAtTime(0.0001, now + (2.9 + gainMul * 0.4) * stretch);
        osc.connect(g).connect(sum);
        osc.start(now);
        osc.stop(now + 3.6 * stretch);
      }
    }

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 2.1;
    filter.frequency.setValueAtTime(freq * 2.3, now);
    filter.frequency.exponentialRampToValueAtTime(freq * 1.35, now + 3.1 * stretch);
    sum.connect(filter);
    this.output(filter, pan, 0.44 + resonance * 0.18, 0.07);
  }

  /**
   * Soft Pluck -- a gentle, rounded, warm articulation. Replaces what used
   * to be a pitch-sweeping "biu" with a filter-envelope pluck instead: the
   * oscillator's own pitch never sweeps, only a lowpass filter closes
   * quickly over it, which is what turns a laser-like zap into a soft
   * "lum~"/"plim~". Short and musical, never sustained -- `resonance` only
   * nudges it slightly longer so it stays the palette's short/rhythmic
   * voice even at a full hold.
   */
  playPluck(midi: number, ny: number, pan: number, resonance: number): void {
    const stretch = this.durationScale("pluck", resonance);
    const { ctx } = this.ensure();
    const freq = midiToFreq(midi);
    const now = ctx.currentTime;
    const decay = 0.38 * stretch;
    const stopAt = 0.46 * stretch;

    const scale = this.beginVoice("pluck", stopAt + 0.05);
    if (scale === null) return;
    const peak = 0.19 * scale;

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, now);

    // The "pluck" lives entirely in this filter envelope, not in the
    // oscillator's pitch: brighter near the top of the canvas, closing
    // quickly toward a rounder, duller tone -- soft articulation, not a
    // sweep you can hear as a shooting-game effect.
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.7;
    const brightPeak = 900 + (1 - ny) * 2600;
    filter.frequency.setValueAtTime(brightPeak, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(240, brightPeak * 0.22), now + decay);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(peak, now + 0.014);
    g.gain.exponentialRampToValueAtTime(0.0001, now + decay);

    osc.connect(filter).connect(g);
    osc.start(now);
    osc.stop(now + stopAt);
    this.output(g, pan, 0.22 + resonance * 0.1);
  }

  /**
   * Bloom -- warm, soft, slowly-opening, mid-frequency, dreamy. A slow
   * attack and a filter that opens as the gain rises, so the sound
   * genuinely blooms into being rather than just fading up at a fixed
   * timbre -- "waaah~~~~". A three-voice detuned chorus keeps the body from
   * ever collapsing into a flat "beeeeep". Tap = a short bloom; a full
   * hold = a much longer body and a long, slow fade-out.
   */
  playBloom(midi: number, pan: number, resonance: number): void {
    const stretch = this.durationScale("bloom", resonance);
    const { ctx } = this.ensure();
    const freq = midiToFreq(midi);
    const now = ctx.currentTime;
    const attack = 0.55 + resonance * 0.35;
    const decayTime = (2.2 + resonance * 0.6) * stretch;
    const stopAt = decayTime + 0.3;

    const scale = this.beginVoice("bloom", stopAt);
    if (scale === null) return;
    const peak = 0.22 * scale;

    const { sum } = this.chorusVoice(ctx, freq, "triangle", [1, 1.004, 0.996], now, now + stopAt);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.6;
    filter.frequency.setValueAtTime(freq * 0.9, now);
    filter.frequency.linearRampToValueAtTime(freq * 4.2, now + attack);
    filter.frequency.exponentialRampToValueAtTime(freq * 1.4, now + decayTime);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(peak, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + decayTime);

    sum.connect(filter).connect(g);
    this.output(g, pan, 0.4 + resonance * 0.2, 0.05);
  }

  /**
   * Haze -- very soft, washed-out, pad-like, distant, floating. The
   * longest, quietest voice in the palette: very slow attack, very long
   * decay, gentle detuning across three voices for width, and a hard
   * per-brush voice cap (see MAX_VOICES) since a washed pad is exactly what
   * turns to mud if several stack. Meant to connect the palette's other,
   * shorter sounds into one continuous atmosphere without ever drawing
   * attention to itself -- "hmmmmmmmm～～～～".
   */
  playHaze(midi: number, pan: number, resonance: number): void {
    const stretch = this.durationScale("haze", resonance);
    const { ctx } = this.ensure();
    const freq = midiToFreq(midi);
    const now = ctx.currentTime;
    const attack = 1.8 + resonance * 0.8;
    const decayTime = (6.5 + resonance * 2) * stretch;
    const stopAt = decayTime + 0.5;

    const scale = this.beginVoice("haze", stopAt);
    if (scale === null) return;
    const peak = 0.1 * scale;

    const { sum } = this.chorusVoice(ctx, freq, "sine", [1, 1.006, 0.993], now, now + stopAt);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.4;
    filter.frequency.value = freq * 2.6;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(peak, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + decayTime);

    sum.connect(filter).connect(g);
    this.output(g, pan, 0.55 + resonance * 0.2, 0.04);
  }

  /**
   * Deep -- low, warm, soft, atmospheric, very sustained. Soft, slow
   * attack into a long sustained tone and a slow fade -- deliberately no
   * percussive "BOOM". A three-oscillator detuned chorus (widened from the
   * previous two-voice version) turns a plain low sine into a
   * "woooom~~~~~~" body. Provides the low-frequency foundation under
   * everything else; gain is restrained on purpose to guard against
   * low-frequency buildup when several Deep marks resonate together. A
   * longer hold both stretches the tail and slows the filter's own sweep,
   * so a fully-held Deep breathes more slowly as well as lasting longer.
   */
  playDeep(midi: number, pan: number, resonance: number): void {
    const stretch = this.durationScale("deep", resonance);
    const { ctx } = this.ensure();
    const freq = midiToFreq(midi);
    const now = ctx.currentTime;
    const attack = 0.8 + resonance * 0.6;
    const decayTime = 7.4 * stretch;
    const stopAt = 7.6 * stretch;

    const scale = this.beginVoice("deep", stopAt);
    if (scale === null) return;
    const peak = 0.24 * scale;

    const { sum } = this.chorusVoice(ctx, freq, "sine", [1, 1.005, 0.996], now, now + stopAt);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(freq * 1.6, now);

    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.15 - resonance * 0.07; // slower sweep the longer it's held
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = freq * 0.7;
    lfo.connect(lfoGain).connect(filter.frequency);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(peak, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + decayTime);

    sum.connect(filter).connect(g);
    lfo.start(now);
    lfo.stop(now + stopAt);
    this.output(g, pan, 0.4 + resonance * 0.2);
  }

  /**
   * Shimmer -- high, airy, faint, sparkling, slightly psychedelic, but
   * never a laser or a magical pickup: the attack is slow and the gain is
   * very low, so it reads as light appearing inside the reverb field
   * rather than a sound effect announcing itself. A second, quietly
   * detuned tone underneath widens it without adding brightness.
   * `resonance` slows the emergence as well as lengthening the tail, so a
   * fully-held Shimmer feels like it's arriving from further away.
   */
  playShimmer(midi: number, pan: number, resonance: number): void {
    const stretch = this.durationScale("shimmer", resonance);
    const { ctx } = this.ensure();
    const freq = midiToFreq(midi);
    const now = ctx.currentTime;
    const noiseAttack = 1.6 * stretch;
    const noiseDecay = 5.8 * stretch;
    const noiseStop = 5.9 * stretch;
    const oscAttack = 1.3 * stretch;
    const oscDecay = 5.3 * stretch;
    const oscStop = 5.5 * stretch;

    const scale = this.beginVoice("shimmer", noiseStop);
    if (scale === null) return;
    const peak = 0.1 * scale;

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(ctx);
    noise.loop = true;
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.value = freq * 2;
    bandpass.Q.value = 5;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.linearRampToValueAtTime(peak, now + noiseAttack);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + noiseDecay);
    noise.connect(bandpass).connect(noiseGain);

    const sum = ctx.createGain();
    noiseGain.connect(sum);
    for (const ratio of [1, 1.008]) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq * ratio, now);
      const oscGain = ctx.createGain();
      oscGain.gain.setValueAtTime(0.0001, now);
      oscGain.gain.linearRampToValueAtTime(peak * 0.45, now + oscAttack);
      oscGain.gain.exponentialRampToValueAtTime(0.0001, now + oscDecay);
      osc.connect(oscGain).connect(sum);
      osc.start(now);
      osc.stop(now + oscStop);
    }

    noise.start(now);
    noise.stop(now + noiseStop);
    this.output(sum, pan, 0.62 + resonance * 0.15);
  }

  /**
   * Veil -- distant, vocal-like without speech, soft, hollow, warm,
   * floating. Two fixed bandpass filters carve vowel-like formants out of a
   * plain sawtooth so the result reads as a wordless "oooh~~~~" rather than
   * a synth pad or an actual voice recording -- pure synthesis throughout.
   * A slow vibrato adds the last bit of floating, breathing quality. Sits
   * between Bell/Pluck's short foreground and Haze/Deep's long atmosphere.
   */
  playVeil(midi: number, pan: number, resonance: number): void {
    const stretch = this.durationScale("veil", resonance);
    const { ctx } = this.ensure();
    const freq = midiToFreq(midi);
    const now = ctx.currentTime;
    const attack = 1.1 + resonance * 0.5;
    const decayTime = (3.4 + resonance * 0.8) * stretch;
    const stopAt = decayTime + 0.4;

    const scale = this.beginVoice("veil", stopAt);
    if (scale === null) return;
    const peak = 0.16 * scale;

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(freq, now);

    const vibrato = ctx.createOscillator();
    vibrato.type = "sine";
    vibrato.frequency.value = 4.2;
    const vibratoGain = ctx.createGain();
    vibratoGain.gain.value = freq * 0.006;
    vibrato.connect(vibratoGain).connect(osc.frequency);

    const sum = ctx.createGain();
    // Two vowel-like formant bands ("oo"-ish), mixed together rather than
    // chained, so neither dominates and the result stays soft-edged.
    for (const [formantFreq, q, gainMul] of [
      [730, 6, 1],
      [1150, 5, 0.55],
    ] as [number, number, number][]) {
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = formantFreq;
      band.Q.value = q;
      const bandGain = ctx.createGain();
      bandGain.gain.value = gainMul;
      osc.connect(band).connect(bandGain).connect(sum);
    }

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(peak, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + decayTime);

    sum.connect(g);
    osc.start(now);
    vibrato.start(now);
    osc.stop(now + stopAt);
    vibrato.stop(now + stopAt);
    this.output(g, pan, 0.5 + resonance * 0.2, 0.09);
  }
}
