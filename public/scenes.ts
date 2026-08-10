// Scene browser UI and scene saving. The engine that actually applies a
// scene to the wall (environment restore + transition) is scene_apply.ts.
import { $, brightnessSlider, effectIntensity, effectSpeed } from "./dom.js";
import {
  builtInPresets,
  MAX_SAVED_PRESETS,
  PRESET_STORAGE_KEY,
  state,
} from "./app_state.js";
import { api, toast } from "./net.js";
import { drawRgbCanvas, invalidateSceneMirror } from "./render_core.js";
import {
  sceneKey,
  scenePreviewPixels,
  sceneRowLabel,
  setOutputContext,
} from "./monitor.js";
import { effectPainters } from "./effect_painters.js";
import { loadPreset } from "./scene_apply.js";
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
import type { SceneSnapshot } from "./types.js";

export function sceneForId(sceneId: string | undefined): SceneSnapshot | undefined {
  return state.library.scenes.find((scene) => scene.id === sceneId);
}

export function readSavedPresets(): SceneSnapshot[] {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(PRESET_STORAGE_KEY) ?? "[]",
    );
    // Legacy browser presets were persisted as full snapshots; only their
    // identity fields are re-verified here.
    return Array.isArray(parsed)
      ? ((parsed as Partial<SceneSnapshot>[])
          .filter(
            (preset) =>
              preset &&
              typeof preset === "object" &&
              typeof preset.id === "string" &&
              typeof preset.name === "string",
          )
          .slice(0, MAX_SAVED_PRESETS) as SceneSnapshot[])
      : [];
  } catch {
    return [];
  }
}

async function upsertOrganizedScene(
  scene: SceneSnapshot,
  successMessage: string,
): Promise<void> {
  await api("/api/scenes", {
    method: "POST",
    body: JSON.stringify(scene),
  });
  await loadLibrary();
  toast(successMessage);
}

function createPresetTool(
  label: string,
  text: string,
  { active = false, danger = false }: { active?: boolean; danger?: boolean } = {},
): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "preset-tool";
  button.classList.toggle("active", active);
  button.classList.toggle("danger", danger);
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.textContent = text;
  return button;
}

function createPresetRow(preset: SceneSnapshot, saved = false): HTMLDivElement {
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
        toast((error as Error).message, true);
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
        toast((error as Error).message, true);
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
        // Saved scenes always carry a server-assigned id.
        await api(`/api/scenes/${encodeURIComponent(preset.id!)}`, {
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
        toast((error as Error).message, true);
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
        toast((error as Error).message, true);
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

export function renderPresets(): void {
  const presetList = $("#presetList");
  presetList.replaceChildren();
  const showCore =
    state.sceneFilters.folder === "ALL" &&
    !state.sceneFilters.favoritesOnly;
  // Built-in presets omit width/height/pixels but always carry a runnable
  // effect, so the scene frame path never reads those fields.
  const coreScenes = showCore
    ? filterScenes(builtInPresets as unknown as SceneSnapshot[], {
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

export async function saveCurrentPreset(): Promise<void> {
  const input = $<HTMLInputElement>("#presetName");
  const name = input.value.trim().toUpperCase();
  if (!name) {
    toast("Name the preset first.", true);
    input.focus();
    return;
  }

  const existing = state.library.scenes.find((preset) => preset.name === name);
  const effect =
    state.animationName !== null &&
    Object.hasOwn(effectPainters, state.animationName)
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
  const folder = $<HTMLInputElement>("#sceneFolder").value.trim();
  const tags = parseSceneTags($<HTMLInputElement>("#sceneTags").value);
  if (folder) preset.folder = folder;
  if (tags.length) preset.tags = tags;
  preset.favorite = $<HTMLInputElement>("#sceneFavorite").checked;
  if (existing) preset.id = existing.id;

  try {
    const response = await api<{ scene?: SceneSnapshot }>("/api/scenes", {
      method: "POST",
      body: JSON.stringify(preset),
    });
    input.value = "";
    $<HTMLInputElement>("#sceneFolder").value = "";
    $<HTMLInputElement>("#sceneTags").value = "";
    $<HTMLInputElement>("#sceneFavorite").checked = false;
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
    toast((error as Error).message, true);
  }
}

export function initializeSceneSaving(): void {
  $("#savePresetButton").addEventListener(
    "click",
    () => void saveCurrentPreset(),
  );
  $("#presetName").addEventListener("keydown", (event) => {
    if (event.key === "Enter") void saveCurrentPreset();
  });
}
