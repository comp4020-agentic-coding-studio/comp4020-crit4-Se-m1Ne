# Process overview

The course site's
[assessment page](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/topics/assessment/#what-you-submit)
is the requirement. This file records how the work developed and changed.

## What I built

**DREAMWASH** is a full-screen browser instrument. The player paints sound marks onto a dark canvas, and a ripple expands from the centre to play the marks it touches.
Distance from the centre controls when a sound plays in the loop, so the ripple acts as the sequencer.
The player can also click or tap anywhere to create a one-shot ripple from that point. This lets the player perform over the automatic loop.
The final sound palette has eight brushes: Bell, Glass, Soft Pluck, Bloom, Haze, Deep, Shimmer, and Veil. They use Web Audio synthesis and share the same dream-pop sound direction. Vertical position controls pitch for most brushes, using a hidden pentatonic scale so free drawing still stays musical.
The instrument has no score or fail state. The opening is also minimal: the first touch unlocks audio, creates the first ripple, and opens the canvas.

## 1. Ripple playback instead of a normal timeline

The first important decision was to avoid a normal left-to-right sequencer.
A normal timeline would have been easier to build, but it would also make the project look like a piano roll or a small DAW. I wanted the canvas itself to control time.
Instead, the automatic playback starts from the centre and expands outward. A sound plays when the ripple reaches it. This means distance from the centre becomes time.
I also reused the same idea for live playing. A click or tap creates another ripple from that exact point, so the same group of sounds can play in a different order depending on where the player touches.
This became the main interaction of the project.

Relevant commit:

[`f23253d`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-Se-m1Ne/commit/f23253d) — Build the Sound Canvas: radial ripples, four sound brushes, live synthesis

## 2. Making the canvas easier to use

Once the main interaction worked, I made several small changes to improve control.
The first loop speed felt too slow, so I increased the default speed. I also added an eraser, pause control, and subtle concentric rings.
The rings give the player a visual guide for distance from the centre, which also means timing.
Later, I added Clear Canvas with a confirmation step. This was useful because deleting many marks one by one became slow once the canvas was crowded.
These changes made experimentation easier without adding a correct or incorrect way to play.

Relevant commits:

[`1f23fe4`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-Se-m1Ne/commit/1f23fe4) — Refine Sound Canvas: quicker default tempo, eraser, pause, background rings

[`51d8c7a`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-Se-m1Ne/commit/51d8c7a) — Add Clear Canvas with confirmation, brighten background rings

## 3. Listening changed the sound direction

The biggest changes came from listening rather than from automated tests.
The first sound palette worked technically, but the sounds felt separate. A crowded area sounded like many small notes being triggered one after another instead of one musical texture.
I first changed the palette toward a more coherent cosmic sound. I kept drawing and Y-position pitch control, but used longer sounds, wider pitch ranges, and more shared reverb.
This helped, but a second listening pass showed another problem. Some sounds became too much like science-fiction or game sound effects. One short sound in particular had a "biu" or "pew" character.
I then changed the target again, from general "cosmic" audio to a more specific dream-pop / ethereal sound:

- light
- distant
- hazy
- soft
- washed-out
- floating
- warm
- slightly psychedelic

Bell and the long low Synth direction were kept. Game-like short sounds were removed or rebuilt.
The final palette became Bell, Glass, Soft Pluck, Bloom, Haze, Deep, Shimmer, and Veil.
Short and long sounds were mixed on purpose. Bell and Soft Pluck give clear timing, while Bloom, Haze, Deep, Shimmer, and Veil create longer layers.
Fade-in, fade-out, reverb, delay, and gentle detuning helped the sounds blend into one space instead of feeling like separate effects.

Relevant commits:

[`c4f9464`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-Se-m1Ne/commit/c4f9464) — Replace sound palette with a coherent cosmic soundscape

[`25a0a60`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-Se-m1Ne/commit/25a0a60) — Rebuild sound palette for a dream-pop/ethereal character

## 4. Hold duration as another expressive control

I wanted duration to be controlled by the player's gesture rather than by another slider.
A quick tap creates a shorter sound. Holding in one place creates a sound with more resonance and a longer duration. Dragging still paints multiple marks.
Different brushes keep different natural ranges. For example, Soft Pluck stays fairly short, while Deep or Shimmer can become much longer.
This means the player now shapes sound through:

- brush choice
- position
- pitch
- timing
- duration

without needing normal music-editor controls.

Relevant commit:

[`a7fdcfc`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-Se-m1Ne/commit/a7fdcfc) — Add hold-to-resonate: pointer hold duration controls sound length

## 5. Turning the audio restriction into the opening

Browser autoplay rules meant the AudioContext could not reliably make sound before the user interacted.
At first, this created an awkward result: the ripple looked active when the page opened, but there was no sound until the first click.
Instead of adding a normal "Enable Audio" button, I turned that required click into part of the instrument.
The page now starts with a simple cover. The first touch:

- unlocks the AudioContext
- creates the first real ripple
- reveals the canvas from the touch position
- fades in the ambient sound
- starts the automatic loop

The cover also dissolves along the ripple instead of using a normal fade.
This makes the first interaction feel like waking the sound space rather than starting an app.

Relevant commits:

[`de58924`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-Se-m1Ne/commit/de58924) — Add a minimal wake cover so the first touch opens the instrument

[`0ff2c77`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-Se-m1Ne/commit/0ff2c77) — Dissolve the opening title along the wake ripple's wavefront

## 6. Naming the piece DREAMWASH

The working title **Sound Canvas** described the function, but it felt too plain for the final direction.
I renamed the piece **DREAMWASH**.
The name better matches the dream-pop sound, the washed-out reverb and delay, the soft visual style, and the wave behaviour of the instrument.
The opening text also changed from **touch to wake** to **touch to resonate**, 
because "resonate" connects more directly to sound and fits the softer, more romantic tone.

Relevant commit:

[`5c77fab`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-Se-m1Ne/commit/5c77fab) — Rename the opening from Sound Canvas to DREAMWASH

## 7. Final correction by ear

After the main sound redesign, Bell was still too loud.
This was most obvious for high Bell notes near the top of the canvas. They were bright enough to feel sharp and slightly piercing.
I did not reduce the whole master volume because the other brushes already sat well in the mix.
Instead, I adjusted Bell only, lowering its level and softening the brightness of its higher notes.
The high notes still sound clearly higher, but they now sit inside the soundscape instead of jumping out of it.

Relevant commit:

[`d358228`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-Se-m1Ne/commit/d358228) — Soften the Bell brush's volume and high-pitch brightness

## Directing and correcting the agent

The agent was useful for building and changing the implementation, but it could not judge whether the instrument actually sounded good.
I gave more specific direction as problems appeared.
For example:

- the first version was redirected away from a normal sequencer
- the first sound palette was changed after it sounded too separate
- the cosmic version was changed again after it sounded too much like a game
- the final Bell sound was adjusted after its high notes felt too sharp

Automated checks were still useful for code quality and website requirements, but they could not judge:

- whether the loop felt too slow
- whether sounds belonged together
- whether a sound felt too sharp
- whether the result felt musical or game-like

Those decisions came from repeatedly playing and listening to the instrument.
The commit history records these corrections instead of making the final result look like it appeared in one step.

## Before you ship

`pnpm check:evidence` verifies your citations resolve to real commits, that
the current reflection entry is in `reflections/`, and that your `CLAUDE.md`
is there --- before a marker ever opens the file. The reflection for this
deliverable is deliberately not written yet: it gets drafted after the
instrument has actually been played and tested, not before.
