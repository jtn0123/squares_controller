import { $, effectIntensity, effectSpeed, updateRangeFill } from "./dom.js";
import {
  EFFECT_PREVIEW_TIMES,
  painterContext,
  state,
} from "./app_state.js";
import { clampByte } from "./color_utils.js";
import { scheduleFrame } from "./net.js";
import { stopAnimation, stopMedia } from "./playback.js";
import { render, drawRgbCanvas } from "./render_core.js";
import { setOutputContext } from "./monitor.js";
import { effectPainters } from "./effect_painters.js";
import { stopPlaylist } from "./playlists.js";
import {
  EFFECT_CATALOG,
  effectById,
  normalizeEffectControls,
} from "./effect_catalog.js";
import { CURATED_PALETTES } from "./palette_model.js";
import { normalizeSegment, segmentSourceIndex } from "./segment_model.js";
import { blendRgb } from "./blend_model.js";
import { renderEffectPreview } from "./effect_preview_model.js";
import { alignFrameTime, FRAME_INTERVAL_MS } from "./frame_timing.js";

let effectPreviewQueued = false;

export function updateModulationVisuals() {
  state.effectSpeed = Number(effectSpeed.value) / 100;
  state.effectIntensity = Number(effectIntensity.value) / 100;
  $("#effectSpeedValue").textContent = `${state.effectSpeed.toFixed(1)}×`;
  $("#effectIntensityValue").textContent = `${effectIntensity.value}%`;
  updateRangeFill(effectSpeed);
  updateRangeFill(effectIntensity);
  queueEffectPreviewRender();
}

export function renderEffectControls(effectId = state.animationName) {
  const grid = $("#effectControlGrid");
  const count = $("#effectControlCount");
  if (!grid || !count) return;
  grid.replaceChildren();
  const effect = effectById(effectId);
  const controls = effect?.controls ?? [];
  if (!controls.length) {
    count.textContent = effect ? "NO EXTRA KNOBS" : "SELECT EFFECT";
    const note = document.createElement("small");
    note.textContent = effect
      ? "THIS EFFECT USES SPEED + EFFECT LEVEL ONLY."
      : "RUN AN EFFECT TO SEE ITS OPTIONAL CONTROLS.";
    grid.append(note);
    return;
  }
  state.effectControls[effectId] = normalizeEffectControls(
    effectId,
    state.effectControls[effectId],
  );
  count.textContent = `${controls.length} CONTROL${controls.length === 1 ? "" : "S"}`;
  controls.forEach((control) => {
    const label = document.createElement("label");
    label.htmlFor = `effect-control-${effectId}-${control.id}`;
    const name = document.createElement("span");
    name.textContent = control.label;
    const value = document.createElement("output");
    const input = document.createElement("input");
    input.className = "range range--compact";
    input.id = `effect-control-${effectId}-${control.id}`;
    input.type = "range";
    input.min = control.min;
    input.max = control.max;
    input.step = control.step;
    input.value = state.effectControls[effectId][control.id];
    const renderValue = () => {
      value.textContent =
        control.step < 1
          ? Number(input.value).toFixed(1)
          : String(Math.round(Number(input.value)));
      updateRangeFill(input);
    };
    input.addEventListener("input", () => {
      state.effectControls[effectId] = normalizeEffectControls(effectId, {
        ...state.effectControls[effectId],
        [control.id]: input.value,
      });
      renderValue();
    });
    input.addEventListener("change", queueEffectPreviewRender);
    renderValue();
    label.append(name, value, input);
    grid.append(label);
  });
}

