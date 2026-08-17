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
the loop. Six sound brushes (Bell, Crystal, Drop, Deep Synth, Metal, Shimmer),
each with its own Web-Audio synthesis and its own visual shape, form one
coherent cosmic palette --- short bright textures, resonant metallic and
crystalline tones, and a slow, deep low end all sharing the same hidden
harmonic world; vertical position sets pitch (quantised to a shared pentatonic
scale, with each brush given its own register, so nothing plays a "wrong"
note) or, for Drop, brightness. There's no tutorial, start button, or score
--- the first click both unlocks audio and triggers the pre-placed starter
marks, so sound happens before any UI is read.

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

## A second refinement pass

Two more changes, again without touching the instrument's concept, layout, or
art direction:

- **Clear Canvas, with a confirmation step.** Individual erasing becomes
  inefficient once a composition contains many sound marks --- clearing a
  crowded canvas one mark at a time isn't a real workflow. A confirmation
  step was added because clearing is destructive and should not happen
  accidentally: the button first arms into a compact "Clear all? /
  Confirm / Cancel" row rather than clearing on the first click, reverts on
  Cancel, on a click anywhere outside the control, or automatically after
  five seconds of inactivity, and leaves tempo, pause state, and the active
  brush untouched.
- **More visible concentric guides.** The previous six rings at a flat, near-
  invisible opacity were too subtle to actually communicate radial
  distance --- players couldn't use them to judge timing before a ripple
  swept past. Increasing the count to ten and graduating the opacity from
  centre to edge makes them quietly noticeable without turning them into a
  technical overlay; they stay well below the brightness of any mark or
  ripple, so the background --- guides --- marks --- ripples hierarchy holds.

Verifying the Clear Canvas confirmation surfaced a real bug, not just a
missing feature: the confirm row and its trigger button used `hidden` for
visibility, but `.clear-confirm { display: flex }` had the same specificity
as the browser's own `[hidden] { display: none }` rule and won on source
order, so the confirm row rendered on every page load regardless of the
attribute. A parallel bug turned up in the existing erase-flash animation
while re-testing the eraser: its fade fraction wasn't clamped, and a rAF
timestamp landing a fraction of a millisecond behind the `performance.now()`
deadline that scheduled the flash was enough to push a circle's radius
negative, which throws inside `CanvasRenderingContext2D.arc` --- and because
that throw happens before the loop's own `requestAnimationFrame` call, it
would have silently frozen the entire instrument on an unlucky frame. Both
were caught by console-error monitoring during Playwright verification
rather than by any visual check, which is the reason that verification step
stayed in the process even for a change that looked purely cosmetic.

## A sound redesign: what listening caught that the checks couldn't

The original palette (Glow, Spark, Ink, Grain) was built from fairly
conventional pitched-synth and percussion sounds --- a bell-ish tone, a
plucked tone, a bass tone, a percussive hit. It passed every check
(`pnpm check` green, all brush/pitch tests passing) and looked correct on
paper: four distinct brushes, a shared pentatonic scale, pitch mapped to
Y-position. Actually listening to it revealed something the tests had no way
to catch: the four sounds felt like separate instruments taking turns rather
than one instrument, and a densely painted area sounded like scattered
individual notes rather than a texture, because each sound was short,
percussive, and rang out in isolation. Part of the problem was structural,
not just timbral --- the ripple plays radially outward from the centre, not
left-to-right, so the usual melodic expectations of a piano-roll style
sequence (a phrase rising and falling in a fixed order) don't really apply
here, and conventional pitched-synth voices were fighting a playback model
that was never going to read as a tune.

The fix was not to remove drawing or pitch --- both stayed, because "the
ripple plays what it touches" and "Y-position controls pitch" are the
instrument's actual identity. Instead, the whole sound palette was replaced
with six voices (Bell, Crystal, Drop, Deep Synth, Metal, Shimmer) designed
together as one cosmic/resonant sound world rather than six independent
instruments: every brush quantises through the same shared pentatonic anchor
even though each has its own register, so a low Deep Synth drone and a high
Shimmer texture still can't produce a clashing note; the old drum-like sounds
(kick/snare-style hits) were removed entirely, since a drum kit was fighting
the "cosmic" brief as much as the melodic ones were; and the Y-pitch range
per brush was deliberately widened to two-to-three audible octaves so
pitch still reads as expressive rather than decorative. Short and long
sounds were then deliberately mixed and made to overlap --- Drop is
short, Bell and Crystal are medium, Metal and Shimmer are long, Deep Synth
is very long --- so a dense painted area rings and blends instead of
chattering, and a shared, subtle reverb send was added across all six
voices (plus a near-inaudible always-on ambient drone) so they read as six
materials in one space rather than six unrelated samples glued together.
The central loop's default speed was also slowed down, because a loop tuned
for short, percussive sounds was retriggering marks faster than the new
longer-decaying sounds could resonate --- manual one-shot ripples were kept
at their original fast, unquantised speed, since those are for live
playing, not the ambient background pulse.

None of this --- whether six sounds feel like one instrument, whether Metal
reads as "resonant" rather than "industrial," whether the ambient layer is
noticeable at all --- is something `pnpm check` or the spec tests can judge;
they only confirm the brush set exists, the scale never goes out of range,
and nothing throws. This redesign is an example of a change that had to be
driven by actually listening to the built instrument, not by making the
automated checks pass, and the checks staying green throughout is why they
were treated as necessary but not sufficient here.

## Hold duration as a fourth expressive control

Painting a mark used to carry only three choices: which brush, where (pitch),
and when. A hold gesture adds a fourth: how long that mark resonates when a
ripple later touches it. Tapping paints a mark with its brush's usual, short
character; holding the pointer still on that same spot grows its resonance
continuously, up to a sensible per-brush maximum, and moving past a small
tolerance switches back to ordinary stroke painting instead of accidentally
stretching every dragged mark. The duration is never shown as a number --- a
faint halo grows while holding, and the placed mark keeps a small permanent
trace (one or two extra rings) of how resonant it was made, using the same
visual language as the rest of the instrument. Each brush stretches within
its own range rather than a single shared multiplier, so a fully-held Drop
stays a short, delicate sound while a fully-held Deep Synth or Shimmer can
become genuinely sustained --- the player is shaping not only timbre, pitch,
and timing, but also how long each painted sound rings on.

## Before you ship

`pnpm check:evidence` verifies your citations resolve to real commits, that
the current reflection entry is in `reflections/`, and that your `CLAUDE.md`
is there --- before a marker ever opens the file. The reflection for this
deliverable is deliberately not written yet: it gets drafted after the
instrument has actually been played and tested, not before.
