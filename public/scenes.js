import { $, brightnessSlider, effectIntensity, effectSpeed } from "./dom.js";
import {
  builtInPresets,
  MAX_SAVED_PRESETS,
  PRESET_STORAGE_KEY,
  state,
} from "./app_state.js";
import { api, scheduleFrame, toast } from "./net.js";
import { stopAnimation, stopMedia } from "./playback.js";
import { drawRgbCanvas, invalidateSceneMirror, render } from "./render_core.js";
import {
  sceneKey,
  scenePreviewPixels,
  sceneRowLabel,
  setOutputContext,
} from "./monitor.js";
import { effectPainters } from "./effect_painters.js";
import {
  renderGeneratedFrame,
  startGeneratedEffect,
  updateModulationVisuals,
} from "./effects_ui.js";
import { applyPalette } from "./palettes.js";
import { applyZone, renderSegmentStudio, updateLayerControls, updateTransitionControls } from "./zones_segments.js";
import { sendBrightness } from "./status_view.js";
import { stopPlaylist } from "./playlists.js";
import { loadLibrary } from "./library_sync.js";
import {
  createSceneSnapshot,
  duplicateScene,
  filterScenes,
  parseSceneTags,
} from "./library_model.js";
import { effectById } from "./effect_catalog.js";
import { describeZone } from "./zone_model.js";
import { normalizeSegment, normalizeSegmentTransform } from "./segment_model.js";
import { normalizeLayer } from "./blend_model.js";
import { normalizeTransition, transitionFrame } from "./transition_model.js";

export function sceneForId(sceneId) {
  return state.library.scenes.find((scene) => scene.id === sceneId);
}

export function readSavedPresets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PRESET_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (preset) =>
              preset &&
              typeof preset === "object" &&
              typeof preset.id === "string" &&
              typeof preset.name === "string",
          )
          .slice(0, MAX_SAVED_PRESETS)
      : [];
  } catch {
    return [];
  }
}

