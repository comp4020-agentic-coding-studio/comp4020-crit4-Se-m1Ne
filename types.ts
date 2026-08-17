// Shared shapes for the sound canvas. Kept flat at repo root (not in a
// subdirectory) because tsconfig.json only typechecks top-level *.ts files.

export type BrushType = "glow" | "spark" | "ink" | "grain";

export interface SoundMark {
  id: number;
  /** Normalized position in [0,1], relative to the current canvas size. */
  nx: number;
  ny: number;
  brush: BrushType;
  /** A stable per-mark random value, used for deterministic grain texture. */
  seed: number;
  /** performance.now() timestamp the trigger glow should fade out by; 0 = idle. */
  pulseUntil: number;
}

export interface Ripple {
  id: number;
  originPxX: number;
  originPxY: number;
  startTime: number;
  kind: "loop" | "single";
  /** Mark ids this ripple has already triggered, so each mark fires once per ripple. */
  triggered: Set<number>;
  prevRadius: number;
  radius: number;
}

export type Mode = { kind: "play" } | { kind: "brush"; brush: BrushType };
