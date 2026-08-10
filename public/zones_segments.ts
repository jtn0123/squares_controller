import { $, effectIntensity, effectSpeed, updateRangeFill } from "./dom.js";
import { state } from "./app_state.js";
import { toast } from "./net.js";
import { render } from "./render_core.js";
import { effectPainters } from "./effect_painters.js";
import { applyPalette, renderPaletteOptions } from "./palettes.js";
import {
  startGeneratedEffect,
  updateModulationVisuals,
} from "./effects_ui.js";
import { describeZone, normalizeZone, panelGrid } from "./zone_model.js";
import {
  normalizeSegment,
  normalizeSegmentTransform,
} from "./segment_model.js";
import { effectById, EFFECT_CATALOG } from "./effect_catalog.js";
import { BLEND_MODES, normalizeLayer } from "./blend_model.js";
import { normalizeTransition } from "./transition_model.js";

export function applyZone(zone: unknown, announce = false): void {
  state.zone = normalizeZone(zone, state.width, state.height);
  renderZoneControls();
  render();
  if (announce) toast(`Target: ${describeZone(state.zone)}.`);
}

export function renderZoneControls(): void {
  const typeSelect = $<HTMLSelectElement>("#zoneType");
  if (!typeSelect) return;
  // Snapshot the zone so discriminant narrowing survives the callbacks.
  const zone = state.zone;
  typeSelect.value = zone.type;
  const panelEditor = $("#panelZoneGrid");
  const axisEditor = $("#zoneAxisEditor");
  const rectEditor = $("#zoneRectEditor");
  panelEditor.hidden = zone.type !== "panel";
  axisEditor.hidden = !["row", "column"].includes(zone.type);
  rectEditor.hidden = zone.type !== "custom";

  panelEditor.replaceChildren();
  if (zone.type === "panel") {
    const panels = panelGrid(state.width, state.height);
    panelEditor.style.setProperty(
      "--panel-columns",
      String(Math.ceil(state.width / 8)),
    );
    panels.forEach((panel, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = String(index + 1).padStart(2, "0");
      button.setAttribute(
        "aria-label",
        `Panel column ${panel.column + 1}, row ${panel.row + 1}`,
      );
      button.classList.toggle(
        "active",
        panel.column === zone.column && panel.row === zone.row,
      );
      button.addEventListener("click", () =>
        applyZone(
          { type: "panel", column: panel.column, row: panel.row },
          true,
        ),
      );
      panelEditor.append(button);
    });
  }

  if (zone.type === "row" || zone.type === "column") {
    const input = $<HTMLInputElement>("#zoneIndex");
    const isRow = zone.type === "row";
    $("#zoneIndexLabel").textContent = isRow ? "ROW NUMBER" : "COLUMN NUMBER";
    input.max = String(isRow ? state.height : state.width);
    input.value = String(zone.index + 1);
  }

  if (zone.type === "custom") {
    const values = {
      zoneX: zone.x + 1,
      zoneY: zone.y + 1,
      zoneWidth: zone.width,
      zoneHeight: zone.height,
    };
    Object.entries(values).forEach(([id, value]) => {
      $<HTMLInputElement>(`#${id}`).value = String(value);
    });
    $<HTMLInputElement>("#zoneX").max = String(state.width);
    $<HTMLInputElement>("#zoneY").max = String(state.height);
    $<HTMLInputElement>("#zoneWidth").max = String(state.width - zone.x);
    $<HTMLInputElement>("#zoneHeight").max = String(state.height - zone.y);
  }
  $("#zoneReadout").textContent = describeZone(zone);
}

export function initializeZones(): void {
  const typeSelect = $<HTMLSelectElement>("#zoneType");
  typeSelect.addEventListener("change", () => {
    const type = typeSelect.value;
    if (type === "panel") applyZone({ type, column: 0, row: 0 }, true);
    else if (type === "row" || type === "column") {
      applyZone({ type, index: 0 }, true);
    } else if (type === "custom") {
      applyZone({ type, x: 0, y: 0, width: 8, height: 8 }, true);
    } else applyZone({ type: "all" }, true);
  });
  const zoneIndexInput = $<HTMLInputElement>("#zoneIndex");
  zoneIndexInput.addEventListener("input", () => {
    // No toast per keystroke; the canvas outline is the live feedback.
    applyZone({
      type: state.zone.type,
      index: Number(zoneIndexInput.value) - 1,
    });
  });
  ["zoneX", "zoneY", "zoneWidth", "zoneHeight"].forEach((id) => {
    $(`#${id}`).addEventListener("input", () => {
      applyZone({
        type: "custom",
        x: Number($<HTMLInputElement>("#zoneX").value) - 1,
        y: Number($<HTMLInputElement>("#zoneY").value) - 1,
        width: Number($<HTMLInputElement>("#zoneWidth").value),
        height: Number($<HTMLInputElement>("#zoneHeight").value),
      });
    });
  });
  renderZoneControls();
}

