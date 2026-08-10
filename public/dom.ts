// Shared references to static, frequently used elements. Modules query
// their own feature-local elements; the hot-path and cross-feature nodes
// live here so they are resolved once.
//
// $ asserts the element exists (and its type when narrowed): the markup is
// bundled with the code, so a missing element is a build defect, not a
// runtime condition to branch on.
export const $ = <T extends Element = HTMLElement>(selector: string): T =>
  document.querySelector(selector) as T;
export const $$ = <T extends Element = HTMLElement>(
  selector: string,
): NodeListOf<T> => document.querySelectorAll<T>(selector);

export const canvas = $<HTMLCanvasElement>("#pixelCanvas");
export const context = canvas.getContext("2d", { alpha: false })!;
export const sceneMonitorCanvas = $<HTMLCanvasElement>("#sceneMonitorCanvas");
export const mediaCanvas = document.createElement("canvas");
export const mediaContext = mediaCanvas.getContext("2d", {
  alpha: false,
  willReadFrequently: true,
})!;
export const stage = $(".stage-frame");
export const colorPicker = $<HTMLInputElement>("#colorPicker");
export const colorValue = $("#colorValue");
export const brightnessSlider = $<HTMLInputElement>("#brightnessSlider");
export const brightnessValue = $("#brightnessValue");
export const effectSpeed = $<HTMLInputElement>("#effectSpeed");
export const effectIntensity = $<HTMLInputElement>("#effectIntensity");
export const toastElement = $("#toast");

export function updateRangeFill(input: HTMLInputElement): void {
  const minimum = Number(input.min);
  const maximum = Number(input.max);
  const percent = ((Number(input.value) - minimum) / (maximum - minimum)) * 100;
  input.style.setProperty("--fill", `${percent}%`);
}
