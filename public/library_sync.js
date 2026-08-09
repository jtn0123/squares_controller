import { $ } from "./dom.js";
import { PRESET_MIGRATION_KEY, PRESET_STORAGE_KEY, state } from "./app_state.js";
import { api, toast } from "./net.js";
import { renderPaletteOptions, renderPaletteWorkshop } from "./palettes.js";
import { updateLayerControls } from "./zones_segments.js";
import { readSavedPresets, renderPresets, sceneForId } from "./scenes.js";
import {
  populatePlaylistSceneSelect,
  renderPlaylistDraft,
  renderPlaylists,
} from "./playlists.js";
import { normalizeLibrary, sceneFolders } from "./library_model.js";

export async function loadLibrary() {
  const library = normalizeLibrary(await api("/api/library"));
  state.library = library;
  renderPaletteOptions();
  renderPaletteWorkshop();
  updateLayerControls();
  state.playlistDraft = state.playlistDraft.filter((step) => sceneForId(step.sceneId));
  updateSceneFolderFilter();
  renderPresets();
  populatePlaylistSceneSelect();
  renderPlaylistDraft();
  renderPlaylists();
}

function updateSceneFolderFilter() {
  const select = $("#sceneFolderFilter");
  const folders = sceneFolders(state.library.scenes);
  const selected = folders.includes(state.sceneFilters.folder)
    ? state.sceneFilters.folder
    : "ALL";
  select.replaceChildren();
  const all = document.createElement("option");
  all.value = "ALL";
  all.textContent = "ALL FOLDERS";
  select.append(all);
  folders.forEach((folder) => {
    const option = document.createElement("option");
    option.value = folder;
    option.textContent = folder;
    select.append(option);
  });
  select.value = selected;
  state.sceneFilters.folder = selected;
}

async function migrateBrowserPresets() {
  let alreadyMigrated = false;
  try {
    alreadyMigrated = localStorage.getItem(PRESET_MIGRATION_KEY) === "done";
  } catch {
    return;
  }
  if (alreadyMigrated) return;

  const browserPresets = readSavedPresets();
  try {
    for (const preset of browserPresets) {
      const portablePreset = { ...preset };
      delete portablePreset.id;
      await api("/api/scenes", {
        method: "POST",
        body: JSON.stringify(portablePreset),
      });
    }
    localStorage.removeItem(PRESET_STORAGE_KEY);
    localStorage.setItem(PRESET_MIGRATION_KEY, "done");
    if (browserPresets.length) {
      toast(`Migrated ${browserPresets.length} browser preset${browserPresets.length === 1 ? "" : "s"}.`);
    }
  } catch (error) {
    toast(`Preset migration paused: ${error.message}`, true);
  }
}

export function initializeSceneOrganizer() {
  $("#sceneSearch").addEventListener("input", (event) => {
    state.sceneFilters.query = event.target.value;
    renderPresets();
  });
  $("#sceneFolderFilter").addEventListener("change", (event) => {
    state.sceneFilters.folder = event.target.value;
    renderPresets();
  });
  $("#sceneFavoritesFilter").addEventListener("click", (event) => {
    state.sceneFilters.favoritesOnly = !state.sceneFilters.favoritesOnly;
    event.currentTarget.setAttribute(
      "aria-pressed",
      String(state.sceneFilters.favoritesOnly),
    );
    event.currentTarget.textContent = state.sceneFilters.favoritesOnly
      ? "★ FAVORITES"
      : "☆ FAVORITES";
    renderPresets();
  });
}

export function initializeLibraryTransfer() {
  $("#exportLibraryButton").addEventListener("click", async () => {
    try {
      const library = await api("/api/library/export");
      const blob = new Blob([`${JSON.stringify(library, null, 2)}\n`], {
        type: "application/json",
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `squares-library-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
      toast("Library backup exported.");
    } catch (error) {
      toast(error.message, true);
    }
  });

  $("#importLibraryInput").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    try {
      const merge = $("#importLibraryMode").value === "merge";
      if (
        !merge &&
        !window.confirm(
          "Replace every saved scene, playlist, and palette with this backup?",
        )
      ) {
        return;
      }
      const library = JSON.parse(await file.text());
      await api("/api/library/import", {
        method: "POST",
        body: JSON.stringify({ library, merge }),
      });
      await loadLibrary();
      toast(`${merge ? "Merged" : "Restored"} ${file.name}.`);
    } catch (error) {
      toast(error.message, true);
    } finally {
      event.target.value = "";
    }
  });
}

export async function initializeLibrary() {
  try {
    await migrateBrowserPresets();
    await loadLibrary();
  } catch (error) {
    toast(`Scene library unavailable: ${error.message}`, true);
    renderPresets();
  }
}
