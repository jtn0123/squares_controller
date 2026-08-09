import { $, $$, brightnessSlider, stage, sceneMonitorCanvas, updateRangeFill } from "./dom.js";
import { state, painterContext } from "./app_state.js";
import { clampByte } from "./color_utils.js";
import { drawRgbCanvas, invalidateSceneMirror } from "./render_core.js";
import { effectPainters } from "./effect_painters.js";
import { effectById } from "./effect_catalog.js";
import { describeZone } from "./zone_model.js";
import { normalizePalette } from "./palette_model.js";
import { playlistStepProgress } from "./library_model.js";
import type { OutputContext, SceneSnapshot } from "./types.js";

export function sceneKey(preset: Partial<SceneSnapshot>, saved: boolean): string {
  return `${saved ? "saved" : "built-in"}:${preset.id}`;
}

function storedPreviewPixels(
  preset: Partial<SceneSnapshot>,
  expected: number,
): number[] | null {
  for (const candidate of [preset.previewPixels, preset.pixels]) {
    if (Array.isArray(candidate) && candidate.length === expected) {
      return candidate;
    }
  }
  return null;
}

// One label vocabulary for scene rows, shared with the scene list.
export function sceneRowLabel(active: boolean, builtIn: boolean): string {
  if (active) return "ON AIR";
  return builtIn ? "BUILT-IN" : "SAVED";
}

export function scenePreviewPixels(
  preset: Partial<SceneSnapshot>,
): { pixels: Uint8Array; width: number; height: number } | null {
  const width = Number(preset.width) || state.width;
  const height = Number(preset.height) || state.height;
  const expected = width * height * 3;
  const stored = storedPreviewPixels(preset, expected);
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

export function updateSceneMonitor(): void {
  const monitor = $("#sceneMonitor");
  if (!monitor) return;
  const output = state.outputContext;
  const scene = output.scene;
  const playlist = state.library.playlists.find(
    (item) => item.id === state.activePlaylistId,
  );
  monitor.dataset.state = output.kind;
  stage.dataset.outputState = output.kind;
  const isScene = output.kind === "scene";
  let badge = output.badge ?? (isScene ? "SCENE LIVE" : "LIVE OUTPUT");
  let kicker =
    output.kicker ??
    (isScene ? `${output.source ?? "SAVED"} SCENE` : "PROGRAM MONITOR");
  if (playlist) {
    badge = "PLAYLIST LIVE";
    kicker = `PLAYLIST / ${playlist.name}`;
  }
  $("#sceneMonitorBadge").textContent = badge;
  $("#sceneMonitorKicker").textContent = kicker;
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

export function updatePresetSelection(): void {
  $$(".preset-row").forEach((row) => {
    const active = row.dataset.sceneKey === state.outputContext.sceneKey;
    row.classList.toggle("active", active);
    const label = row.querySelector(".scene-preview-label");
    if (label) {
      label.textContent = sceneRowLabel(
        active,
        row.classList.contains("built-in"),
      );
    }
  });
  invalidateSceneMirror();
}

export function setOutputContext(output: Partial<OutputContext>): void {
  const nextOutputContext: OutputContext = {
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

export function updateBrightnessVisual(value: number): void {
  $("#brightnessValue").textContent = `${value}%`;
  updateRangeFill(brightnessSlider);
  updateSceneMonitor();
}
