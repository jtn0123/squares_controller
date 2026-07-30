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
  transition,
}) {
  return {
    name,
    effect: effect ?? null,
    width,
    height,
    pixels: effect ? null : Array.from(pixels),
    ...(effect ? { previewPixels: Array.from(pixels) } : {}),
    speed: Number(speed),
    intensity: Number(intensity),
    brightness: Number(brightness),
    ...(palette ? { palette: structuredClone(palette) } : {}),
    ...(zone ? { zone: structuredClone(zone) } : {}),
    ...(layers ? { layers: structuredClone(layers) } : {}),
    ...(transition ? { transition: structuredClone(transition) } : {}),
  };
}

export function playlistStepProgress(startedAt, durationSeconds, now = Date.now()) {
  const duration = Math.max(1, Number(durationSeconds) || 1);
  if (!Number.isFinite(startedAt)) {
    return { progress: 0, remainingSeconds: Math.ceil(duration) };
  }
  const elapsed = Math.max(0, now - startedAt);
  const progress = Math.min(1, elapsed / (duration * 1000));
  return {
    progress,
    remainingSeconds: Math.max(0, Math.ceil(duration - elapsed / 1000)),
  };
}

export function advancePlaylist(index, length, repeat) {
  if (index + 1 < length) return { index: index + 1, done: false };
  if (repeat && length > 0) return { index: 0, done: false };
  return { index, done: true };
}
