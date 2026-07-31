export function renderEffectPreview(
  renderer,
  { width, height, time, palette, intensity = 1 },
) {
  if (
    typeof renderer !== "function" ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    throw new TypeError("Effect previews need a renderer and valid dimensions.");
  }
  const pixels = new Uint8Array(width * height * 3);
  renderer(Number(time) || 0, pixels, palette);
  const gain = Math.max(0, Math.min(1, Number(intensity) || 0));
  if (gain < 1) {
    for (let index = 0; index < pixels.length; index += 1) {
      pixels[index] = Math.round(pixels[index] * gain);
    }
  }
  return pixels;
}