export function renderSegmentStudio(): void {
  const count = $("#segmentCount");
  if (!count) return;
  const transform = normalizeSegmentTransform(
    state.segmentTransform,
    state.width * state.height,
  );
  state.segmentTransform = transform;
  $<HTMLInputElement>("#segmentMirrorX").checked = transform.mirrorX;
  $<HTMLInputElement>("#segmentMirrorY").checked = transform.mirrorY;
  $<HTMLInputElement>("#segmentTranspose").checked = transform.transpose;
  $<HTMLInputElement>("#segmentGrouping").value = String(transform.grouping);
  $<HTMLInputElement>("#segmentSpacing").value = String(transform.spacing);
  $<HTMLInputElement>("#segmentOffset").value = String(transform.offset);
  $<HTMLInputElement>("#segmentOffset").min = String(
    -(state.width * state.height - 1),
  );
  $<HTMLInputElement>("#segmentOffset").max = String(
    state.width * state.height - 1,
  );
  count.textContent = `LIVE + ${state.segments.length} PINNED`;

  const list = $("#segmentList");
  list.replaceChildren();
  state.segments.forEach((segment) => {
    const row = document.createElement("div");
    row.className = "segment-row";
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = segment.enabled;
    enabled.setAttribute("aria-label", `Enable ${segment.name}`);
    enabled.addEventListener("change", () => {
      segment.enabled = enabled.checked;
    });
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = segment.name;
    const details = document.createElement("small");
    details.textContent =
      `${effectById(segment.effect)?.name ?? segment.effect.toUpperCase()}` +
      ` / ${describeZone(segment.zone)}`;
    copy.append(name, details);
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "EDIT";
    edit.setAttribute("aria-label", `Edit ${segment.name}`);
    edit.addEventListener("click", () => {
      state.segments = state.segments.filter((item) => item.id !== segment.id);
      state.zone = normalizeZone(segment.zone, state.width, state.height);
      state.segmentTransform = normalizeSegmentTransform(
        segment.transform,
        state.width * state.height,
      );
      effectSpeed.value = String(Math.round(segment.speed * 100));
      effectIntensity.value = String(Math.round(segment.intensity * 100));
      updateModulationVisuals();
      applyPalette(segment.palette);
      renderZoneControls();
      renderSegmentStudio();
      startGeneratedEffect(segment.effect);
      toast(`${segment.name} is now the live segment.`);
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${segment.name}`);
    remove.addEventListener("click", () => {
      state.segments = state.segments.filter((item) => item.id !== segment.id);
      renderSegmentStudio();
    });
    row.append(enabled, copy, edit, remove);
    list.append(row);
  });
  if (!state.segments.length) {
    const empty = document.createElement("small");
    empty.className = "local-note";
    empty.textContent = "PIN THE LIVE REGION, THEN BUILD ANOTHER.";
    list.append(empty);
  }
}

function readSegmentTransformControls(): void {
  state.segmentTransform = normalizeSegmentTransform(
    {
      mirrorX: $<HTMLInputElement>("#segmentMirrorX").checked,
      mirrorY: $<HTMLInputElement>("#segmentMirrorY").checked,
      transpose: $<HTMLInputElement>("#segmentTranspose").checked,
      grouping: $<HTMLInputElement>("#segmentGrouping").value,
      spacing: $<HTMLInputElement>("#segmentSpacing").value,
      offset: $<HTMLInputElement>("#segmentOffset").value,
    },
    state.width * state.height,
  );
  renderSegmentStudio();
}

export function initializeSegments(): void {
  [
    "segmentMirrorX",
    "segmentMirrorY",
    "segmentTranspose",
    "segmentGrouping",
    "segmentSpacing",
    "segmentOffset",
  ].forEach((id) => {
    $(`#${id}`).addEventListener(
      id.startsWith("segmentMirror") || id === "segmentTranspose"
        ? "change"
        : "input",
      readSegmentTransformControls,
    );
  });
  $("#pinSegmentButton").addEventListener("click", () => {
    if (state.animationName === null || !effectPainters[state.animationName]) {
      toast("Run an effect before pinning a segment.", true);
      return;
    }
    if (state.segments.length >= 3) {
      toast("The live renderer supports three pinned segments.", true);
      return;
    }
    const requestedName = $<HTMLInputElement>("#segmentName").value.trim();
    const index = state.segments.length + 1;
    state.segments.push(
      normalizeSegment(
        {
          id: `segment-${Date.now().toString(36)}-${index}`,
          name: requestedName || `SEGMENT ${index}`,
          effect: state.animationName,
          speed: state.effectSpeed,
          intensity: state.effectIntensity,
          palette: state.palette,
          zone: state.zone,
          transform: state.segmentTransform,
        },
        state.width,
        state.height,
        `segment-${index}`,
      ),
    );
    $<HTMLInputElement>("#segmentName").value = "";
    renderSegmentStudio();
    toast(`Pinned segment ${index}.`);
  });
  $("#clearSegmentsButton").addEventListener("click", () => {
    state.segments = [];
    renderSegmentStudio();
    toast("Pinned segments cleared.");
  });
  renderSegmentStudio();
}

export function updateLayerControls(): void {
  const layerStudio = $(".layer-studio");
  $<HTMLInputElement>("#overlayEnabled").checked = state.overlay.enabled;
  $<HTMLSelectElement>("#overlayEffect").value = state.overlay.effect;
  $<HTMLSelectElement>("#overlayPalette").value = state.overlay.paletteId;
  $<HTMLSelectElement>("#overlayBlend").value = state.overlay.blend;
  $<HTMLInputElement>("#overlayOpacity").value = String(state.overlay.opacity);
  $("#overlayOpacityValue").textContent = `${state.overlay.opacity}%`;
  updateRangeFill($<HTMLInputElement>("#overlayOpacity"));
  layerStudio.classList.toggle("enabled", state.overlay.enabled);
}

function readLayerControls(): void {
  state.overlay = normalizeLayer({
    enabled: $<HTMLInputElement>("#overlayEnabled").checked,
    effect: $<HTMLSelectElement>("#overlayEffect").value,
    paletteId: $<HTMLSelectElement>("#overlayPalette").value,
    blend: $<HTMLSelectElement>("#overlayBlend").value,
    opacity: $<HTMLInputElement>("#overlayOpacity").value,
  });
  updateLayerControls();
}

export function initializeLayers(): void {
  const effectSelect = $<HTMLSelectElement>("#overlayEffect");
  effectSelect.replaceChildren();
  EFFECT_CATALOG.forEach((effect) => {
    const option = document.createElement("option");
    option.value = effect.id;
    option.textContent = effect.name;
    effectSelect.append(option);
  });
  renderPaletteOptions();
  const blendSelect = $<HTMLSelectElement>("#overlayBlend");
  BLEND_MODES.forEach((mode) => {
    const option = document.createElement("option");
    option.value = mode.id;
    option.textContent = mode.name;
    blendSelect.append(option);
  });
  ["overlayEnabled", "overlayEffect", "overlayPalette", "overlayBlend"].forEach(
    (id) => $(`#${id}`).addEventListener("change", readLayerControls),
  );
  $("#overlayOpacity").addEventListener("input", readLayerControls);
  updateLayerControls();
}

export function updateTransitionControls(): void {
  $<HTMLSelectElement>("#sceneTransition").value = state.transition.type;
  $<HTMLInputElement>("#transitionDuration").value = String(
    state.transition.duration,
  );
  $("#transitionDurationValue").textContent =
    `${state.transition.duration}ms`;
  updateRangeFill($<HTMLInputElement>("#transitionDuration"));
}

function readTransitionControls(): void {
  state.transition = normalizeTransition({
    type: $<HTMLSelectElement>("#sceneTransition").value,
    duration: $<HTMLInputElement>("#transitionDuration").value,
  });
  updateTransitionControls();
}

export function initializeTransitions(): void {
  $("#sceneTransition").addEventListener("change", readTransitionControls);
  $("#transitionDuration").addEventListener("input", readTransitionControls);
  updateTransitionControls();
}
