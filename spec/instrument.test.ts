import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { midiToFreq, percussionZone, quantizeToScale } from "../scale";

// Mechanically-checkable slices of this week's spec: the page must offer a
// full-canvas ripple surface, a small set of visually distinct sound
// brushes, and a single tempo control — with no onboarding chrome, no score,
// and no "how to use this" screen. Judgement calls (does it feel musical,
// is it fun to play) are for the crit, not this file.

describe("sound canvas page", () => {
  const distPath = resolve("dist/index.html");
  const doc = existsSync(distPath)
    ? new JSDOM(readFileSync(distPath, "utf8")).window.document
    : undefined;

  it("built", () => {
    expect(doc, "run `pnpm build` first").toBeTruthy();
  });

  it("has one full-canvas playing surface", () => {
    expect(doc?.querySelectorAll("canvas").length).toBe(1);
  });

  it("offers exactly four visually distinct sound brushes", () => {
    const buttons = doc?.querySelectorAll<HTMLButtonElement>("[data-brush]") ?? [];
    const brushes = new Set(Array.from(buttons).map((b) => b.dataset.brush));
    expect(brushes).toEqual(new Set(["glow", "spark", "ink", "grain"]));
    // Each brush must carry its own class, so a look at styles.css shows a
    // distinct visual per brush rather than one shared "instrument" look.
    for (const btn of buttons) {
      expect(btn.className).toMatch(new RegExp(`brush-${btn.dataset.brush}\\b`));
    }
  });

  it("has a single global tempo control, not a music-settings panel", () => {
    const sliders = doc?.querySelectorAll('input[type="range"]') ?? [];
    expect(sliders.length).toBe(1);
  });

  it("has no start button, tutorial, or onboarding modal", () => {
    const text = doc?.body.textContent?.toLowerCase() ?? "";
    expect(text).not.toMatch(/how to (use|play)/);
    expect(text).not.toMatch(/tutorial/);
    expect(text).not.toMatch(/get started/);
    const buttons = Array.from(doc?.querySelectorAll("button") ?? []);
    expect(buttons.some((b) => /^start$/i.test(b.textContent?.trim() ?? ""))).toBe(false);
  });

  it("has no score, objective, or win/fail state in the markup", () => {
    const text = doc?.body.textContent?.toLowerCase() ?? "";
    expect(text).not.toMatch(/\bscore\b/);
    expect(text).not.toMatch(/\bwrong note\b/);
    expect(text).not.toMatch(/\bgame over\b/);
  });
});

describe("pitch quantization", () => {
  it("always lands on a note within the requested range", () => {
    for (let i = 0; i <= 20; i++) {
      const midi = quantizeToScale(i / 20, 60, 84);
      expect(midi).toBeGreaterThanOrEqual(60);
      expect(midi).toBeLessThanOrEqual(84);
    }
  });

  it("is monotonic: higher input never yields a lower note", () => {
    let prev = -Infinity;
    for (let i = 0; i <= 40; i++) {
      const midi = quantizeToScale(i / 40, 36, 84);
      expect(midi).toBeGreaterThanOrEqual(prev);
      prev = midi;
    }
  });

  it("converts A4 (midi 69) to 440Hz", () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 5);
  });
});

describe("percussion zones", () => {
  it("splits the canvas into three vertical character bands", () => {
    expect(percussionZone(0)).toBe("hi");
    expect(percussionZone(0.5)).toBe("mid");
    expect(percussionZone(0.99)).toBe("low");
  });
});
