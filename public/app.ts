// Composition root: wires every feature module together and boots the app.
// All logic lives in the feature modules; this file only sequences them.
import { state } from "./app_state.js";
import {
  noteUserGesture,
  onConnectionLost,
  onControlLost,
  toast,
} from "./net.js";
import { stopAnimation, stopMedia } from "./playback.js";
import { render } from "./render_core.js";
import { updateSceneMonitor } from "./monitor.js";
import {
  initializeEffectCatalog,
  initializeModulation,
  updateModulationVisuals,
} from "./effects_ui.js";
import { initializePalettes } from "./palettes.js";
import {
  initializeLayers,
  initializeSegments,
  initializeTransitions,
  initializeZones,
} from "./zones_segments.js";
import { initializeClipStudio, initializeDrawTools } from "./draw_tools.js";
import { initializeMediaControls } from "./media_input.js";
import { initializeLiveInputs } from "./live_audio.js";
import { initializeTextStudio } from "./text_studio.js";
import { initializeSceneSaving, renderPresets } from "./scenes.js";
import {
  initializePlaylists,
  renderPlaylistDraft,
  stopPlaylist,
} from "./playlists.js";
import { initializeMovieBaking } from "./movies_bake.js";
import {
  initializeAutomations,
  initializeRuntimePolicy,
  loadAutomations,
} from "./schedule_policy.js";
import {
  initializeLibrary,
  initializeLibraryTransfer,
  initializeSceneOrganizer,
} from "./library_sync.js";
import {
  initializeStatusControls,
  loadMovies,
  loadStatus,
  loadStreamTelemetry,
  probeStatus,
  startStateSync,
} from "./status_view.js";
import { $ } from "./dom.js";

render();
updateSceneMonitor();
updateModulationVisuals();
initializeModulation();
initializeEffectCatalog();
initializePalettes();
initializeDrawTools();
initializeClipStudio();
initializeZones();
initializeSegments();
initializeLayers();
initializeTransitions();
initializeMediaControls();
initializeLiveInputs();
initializeTextStudio();
initializeAutomations();
initializeRuntimePolicy();
initializeSceneOrganizer();
initializeSceneSaving();
initializePlaylists();
initializeMovieBaking();
initializeLibraryTransfer();
initializeStatusControls();
renderPresets();
renderPlaylistDraft();

// When frame uploads start failing, net.js probes quietly until the
// controller answers again.
onConnectionLost(probeStatus);

// Only one tab may drive the wall. Clicks and keypresses mark this tab as
// the human's choice (its frames carry a takeover claim); when another tab
// wins instead, stop every producer loop here rather than fight it.
document.addEventListener("pointerdown", noteUserGesture, {
  capture: true,
  passive: true,
});
document.addEventListener("keydown", noteUserGesture, {
  capture: true,
  passive: true,
});
onControlLost(() => {
  stopPlaylist();
  stopMedia();
  stopAnimation();
  toast("Another tab took the wall. Click any effect to take it back.", true);
});

void initializeLibrary();
startStateSync();
setInterval(() => {
  // probeStatus (not loadStatus): the periodic refresh must never
  // re-assert this tab's saved rotation over another client's change.
  if (!state.animationName) void probeStatus();
  void loadAutomations().catch(() => {});
}, 60_000);
setInterval(() => void loadStreamTelemetry().catch(() => {}), 2_000);

// Boot status last so every listener above is wired before the first
// payload lands; movie capacity is cosmetic and may fail on its own.
await loadStatus();
try {
  await loadMovies();
} catch {
  $("#movieCapacityReadout").textContent = "STORAGE UNAVAILABLE";
}
