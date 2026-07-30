export function normalizeLibrary(value) {
  const scenes = Array.isArray(value?.scenes)
    ? value.scenes.filter(
        (scene) =>
          scene &&
          typeof scene === "object" &&
          typeof scene.id === "string" &&
          typeof scene.name === "string",
      )
    : [];
  const playlists = Array.isArray(value?.playlists)
    ? value.playlists.filter(
        (playlist) =>
          playlist &&
          typeof playlist === "object" &&
          typeof playlist.id === "string" &&
          typeof playlist.name === "string" &&
          Array.isArray(playlist.steps),
      )
    : [];
  return { scenes, playlists };
}

export function createSceneSnapshot({
  name,
  effect,
  width,
  height,
  pixels,
  speed,
  intensity,
  brightness,
  palette,
  zone,
  layers,
}) {
  return {
    name,
    effect: effect ?? null,
    width,
    height,
    pixels: effect ? null : Array.from(pixels),
    speed: Number(speed),
    intensity: Number(intensity),
    brightness: Number(brightness),
    ...(palette ? { palette: structuredClone(palette) } : {}),
    ...(zone ? { zone: structuredClone(zone) } : {}),
    ...(layers ? { layers: structuredClone(layers) } : {}),
  };
}

export function advancePlaylist(index, length, repeat) {
  if (index + 1 < length) return { index: index + 1, done: false };
  if (repeat && length > 0) return { index: 0, done: false };
  return { index, done: true };
}
