// Shared references to static, frequently used elements. Modules query
// their own feature-local elements; the hot-path and cross-feature nodes
// live here so they are resolved once.
export const $ = (selector) => document.querySelector(selector);
export const $$ = (selector) => document.querySelectorAll(selector);

export const canvas = $("#pixelCanvas");
export const context = canvas.getContext("2d", { alpha: false });
export const sceneMonitorCanvas = $("#sceneMonitorCanvas");
export const mediaCanvas = document.createElement("canvas");
export const mediaContext = mediaCanvas.getContext("2d", {
  alpha: false,
  willReadFrequently: true,
});
export const stage = $(".stage-frame");
export const colorPicker = $("#colorPicker");
export const colorValue = $("#colorValue");
export const brightnessSlider = $("#brightnessSlider");
export const brightnessValue = $("#brightnessValue");
export const effectSpeed = $("#effectSpeed");
export const effectIntensity = $("#effectIntensity");
export const toastElement = $("#toast");

export function updateRangeFill(input) {
  const minimum = Number(input.min);
  const maximum = Number(input.max);
  const percent = ((Number(input.value) - minimum) / (maximum - minimum)) * 100;
  input.style.setProperty("--fill", `${percent}%`);
}
