import { $, $$, brightnessSlider, canvas, stage } from "./dom.js";
import { ROTATION_STORAGE_KEY, state } from "./app_state.js";
import {
  api,
  scheduleFrame,
  setConnection,
  toast,
  waitForFrameSender,
} from "./net.js";
import { controllerMovieFps } from "./movie_model.js";
import { stopAnimation, stopMedia } from "./playback.js";
import { render } from "./render_core.js";
import { setOutputContext, updateBrightnessVisual } from "./monitor.js";
import { renderClipTimeline } from "./draw_tools.js";
import { queueEffectPreviewRender } from "./effects_ui.js";
import { renderSegmentStudio, renderZoneControls } from "./zones_segments.js";
import { shouldApplyStatus, statusOptionsForSource } from "./status_sync.js";
import { setUploadTargetFps } from "./frame_timing.js";
import { normalizeZone } from "./zone_model.js";
import { normalizeSegment, normalizeSegmentTransform } from "./segment_model.js";
import { normalizeStreamTelemetry, streamHealth } from "./stream_model.js";
import { mergeMovieDetails, outputPresentation, outputSignalPath } from "./output_model.js";
import type { ControllerStatus, MovieLibrary, StreamTelemetry } from "./types.js";

function liveFlagLabel(status: ControllerStatus): string {
  if (status.streaming) return " LIVE";
  if (status.mode === "movie" || status.mode === "demo") return " PANEL LOCAL";
  if (status.mode === "off") return " OFF";
  return " PREVIEW";
}

const STREAM_HEALTH_LABELS: Record<string, string> = {
  locked: "CLOCK LOCKED",
  warning: "CHECK TIMING",
  idle: "WAITING",
};

