export const CURATED_PALETTES = Object.freeze([
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

function rgbFromHex(color) {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

export function normalizePalette(value) {
  if (value && typeof value === "object") {
    const colors = Array.isArray(value.colors)
      ? value.colors.filter((color) => typeof color === "string" && HEX_COLOR.test(color))
      : [];
    if (colors.length >= 2) {
      return {
        id: typeof value.id === "string" ? value.id : "custom",
        colors: colors.map((color) => color.toLowerCase()),
      };
    }
  }
  return CURATED_PALETTES[0];
}

export function sampleGradient(rawColors, rawPosition) {
  const { colors } = normalizePalette({ id: "sample", colors: rawColors });
  const position = ((Number(rawPosition) % 1) + 1) % 1;
  const scaled = position * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const blend = scaled - index;
  const first = rgbFromHex(colors[index]);
  const second = rgbFromHex(colors[index + 1]);
  return first.map((channel, channelIndex) =>
    Math.round(channel + (second[channelIndex] - channel) * blend),
  );
}
