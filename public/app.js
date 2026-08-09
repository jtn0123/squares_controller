// Composition root: wires every feature module together and boots the app.
// All logic lives in the feature modules; this file only sequences them.
import { state } from "./app_state.js";
import { onConnectionLost } from "./net.js";
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
import { initializePlaylists, renderPlaylistDraft } from "./playlists.js";
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

void loadStatus().then(() => {
  void loadMovies().catch(() => {
    $("#movieCapacityReadout").textContent = "STORAGE UNAVAILABLE";
  });
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
