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

export function applyZone(zone, announce = false) {
  state.zone = normalizeZone(zone, state.width, state.height);
  renderZoneControls();
  render();
  if (announce) toast(`Target: ${describeZone(state.zone)}.`);
}

export function renderZoneControls() {
  const typeSelect = $("#zoneType");
  if (!typeSelect) return;
  typeSelect.value = state.zone.type;
  const panelEditor = $("#panelZoneGrid");
  const axisEditor = $("#zoneAxisEditor");
  const rectEditor = $("#zoneRectEditor");
  panelEditor.hidden = state.zone.type !== "panel";
  axisEditor.hidden = !["row", "column"].includes(state.zone.type);
  rectEditor.hidden = state.zone.type !== "custom";

  panelEditor.replaceChildren();
  if (state.zone.type === "panel") {
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
        panel.column === state.zone.column && panel.row === state.zone.row,
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

  if (["row", "column"].includes(state.zone.type)) {
    const input = $("#zoneIndex");
    const isRow = state.zone.type === "row";
    $("#zoneIndexLabel").textContent = isRow ? "ROW NUMBER" : "COLUMN NUMBER";
    input.max = String(isRow ? state.height : state.width);
    input.value = String(state.zone.index + 1);
  }

  if (state.zone.type === "custom") {
    const values = {
      zoneX: state.zone.x + 1,
      zoneY: state.zone.y + 1,
      zoneWidth: state.zone.width,
      zoneHeight: state.zone.height,
    };
    Object.entries(values).forEach(([id, value]) => {
      $(`#${id}`).value = value;
    });
    $("#zoneX").max = state.width;
    $("#zoneY").max = state.height;
    $("#zoneWidth").max = state.width - state.zone.x;
    $("#zoneHeight").max = state.height - state.zone.y;
  }
  $("#zoneReadout").textContent = describeZone(state.zone);
}

export function initializeZones() {
  $("#zoneType").addEventListener("change", (event) => {
    const type = event.target.value;
    if (type === "panel") applyZone({ type, column: 0, row: 0 }, true);
    else if (type === "row" || type === "column") {
      applyZone({ type, index: 0 }, true);
    } else if (type === "custom") {
      applyZone({ type, x: 0, y: 0, width: 8, height: 8 }, true);
    } else applyZone({ type: "all" }, true);
  });
  $("#zoneIndex").addEventListener("input", (event) => {
    applyZone(
      { type: state.zone.type, index: Number(event.target.value) - 1 },
      true,
    );
  });
  ["zoneX", "zoneY", "zoneWidth", "zoneHeight"].forEach((id) => {
    $(`#${id}`).addEventListener("input", () => {
      applyZone(
        {
          type: "custom",
          x: Number($("#zoneX").value) - 1,
          y: Number($("#zoneY").value) - 1,
          width: Number($("#zoneWidth").value),
          height: Number($("#zoneHeight").value),
        },
        true,
      );
    });
  });
  renderZoneControls();
}

export function renderSegmentStudio() {
  const count = $("#segmentCount");
  if (!count) return;
  const transform = normalizeSegmentTransform(
    state.segmentTransform,
    state.width * state.height,
  );
  state.segmentTransform = transform;
  $("#segmentMirrorX").checked = transform.mirrorX;
  $("#segmentMirrorY").checked = transform.mirrorY;
  $("#segmentTranspose").checked = transform.transpose;
  $("#segmentGrouping").value = transform.grouping;
  $("#segmentSpacing").value = transform.spacing;
  $("#segmentOffset").value = transform.offset;
  $("#segmentOffset").min = String(-(state.width * state.height - 1));
  $("#segmentOffset").max = String(state.width * state.height - 1);
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
      effectSpeed.value = Math.round(segment.speed * 100);
      effectIntensity.value = Math.round(segment.intensity * 100);
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

function readSegmentTransformControls() {
  state.segmentTransform = normalizeSegmentTransform(
    {
      mirrorX: $("#segmentMirrorX").checked,
      mirrorY: $("#segmentMirrorY").checked,
      transpose: $("#segmentTranspose").checked,
      grouping: $("#segmentGrouping").value,
      spacing: $("#segmentSpacing").value,
      offset: $("#segmentOffset").value,
    },
    state.width * state.height,
  );
  renderSegmentStudio();
}

export function initializeSegments() {
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
    if (!effectPainters[state.animationName]) {
      toast("Run an effect before pinning a segment.", true);
      return;
    }
    if (state.segments.length >= 3) {
      toast("The live renderer supports three pinned segments.", true);
      return;
    }
    const requestedName = $("#segmentName").value.trim();
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
    $("#segmentName").value = "";
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

export function updateLayerControls() {
  const layerStudio = $(".layer-studio");
  $("#overlayEnabled").checked = state.overlay.enabled;
  $("#overlayEffect").value = state.overlay.effect;
  $("#overlayPalette").value = state.overlay.paletteId;
  $("#overlayBlend").value = state.overlay.blend;
  $("#overlayOpacity").value = state.overlay.opacity;
  $("#overlayOpacityValue").textContent = `${state.overlay.opacity}%`;
  updateRangeFill($("#overlayOpacity"));
  layerStudio.classList.toggle("enabled", state.overlay.enabled);
}

function readLayerControls() {
  state.overlay = normalizeLayer({
    enabled: $("#overlayEnabled").checked,
    effect: $("#overlayEffect").value,
    paletteId: $("#overlayPalette").value,
    blend: $("#overlayBlend").value,
    opacity: $("#overlayOpacity").value,
  });
  updateLayerControls();
}

export function initializeLayers() {
  const effectSelect = $("#overlayEffect");
  effectSelect.replaceChildren();
  EFFECT_CATALOG.forEach((effect) => {
    const option = document.createElement("option");
    option.value = effect.id;
    option.textContent = effect.name;
    effectSelect.append(option);
  });
  renderPaletteOptions();
  const blendSelect = $("#overlayBlend");
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

export function updateTransitionControls() {
  $("#sceneTransition").value = state.transition.type;
  $("#transitionDuration").value = state.transition.duration;
  $("#transitionDurationValue").textContent =
    `${state.transition.duration}ms`;
  updateRangeFill($("#transitionDuration"));
}

function readTransitionControls() {
  state.transition = normalizeTransition({
    type: $("#sceneTransition").value,
    duration: $("#transitionDuration").value,
  });
  updateTransitionControls();
}

export function initializeTransitions() {
  $("#sceneTransition").addEventListener("change", readTransitionControls);
  $("#transitionDuration").addEventListener("input", readTransitionControls);
  updateTransitionControls();
}
