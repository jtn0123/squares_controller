import type { Rgb } from "./types.js";

const FIT_MODES = new Set<string>(["cover", "contain", "stretch"]);
const SAMPLING_MODES = new Set<string>(["smooth", "pixel"]);

export type MediaFitMode = "cover" | "contain" | "stretch";
export type MediaSamplingMode = "smooth" | "pixel";

export interface MediaControls {
  fit: MediaFitMode;
  sampling: MediaSamplingMode;
  saturation: number;
  contrast: number;
  brightness: number;
  gamma: number;
}

export interface FitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Number(value)));
}

export function normalizeMediaControls(raw: unknown): MediaControls {
  const value = raw as Partial<MediaControls> | null | undefined;
  return {
    fit: value?.fit !== undefined && FIT_MODES.has(value.fit) ? value.fit : "cover",
    sampling:
      value?.sampling !== undefined && SAMPLING_MODES.has(value.sampling)
        ? value.sampling
        : "smooth",
    saturation: clamp(Number(value?.saturation) || 0, 0, 2),
    contrast: clamp(Number(value?.contrast) || 0, 0, 2),
    brightness: clamp(Number(value?.brightness) || 0, 0.1, 2),
    gamma: clamp(Number(value?.gamma) || 0, 0.2, 2),
  };
}

export function fitRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  mode: string,
): FitRect {
  if (mode === "stretch") {
    return { x: 0, y: 0, width: targetWidth, height: targetHeight };
  }
  const scale =
    mode === "contain"
      ? Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight)
      : Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
  };
}

export function adjustRgb(rgb: Rgb, rawControls: unknown): Rgb {
  const controls = normalizeMediaControls(rawControls);
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return rgb.map((channel) => {
    const saturated =
      luminance + (channel - luminance) * controls.saturation;
    const contrasted = 128 + (saturated - 128) * controls.contrast;
    const brightened = Math.max(0, Math.min(255, contrasted * controls.brightness));
    const corrected =
      255 * Math.pow(brightened / 255, 1 / controls.gamma);
    return Math.max(0, Math.min(255, Math.round(corrected)));
  });
}