function transitionToFrame(target, transition) {
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

  return new Promise((resolve) => {
    let startedAt;
    const tick = (now) => {
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

function applyPresetEnvironment(preset, options) {
  state.effectControls =
    preset.effectControls && typeof preset.effectControls === "object"
      ? structuredClone(preset.effectControls)
      : {};
  effectSpeed.value = preset.speed ?? 100;
  effectIntensity.value = preset.intensity ?? 75;
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

function presetHasRunnableEffect(preset) {
  return Boolean(
    preset.effect && effectById(preset.effect) && effectPainters[preset.effect],
  );
}

function presetTargetFrame(preset) {
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

export async function loadPreset(preset, options = {}) {
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
    toast(error.message, true);
    return false;
  }
}

async function upsertOrganizedScene(scene, successMessage) {
  await api("/api/scenes", {
    method: "POST",
    body: JSON.stringify(scene),
  });
  await loadLibrary();
  toast(successMessage);
}

function createPresetTool(label, text, { active = false, danger = false } = {}) {
  const button = document.createElement("button");
  button.className = "preset-tool";
  button.classList.toggle("active", active);
  button.classList.toggle("danger", danger);
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.textContent = text;
  return button;
}

function createPresetRow(preset, saved = false) {
  const row = document.createElement("div");
  row.className = "preset-row";
  if (!saved) row.classList.add("built-in");
  const key = sceneKey(preset, saved);
  row.dataset.sceneKey = key;
  row.classList.toggle("active", state.outputContext.sceneKey === key);

  const loadButton = document.createElement("button");
  loadButton.className = "preset-load";
  loadButton.type = "button";
  loadButton.setAttribute("aria-label", `Load scene ${preset.name}`);

  const preview = document.createElement("span");
  preview.className = "scene-preview";
  const previewCanvas = document.createElement("canvas");
  previewCanvas.className = "scene-preview-canvas";
  previewCanvas.setAttribute("aria-hidden", "true");
  const previewLabel = document.createElement("small");
  previewLabel.className = "scene-preview-label";
  previewLabel.textContent = sceneRowLabel(
    state.outputContext.sceneKey === key,
    !saved,
  );
  preview.append(previewCanvas, previewLabel);

  const previewFrame = scenePreviewPixels(preset);
  if (previewFrame) {
    preview.style.aspectRatio = `${previewFrame.width} / ${previewFrame.height}`;
    drawRgbCanvas(
      previewCanvas,
      previewFrame.pixels,
      previewFrame.width,
      previewFrame.height,
    );
  }

  const copy = document.createElement("span");
  copy.className = "scene-card-copy";
  const name = document.createElement("span");
  name.textContent = preset.name;
  const details = document.createElement("small");
  const effectName =
    effectById(preset.effect)?.name ?? (preset.effect ? preset.effect : "STATIC FRAME");
  details.textContent =
    `${effectName} / ${Math.round(Number(preset.brightness ?? 25))}%` +
    ` / ${describeZone(preset.zone ?? { type: "all" })}`;
  const tags = document.createElement("span");
  tags.className = "scene-card-tags";
  const metadata = [
    ...(preset.favorite ? ["★ FAVORITE"] : []),
    ...(preset.folder ? [preset.folder] : []),
    ...parseSceneTags(preset.tags),
  ];
  metadata.forEach((label) => {
    const chip = document.createElement("i");
    chip.textContent = label;
    tags.append(chip);
  });
  copy.append(name, details, tags);
  loadButton.append(preview, copy);
  loadButton.addEventListener("click", () => {
    stopPlaylist();
    void loadPreset(preset, {
      sceneKey: key,
      source: saved ? "SAVED" : "BUILT-IN",
    });
  });
  row.append(loadButton);

  if (saved) {
    const tools = document.createElement("div");
    tools.className = "preset-tools";
    const favoriteButton = createPresetTool(
      `${preset.favorite ? "Remove" : "Add"} ${preset.name} ${
        preset.favorite ? "from" : "to"
      } favorites`,
      preset.favorite ? "★" : "☆",
      { active: Boolean(preset.favorite) },
    );
    favoriteButton.addEventListener("click", async () => {
      try {
        await upsertOrganizedScene(
          { ...preset, favorite: !preset.favorite },
          `${preset.name} ${preset.favorite ? "removed from" : "added to"} favorites.`,
        );
      } catch (error) {
        toast(error.message, true);
      }
    });

    const duplicateButton = createPresetTool(
      `Duplicate ${preset.name}`,
      "COPY",
    );
    duplicateButton.addEventListener("click", async () => {
      try {
        const duplicate = duplicateScene(
          preset,
          state.library.scenes.map((scene) => scene.name),
        );
        await upsertOrganizedScene(
          duplicate,
          `Created ${duplicate.name}.`,
        );
      } catch (error) {
        toast(error.message, true);
      }
    });

    const editButton = createPresetTool(
      `Edit folder and tags for ${preset.name}`,
      "EDIT",
    );

    const deleteButton = createPresetTool(
      `Delete ${preset.name}`,
      "DEL",
      { danger: true },
    );
    deleteButton.addEventListener("click", async () => {
      try {
        await api(`/api/scenes/${encodeURIComponent(preset.id)}`, {
          method: "DELETE",
        });
        state.playlistDraft = state.playlistDraft.filter(
          (step) => step.sceneId !== preset.id,
        );
        if (state.outputContext.sceneKey === key) {
          setOutputContext({ kind: "canvas", name: "CURRENT FRAME" });
        }
        await loadLibrary();
        toast(`Deleted ${preset.name}.`);
      } catch (error) {
        toast(error.message, true);
      }
    });

    tools.append(
      favoriteButton,
      duplicateButton,
      editButton,
      deleteButton,
    );
    row.append(tools);

    const editor = document.createElement("div");
    editor.className = "scene-metadata-editor";
    const folderInput = document.createElement("input");
    folderInput.type = "text";
    folderInput.maxLength = 32;
    folderInput.placeholder = "FOLDER / UNFILED";
    folderInput.setAttribute("aria-label", `Folder for ${preset.name}`);
    folderInput.value = preset.folder ?? "";
    const tagsInput = document.createElement("input");
    tagsInput.type = "text";
    tagsInput.maxLength = 175;
    tagsInput.placeholder = "TAGS / COMMA SEPARATED";
    tagsInput.setAttribute("aria-label", `Tags for ${preset.name}`);
    tagsInput.value = parseSceneTags(preset.tags).join(", ");
    const saveMetadata = document.createElement("button");
    saveMetadata.type = "button";
    saveMetadata.textContent = "SAVE ORGANIZATION";
    saveMetadata.addEventListener("click", async () => {
      try {
        await upsertOrganizedScene(
          {
            ...preset,
            folder: folderInput.value,
            tags: parseSceneTags(tagsInput.value),
          },
          `Updated ${preset.name}.`,
        );
      } catch (error) {
        toast(error.message, true);
      }
    });
    editor.append(folderInput, tagsInput, saveMetadata);
    row.append(editor);
    editButton.addEventListener("click", () => {
      const open = !editor.classList.contains("open");
      editor.classList.toggle("open", open);
      editButton.classList.toggle("active", open);
      editButton.setAttribute("aria-expanded", String(open));
      if (open) folderInput.focus();
    });
  }

  return row;
}

export function renderPresets() {
  const presetList = $("#presetList");
  presetList.replaceChildren();
  const showCore =
    state.sceneFilters.folder === "ALL" &&
    !state.sceneFilters.favoritesOnly;
  const coreScenes = showCore
    ? filterScenes(builtInPresets, {
        query: state.sceneFilters.query,
        folder: "ALL",
      })
    : [];
  const savedScenes = filterScenes(
    state.library.scenes,
    state.sceneFilters,
  );
  coreScenes.forEach((preset) => {
    presetList.append(createPresetRow(preset));
  });
  savedScenes.forEach((preset) => {
    presetList.append(createPresetRow(preset, true));
  });
  if (!coreScenes.length && !savedScenes.length) {
    const empty = document.createElement("small");
    empty.className = "local-note";
    empty.textContent = "NO SCENES MATCH THIS VIEW.";
    presetList.append(empty);
  }
  invalidateSceneMirror();
  const totalSaved = state.library.scenes.length;
  const savedSuffix =
    savedScenes.length === totalSaved ? "" : ` OF ${totalSaved}`;
  $("#sceneFilterCount").textContent =
    `${coreScenes.length} CORE / ${savedScenes.length}${savedSuffix} SAVED`;
}

export async function saveCurrentPreset() {
  const input = $("#presetName");
  const name = input.value.trim().toUpperCase();
  if (!name) {
    toast("Name the preset first.", true);
    input.focus();
    return;
  }

  const existing = state.library.scenes.find((preset) => preset.name === name);
  const effect = Object.hasOwn(effectPainters, state.animationName)
    ? state.animationName
    : null;
  const preset = createSceneSnapshot({
    name,
    effect,
    width: state.width,
    height: state.height,
    pixels: state.pixels,
    speed: Number(effectSpeed.value),
    intensity: Number(effectIntensity.value),
    brightness: Number(brightnessSlider.value),
    palette: state.palette,
    zone: state.zone,
    layers: { overlay: state.overlay },
    transition: state.transition,
    segments: state.segments,
    segmentTransform: state.segmentTransform,
    effectControls: state.effectControls,
  });
  const folder = $("#sceneFolder").value.trim();
  const tags = parseSceneTags($("#sceneTags").value);
  if (folder) preset.folder = folder;
  if (tags.length) preset.tags = tags;
  preset.favorite = $("#sceneFavorite").checked;
  if (existing) preset.id = existing.id;

  try {
    const response = await api("/api/scenes", {
      method: "POST",
      body: JSON.stringify(preset),
    });
    input.value = "";
    $("#sceneFolder").value = "";
    $("#sceneTags").value = "";
    $("#sceneFavorite").checked = false;
    await loadLibrary();
    const savedScene =
      sceneForId(response.scene?.id) ??
      state.library.scenes.find((scene) => scene.name === name);
    if (savedScene) {
      setOutputContext({
        kind: "scene",
        name: savedScene.name,
        sceneKey: `saved:${savedScene.id}`,
        scene: savedScene,
        source: "SAVED",
      });
    }
    toast(`Saved ${name} to the controller library.`);
  } catch (error) {
    toast(error.message, true);
  }
}

export function initializeSceneSaving() {
  $("#savePresetButton").addEventListener(
    "click",
    () => void saveCurrentPreset(),
  );
  $("#presetName").addEventListener("keydown", (event) => {
    if (event.key === "Enter") void saveCurrentPreset();
  });
}
