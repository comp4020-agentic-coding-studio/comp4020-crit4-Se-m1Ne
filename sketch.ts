// The Sound Canvas engine: paint sound marks, watch ripples cross them.
// One central ripple loops forever (the sequencer); every tap or click sends
// out an independent one-shot ripple (the live-performance layer). Both are
// driven by the same distance-from-origin -> time mapping.
import { AudioEngine } from "./audio";
import { percussionZone, quantizeToScale } from "./scale";
import type { BrushType, Mode, Ripple, SoundMark } from "./types";

const GLOW_RANGE: [number, number] = [60, 84]; // C4..C6
const SPARK_RANGE: [number, number] = [72, 96]; // C5..C7
const INK_RANGE: [number, number] = [36, 55]; // C2..G3

const STROKE_MIN_SPACING = 18; // px between marks placed while dragging a brush
const DRAG_THRESHOLD = 6; // px of movement before a pointerdown-on-a-mark becomes a drag
const HIT_RADIUS = 24; // px, for picking up / selecting an existing mark
const PULSE_MS = 260;

const BRUSH_COLOR: Record<BrushType, string> = {
  glow: "140, 220, 210",
  spark: "255, 214, 120",
  ink: "170, 120, 230",
  grain: "255, 150, 110",
};

// Static concentric guides behind everything else, centred on the loop
// origin, so distance-from-centre (the loop's own timing) is legible before
// anything moves. Kept dimmer than any ripple or mark, but bright enough
// (RING_ALPHA_*) to actually be noticed rather than needing to be sought out.
const RING_COUNT = 10;
const RING_INNER_COLOR: [number, number, number] = [60, 72, 105];
const RING_OUTER_COLOR: [number, number, number] = [130, 145, 190];
const RING_ALPHA_INNER = 0.07;
const RING_ALPHA_OUTER = 0.17;

// A frame delta larger than this (tab backgrounded, debugger pause) is
// clamped so a single stalled frame can't fling a ripple across the canvas.
const MAX_FRAME_DT = 0.25;

// Clear Canvas gets its own brief outward flash (distinct from the per-mark
// erase flash) so wiping the whole composition reads as a bigger event than
// removing one mark.
const CLEAR_FLASH_MS = 420;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

let nextId = 1;

interface DragState {
  markId: number;
  pointerId: number;
  startX: number;
  startY: number;
  movedPast: boolean;
}

interface EraseFlash {
  x: number;
  y: number;
  until: number;
}

export class SoundCanvas {
  private ctx2d: CanvasRenderingContext2D;
  private audio = new AudioEngine();

  private marks: SoundMark[] = [];
  private loopRipple: Ripple;
  private singleRipples: Ripple[] = [];

  private mode: Mode = { kind: "play" };
  private selectedMarkId: number | null = null;

  private lastPointerNx = 0.5;
  private lastPointerNy = 0.5;
  private tempoSeconds = 9;

  private width = 0;
  private height = 0;

  private dragging: DragState | null = null;
  private strokePointerId: number | null = null;
  private strokeLast: { nx: number; ny: number } | null = null;

  private eraseFlashes: EraseFlash[] = [];
  private clearFlashUntil = 0;

  private paused = false;
  private lastTickTime = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private paletteButtons: NodeListOf<HTMLButtonElement>,
    private tempoSlider: HTMLInputElement,
    private pauseButton: HTMLButtonElement,
    private clearControl: HTMLElement,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx2d = ctx;

    this.resize();
    window.addEventListener("resize", () => this.resize());

    this.loopRipple = this.makeRipple(this.width / 2, this.height / 2, "loop");
    this.seedStarterMarks();

    this.bindPointer();
    this.bindKeyboard();
    this.bindPalette();
    this.bindTempo();
    this.bindPause();
    this.bindClear();

