import { $, $$, brightnessSlider, stage, sceneMonitorCanvas, updateRangeFill } from "./dom.js";
import { state, painterContext } from "./app_state.js";
import { clampByte } from "./color_utils.js";
import { drawRgbCanvas, invalidateSceneMirror } from "./render_core.js";
import { effectPainters } from "./effect_painters.js";
import { effectById } from "./effect_catalog.js";
import { describeZone } from "./zone_model.js";
import { normalizePalette } from "./palette_model.js";
import { playlistStepProgress } from "./library_model.js";

export function sceneKey(preset, saved) {
  return `${saved ? "saved" : "built-in"}:${preset.id}`;
}

export function scenePreviewPixels(preset) {
  const width = Number(preset.width) || state.width;
  const height = Number(preset.height) || state.height;
  const expected = width * height * 3;
  const stored =
    Array.isArray(preset.previewPixels) && preset.previewPixels.length === expected
      ? preset.previewPixels
      : Array.isArray(preset.pixels) && preset.pixels.length === expected
        ? preset.pixels
        : null;
  if (stored) return { pixels: new Uint8Array(stored), width, height };
  if (
    !preset.effect ||
    width !== state.width ||
    height !== state.height ||
    !effectPainters[preset.effect]
  ) {
    return null;
  }
  const pixels = new Uint8Array(expected);
  const palette = normalizePalette(preset.palette);
  const time = 1.35 * (Number(preset.speed ?? 100) / 100);
  effectPainters[preset.effect](
    time,
    pixels,
    palette.colors,
    painterContext({ type: "all" }),
  );
  const intensity = Math.max(
    0.1,
    Math.min(1, Number(preset.intensity ?? 75) / 100),
  );
  for (let index = 0; index < pixels.length; index += 1) {
    pixels[index] = clampByte(pixels[index] * intensity);
  }
  return { pixels, width, height };
}

export function updateSceneMonitor() {
  const monitor = $("#sceneMonitor");
  if (!monitor) return;
  const output = state.outputContext;
  const scene = output.scene;
  const playlist = state.library.playlists.find(
    (item) => item.id === state.activePlaylistId,
  );
  monitor.dataset.state = output.kind;
  stage.dataset.outputState = output.kind;
  $("#sceneMonitorBadge").textContent = playlist
    ? "PLAYLIST LIVE"
    : output.badge ??
      (output.kind === "scene" ? "SCENE LIVE" : "LIVE OUTPUT");
  $("#sceneMonitorKicker").textContent = playlist
    ? `PLAYLIST / ${playlist.name}`
    : output.kicker ??
      (output.kind === "scene"
        ? `${output.source ?? "SAVED"} SCENE`
        : "PROGRAM MONITOR");
  $("#sceneMonitorName").textContent = output.name;

  const effectName =
    effectById(scene?.effect ?? output.effect)?.name ??
    (output.kind === "canvas" ? "PIXEL FRAME" : output.kind.toUpperCase());
  const brightness = Math.round(
    Number(scene?.brightness ?? brightnessSlider.value),
  );
  const zone = describeZone(scene?.zone ?? state.zone);
  $("#sceneMonitorMeta").textContent =
    output.meta ?? `${effectName} / ${brightness}% / ${zone}`;
  $("#stageOutputBadge").textContent = output.badge ?? "BROWSER PREVIEW";
  $("#stageOutputName").textContent = output.name;
  $("#stageOutputMeta").textContent =
    output.meta ?? `${effectName} / ${brightness}% / ${zone}`;
  $("#stageOutputNote").textContent =
    output.note ?? "The browser canvas is ready to send.";

  const progressElement = $("#sceneProgress");
  const progressFill = $("#sceneProgressFill");
  const progressLabel = $("#sceneProgressLabel");
  if (playlist && state.activePlaylistStep) {
    const progress = playlistStepProgress(
      state.activePlaylistStep.startedAt,
      state.activePlaylistStep.duration,
    );
    const percent = Math.round(progress.progress * 100);
    progressFill.style.width = `${percent}%`;
    progressElement.setAttribute("aria-valuenow", String(percent));
    // Once the step's time is spent we are loading/crossfading into the
    // next scene; "0s LEFT" would read as a stall.
    const remaining =
      progress.progress >= 1
        ? "NEXT SCENE…"
        : `${progress.remainingSeconds}s LEFT`;
    progressLabel.textContent =
      `STEP ${state.activePlaylistStep.index + 1}/${playlist.steps.length}` +
      ` / ${remaining}` +
      ` / ${state.activePlaylistStep.transition.toUpperCase()}`;
  } else {
    progressFill.style.width = "0%";
    progressElement.setAttribute("aria-valuenow", "0");
    progressLabel.textContent =
      output.note ??
      (output.kind === "scene"
        ? "OUTPUT MIRRORS THIS SCENE"
        : "OUTPUT MIRRORS THE WALL");
  }
}

export function updatePresetSelection() {
  $$(".preset-row").forEach((row) => {
    const active = row.dataset.sceneKey === state.outputContext.sceneKey;
    row.classList.toggle("active", active);
    const label = row.querySelector(".scene-preview-label");
    if (label) {
      label.textContent = active
        ? "ON AIR"
        : row.classList.contains("built-in")
          ? "BUILT-IN"
          : "SAVED";
    }
  });
  invalidateSceneMirror();
}

export function setOutputContext(output) {
  const nextOutputContext = {
    kind: output.kind ?? "canvas",
    name: output.name ?? "CURRENT OUTPUT",
    sceneKey: output.sceneKey ?? null,
    scene: output.scene ?? null,
    source: output.source ?? null,
    effect: output.effect ?? output.scene?.effect ?? null,
    badge: output.badge ?? null,
    kicker: output.kicker ?? null,
    meta: output.meta ?? null,
    note: output.note ?? null,
    playback: output.playback ?? null,
    controllerMovie: output.controllerMovie ?? null,
  };
  const sceneSelectionChanged =
    state.outputContext.sceneKey !== nextOutputContext.sceneKey;
  state.outputContext = nextOutputContext;
  if (sceneSelectionChanged) updatePresetSelection();
  updateSceneMonitor();
  drawRgbCanvas(
    sceneMonitorCanvas,
    state.pixels,
    state.width,
    state.height,
  );
}

export function updateBrightnessVisual(value) {
  $("#brightnessValue").textContent = `${value}%`;
  updateRangeFill(brightnessSlider);
  updateSceneMonitor();
}
