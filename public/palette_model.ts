import { hsvToRgb, rgbToHsv, saturateRgb } from "./color_utils.js";
import type { Palette, Rgb, SavedPalette } from "./types.js";

export const CURATED_PALETTES: readonly SavedPalette[] = Object.freeze([
  { id: "acid", name: "ACID SIGNAL", colors: ["#d9ff5b", "#57e6d5", "#4b83ff", "#ec5fff"] },
  { id: "ember", name: "EMBER ROOM", colors: ["#150707", "#7a190d", "#ff6b3d", "#ffcf54"] },
  { id: "ocean", name: "DEEP CURRENT", colors: ["#020818", "#073b5d", "#00a8a8", "#8affda"] },
  { id: "aurora", name: "POLAR AURORA", colors: ["#071a19", "#19d3ae", "#8c7cff", "#ff71ce"] },
  { id: "mono", name: "PHOSPHOR", colors: ["#020402", "#173c1e", "#63a84e", "#e5ff9b"] },
  { id: "sunset", name: "MAGIC HOUR", colors: ["#260d33", "#7f2f74", "#ed635d", "#ffd06a"] },
  { id: "ice", name: "GLACIAL", colors: ["#07111f", "#235789", "#70d6ff", "#f7fff7"] },
  { id: "candy", name: "CANDY STATIC", colors: ["#ff4fa3", "#ffca3a", "#5ce1e6", "#9b5de5"] },
  { id: "voltage", name: "HIGH VOLTAGE", colors: ["#0b0b0b", "#4a00e0", "#00f5d4", "#f9f871"] },
  { id: "warmwhite", name: "WARM FILAMENT", colors: ["#080604", "#4a2f18", "#c9833e", "#fff1c1"] },
]);

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function rgbFromHex(color: string): Rgb {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

export function normalizePalette(value: unknown): Palette {
  if (value && typeof value === "object") {
    const raw = value as Partial<Palette>;
    const colors = Array.isArray(raw.colors)
      ? raw.colors.filter((color) => typeof color === "string" && HEX_COLOR.test(color))
      : [];
    if (colors.length >= 2) {
      return {
        id: typeof raw.id === "string" ? raw.id : "custom",
        colors: colors.map((color) => color.toLowerCase()),
      };
    }
  }
  return CURATED_PALETTES[0];
}

export function normalizeSavedPalette(value: unknown): SavedPalette | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<SavedPalette>;
  if (
    typeof raw.id !== "string" ||
    !SAFE_ID.test(raw.id) ||
    !Array.isArray(raw.colors)
  ) {
    return null;
  }
  const name =
    typeof raw.name === "string"
      ? raw.name.trim().replace(/\s+/g, " ").slice(0, 48).toUpperCase()
      : "";
  const colors = raw.colors
    .filter((color) => typeof color === "string" && HEX_COLOR.test(color))
    .slice(0, 8)
    .map((color) => color.toLowerCase());
  if (!name || colors.length < 2) return null;
  return {
    id: raw.id,
    name,
    colors,
  };
}

// How hard palette colours are pushed away from their own luma. Chosen
// on the wall (see docs/PERFORMANCE.md). It lives here, not at the
// device boundary, so the browser previews show the colour the wall
// will show — and realtime output gets it too.
export const PALETTE_SATURATION = 2.2;

/** Shortest way round the hue circle, so a blend never detours through
 *  the opposite side of the wheel. */
function blendHue(from: number, to: number, amount: number): number {
  let delta = to - from;
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  return from + delta * amount;
}

export function sampleGradient(rawColors: unknown, rawPosition: number): Rgb {
  const { colors } = normalizePalette({ id: "sample", colors: rawColors });
  const position = ((Number(rawPosition) % 1) + 1) % 1;
  const scaled = position * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const blend = scaled - index;
  const first = rgbFromHex(colors[index]);
  const second = rgbFromHex(colors[index + 1]);

  // Straight RGB interpolation drags every midpoint toward grey: blend
  // acid green into cyan and the halfway colour is a washed pale green.
  // Interpolating hue, saturation, and value separately keeps the
  // transition as vivid as the two stops it runs between.
  const [firstHue, firstSaturation, firstValue] = rgbToHsv(first);
  const [secondHue, secondSaturation, secondValue] = rgbToHsv(second);
  // A grey stop has no meaningful hue, and black has no meaningful hue
  // OR saturation. Borrow the other stop's so a ramp out of black stays
  // a pure dark red rather than fading up through pink.
  const fromHue = firstSaturation === 0 ? secondHue : firstHue;
  const toHue = secondSaturation === 0 ? firstHue : secondHue;
  const fromSaturation = firstValue === 0 ? secondSaturation : firstSaturation;
  const toSaturation = secondValue === 0 ? firstSaturation : secondSaturation;
  const mixed = hsvToRgb(
    blendHue(fromHue, toHue, blend),
    fromSaturation + (toSaturation - fromSaturation) * blend,
    firstValue + (secondValue - firstValue) * blend,
  );
  return saturateRgb(mixed, PALETTE_SATURATION);
}
