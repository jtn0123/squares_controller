const FIT_MODES = new Set(["cover", "contain", "stretch"]);
const SAMPLING_MODES = new Set(["smooth", "pixel"]);

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value)));
}

export function normalizeMediaControls(raw) {
  return {
    fit: FIT_MODES.has(raw?.fit) ? raw.fit : "cover",
    sampling: SAMPLING_MODES.has(raw?.sampling) ? raw.sampling : "smooth",
    saturation: clamp(Number(raw?.saturation) || 0, 0, 2),
    contrast: clamp(Number(raw?.contrast) || 0, 0, 2),
    brightness: clamp(Number(raw?.brightness) || 0, 0.1, 2),
    gamma: clamp(Number(raw?.gamma) || 0, 0.2, 2),
  };
}

export function fitRect(sourceWidth, sourceHeight, targetWidth, targetHeight, mode) {
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

export function adjustRgb(rgb, rawControls) {
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
