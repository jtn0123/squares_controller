import { EFFECT_CATALOG } from "./effect_catalog.js";
import type { BlendLayer, BlendMode, Rgb } from "./types.js";

export interface BlendModeOption {
  id: BlendMode;
  name: string;
}

export const BLEND_MODES: readonly BlendModeOption[] = Object.freeze([
  { id: "normal", name: "NORMAL" },
  { id: "add", name: "ADD LIGHT" },
  { id: "screen", name: "SCREEN" },
  { id: "multiply", name: "MULTIPLY" },
  { id: "difference", name: "DIFFERENCE" },
]);

const EFFECTS = new Set<string>(EFFECT_CATALOG.map((effect) => effect.id));
const MODES = new Set<string>(BLEND_MODES.map((mode) => mode.id));
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function blendChannel(base: number, top: number, mode: BlendMode): number {
  if (mode === "add") return Math.min(255, base + top);
  if (mode === "screen") return 255 - ((255 - base) * (255 - top)) / 255;
  if (mode === "multiply") return (base * top) / 255;
  if (mode === "difference") return Math.abs(base - top);
  return top;
}

export function blendRgb(
  base: Rgb,
  top: Rgb,
  mode: string = "normal",
  opacity: number = 1,
): Rgb {
  // Membership in MODES guarantees the string is a BlendMode.
  const cleanMode = (MODES.has(mode) ? mode : "normal") as BlendMode;
  const mix = Math.max(0, Math.min(1, Number(opacity) || 0));
  return base.map((channel, index) => {
    const blended = blendChannel(channel, top[index], cleanMode);
    return clampByte(channel + (blended - channel) * mix);
  });
}

export function normalizeLayer(raw: unknown): BlendLayer {
  const value = raw as Partial<BlendLayer> | null | undefined;
  const opacity = Math.max(0, Math.min(100, Number(value?.opacity) || 0));
  return {
    enabled: Boolean(value?.enabled),
    effect: value?.effect !== undefined && EFFECTS.has(value.effect) ? value.effect : "tide",
    blend: value?.blend !== undefined && MODES.has(value.blend) ? value.blend : "normal",
    opacity,
    paletteId:
      typeof value?.paletteId === "string" && SAFE_ID.test(value.paletteId)
        ? value.paletteId
        : "acid",
  };
}
