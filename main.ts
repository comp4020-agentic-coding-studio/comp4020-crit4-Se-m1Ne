import { SoundCanvas } from "./sketch";

const canvas = document.querySelector<HTMLCanvasElement>("#sound-canvas");
const tempoSlider = document.querySelector<HTMLInputElement>("#tempo-slider");
const pauseButton = document.querySelector<HTMLButtonElement>("#pause-btn");
const clearControl = document.querySelector<HTMLElement>("#clear-control");
const paletteButtons = document.querySelectorAll<HTMLButtonElement>(".brush-btn");
const wakeCover = document.querySelector<HTMLElement>("#wake-cover");

if (canvas && tempoSlider && pauseButton && clearControl && paletteButtons.length > 0 && wakeCover) {
  new SoundCanvas(canvas, paletteButtons, tempoSlider, pauseButton, clearControl, wakeCover);
}
