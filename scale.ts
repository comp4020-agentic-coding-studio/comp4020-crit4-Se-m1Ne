// Pitch quantization: freehand vertical position always lands on a note in a
// forgiving major-pentatonic scale, so random drawing still sounds musical.

const PENTATONIC = [0, 2, 4, 7, 9];

export function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/**
 * Snap a fractional position t (0 = bottom of range, 1 = top) to the nearest
 * note of a pentatonic scale spanning [minMidi, maxMidi].
 */
export function quantizeToScale(t: number, minMidi: number, maxMidi: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  const octaves = Math.max(1, Math.round((maxMidi - minMidi) / 12));
  const totalDegrees = octaves * PENTATONIC.length;
  const degree = Math.round(clamped * (totalDegrees - 1));
  const octave = Math.floor(degree / PENTATONIC.length);
  const step = PENTATONIC[degree % PENTATONIC.length] ?? 0;
  return minMidi + octave * 12 + step;
}

export type PercussionZone = "hi" | "mid" | "low";

/** ny: normalized vertical position, 0 = top of canvas, 1 = bottom. */
export function percussionZone(ny: number): PercussionZone {
  if (ny < 1 / 3) return "hi";
  if (ny < 2 / 3) return "mid";
  return "low";
}
