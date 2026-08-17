// Pitch quantization: freehand vertical position always lands on a note in a
// forgiving major-pentatonic scale, so random drawing still sounds musical.
// Every brush quantizes through this same SHARED_ROOT_MIDI anchor, even
// though each brush is given its own [min, max] register (see sketch.ts) --
// that shared anchor is what makes eight differently-ranged voices sound like
// one harmonic world instead of eight independently-tuned instruments.

const PENTATONIC = [0, 2, 4, 7, 9];
const SHARED_ROOT_MIDI = 60; // C4 -- the one shared anchor every brush's scale is built from

export function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/**
 * Snap a fractional position t (0 = bottom of range, 1 = top) to the nearest
 * note of a pentatonic scale, restricted to notes that fall within
 * [minMidi, maxMidi]. Every brush calls this against the same
 * SHARED_ROOT_MIDI, so two brushes with different ranges still only ever
 * play notes from the same underlying scale.
 */
export function quantizeToScale(t: number, minMidi: number, maxMidi: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  const lowOctave = Math.floor((minMidi - SHARED_ROOT_MIDI) / 12) - 1;
  const highOctave = Math.ceil((maxMidi - SHARED_ROOT_MIDI) / 12) + 1;

  const notes: number[] = [];
  for (let octave = lowOctave; octave <= highOctave; octave++) {
    for (const step of PENTATONIC) {
      const note = SHARED_ROOT_MIDI + octave * 12 + step;
      if (note >= minMidi && note <= maxMidi) notes.push(note);
    }
  }
  notes.sort((a, b) => a - b);
  if (notes.length === 0) return Math.round((minMidi + maxMidi) / 2);

  const idx = Math.round(clamped * (notes.length - 1));
  return notes[idx];
}
