export const BLEND_MODES = Object.freeze([
  { id: "normal", name: "NORMAL" },
  { id: "add", name: "ADD LIGHT" },
  { id: "screen", name: "SCREEN" },
  { id: "multiply", name: "MULTIPLY" },
  { id: "difference", name: "DIFFERENCE" },
]);

const EFFECTS = new Set(["tide", "radar", "ember", "orbit"]);
const MODES = new Set(BLEND_MODES.map((mode) => mode.id));
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function blendChannel(base, top, mode) {
  if (mode === "add") return Math.min(255, base + top);
  if (mode === "screen") return 255 - ((255 - base) * (255 - top)) / 255;
  if (mode === "multiply") return (base * top) / 255;
  if (mode === "difference") return Math.abs(base - top);
  return top;
}

export function blendRgb(base, top, mode = "normal", opacity = 1) {
  const cleanMode = MODES.has(mode) ? mode : "normal";
  const mix = Math.max(0, Math.min(1, Number(opacity) || 0));
  return base.map((channel, index) => {
    const blended = blendChannel(channel, top[index], cleanMode);
    return clampByte(channel + (blended - channel) * mix);
  });
}

export function normalizeLayer(raw) {
  const opacity = Math.max(0, Math.min(100, Number(raw?.opacity) || 0));
  return {
    enabled: Boolean(raw?.enabled),
    effect: EFFECTS.has(raw?.effect) ? raw.effect : "tide",
    blend: MODES.has(raw?.blend) ? raw.blend : "normal",
    opacity,
    paletteId:
      typeof raw?.paletteId === "string" && SAFE_ID.test(raw.paletteId)
        ? raw.paletteId
        : "acid",
  };
}
