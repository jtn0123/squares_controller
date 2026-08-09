// Applying a scene to the wall: environment restore, target-frame
// resolution, and the animated transition. The scene browser UI lives in
// scenes.ts; playlists drive this module directly.
import { brightnessSlider, effectIntensity, effectSpeed } from "./dom.js";
import { state } from "./app_state.js";
import { scheduleFrame, toast } from "./net.js";
import { stopAnimation, stopMedia } from "./playback.js";
import { render } from "./render_core.js";
import { setOutputContext } from "./monitor.js";
import { effectPainters } from "./effect_painters.js";
import {
  renderGeneratedFrame,
  startGeneratedEffect,
  updateModulationVisuals,
} from "./effects_ui.js";
import { applyPalette } from "./palettes.js";
import {
  applyZone,
  renderSegmentStudio,
  updateLayerControls,
  updateTransitionControls,
} from "./zones_segments.js";
import { sendBrightness } from "./status_view.js";
import { effectById } from "./effect_catalog.js";
import { normalizeSegment, normalizeSegmentTransform } from "./segment_model.js";
import { normalizeLayer } from "./blend_model.js";
import { normalizeTransition, transitionFrame } from "./transition_model.js";
import type { SceneSnapshot, TransitionSettings } from "./types.js";

export interface LoadPresetOptions {
  sceneKey?: string;
  source?: string;
  transition?: TransitionSettings;
}

function transitionToFrame(
  target: Uint8Array,
  transition: TransitionSettings,
): Promise<boolean> {
  const setting = normalizeTransition(transition);
  const from = state.pixels.slice();
  stopAnimation();
  const token = state.transitionToken;
  if (setting.type === "cut" || setting.duration === 0) {
    state.pixels.set(target);
    render();
    scheduleFrame();
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    let startedAt: number | undefined;
    const tick = (now: number): void => {
      if (token !== state.transitionToken) {
        resolve(false);
        return;
      }
      startedAt ??= now;
      const progress = Math.min(1, (now - startedAt) / setting.duration);
      state.pixels.set(
        transitionFrame(
          from,
          target,
          state.width,
          state.height,
          setting.type,
          progress,
        ),
      );
      render();
      scheduleFrame();
      if (progress < 1) requestAnimationFrame(tick);
      else resolve(true);
    };
    requestAnimationFrame(tick);
  });
}

function applyPresetEnvironment(
  preset: SceneSnapshot,
  options: LoadPresetOptions,
): void {
  state.effectControls =
    preset.effectControls && typeof preset.effectControls === "object"
      ? structuredClone(preset.effectControls)
      : {};
  effectSpeed.value = String(preset.speed ?? 100);
  effectIntensity.value = String(preset.intensity ?? 75);
  updateModulationVisuals();
  if (preset.palette) applyPalette(preset.palette);
  if (preset.zone) applyZone(preset.zone);
  state.segmentTransform = normalizeSegmentTransform(
    preset.segmentTransform,
    state.width * state.height,
  );
  state.segments = Array.isArray(preset.segments)
    ? preset.segments
        .slice(0, 3)
        .map((segment, index) =>
          normalizeSegment(
            segment,
            state.width,
            state.height,
            `segment-${index + 1}`,
          ),
        )
    : [];
  renderSegmentStudio();
  if (preset.layers?.overlay) {
    state.overlay = normalizeLayer(preset.layers.overlay);
    updateLayerControls();
  }
  if (preset.transition && !options.transition) {
    state.transition = normalizeTransition(preset.transition);
    updateTransitionControls();
  }
}

function presetHasRunnableEffect(
  preset: SceneSnapshot,
): preset is SceneSnapshot & { effect: string } {
  return Boolean(
    preset.effect && effectById(preset.effect) && effectPainters[preset.effect],
  );
}

function presetTargetFrame(preset: SceneSnapshot): Uint8Array {
  if (presetHasRunnableEffect(preset)) {
    const target = new Uint8Array(state.pixels.length);
    renderGeneratedFrame(preset.effect, 0, state.pixels.slice(), target);
    return target;
  }
  if (
    preset.width !== state.width ||
    preset.height !== state.height ||
    !Array.isArray(preset.pixels) ||
    preset.pixels.length !== state.pixels.length
  ) {
    throw new Error("This preset was saved for a different panel layout.");
  }
  return new Uint8Array(preset.pixels);
}

export async function loadPreset(
  preset: SceneSnapshot,
  options: LoadPresetOptions = {},
): Promise<boolean> {
  stopMedia();
  applyPresetEnvironment(preset, options);
  const selectedTransition = normalizeTransition(
    options.transition ?? preset.transition ?? state.transition,
  );

  try {
    await sendBrightness(preset.brightness ?? brightnessSlider.value);
    const target = presetTargetFrame(preset);
    const completed = await transitionToFrame(target, selectedTransition);
    if (!completed) return false;
    if (presetHasRunnableEffect(preset)) {
      startGeneratedEffect(preset.effect, { preserveOutput: true });
    }
    setOutputContext({
      kind: "scene",
      name: preset.name,
      sceneKey: options.sceneKey ?? `saved:${preset.id}`,
      scene: preset,
      source: options.source ?? "SAVED",
    });
    toast(`Loaded ${preset.name}.`);
    return true;
  } catch (error) {
    toast((error as Error).message, true);
    return false;
  }
}
