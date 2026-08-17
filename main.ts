import { SoundCanvas } from "./sketch";

const canvas = document.querySelector<HTMLCanvasElement>("#sound-canvas");
const tempoSlider = document.querySelector<HTMLInputElement>("#tempo-slider");
const paletteButtons = document.querySelectorAll<HTMLButtonElement>(".brush-btn");

if (canvas && tempoSlider && paletteButtons.length > 0) {
  new SoundCanvas(canvas, paletteButtons, tempoSlider);
}
