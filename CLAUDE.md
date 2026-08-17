# COMP4020 prototype

Your starter repo for a COMP4020 prototype: a static site in HTML/CSS/TypeScript
that builds to plain HTML/CSS/JS and deploys to GitHub Pages. The deployed site
is what gets marked, not this repo.

The
[course website](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/)
publishes this deliverable's brief and spec, and this repo's name tells you
which deliverable applies. Read both before you plan or build.

## How to work in here

- Keep the dev server running (`pnpm dev`) so you see changes as you make them.
- Run `pnpm check` before you push.
- Open the page in a browser and look at it. The rendered page is the truth;
  your mental model of it isn't.
- When a check fails, read its output before you change anything.
- Never commit a red state.

## The checks

`typecheck`, `build`, `deploy`, `spec`, `lint`, `tests`, `evidence`, `links`,
`secrets`. Run `pnpm check`. Read the failure.

`spec/README.md`, `PROCESS.md` and `reflections/README.md` are in this repo and
say what they are for.

## This file is yours

A starting point, not a rulebook. As you learn what your prototype needs --- a
convention the work has to hold to, a sensor that keeps catching you out, a fact
about the stack that is easy to get wrong --- write it down here. Growing this
file is the work.

## Facts about this stack that are easy to get wrong

- `tsconfig.json`'s `include` is `["*.ts", "spec"]` --- only **top-level**
  `*.ts` files are typechecked, not anything in a subdirectory. A file under
  `src/` silently gets zero type checking from `pnpm check`. Keep app modules
  flat at the repo root (`sketch.ts`, `audio.ts`, `scale.ts`, `types.ts`,
  `main.ts`) rather than nesting them.
- `stylelint-config-standard` enforces modern CSS notation, not just "valid
  CSS": `rgb(r g b / a%)` instead of `rgba(...)`, range syntax
  `(width <= 30rem)` instead of `(max-width: 30rem)`, and no deprecated `clip`
  property (use `clip-path: inset(...)`). Most of this is auto-fixable with
  `pnpm exec stylelint "**/*.css" --ignore-path .gitignore --fix`, but `clip`
  is not --- fix it by hand.
- `spec/starter.test.ts` is the worked example, not a fixture to keep passing
  forever --- `spec/README.md` says to replace it with tests for your actual
  page once the starter markup is gone. Its assertions (checking for the
  starter's specific heading text, etc.) will otherwise fail for reasons that
  have nothing to do with your instrument.
- There is no headless-browser tool preinstalled in this environment for
  visually verifying a canvas/Web-Audio app (no `chromium-cli`). A scratch npm
  project with `playwright` installed (`npm init -y && npm install playwright
  --no-save`, outside the repo) reuses the Chromium already cached at
  `$LOCALAPPDATA/ms-playwright` --- no download needed --- and is the fastest
  path to real screenshots. Don't write driver scripts inside the repo itself;
  they're scratch tooling, not part of the deliverable.
