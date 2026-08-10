import { $ } from "./dom.js";
import { state } from "./app_state.js";
import { api, toast } from "./net.js";
import { updateSceneMonitor } from "./monitor.js";
import { loadPreset } from "./scene_apply.js";
import { sceneForId } from "./scenes.js";
import { loadLibrary } from "./library_sync.js";
import { advancePlaylist } from "./library_model.js";
import type { PlaylistItem, TransitionType } from "./types.js";

export function populatePlaylistSceneSelect(): void {
  const select = $<HTMLSelectElement>("#playlistSceneSelect");
  select.replaceChildren();
  if (!state.library.scenes.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "SAVE A SCENE FIRST";
    select.append(option);
    select.disabled = true;
    return;
  }
  select.disabled = false;
  state.library.scenes.forEach((scene) => {
    const option = document.createElement("option");
    // Library scenes always carry a server-assigned id.
    option.value = scene.id!;
    option.textContent = scene.name;
    select.append(option);
  });
}

export function renderPlaylistDraft(): void {
  const draft = $("#playlistDraft");
  draft.replaceChildren();
  if (!state.playlistDraft.length) {
    const empty = document.createElement("small");
    empty.textContent = "ADD SAVED SCENES TO BUILD A TIMED RUN.";
    draft.append(empty);
    return;
  }
  state.playlistDraft.forEach((step, index) => {
    const scene = sceneForId(step.sceneId);
    const row = document.createElement("div");
    row.className = "playlist-draft-row";
    const order = document.createElement("b");
    order.textContent = String(index + 1).padStart(2, "0");
    const name = document.createElement("span");
    name.textContent = scene?.name ?? "MISSING SCENE";
    const duration = document.createElement("small");
    duration.textContent = `${step.duration}s / ${step.transition.toUpperCase()}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${name.textContent}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      state.playlistDraft.splice(index, 1);
      renderPlaylistDraft();
    });
    row.append(order, name, duration, remove);
    draft.append(row);
  });
}

// Increments on every stop/start; a step chain that awaited across a
// restart of the same playlist sees a stale run and exits.
let playlistRun = 0;

export function stopPlaylist(showNotice = false): void {
  playlistRun += 1;
  if (state.playlistTimer !== null) clearTimeout(state.playlistTimer);
  if (state.playlistProgressTimer !== null) {
    clearInterval(state.playlistProgressTimer);
  }
  state.playlistTimer = null;
  state.playlistProgressTimer = null;
  const wasRunning = Boolean(state.activePlaylistId);
  state.activePlaylistId = null;
  state.activePlaylistStep = null;
  renderPlaylists();
  updateSceneMonitor();
  if (showNotice && wasRunning) toast("Playlist stopped.");
}

async function runPlaylistStep(playlist: PlaylistItem, index: number): Promise<void> {
  const run = playlistRun;
  if (state.activePlaylistId !== playlist.id) return;
  const step = playlist.steps[index];
  const scene = sceneForId(step.sceneId);
  if (!scene) {
    stopPlaylist();
    toast("A playlist scene is missing.", true);
    return;
  }
  const loaded = await loadPreset(scene, {
    sceneKey: `saved:${scene.id}`,
    source: "PLAYLIST",
    transition: {
      type: step.transition,
      duration: state.transition.duration,
    },
  });
  if (!loaded || run !== playlistRun) return;
  if (state.activePlaylistId !== playlist.id) return;
  state.activePlaylistStep = {
    index,
    startedAt: Date.now(),
    duration: step.duration,
    transition: step.transition,
  };
  updateSceneMonitor();
  state.playlistTimer = setTimeout(() => {
    if (run !== playlistRun) return;
    const next = advancePlaylist(index, playlist.steps.length, playlist.repeat);
    if (next.done) {
      stopPlaylist();
      toast(`${playlist.name} finished.`);
      return;
    }
    void runPlaylistStep(playlist, next.index);
  }, step.duration * 1000);
}

function playPlaylist(playlist: PlaylistItem): void {
  stopPlaylist();
  state.activePlaylistId = playlist.id;
  state.playlistProgressTimer = setInterval(updateSceneMonitor, 250);
  renderPlaylists();
  updateSceneMonitor();
  toast(`Running ${playlist.name}.`);
  void runPlaylistStep(playlist, 0);
}

export function renderPlaylists(): void {
  const list = $("#playlistList");
  list.replaceChildren();
  state.library.playlists.forEach((playlist) => {
    const row = document.createElement("div");
    row.className = "playlist-row";
    row.classList.toggle("active", state.activePlaylistId === playlist.id);
    const play = document.createElement("button");
    play.type = "button";
    const name = document.createElement("span");
    name.textContent = playlist.name;
    const details = document.createElement("small");
    details.textContent = `${playlist.steps.length} STEP${playlist.steps.length === 1 ? "" : "S"}${playlist.repeat ? " / LOOP" : ""}`;
    play.append(name, details);
    play.addEventListener("click", () => playPlaylist(playlist));
    const runtime = document.createElement("small");
    const seconds = playlist.steps.reduce((total, step) => total + step.duration, 0);
    runtime.textContent = `${seconds}s`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", `Delete ${playlist.name}`);
    remove.textContent = "×";
    remove.addEventListener("click", async () => {
      try {
        if (state.activePlaylistId === playlist.id) stopPlaylist();
        await api(`/api/playlists/${encodeURIComponent(playlist.id)}`, {
          method: "DELETE",
        });
        await loadLibrary();
        toast(`Deleted ${playlist.name}.`);
      } catch (error) {
        toast((error as Error).message, true);
      }
    });
    row.append(play, runtime, remove);
    list.append(row);
  });
}

export function initializePlaylists(): void {
  $("#addPlaylistStepButton").addEventListener("click", () => {
    const sceneId = $<HTMLSelectElement>("#playlistSceneSelect").value;
    const duration = Number($<HTMLInputElement>("#playlistDuration").value);
    if (!sceneForId(sceneId)) {
      toast("Save a scene before building a playlist.", true);
      return;
    }
    if (!Number.isFinite(duration) || duration < 1 || duration > 86_400) {
      toast("Step time must be from 1 to 86400 seconds.", true);
      return;
    }
    state.playlistDraft.push({
      sceneId,
      duration,
      // The select's options enumerate exactly the TransitionType values.
      transition: $<HTMLSelectElement>("#playlistTransition").value as TransitionType,
    });
    renderPlaylistDraft();
  });

  $("#savePlaylistButton").addEventListener("click", async () => {
    const nameInput = $<HTMLInputElement>("#playlistName");
    const name = nameInput.value.trim().toUpperCase();
    if (!name || !state.playlistDraft.length) {
      toast("Name the playlist and add at least one step.", true);
      return;
    }
    const existing = state.library.playlists.find((playlist) => playlist.name === name);
    try {
      await api("/api/playlists", {
        method: "POST",
        body: JSON.stringify({
          ...(existing ? { id: existing.id } : {}),
          name,
          repeat: $<HTMLInputElement>("#playlistRepeat").checked,
          steps: state.playlistDraft,
        }),
      });
      nameInput.value = "";
      state.playlistDraft = [];
      await loadLibrary();
      toast(`Saved ${name}.`);
    } catch (error) {
      toast((error as Error).message, true);
    }
  });

  $("#stopPlaylistButton").addEventListener("click", () => stopPlaylist(true));
}
