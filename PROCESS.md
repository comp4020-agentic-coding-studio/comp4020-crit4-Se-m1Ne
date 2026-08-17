# Process overview

The course site's
[assessment page](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/topics/assessment/#what-you-submit)
is the requirement; this file is a map to how the work got there.

## What I built

**Sound Canvas**: a full-screen instrument where you paint marks onto a dark
canvas and a looping ripple, expanding outward from the centre, plays whatever
it touches --- distance from the centre is time in the loop, so the ripple
itself is the sequencer. Clicking or tapping anywhere also sends out an
independent one-shot ripple from that exact point, for live playing on top of
the loop. Four sound brushes (Glow, Spark, Ink, Grain), each with its own
Web-Audio synthesis and its own visual shape, cover melodic, bell, bass, and
percussive character; vertical position sets pitch (quantised to a pentatonic
scale so nothing plays a "wrong" note) or percussion register. There's no
tutorial, start button, or score --- the first click both unlocks audio and
triggers the pre-placed starter marks, so sound happens before any UI is read.

## The moments that mattered

1. **Ripple-as-sequencer instead of a linear timeline.** The brief asked for a
   central looping ripple where "distance from centre = time in the loop," but
   the obvious implementation path for a browser instrument is a linear
   playhead (a `requestAnimationFrame` loop advancing a `t` variable left to
   right) with marks laid out on a timeline, because that's the pattern every
   step-sequencer tutorial uses. I built the radial version instead --- a
   `Ripple` with a growing `radius`, and a per-frame collision check
   `dist > prevRadius && dist <= radius` against every mark's distance from
   the centre --- because a timeline would have turned the canvas into a
   scrolling piano roll, which is exactly the DAW-like look the brief says to
   avoid. I checked it was right by watching the built page in a headless
   browser: the loop ripple visibly expands as a circle, marks pulse as the
   ring passes through them, and the loop resets and re-triggers cleanly on
   each pass
   ([`f23253d`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-Se-m1Ne/commit/f23253d)).

2. **All four brushes from the start, against the staged plan.** The brief's
   own "development priority" section stages the palette in --- Stage 1 with
   only two melodic voices and one percussion type, full palette deferred to
   Stage 2. I built all four (Glow, Spark, Ink, Grain) together instead,
   because the brief also asks for a cold open with no onboarding: a palette
   that starts with one button and grows over the session would need some way
   to *tell* the player new brushes exist, which is itself a small onboarding
   problem the brief is trying to avoid. Shipping the full, visually-distinct
   palette from the first frame means what you see on load is what the
   instrument actually is. I checked this against the "no wrong way to play"
   requirement by seeding three starter marks (one Glow, one Spark, one
   Grain) so the very first loop pass already demonstrates more than one
   voice without any input at all
   ([`f23253d`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-Se-m1Ne/commit/f23253d)).

3. **A tsconfig gap that would have made a whole module invisible to
   typecheck.** `tsconfig.json`'s `include` is `["*.ts", "spec"]` --- only
   top-level `.ts` files, not anything in a subdirectory. My first instinct
   was a `src/` folder for `sketch.ts`, `audio.ts`, and `scale.ts`, which
   `tsc --noEmit` would have silently skipped: `pnpm check` would stay green
   no matter what type errors were in there. Rather than just moving the
   files and moving on, I wrote the constraint into `CLAUDE.md` so the next
   session (or the next file I add) doesn't rediscover it the same way ---
   the fix that matters is the one that stops the same mistake from being
   possible again, not the one that stops it happening once
   ([`a99b0e2`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-Se-m1Ne/commit/a99b0e2)).

4. **Stylelint's modern-CSS rules caught a whole file's worth of legacy
   syntax before it ever reached a commit.** `styles.css` used `rgba(r,g,b,a)`
   throughout, plus `max-width` media queries and a deprecated `clip`
   property --- all valid CSS, all rejected by `stylelint-config-standard`
   (56 errors). `--fix` handled the color functions and the media-query range
   syntax automatically; `clip` had to be hand-converted to `clip-path:
   inset(50%)`. I verified by re-running `pnpm check` until lint was clean,
   then added the specific notation this config expects to `CLAUDE.md` so a
   future edit to `styles.css` doesn't reintroduce the same 56 errors one at
   a time
   ([`a99b0e2`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-Se-m1Ne/commit/a99b0e2)).

## A refinement pass

Once the instrument was playable, four small changes made it easier to
actually use and to compose with, without touching its concept, layout, or
art direction
([`1f23fe4`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-Se-m1Ne/commit/1f23fe4)):

- **A quicker default tempo**, so the loop has some life to it on first load
  instead of needing the slider touched before the instrument feels
  responsive.
- **An eraser**, because painting sound marks with no way to remove one
  turns every misplaced click into a permanent addition --- reversibility
  matters as much for sound as it does for a brush stroke.
- **Pause**, for composition and manual performance: stopping the automatic
  loop so a player can arrange marks without them being triggered mid-edit,
  while one-shot ripples from clicks stay live so pausing doesn't mean
  going silent.
- **Subtle concentric background rings**, so distance-from-centre --- the
  loop's own timing --- has a visible reference even before a ripple has
  swept past, without the rings themselves looking like a technical
  overlay.

Switching the ripple's radius from an absolute-elapsed-time calculation to
per-frame delta-time accumulation was the one internal change needed to
support two of these cleanly: a live tempo change no longer has to
retroactively correct for time already elapsed at the old speed, and pausing
is just skipping that frame's growth for the loop ripple only --- both come
for free instead of needing separate special-casing.

## Before you ship

`pnpm check:evidence` verifies your citations resolve to real commits, that
the current reflection entry is in `reflections/`, and that your `CLAUDE.md`
is there --- before a marker ever opens the file. The reflection for this
deliverable is deliberately not written yet: it gets drafted after the
instrument has actually been played and tested, not before.