    requestAnimationFrame((t) => this.tick(t));
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.loopRipple) {
      this.loopRipple.originPxX = this.width / 2;
      this.loopRipple.originPxY = this.height / 2;
    }
  }

  private seedStarterMarks(): void {
    // A handful of pre-placed marks close to the centre, so the very first
    // click's ripple - and the looping ripple - produce sound immediately.
    this.marks.push(
      this.makeMark(0.56, 0.42, "glow"),
      this.makeMark(0.44, 0.47, "spark"),
      this.makeMark(0.5, 0.62, "grain"),
    );
  }

  // --- geometry -----------------------------------------------------------

  private toPixel(nx: number, ny: number): { x: number; y: number } {
    return { x: nx * this.width, y: ny * this.height };
  }

  private canvasPoint(e: PointerEvent): { x: number; y: number; nx: number; ny: number } {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return { x, y, nx: clamp01(x / rect.width), ny: clamp01(y / rect.height) };
  }

  private maxRadiusFromCenter(): number {
    return Math.hypot(this.width / 2, this.height / 2);
  }

  private maxRadiusFromPoint(px: number, py: number): number {
    const corners: [number, number][] = [
      [0, 0],
      [this.width, 0],
      [0, this.height],
      [this.width, this.height],
    ];
    return Math.max(...corners.map(([cx, cy]) => Math.hypot(cx - px, cy - py)));
  }

  private loopSpeedPxPerSec(): number {
    return this.maxRadiusFromCenter() / this.tempoSeconds;
  }

  private findMarkNear(px: number, py: number): SoundMark | undefined {
    let best: SoundMark | undefined;
    let bestDist = HIT_RADIUS;
    for (const mark of this.marks) {
      const p = this.toPixel(mark.nx, mark.ny);
      const d = Math.hypot(p.x - px, p.y - py);
      if (d <= bestDist) {
        bestDist = d;
        best = mark;
      }
    }
    return best;
  }

  // --- factories ------------------------------------------------------------

  private makeMark(nx: number, ny: number, brush: BrushType): SoundMark {
    return { id: nextId++, nx, ny, brush, seed: Math.random(), pulseUntil: 0 };
  }

  private makeRipple(x: number, y: number, kind: "loop" | "single"): Ripple {
    return {
      id: nextId++,
      originPxX: x,
      originPxY: y,
      kind,
      triggered: new Set(),
      prevRadius: -1,
      radius: 0,
    };
  }

  private spawnSingleRipple(x: number, y: number): void {
    this.singleRipples.push(this.makeRipple(x, y, "single"));
  }

  // --- input ----------------------------------------------------------------

  private bindPointer(): void {
    this.canvas.style.touchAction = "none";
    this.canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    this.canvas.addEventListener("pointermove", (e) => this.onPointerMove(e));
    this.canvas.addEventListener("pointerup", (e) => this.onPointerEnd(e));
    this.canvas.addEventListener("pointercancel", (e) => this.onPointerEnd(e));
  }

  private onPointerDown(e: PointerEvent): void {
    this.audio.unlock();
    const { x, y, nx, ny } = this.canvasPoint(e);
    this.lastPointerNx = nx;
    this.lastPointerNy = ny;

    if (this.mode.kind === "brush") {
      this.strokePointerId = e.pointerId;
      this.strokeLast = { nx, ny };
      this.canvas.setPointerCapture(e.pointerId);
      this.marks.push(this.makeMark(nx, ny, this.mode.brush));
      return;
    }

    if (this.mode.kind === "erase") {
      this.strokePointerId = e.pointerId;
      this.canvas.setPointerCapture(e.pointerId);
      this.eraseNear(x, y);
      return;
    }

    const hit = this.findMarkNear(x, y);
    if (hit) {
      this.selectedMarkId = hit.id;
      this.dragging = { markId: hit.id, pointerId: e.pointerId, startX: x, startY: y, movedPast: false };
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }

    this.selectedMarkId = null;
    this.spawnSingleRipple(x, y);
  }

  private onPointerMove(e: PointerEvent): void {
    const { x, y, nx, ny } = this.canvasPoint(e);
    this.lastPointerNx = nx;
    this.lastPointerNy = ny;

    if (this.mode.kind === "brush" && this.strokePointerId === e.pointerId && this.strokeLast) {
      const last = this.toPixel(this.strokeLast.nx, this.strokeLast.ny);
      if (Math.hypot(x - last.x, y - last.y) >= STROKE_MIN_SPACING) {
        this.marks.push(this.makeMark(nx, ny, this.mode.brush));
        this.strokeLast = { nx, ny };
      }
      return;
    }

    if (this.mode.kind === "erase" && this.strokePointerId === e.pointerId) {
      this.eraseNear(x, y);
      return;
    }

    if (this.dragging && this.dragging.pointerId === e.pointerId) {
      const moved = Math.hypot(x - this.dragging.startX, y - this.dragging.startY);
      if (moved > DRAG_THRESHOLD) this.dragging.movedPast = true;
      if (this.dragging.movedPast) {
        const mark = this.marks.find((m) => m.id === this.dragging?.markId);
        if (mark) {
          mark.nx = nx;
          mark.ny = ny;
        }
      }
    }
  }

  private onPointerEnd(e: PointerEvent): void {
    if (this.strokePointerId === e.pointerId) {
      this.strokePointerId = null;
      this.strokeLast = null;
    }
    if (this.dragging && this.dragging.pointerId === e.pointerId) {
      this.dragging = null;
    }
  }

  private bindKeyboard(): void {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      switch (e.key) {
        case " ": {
          e.preventDefault();
          this.audio.unlock();
          const p = this.toPixel(this.lastPointerNx, this.lastPointerNy);
          this.spawnSingleRipple(p.x, p.y);
          break;
        }
        case "1":
          this.setMode({ kind: "brush", brush: "glow" });
          break;
        case "2":
          this.setMode({ kind: "brush", brush: "spark" });
          break;
        case "3":
          this.setMode({ kind: "brush", brush: "ink" });
          break;
        case "4":
          this.setMode({ kind: "brush", brush: "grain" });
          break;
        case "5":
          this.setMode({ kind: "erase" });
          break;
        case "Delete":
        case "Backspace":
          if (this.selectedMarkId !== null) {
            this.marks = this.marks.filter((m) => m.id !== this.selectedMarkId);
            this.selectedMarkId = null;
          }
          break;
        case "Escape":
          this.setMode({ kind: "play" });
          break;
        default:
          break;
      }
    });
  }

  private bindPalette(): void {
    for (const btn of this.paletteButtons) {
      btn.addEventListener("click", () => {
        if (btn.dataset.tool === "eraser") {
          this.setMode(this.mode.kind === "erase" ? { kind: "play" } : { kind: "erase" });
          return;
        }
        const brush = btn.dataset.brush as BrushType | undefined;
        if (!brush) return;
        if (this.mode.kind === "brush" && this.mode.brush === brush) {
          this.setMode({ kind: "play" });
        } else {
          this.setMode({ kind: "brush", brush });
        }
      });
    }
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    for (const btn of this.paletteButtons) {
      const active =
        btn.dataset.tool === "eraser"
          ? mode.kind === "erase"
          : mode.kind === "brush" && btn.dataset.brush === mode.brush;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    }
    this.canvas.classList.toggle("brush-mode", mode.kind === "brush" || mode.kind === "erase");
    this.selectedMarkId = null;
  }

  private bindTempo(): void {
    const apply = () => {
      const t = Number(this.tempoSlider.value) / 100;
      // 16s (slow) down to 3s (fast) for one lap of the loop ripple.
      this.tempoSeconds = 16 - t * 13;
    };
    apply();
    this.tempoSlider.addEventListener("input", apply);
  }

  private bindPause(): void {
    this.pauseButton.addEventListener("click", () => {
      this.paused = !this.paused;
      this.pauseButton.classList.toggle("paused", this.paused);
      this.pauseButton.setAttribute("aria-pressed", String(this.paused));
      this.pauseButton.setAttribute(
        "aria-label",
        this.paused ? "Resume automatic loop" : "Pause automatic loop",
      );
    });
  }

  // A momentary action, not a mode: requires an explicit second confirmation
  // click before anything is deleted, auto-reverts if left alone, and backs
  // out on a click anywhere outside the control.
  private bindClear(): void {
    const btn = this.clearControl.querySelector<HTMLButtonElement>(".clear-btn");
    const confirm = this.clearControl.querySelector<HTMLElement>(".clear-confirm");
    const confirmBtn = this.clearControl.querySelector<HTMLButtonElement>(".clear-confirm-action.confirm");
    const cancelBtn = this.clearControl.querySelector<HTMLButtonElement>(".clear-confirm-action.cancel");
    if (!btn || !confirm || !confirmBtn || !cancelBtn) return;

    let revertTimer: ReturnType<typeof setTimeout> | undefined;

    const showButton = () => {
      if (revertTimer !== undefined) {
        clearTimeout(revertTimer);
        revertTimer = undefined;
      }
      confirm.hidden = true;
      btn.hidden = false;
    };

    const showConfirm = () => {
      btn.hidden = true;
      confirm.hidden = false;
      revertTimer = setTimeout(showButton, 5000);
    };

    btn.addEventListener("click", showConfirm);
    cancelBtn.addEventListener("click", showButton);
    confirmBtn.addEventListener("click", () => {
      showButton();
      this.clearCanvas();
    });

    document.addEventListener("pointerdown", (e) => {
      if (!confirm.hidden && !this.clearControl.contains(e.target as Node)) {
        showButton();
      }
    });
  }

  private clearCanvas(): void {
    this.marks = [];
    this.selectedMarkId = null;
    this.loopRipple.triggered.clear();
    for (const ripple of this.singleRipples) ripple.triggered.clear();
    this.clearFlashUntil = performance.now() + CLEAR_FLASH_MS;
  }

  // --- simulation -------------------------------------------------------------

  private trigger(mark: SoundMark, now: number): void {
    mark.pulseUntil = now + PULSE_MS;
    switch (mark.brush) {
      case "glow":
        this.audio.playGlow(quantizeToScale(1 - mark.ny, GLOW_RANGE[0], GLOW_RANGE[1]));
        break;
      case "spark":
        this.audio.playSpark(quantizeToScale(1 - mark.ny, SPARK_RANGE[0], SPARK_RANGE[1]));
        break;
      case "ink":
        this.audio.playInk(quantizeToScale(1 - mark.ny, INK_RANGE[0], INK_RANGE[1]));
        break;
      case "grain":
        this.audio.playGrain(percussionZone(mark.ny));
        break;
      default:
        break;
    }
  }

  private eraseNear(px: number, py: number): void {
    const hit = this.findMarkNear(px, py);
    if (!hit) return;
    const p = this.toPixel(hit.nx, hit.ny);
    this.marks = this.marks.filter((m) => m.id !== hit.id);
    if (this.selectedMarkId === hit.id) this.selectedMarkId = null;
    // Belt-and-braces: a removed mark can't be found by checkCollisions once
    // it's out of `marks`, but drop any stale trigger record too.
    this.loopRipple.triggered.delete(hit.id);
    for (const ripple of this.singleRipples) ripple.triggered.delete(hit.id);
    this.eraseFlashes.push({ x: p.x, y: p.y, until: performance.now() + PULSE_MS });
  }

  private checkCollisions(ripple: Ripple, from: number, to: number, now: number): void {
    if (to <= from) return;
    for (const mark of this.marks) {
      if (ripple.triggered.has(mark.id)) continue;
      const p = this.toPixel(mark.nx, mark.ny);
      const dist = Math.hypot(p.x - ripple.originPxX, p.y - ripple.originPxY);
      if (dist > from && dist <= to) {
        ripple.triggered.add(mark.id);
        this.trigger(mark, now);
      }
    }
  }

  // Radius grows by `dt * speed` each frame, rather than from an absolute
  // elapsed-since-start calculation, so a tempo change takes effect from the
  // ripple's current position instead of snapping the radius to wherever the
  // new speed "would have" put it since the loop started. This is also what
  // makes pause a matter of skipping the growth step for one ripple only.
  private updateLoopRipple(dt: number, now: number): void {
    if (this.paused) return;
    const speed = this.loopSpeedPxPerSec();
    const maxRadius = this.maxRadiusFromCenter();
    const radius = this.loopRipple.radius + dt * speed;

    if (radius > maxRadius) {
      this.checkCollisions(this.loopRipple, this.loopRipple.prevRadius, maxRadius, now);
      this.loopRipple.originPxX = this.width / 2;
      this.loopRipple.originPxY = this.height / 2;
      this.loopRipple.triggered.clear();
      this.loopRipple.prevRadius = -1;
      this.loopRipple.radius = 0;
      return;
    }

    this.checkCollisions(this.loopRipple, this.loopRipple.prevRadius, radius, now);
    this.loopRipple.prevRadius = radius;
    this.loopRipple.radius = radius;
  }

  private updateSingleRipple(ripple: Ripple, dt: number, now: number): boolean {
    const speed = this.loopSpeedPxPerSec();
    const maxRadius = this.maxRadiusFromPoint(ripple.originPxX, ripple.originPxY);
    const radius = Math.min(ripple.radius + dt * speed, maxRadius);
    this.checkCollisions(ripple, ripple.prevRadius, radius, now);
    ripple.prevRadius = radius;
    ripple.radius = radius;
    return radius < maxRadius;
  }

  private tick(now: number): void {
    const dt = this.lastTickTime === 0 ? 0 : Math.min(MAX_FRAME_DT, Math.max(0, (now - this.lastTickTime) / 1000));
    this.lastTickTime = now;

    // Single ripples keep running even while the automatic loop is paused --
    // pause silences the composition, not the instrument.
    this.updateLoopRipple(dt, now);
    this.singleRipples = this.singleRipples.filter((r) => this.updateSingleRipple(r, dt, now));
    this.eraseFlashes = this.eraseFlashes.filter((f) => f.until > now);

    this.render(now);
    requestAnimationFrame((t) => this.tick(t));
  }

  // --- rendering -----------------------------------------------------------

  private render(now: number): void {
    const ctx = this.ctx2d;
    const { width, height } = this;

    const bg = ctx.createRadialGradient(
      width / 2,
      height / 2,
      0,
      width / 2,
      height / 2,
      Math.max(width, height) * 0.8,
    );
    bg.addColorStop(0, "#0e0e1e");
    bg.addColorStop(1, "#050508");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    this.drawBackgroundRings();
    this.drawCenter();
    this.drawRipple(this.loopRipple, this.maxRadiusFromCenter());
    for (const r of this.singleRipples) {
      this.drawRipple(r, this.maxRadiusFromPoint(r.originPxX, r.originPxY));
    }
    for (const mark of this.marks) {
      this.drawMark(mark, now);
    }
    for (const flash of this.eraseFlashes) {
      this.drawEraseFlash(flash, now);
    }
    this.drawClearFlash(now);
  }

  // Stationary rings sharing the loop's own centre and reach, so the loop's
  // radial timing has a always-visible reference even before a ripple has
  // passed through. Kept far dimmer than a mark or ripple - this is a guide,
  // not a target.
  private drawBackgroundRings(): void {
    const ctx = this.ctx2d;
    const cx = this.width / 2;
    const cy = this.height / 2;
    const maxRadius = this.maxRadiusFromCenter();

    ctx.save();
    for (let i = 1; i <= RING_COUNT; i++) {
      const t = i / RING_COUNT;
      const radius = maxRadius * t;
      const [r0, g0, b0] = RING_INNER_COLOR;
      const [r1, g1, b1] = RING_OUTER_COLOR;
      const r = Math.round(r0 + (r1 - r0) * t);
      const g = Math.round(g0 + (g1 - g0) * t);
      const b = Math.round(b0 + (b1 - b0) * t);
      const alpha = RING_ALPHA_INNER + (RING_ALPHA_OUTER - RING_ALPHA_INNER) * t;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawClearFlash(now: number): void {
    const remaining = this.clearFlashUntil - now;
    if (remaining <= 0) return;
    const t = Math.min(1, Math.max(0, 1 - remaining / CLEAR_FLASH_MS));
    const ctx = this.ctx2d;
    const radius = this.maxRadiusFromCenter() * t;
    const alpha = (1 - t) * 0.3;
    if (alpha <= 0.01) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(this.width / 2, this.height / 2, radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  private drawEraseFlash(flash: EraseFlash, now: number): void {
    // Clamped to 1: the flash's deadline is set with performance.now() at
    // erase time, but this is read against the rAF timestamp, which can lag
    // slightly behind on the very next frame -- an unclamped t briefly pushes
    // the radius negative and throws, freezing the render loop for good.
    const t = Math.min(1, (flash.until - now) / PULSE_MS);
    if (t <= 0) return;
    const ctx = this.ctx2d;
    const r = 6 + (1 - t) * 20;
    ctx.save();
    ctx.beginPath();
    ctx.arc(flash.x, flash.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 255, 255, ${(t * 0.45).toFixed(3)})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  private drawCenter(): void {
    const ctx = this.ctx2d;
    ctx.save();
    ctx.beginPath();
    ctx.arc(this.width / 2, this.height / 2, 4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fill();
    ctx.restore();
  }

  private drawRipple(ripple: Ripple, maxRadius: number): void {
    if (ripple.radius <= 0) return;
    const ctx = this.ctx2d;
    const t = Math.min(1, ripple.radius / maxRadius);
    const alpha = (1 - t) * (ripple.kind === "loop" ? 0.55 : 0.7);
    if (alpha <= 0.01) return;
    const color = ripple.kind === "loop" ? "120, 190, 255" : "255, 176, 110";
    ctx.save();
    ctx.beginPath();
    ctx.arc(ripple.originPxX, ripple.originPxY, ripple.radius, 0, Math.PI * 2);
    ctx.lineWidth = ripple.kind === "loop" ? 2 : 1.6;
    ctx.strokeStyle = `rgba(${color}, ${alpha.toFixed(3)})`;
    ctx.shadowColor = `rgba(${color}, ${(alpha * 0.6).toFixed(3)})`;
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.restore();
  }

  private drawMark(mark: SoundMark, now: number): void {
    const ctx = this.ctx2d;
    const { x, y } = this.toPixel(mark.nx, mark.ny);
    const pulse = mark.pulseUntil > now ? (mark.pulseUntil - now) / PULSE_MS : 0;
    const selected = mark.id === this.selectedMarkId;
    const color = BRUSH_COLOR[mark.brush];

    ctx.save();
    if (selected) {
      ctx.beginPath();
      ctx.arc(x, y, 18 + pulse * 4, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    switch (mark.brush) {
      case "glow": {
        const r = 10 + pulse * 10;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, `rgba(${color}, ${0.9})`);
        grad.addColorStop(1, `rgba(${color}, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "spark": {
        const r = 5 + pulse * 7;
        ctx.shadowColor = `rgba(${color}, 0.9)`;
        ctx.shadowBlur = 8 + pulse * 10;
        ctx.fillStyle = `rgba(${color}, ${0.95})`;
        ctx.beginPath();
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r * 0.35, y - r * 0.35);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x + r * 0.35, y + r * 0.35);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r * 0.35, y + r * 0.35);
        ctx.lineTo(x - r, y);
        ctx.lineTo(x - r * 0.35, y - r * 0.35);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "ink": {
        const r = 11 + pulse * 5;
        ctx.fillStyle = `rgba(${color}, ${0.75 + pulse * 0.2})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(${color}, 0.9)`;
        ctx.lineWidth = 2;
        ctx.stroke();
        break;
      }
      case "grain": {
        const specks = 5;
        for (let i = 0; i < specks; i++) {
          const a = mark.seed * Math.PI * 2 + (i / specks) * Math.PI * 2;
          const dist = 4 + ((mark.seed * (i + 1) * 37) % 6);
          const sx = x + Math.cos(a) * dist;
          const sy = y + Math.sin(a) * dist;
          const r = 1.5 + pulse * 2;
          ctx.fillStyle = `rgba(${color}, ${0.85})`;
          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      default:
        break;
    }
    ctx.restore();
  }
}