export function renderGeneratedFrame(
  name,
  time,
  backdrop,
  target,
  primaryBuffer = new Uint8Array(target.length),
  overlayBuffer = new Uint8Array(target.length),
) {
  target.set(backdrop);
  const paintSegment = (segment, includeOverlay = false) => {
    const ctx = painterContext(segment.zone);
    primaryBuffer.fill(0);
    effectPainters[segment.effect](
      time * segment.speed,
      primaryBuffer,
      segment.palette.colors,
      ctx,
    );
    overlayBuffer.fill(0);
    const overlayPalette =
      [...CURATED_PALETTES, ...state.library.palettes].find(
        (palette) => palette.id === state.overlay.paletteId,
      ) ?? CURATED_PALETTES[0];
    if (includeOverlay && state.overlay.enabled) {
      effectPainters[state.overlay.effect](
        time * segment.speed * 0.87 + 0.61,
        overlayBuffer,
        overlayPalette.colors,
        ctx,
      );
    }

    for (let y = 0; y < state.height; y += 1) {
      for (let x = 0; x < state.width; x += 1) {
        const pixel = segmentSourceIndex(
          segment.zone,
          segment.transform,
          x,
          y,
          state.width,
          state.height,
        );
        if (pixel < 0) continue;
        const offset = (y * state.width + x) * 3;
        const sourceOffset = pixel * 3;
        const base = [
          clampByte(primaryBuffer[sourceOffset] * segment.intensity),
          clampByte(primaryBuffer[sourceOffset + 1] * segment.intensity),
          clampByte(primaryBuffer[sourceOffset + 2] * segment.intensity),
        ];
        const mixed =
          includeOverlay && state.overlay.enabled
            ? blendRgb(
                base,
                [
                  clampByte(overlayBuffer[sourceOffset] * segment.intensity),
                  clampByte(
                    overlayBuffer[sourceOffset + 1] * segment.intensity,
                  ),
                  clampByte(
                    overlayBuffer[sourceOffset + 2] * segment.intensity,
                  ),
                ],
                state.overlay.blend,
                state.overlay.opacity / 100,
              )
            : base;
        target.set(mixed, offset);
      }
    }
  };

  state.segments
    .filter((segment) => segment.enabled && effectPainters[segment.effect])
    .forEach((segment) => paintSegment(segment));
  paintSegment(
    normalizeSegment(
      {
        id: "live",
        name: "LIVE SEGMENT",
        enabled: true,
        effect: name,
        speed: state.effectSpeed,
        intensity: state.effectIntensity,
        palette: state.palette,
        zone: state.zone,
        transform: state.segmentTransform,
      },
      state.width,
      state.height,
      "live",
    ),
    true,
  );
  return target;
}

export function startGeneratedEffect(name, { preserveOutput = false } = {}) {
  stopMedia();
  stopAnimation();
  state.animationName = name;
  renderEffectControls(name);
  if (!preserveOutput) {
    setOutputContext({
      kind: "effect",
      name: effectById(name)?.name ?? name.toUpperCase(),
      effect: name,
    });
  }
  const card = $(`[data-effect="${name}"]`);
  if (card) {
    card.classList.add("active");
    card.setAttribute("aria-pressed", "true");
  }
  const startedAt = performance.now();
  const backdrop = state.pixels.slice();
  const primaryBuffer = new Uint8Array(state.pixels.length);
  const overlayBuffer = new Uint8Array(state.pixels.length);
  let previousFrame = startedAt;

  const tick = (now) => {
    if (state.animationName !== name) return;
    if (now - previousFrame >= FRAME_INTERVAL_MS) {
      const time = (now - startedAt) / 1000;
      renderGeneratedFrame(
        name,
        time,
        backdrop,
        state.pixels,
        primaryBuffer,
        overlayBuffer,
      );
      render();
      scheduleFrame();
      previousFrame = alignFrameTime(previousFrame, now);
    }
    state.animationFrame = requestAnimationFrame(tick);
  };
  state.animationFrame = requestAnimationFrame(tick);
}

export function renderEffectPreviews() {
  const previewContext = painterContext({ type: "all" });
  EFFECT_CATALOG.forEach((effect) => {
    const previewCanvas = $(`[data-effect-preview="${effect.id}"]`);
    if (!previewCanvas || !effectPainters[effect.id]) return;
    const pixels = renderEffectPreview(
      (time, target, palette) =>
        effectPainters[effect.id](time, target, palette, previewContext),
      {
        width: state.width,
        height: state.height,
        time: EFFECT_PREVIEW_TIMES[effect.id] * state.effectSpeed,
        palette: state.palette.colors,
        intensity: state.effectIntensity,
      },
    );
    drawRgbCanvas(previewCanvas, pixels, state.width, state.height);
    previewCanvas.parentElement.dataset.preview =
      `${state.width}×${state.height} CODE FRAME`;
  });
}

export function queueEffectPreviewRender() {
  if (effectPreviewQueued || !$(".effect-grid")) return;
  effectPreviewQueued = true;
  requestAnimationFrame(() => {
    effectPreviewQueued = false;
    renderEffectPreviews();
  });
}

export function initializeEffectCatalog() {
  const grid = $(".effect-grid");
  grid.replaceChildren();
  EFFECT_CATALOG.forEach((effect) => {
    const button = document.createElement("button");
    button.className = `effect-card effect-card--${effect.id}`;
    button.dataset.effect = effect.id;
    button.type = "button";
    button.setAttribute("aria-pressed", "false");
    const visual = document.createElement("canvas");
    visual.className = "effect-preview-canvas";
    visual.dataset.effectPreview = effect.id;
    visual.setAttribute("aria-hidden", "true");
    const name = document.createElement("strong");
    name.textContent = effect.name;
    const subtitle = document.createElement("small");
    subtitle.textContent = effect.subtitle;
    button.append(visual, name, subtitle);
    button.addEventListener("click", () => {
      stopPlaylist();
      startGeneratedEffect(effect.id);
    });
    grid.append(button);
  });
  renderEffectPreviews();
}

export function initializeModulation() {
  effectSpeed.addEventListener("input", updateModulationVisuals);
  effectIntensity.addEventListener("input", updateModulationVisuals);
}
