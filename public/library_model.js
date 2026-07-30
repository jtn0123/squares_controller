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

function normalizeFolder(value) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, 32).toUpperCase()
    : "";
}

export function parseSceneTags(value) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(",");
  const tags = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const tag = item.trim().replace(/\s+/g, " ").slice(0, 20).toUpperCase();
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length === 8) break;
  }
  return tags;
}

export function sceneFolders(scenes) {
  return Array.from(
    new Set(
      (Array.isArray(scenes) ? scenes : [])
        .map((scene) => normalizeFolder(scene?.folder))
        .filter(Boolean),
    ),
  ).sort((first, second) => first.localeCompare(second));
}

export function filterScenes(scenes, filters = {}) {
  const query = String(filters.query ?? "").trim().toUpperCase();
  const folder = normalizeFolder(filters.folder);
  const favoritesOnly = Boolean(filters.favoritesOnly);
  return (Array.isArray(scenes) ? scenes : []).filter((scene) => {
    const sceneFolder = normalizeFolder(scene?.folder);
    const tags = parseSceneTags(scene?.tags);
    const searchable = [
      String(scene?.name ?? ""),
      sceneFolder,
      ...tags,
    ]
      .join(" ")
      .toUpperCase();
    return (
      (!query || searchable.includes(query)) &&
      (!folder || folder === "ALL" || sceneFolder === folder) &&
      (!favoritesOnly || Boolean(scene?.favorite))
    );
  });
}

export function duplicateScene(scene, existingNames = []) {
  const { id: _id, ...portable } = structuredClone(scene ?? {});
  const sourceName = String(portable.name ?? "SCENE").trim().toUpperCase();
  const usedNames = new Set(
    (Array.isArray(existingNames) ? existingNames : []).map((name) =>
      String(name).trim().toUpperCase(),
    ),
  );
  let suffix = " COPY";
  let index = 1;
  let name = `${sourceName.slice(0, 48 - suffix.length)}${suffix}`;
  while (usedNames.has(name)) {
    index += 1;
    suffix = ` COPY ${index}`;
    name = `${sourceName.slice(0, 48 - suffix.length)}${suffix}`;
  }
  return {
    ...portable,
    name,
    favorite: false,
  };
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