export function applyStatus(
  status: ControllerStatus,
  { syncBrightness = true }: { syncBrightness?: boolean } = {},
): void {
  status = mergeMovieDetails(status, state.movieLibrary.movies);
  state.controllerStatus = status;
  setConnection(status);
  const controllerVersion = status.controllerVersion;
  const controllerReadout = $("#controllerReadout");
  controllerReadout.textContent = controllerVersion
    ? `V${controllerVersion}`
    : "RESTART REQUIRED";
  controllerReadout.classList.toggle("warning", !controllerVersion);
  $("#dimmingReadout").textContent =
    status.brightnessControl === "realtime-rgb" ? "REALTIME RGB" : "DEVICE";
  if (!controllerVersion && !state.backendWarningShown) {
    state.backendWarningShown = true;
    toast("Controller restart required for rotation and live brightness.", true);
  }
  $("#resolutionReadout").textContent = `${status.width}×${status.height}`;
  $("#pixelReadout").textContent = String(status.ledCount);
  $("#fpsReadout").textContent = String(status.frameRate);
  $("#measuredFpsReadout").textContent =
    Number(status.measuredFrameRate ?? status.frameRate).toFixed(2);
  state.measuredFrameRate = Number(status.measuredFrameRate ?? status.frameRate);
  // Pace frame production just under the relay rate so every produced
  // frame ships; producing faster than the relay drops frames visibly.
  setUploadTargetFps(status.streamTargetFps ?? state.measuredFrameRate);
  updateStreamTelemetry(status.streamTelemetry);
  $("#firmwareReadout").textContent = `FW ${status.firmware}`;
  $("#routeReadout").textContent = status.ip;
  $("#modeReadout").textContent = status.streaming
    ? "LIVE"
    : status.mode.toUpperCase();
  // Frame-driven refreshes must not yank a slider the user is holding.
  const visibleBrightness = syncBrightness
    ? Number(status.brightness)
    : Number(brightnessSlider.value);
  brightnessSlider.value = String(visibleBrightness);
  updateBrightnessVisual(visibleBrightness);
  stage.classList.toggle("is-live", status.streaming);
  $("#liveFlag").lastChild!.textContent = liveFlagLabel(status);

  const rotation = Number(status.rotation ?? 0);
  state.rotation = rotation;
  // Track the panel's rotation in this browser's storage so a second tab
  // never "syncs" a stale value back and silently reverts a change.
  saveRotation(rotation);
  $$("[data-rotation]").forEach((button) => {
    const active = Number(button.dataset.rotation) === rotation;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  if (status.width !== state.width || status.height !== state.height) {
    state.width = status.width;
    state.height = status.height;
    state.pixels = new Uint8Array(status.width * status.height * 3);
    canvas.width = status.width * 30;
    canvas.height = status.height * 30;
    canvas.style.aspectRatio = `${status.width} / ${status.height}`;
    canvas.setAttribute(
      "aria-label",
      `Interactive ${status.width} by ${status.height} LED canvas`,
    );
    state.zone = normalizeZone(state.zone, status.width, status.height);
    state.segmentTransform = normalizeSegmentTransform(
      state.segmentTransform,
      status.width * status.height,
    );
    state.segments = state.segments.map((segment, index) =>
      normalizeSegment(segment, status.width, status.height, `segment-${index + 1}`),
    );
    state.clip = { frames: [], selected: -1 };
    renderZoneControls();
    renderSegmentStudio();
    renderClipTimeline();
    queueEffectPreviewRender();
    render();
  }

  setOutputContext(outputPresentation(status, state.outputContext));
  updateOutputSignal(status);
}

export function updateOutputSignal(status: ControllerStatus): void {
  const signal = outputSignalPath({
    ...status,
    streamTelemetry: state.streamTelemetry,
  });
  const panel = $("#outputSignal");
  if (!panel) return;
  panel.dataset.mode = signal.mode;
  $("#outputSignalHeadline").textContent = signal.headline;
  signal.nodes.forEach((node, index) => {
    const element = $(`[data-signal-node="${index}"]`);
    element.dataset.state = node.state;
    element.querySelector("small")!.textContent = node.label;
    element.querySelector("strong")!.textContent = node.value;
  });
  $("#outputSignalNote").textContent = signal.note;
}

export function updateStreamTelemetry(raw: unknown): void {
  const telemetry = normalizeStreamTelemetry(raw);
  state.streamTelemetry = telemetry;
  $("#relayFpsReadout").textContent =
    telemetry.actualFps ? telemetry.actualFps.toFixed(2) : "—";
  const health = streamHealth(telemetry);
  const panel = $("#streamDiagnostics");
  panel.dataset.health = health;
  $("#streamHealthReadout").textContent =
    STREAM_HEALTH_LABELS[health] ?? "WAITING";
  $("#streamActualReadout").textContent =
    telemetry.actualFps ? `${telemetry.actualFps.toFixed(2)} FPS` : "—";
  $("#streamTargetReadout").textContent =
    `${telemetry.targetFps.toFixed(2)} FPS`;
  $("#streamUniqueReadout").textContent =
    telemetry.uniqueFrames.toLocaleString();
  $("#streamRepeatReadout").textContent =
    telemetry.repeatedFrames.toLocaleString();
  // Fresh-frame gaps, not raw send gaps: idle keepalive repeats would
  // otherwise read as 500 ms "stutter" while the wall holds a still frame.
  $("#streamGapReadout").textContent =
    telemetry.p95UniqueGapMs ? `${telemetry.p95UniqueGapMs.toFixed(2)} ms` : "—";
  $("#streamMissedReadout").textContent =
    telemetry.missedDeadlines.toLocaleString();
  if (state.controllerStatus) {
    state.controllerStatus = {
      ...state.controllerStatus,
      streamTelemetry: telemetry,
    };
    updateOutputSignal(state.controllerStatus);
  }
}

export async function loadStreamTelemetry(): Promise<void> {
  if (!state.connected) return;
  const response = await api<{
    streamTelemetry?: Partial<StreamTelemetry> | null;
  }>("/api/telemetry");
  updateStreamTelemetry(response.streamTelemetry);
}

// Selection changes what the panel plays, so overlapping requests race:
// an older one can land last and leave the wall playing something the
// UI is not showing. Ignoring the statusEpoch is not enough — that only
// discards the stale *response*. One at a time is the honest fix.
let movieSelectionInFlight = false;

export async function playStoredMovie(movieId: number): Promise<void> {
  if (movieSelectionInFlight) return;
  movieSelectionInFlight = true;
  const list = $("#panelMovieList");
  list.classList.add("busy");
  const epoch = beginUserAction();
  try {
    const status = await api<ControllerStatus>("/api/movies/select", {
      method: "POST",
      body: JSON.stringify({ id: movieId }),
    });
    applyIfCurrent(epoch, status);
    await loadMovies();
    toast(`Playing ${status.currentMovie?.name ?? "panel movie"}.`);
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    movieSelectionInFlight = false;
    list.classList.remove("busy");
  }
}

// Panel-stored movies play from the controller's own clock with no
// network in the loop, so they are the smooth path; listing them lets
// any stored look be recalled, not only the one just baked.
function renderPanelMovies(library: MovieLibrary): void {
  const list = $("#panelMovieList");
  // The rebuild destroys the button the user just activated; remember
  // which one held focus so keyboard users are not dropped to <body>.
  const focusedId =
    document.activeElement instanceof HTMLElement
      ? document.activeElement.dataset["movieId"]
      : undefined;
  list.replaceChildren();
  const currentId = state.controllerStatus?.currentMovie?.id;
  library.movies.forEach((movie) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "panel-movie";
    button.dataset["movieId"] = String(movie.id);
    const playing =
      movie.id === currentId && state.controllerStatus?.mode === "movie";
    button.classList.toggle("active", playing);
    button.setAttribute("aria-pressed", String(playing));
    button.setAttribute("aria-label", `Play ${movie.name} on the panel`);
    const name = document.createElement("strong");
    name.textContent = movie.name;
    const detail = document.createElement("small");
    detail.textContent = `${movie.frames_number ?? "?"}F / ${movie.fps ?? "?"}FPS`;
    button.append(name, detail);
    button.addEventListener("click", () => void playStoredMovie(movie.id));
    list.append(button);
    if (focusedId === String(movie.id)) button.focus();
  });
}

export async function loadMovies(): Promise<MovieLibrary> {
  const library = await api<MovieLibrary>("/api/movies");
  state.movieLibrary = library;
  const used = Math.max(0, library.maxCapacity - library.availableFrames);
  const free = Math.max(0, library.availableFrames);
  // Free space is what decides whether the next bake fits, so lead with
  // it; the used/total pair stays for context. The duration estimate
  // uses the same helper the bake flow uses, so the two never disagree
  // about what rate a movie will store at.
  const bakeFps = controllerMovieFps(
    Number(state.controllerStatus?.measuredFrameRate),
  );
  const seconds = Math.floor(free / bakeFps);
  $("#movieCapacityReadout").textContent =
    `${free} FRAMES FREE / ~${seconds}s · ${used} OF ${library.maxCapacity} USED`;
  renderPanelMovies(library);
  const currentId = state.controllerStatus?.currentMovie?.id;
  const currentMovie = library.movies.find((movie) => movie.id === currentId);
  if (currentMovie && state.controllerStatus?.mode === "movie") {
    applyStatus(
      {
        ...state.controllerStatus,
        currentMovie: {
          ...state.controllerStatus.currentMovie,
          ...currentMovie,
        },
      },
      { syncBrightness: false },
    );
  }
  return library;
}

function readSavedRotation(): number | null {
  // null means "no stored choice": a fresh browser must adopt the
  // panel's rotation instead of resetting it to 0.
  try {
    const raw = localStorage.getItem(ROTATION_STORAGE_KEY);
    if (raw === null) return null;
    const rotation = Number(raw);
    return [0, 90, 180, 270].includes(rotation) ? rotation : null;
  } catch {
    return null;
  }
}

function saveRotation(rotation: number): void {
  try {
    localStorage.setItem(ROTATION_STORAGE_KEY, String(rotation));
  } catch {
    // Rotation still works when browser storage is disabled.
  }
}

// A response that started before the user's latest controller action must
// not overwrite the newer state when it finally lands.
function beginUserAction(): number {
  state.statusEpoch += 1;
  return state.statusEpoch;
}

function applyIfCurrent(
  epoch: number,
  status: ControllerStatus,
  options?: { syncBrightness?: boolean },
): void {
  if (epoch === state.statusEpoch) applyStatus(status, options);
}

export async function loadStatus(): Promise<void> {
  const epoch = state.statusEpoch;
  try {
    let status = await api<ControllerStatus>("/api/status");
    const savedRotation = readSavedRotation();
    if (
      savedRotation !== null &&
      Object.hasOwn(status, "rotation") &&
      savedRotation !== status.rotation
    ) {
      status = await api<ControllerStatus>("/api/rotation", {
        method: "POST",
        body: JSON.stringify({ degrees: savedRotation }),
      });
    }
    applyIfCurrent(epoch, status);
  } catch (error) {
    const message = (error as Error).message;
    setConnection(null, message);
    toast(message, true);
  }
}

// A quiet variant for background reconnect probing: no toasts, no
// rotation sync — just apply the status if the controller answers.
export async function probeStatus(): Promise<void> {
  const epoch = state.statusEpoch;
  try {
    const status = await api<ControllerStatus>("/api/status");
    applyIfCurrent(epoch, status);
  } catch {
    // Still unreachable; the reconnect loop keeps backing off.
  }
}

export function startStateSync(): void {
  if (!("EventSource" in window) || state.stateEvents) return;
  const stateEvents = new EventSource("/api/events");
  stateEvents.addEventListener("state", (event) => {
    try {
      // SSE payload invariant: the server always includes a full status.
      const message = JSON.parse((event as MessageEvent<string>).data) as {
        source?: string;
        status: ControllerStatus;
      };
      if (
        !shouldApplyStatus(
          message.source,
          state.controllerStatus,
          message.status,
        )
      ) return;
      applyStatus(
        message.status,
        statusOptionsForSource(message.source),
      );
    } catch {
      // The periodic status refresh remains available as a safe fallback.
    }
  });
  state.stateEvents = stateEvents;
}

export async function sendBrightness(value: number | string): Promise<void> {
  brightnessSlider.value = String(value);
  updateBrightnessVisual(Number(value));
  if (!state.connected) return;
  const epoch = beginUserAction();
  const status = await api<ControllerStatus>("/api/brightness", {
    method: "POST",
    body: JSON.stringify({ value: Number(value) }),
  });
  applyIfCurrent(epoch, status);
}

async function setMode(
  mode: string,
  sourceButton: HTMLButtonElement | null = null,
): Promise<void> {
  stopMedia();
  stopAnimation();
  const buttons = [
    $<HTMLButtonElement>("#offButton"),
    $<HTMLButtonElement>("#stockButton"),
  ];
  const originalLabel = sourceButton?.textContent;
  buttons.forEach((button) => {
    button.disabled = true;
  });
  if (sourceButton) sourceButton.textContent = "SWITCHING…";
  const epoch = beginUserAction();
  try {
    // A frame upload already in flight could land mid-transition and
    // restart the realtime stream; drain the sender first.
    await waitForFrameSender();
    const status = await api<ControllerStatus>("/api/mode", {
      method: "POST",
      body: JSON.stringify({ mode }),
    });
    applyIfCurrent(epoch, status);
    toast(mode === "off" ? "Panel switched off." : "Stock Twinkly animation restored.");
  } catch (error) {
    toast((error as Error).message, true);
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
    });
    if (sourceButton && originalLabel) sourceButton.textContent = originalLabel;
  }
}

