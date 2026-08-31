import type { Rgb } from "./types.js";

export function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function hexToRgb(hex: string): Rgb {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

/** [hue 0-1, saturation 0-1, value 0-1]; hue is 0 for greys. */
export function rgbToHsv(rgb: Rgb): [number, number, number] {
  const [red, green, blue] = rgb.map((channel) => channel / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const span = max - min;
  let hue = 0;
  if (span > 0) {
    if (max === red) hue = ((green - blue) / span + 6) % 6;
    else if (max === green) hue = (blue - red) / span + 2;
    else hue = (red - green) / span + 4;
    hue /= 6;
  }
  return [hue, max === 0 ? 0 : span / max, max];
}

export function hsvToRgb(
  hue: number,
  saturation: number,
  value: number,
): Rgb {
  const sector = (((hue % 1) + 1) % 1) * 6;
  const offset = sector - Math.floor(sector);
  const dim = value * (1 - saturation);
  const falling = value * (1 - saturation * offset);
  const rising = value * (1 - saturation * (1 - offset));
  const table: Rgb[] = [
    [value, rising, dim],
    [falling, value, dim],
    [dim, value, rising],
    [dim, falling, value],
    [rising, dim, value],
    [value, dim, falling],
  ];
  return table[Math.floor(sector) % 6].map((channel) =>
    clampByte(channel * 255),
  );
}

/**
 * Push a colour away from its own luma. 1 leaves it untouched.
 *
 * This is the browser-side half of the colour treatment: effects are
 * saturated where they are generated, so the previews, realtime output,
 * and baked movies all agree. The device boundary only adds gamma.
 */
export function saturateRgb(rgb: Rgb, amount: number): Rgb {
  if (amount === 1) return rgb;
  const luma = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  return rgb.map((channel) => clampByte(luma + (channel - luma) * amount));
}