export function initializeStatusControls(): void {
  let brightnessTimer: ReturnType<typeof setTimeout> | null = null;
  brightnessSlider.addEventListener("input", () => {
    const requestedBrightness = brightnessSlider.value;
    updateBrightnessVisual(Number(requestedBrightness));
    if (brightnessTimer !== null) clearTimeout(brightnessTimer);
    brightnessTimer = setTimeout(async () => {
      const epoch = beginUserAction();
      try {
        const status = await api<ControllerStatus>("/api/brightness", {
          method: "POST",
          body: JSON.stringify({ value: Number(requestedBrightness) }),
        });
        applyIfCurrent(epoch, status);
      } catch (error) {
        toast((error as Error).message, true);
      }
    }, 120);
  });

  $<HTMLButtonElement>("#offButton").addEventListener("click", (event) =>
    void setMode("off", event.currentTarget as HTMLButtonElement),
  );
  $<HTMLButtonElement>("#stockButton").addEventListener("click", (event) =>
    void setMode("movie", event.currentTarget as HTMLButtonElement),
  );
  $("#stopMotionButton").addEventListener("click", () => stopAnimation(true));

  $$("[data-rotation]").forEach((button) => {
    button.addEventListener("click", async () => {
      const degrees = Number(button.dataset.rotation);
      if (degrees === state.rotation) return;
      stopMedia();
      stopAnimation();
      state.frameQueued = false;
      const epoch = beginUserAction();
      try {
        const status = await api<ControllerStatus>("/api/rotation", {
          method: "POST",
          body: JSON.stringify({ degrees }),
        });
        saveRotation(degrees);
        applyIfCurrent(epoch, status);
        state.pixels.fill(0);
        render();
        scheduleFrame();
        toast(`Display rotated to ${degrees}°.`);
      } catch (error) {
        toast((error as Error).message, true);
      }
    });
  });
}
