import {
  brightnessFromStatus,
  statusOptionsForSource,
} from "./status_sync.js";
import {
  advancePlaylist,
  createSceneSnapshot,
  normalizeLibrary,
  playlistStepProgress,
} from "./library_model.js";
import {
  CURATED_PALETTES,
  normalizePalette,
  sampleGradient,
} from "./palette_model.js";
import {
  describeZone,
  normalizeZone,
  panelGrid,
  zoneBounds,
  zoneContains,
} from "./zone_model.js";
import {
  BLEND_MODES,
  blendRgb,
  normalizeLayer,
} from "./blend_model.js";
import {
  normalizeTransition,
  transitionFrame,
} from "./transition_model.js";
import {
  EFFECT_CATALOG,
  effectById,
  hashUnit,
} from "./effect_catalog.js";
import {
  adjustRgb,
  fitRect,
  normalizeMediaControls,
} from "./media_model.js";
import {
  buildSleepAutomation,
  daysForPreset,
  describeAutomation,
  localDateTime,
} from "./automation_model.js";

const canvas = document.querySelector("#pixelCanvas");
const context = canvas.getContext("2d", { alpha: false });
const sceneMonitorCanvas = document.querySelector("#sceneMonitorCanvas");
const mediaCanvas = document.createElement("canvas");
const mediaContext = mediaCanvas.getContext("2d", { alpha: false });
const stage = document.querySelector(".stage-frame");
const colorPicker = document.querySelector("#colorPicker");
const colorValue = document.querySelector("#colorValue");
const brightnessSlider = document.querySelector("#brightnessSlider");
const brightnessValue = document.querySelector("#brightnessValue");
const effectSpeed = document.querySelector("#effectSpeed");
const effectIntensity = document.querySelector("#effectIntensity");
const toastElement = document.querySelector("#toast");
const PRESET_STORAGE_KEY = "squares-controller.presets.v1";
const PRESET_MIGRATION_KEY = "squares-controller.presets-migrated.v1";
const ROTATION_STORAGE_KEY = "squares-controller.rotation.v1";
const MAX_SAVED_PRESETS = 12;
const FONT_STACKS = {
  condensed: '"Avenir Next Condensed", "Arial Narrow", sans-serif',
  pixel: '"Courier New", ui-monospace, monospace',
  serif: 'Georgia, "Times New Roman", serif',
};

const builtInPresets = [
  { id: "aurora", name: "AURORA DRIFT", effect: "tide", speed: 74, intensity: 70, brightness: 28 },
  { id: "signal", name: "SIGNAL SWEEP", effect: "radar", speed: 110, intensity: 58, brightness: 24 },
  { id: "hearth", name: "WARM HEARTH", effect: "ember", speed: 52, intensity: 55, brightness: 20 },
  { id: "orbit", name: "SLOW ORBIT", effect: "orbit", speed: 42, intensity: 72, brightness: 26 },
];

const state = {
  width: 32,
  height: 24,
  pixels: new Uint8Array(32 * 24 * 3),
  brush: 1,
  erasing: false,
  drawing: false,
  connected: false,
  animationFrame: null,
  animationName: null,
  frameQueued: false,
  frameSending: false,
  lastSentAt: 0,
  toastTimer: null,
  effectSpeed: 1,
  effectIntensity: 0.75,
  rotation: 0,
  backendWarningShown: false,
  stateEvents: null,
  library: { scenes: [], playlists: [] },
  playlistDraft: [],
  playlistTimer: null,
  playlistProgressTimer: null,
  activePlaylistId: null,
  activePlaylistStep: null,
  outputContext: {
    kind: "canvas",
    name: "CURRENT CANVAS",
    sceneKey: null,
    scene: null,
  },
  palette: normalizePalette(null),
  zone: { type: "all" },
  overlay: normalizeLayer({
    enabled: false,
    effect: "orbit",
    blend: "screen",
    opacity: 55,
    paletteId: "candy",
  }),
  transition: normalizeTransition({ type: "crossfade", duration: 800 }),
  transitionToken: 0,
  mediaElement: null,
  mediaFrame: null,
  mediaUrl: null,
  mediaLastFrame: 0,
  textFont: FONT_STACKS.condensed,
  textSize: 13,
  textDirection: "left",
  automations: [],
};

function toast(message, error = false) {
  toastElement.textContent = message;
  toastElement.classList.toggle("error", error);
  toastElement.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toastElement.classList.remove("show"), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `Request failed: ${response.status}`);
  return data;
}

function setConnection(status, errorMessage = "") {
  const badge = document.querySelector("#connectionBadge");
  const label = document.querySelector("#connectionLabel");
  const detail = document.querySelector("#connectionDetail");
  badge.dataset.state = status ? "online" : "error";
  label.textContent = status ? "PANEL ONLINE" : "PANEL UNREACHABLE";
  detail.textContent = status ? `${status.ip} / ${status.mode.toUpperCase()}` : errorMessage;
  state.connected = Boolean(status);
}

function applyStatus(status, { syncBrightness = true } = {}) {
  setConnection(status);
  const controllerVersion = status.controllerVersion;
  const controllerReadout = document.querySelector("#controllerReadout");
  controllerReadout.textContent = controllerVersion
    ? `V${controllerVersion}`
    : "RESTART REQUIRED";
  controllerReadout.classList.toggle("warning", !controllerVersion);
  document.querySelector("#dimmingReadout").textContent =
    status.brightnessControl === "realtime-rgb" ? "REALTIME RGB" : "DEVICE";
  if (!controllerVersion && !state.backendWarningShown) {
    state.backendWarningShown = true;
    toast("Controller restart required for rotation and live brightness.", true);
  }
  document.querySelector("#resolutionReadout").textContent = `${status.width}×${status.height}`;
  document.querySelector("#pixelReadout").textContent = status.ledCount;
  document.querySelector("#fpsReadout").textContent = status.frameRate;
  document.querySelector("#firmwareReadout").textContent = `FW ${status.firmware}`;
  document.querySelector("#routeReadout").textContent = status.ip;
  document.querySelector("#modeReadout").textContent = status.streaming
    ? "LIVE"
    : status.mode.toUpperCase();
  const visibleBrightness = brightnessFromStatus({
    currentBrightness: brightnessSlider.value,
    statusBrightness: status.brightness,
    syncBrightness,
  });
  brightnessSlider.value = visibleBrightness;
  updateBrightnessVisual(visibleBrightness);
  stage.classList.toggle("is-live", status.streaming);
  document.querySelector("#liveFlag").lastChild.textContent = status.streaming
    ? " LIVE"
    : " PREVIEW";

  const rotation = Number(status.rotation ?? 0);
  state.rotation = rotation;
  document.querySelectorAll("[data-rotation]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.rotation) === rotation);
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
    renderZoneControls();
    render();
  }
}

function readSavedRotation() {
  try {
    const rotation = Number(localStorage.getItem(ROTATION_STORAGE_KEY) ?? 0);
    return [0, 90, 180, 270].includes(rotation) ? rotation : 0;
  } catch {
    return 0;
  }
}

function saveRotation(rotation) {
  try {
    localStorage.setItem(ROTATION_STORAGE_KEY, String(rotation));
  } catch {
    // Rotation still works when browser storage is disabled.
  }
}

async function loadStatus() {
  try {
    let status = await api("/api/status");
    const savedRotation = readSavedRotation();
    if (
      Object.hasOwn(status, "rotation") &&
      savedRotation !== status.rotation
    ) {
      status = await api("/api/rotation", {
        method: "POST",
        body: JSON.stringify({ degrees: savedRotation }),
      });
    }
    applyStatus(status);
  } catch (error) {
    setConnection(null, error.message);
    toast(error.message, true);
  }
}

function startStateSync() {
  if (!("EventSource" in window) || state.stateEvents) return;
  const stateEvents = new EventSource("/api/events");
  stateEvents.addEventListener("state", (event) => {
    try {
      const message = JSON.parse(event.data);
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

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function hslToRgb(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const saturation = Math.max(0, Math.min(1, s));
  const lightness = Math.max(0, Math.min(1, l));
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const segment = hue / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));
  let rgb = [0, 0, 0];
  if (segment < 1) rgb = [chroma, x, 0];
  else if (segment < 2) rgb = [x, chroma, 0];
  else if (segment < 3) rgb = [0, chroma, x];
  else if (segment < 4) rgb = [0, x, chroma];
  else if (segment < 5) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];
  const match = lightness - chroma / 2;
  return rgb.map((channel) => clampByte((channel + match) * 255));
}

function setPixel(x, y, rgb) {
  if (x < 0 || y < 0 || x >= state.width || y >= state.height) return;
  if (!zoneContains(state.zone, x, y, state.width, state.height)) return;
  const offset = (y * state.width + x) * 3;
  state.pixels[offset] = rgb[0];
  state.pixels[offset + 1] = rgb[1];
  state.pixels[offset + 2] = rgb[2];
}

function drawRgbCanvas(targetCanvas, pixels, width, height) {
  if (
    !targetCanvas ||
    !pixels ||
    pixels.length !== width * height * 3
  ) {
    return false;
  }
  if (targetCanvas.width !== width) targetCanvas.width = width;
  if (targetCanvas.height !== height) targetCanvas.height = height;
  const targetContext = targetCanvas.getContext("2d", { alpha: false });
  const image = targetContext.createImageData(width, height);
  for (let source = 0, destination = 0; source < pixels.length; source += 3) {
    image.data[destination] = pixels[source];
    image.data[destination + 1] = pixels[source + 1];
    image.data[destination + 2] = pixels[source + 2];
    image.data[destination + 3] = 255;
    destination += 4;
  }
  targetContext.putImageData(image, 0, 0);
  return true;
}

function sceneKey(preset, saved) {
  return `${saved ? "saved" : "built-in"}:${preset.id}`;
}

function scenePreviewPixels(preset) {
  const width = Number(preset.width) || state.width;
  const height = Number(preset.height) || state.height;
  const expected = width * height * 3;
  const stored =
    Array.isArray(preset.previewPixels) && preset.previewPixels.length === expected
      ? preset.previewPixels
      : Array.isArray(preset.pixels) && preset.pixels.length === expected
        ? preset.pixels
        : null;
  if (stored) return { pixels: new Uint8Array(stored), width, height };
  if (
    !preset.effect ||
    width !== state.width ||
    height !== state.height ||
    !effectPainters[preset.effect]
  ) {
    return null;
  }
  const pixels = new Uint8Array(expected);
  const palette = normalizePalette(preset.palette);
  const time = 1.35 * (Number(preset.speed ?? 100) / 100);
  effectPainters[preset.effect](time, pixels, palette.colors);
  const intensity = Math.max(
    0.1,
    Math.min(1, Number(preset.intensity ?? 75) / 100),
  );
  for (let index = 0; index < pixels.length; index += 1) {
    pixels[index] = clampByte(pixels[index] * intensity);
  }
  return { pixels, width, height };
}

function updateSceneMonitor() {
  const monitor = document.querySelector("#sceneMonitor");
  if (!monitor) return;
  const output = state.outputContext;
  const scene = output.scene;
  const playlist = state.library.playlists.find(
    (item) => item.id === state.activePlaylistId,
  );
  monitor.dataset.state = output.kind;
  document.querySelector("#sceneMonitorBadge").textContent = playlist
    ? "PLAYLIST LIVE"
    : output.kind === "scene"
      ? "SCENE LIVE"
      : "LIVE OUTPUT";
  document.querySelector("#sceneMonitorKicker").textContent = playlist
    ? `PLAYLIST / ${playlist.name}`
    : output.kind === "scene"
      ? `${output.source ?? "SAVED"} SCENE`
      : "PROGRAM MONITOR";
  document.querySelector("#sceneMonitorName").textContent = output.name;

  const effectName =
    effectById(scene?.effect ?? output.effect)?.name ??
    (output.kind === "canvas" ? "PIXEL FRAME" : output.kind.toUpperCase());
  const brightness = Math.round(
    Number(scene?.brightness ?? brightnessSlider.value),
  );
  const zone = describeZone(scene?.zone ?? state.zone);
  document.querySelector("#sceneMonitorMeta").textContent =
    `${effectName} / ${brightness}% / ${zone}`;

  const progressElement = document.querySelector("#sceneProgress");
  const progressFill = document.querySelector("#sceneProgressFill");
  const progressLabel = document.querySelector("#sceneProgressLabel");
  if (playlist && state.activePlaylistStep) {
    const progress = playlistStepProgress(
      state.activePlaylistStep.startedAt,
      state.activePlaylistStep.duration,
    );
    const percent = Math.round(progress.progress * 100);
    progressFill.style.width = `${percent}%`;
    progressElement.setAttribute("aria-valuenow", String(percent));
    progressLabel.textContent =
      `STEP ${state.activePlaylistStep.index + 1}/${playlist.steps.length}` +
      ` / ${progress.remainingSeconds}s LEFT` +
      ` / ${state.activePlaylistStep.transition.toUpperCase()}`;
  } else {
    progressFill.style.width = "0%";
    progressElement.setAttribute("aria-valuenow", "0");
    progressLabel.textContent =
      output.kind === "scene"
        ? "OUTPUT MIRRORS THIS SCENE"
        : "OUTPUT MIRRORS THE WALL";
  }
}

function setOutputContext(output) {
  state.outputContext = {
    kind: output.kind ?? "canvas",
    name: output.name ?? "CURRENT OUTPUT",
    sceneKey: output.sceneKey ?? null,
    scene: output.scene ?? null,
    source: output.source ?? null,
    effect: output.effect ?? output.scene?.effect ?? null,
  };
  renderPresets();
  updateSceneMonitor();
  drawRgbCanvas(
    sceneMonitorCanvas,
    state.pixels,
    state.width,
    state.height,
  );
}

function renderSceneMirrors() {
  drawRgbCanvas(
    sceneMonitorCanvas,
    state.pixels,
    state.width,
    state.height,
  );
  const activeSceneCanvas = document.querySelector(
    ".preset-row.active .scene-preview-canvas",
  );
  if (activeSceneCanvas) {
    drawRgbCanvas(activeSceneCanvas, state.pixels, state.width, state.height);
  }
}

function render() {
  const cellWidth = canvas.width / state.width;
  const cellHeight = canvas.height / state.height;
  context.fillStyle = "#030403";
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      const offset = (y * state.width + x) * 3;
      const red = state.pixels[offset];
      const green = state.pixels[offset + 1];
      const blue = state.pixels[offset + 2];
      const active = red + green + blue > 3;
      const gap = Math.max(1.5, cellWidth * 0.075);
      context.fillStyle = active
        ? `rgb(${red}, ${green}, ${blue})`
        : (x + y) % 2
          ? "#0a0d0a"
          : "#080a08";
      context.fillRect(
        x * cellWidth + gap,
        y * cellHeight + gap,
        cellWidth - gap * 2,
        cellHeight - gap * 2,
      );
      if (active) {
        context.fillStyle = `rgba(${red}, ${green}, ${blue}, 0.18)`;
        context.fillRect(
          x * cellWidth,
          y * cellHeight,
          cellWidth,
          cellHeight,
        );
      }
    }
  }

  context.save();
  context.strokeStyle = "rgba(238, 232, 217, 0.22)";
  context.lineWidth = 3;
  for (let x = 8; x < state.width; x += 8) {
    context.beginPath();
    context.moveTo(x * cellWidth, 0);
    context.lineTo(x * cellWidth, canvas.height);
    context.stroke();
  }
  for (let y = 8; y < state.height; y += 8) {
    context.beginPath();
    context.moveTo(0, y * cellHeight);
    context.lineTo(canvas.width, y * cellHeight);
    context.stroke();
  }
  if (state.zone.type !== "all") {
    const bounds = zoneBounds(state.zone, state.width, state.height);
    context.strokeStyle = "rgba(217, 255, 91, 0.95)";
    context.lineWidth = Math.max(2, Math.min(cellWidth, cellHeight) * 0.12);
    context.setLineDash([
      Math.max(6, cellWidth * 0.35),
      Math.max(4, cellWidth * 0.18),
    ]);
    context.strokeRect(
      bounds.x * cellWidth + context.lineWidth / 2,
      bounds.y * cellHeight + context.lineWidth / 2,
      bounds.width * cellWidth - context.lineWidth,
      bounds.height * cellHeight - context.lineWidth,
    );
  }
  context.restore();
  renderSceneMirrors();
}

function stopAnimation(showNotice = false) {
  state.transitionToken += 1;
  if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
  state.animationFrame = null;
  state.animationName = null;
  document
    .querySelectorAll(".effect-card")
    .forEach((button) => button.classList.remove("active"));
  if (showNotice) toast("Motion stopped. The last frame remains live.");
}

function scheduleFrame() {
  state.frameQueued = true;
  if (!state.frameSending) void flushFrame();
}

async function flushFrame() {
  if (!state.frameQueued || !state.connected) return;
  const delay = Math.max(0, 45 - (performance.now() - state.lastSentAt));
  if (delay > 0) {
    setTimeout(() => void flushFrame(), delay);
    return;
  }
  state.frameQueued = false;
  state.frameSending = true;
  try {
    const status = await api("/api/frame", {
      method: "POST",
      body: JSON.stringify({
        width: state.width,
        height: state.height,
        pixels: Array.from(state.pixels),
      }),
    });
    state.lastSentAt = performance.now();
    applyStatus(status, { syncBrightness: false });
  } catch (error) {
    toast(error.message, true);
  } finally {
    state.frameSending = false;
    if (state.frameQueued) void flushFrame();
  }
}

function paintAtEvent(event) {
  const bounds = canvas.getBoundingClientRect();
  const x = Math.floor(((event.clientX - bounds.left) / bounds.width) * state.width);
  const y = Math.floor(((event.clientY - bounds.top) / bounds.height) * state.height);
  const rgb = state.erasing ? [0, 0, 0] : hexToRgb(colorPicker.value);
  const radius = state.brush - 1;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy <= radius * radius + 0.35) {
        setPixel(x + dx, y + dy, rgb);
      }
    }
  }
  render();
  scheduleFrame();
}

canvas.addEventListener("pointerdown", (event) => {
  stopMedia();
  stopAnimation();
  setOutputContext({ kind: "canvas", name: "HAND-DRAWN FRAME" });
  state.drawing = true;
  canvas.setPointerCapture(event.pointerId);
  paintAtEvent(event);
});
canvas.addEventListener("pointermove", (event) => {
  if (state.drawing) paintAtEvent(event);
});
canvas.addEventListener("pointerup", () => {
  state.drawing = false;
});
canvas.addEventListener("pointercancel", () => {
  state.drawing = false;
});

colorPicker.addEventListener("input", () => {
  colorValue.textContent = colorPicker.value.toUpperCase();
  state.erasing = false;
  document.querySelector("#eraserButton").classList.remove("active");
});

document.querySelectorAll("[data-color]").forEach((button) => {
  button.addEventListener("click", () => {
    colorPicker.value = button.dataset.color;
    colorValue.textContent = button.dataset.color.toUpperCase();
    state.erasing = false;
    document.querySelector("#eraserButton").classList.remove("active");
  });
});

document.querySelectorAll("[data-brush]").forEach((button) => {
  button.addEventListener("click", () => {
    state.brush = Number(button.dataset.brush);
    document
      .querySelectorAll("[data-brush]")
      .forEach((item) => item.classList.toggle("active", item === button));
  });
});

document.querySelector("#eraserButton").addEventListener("click", (event) => {
  state.erasing = !state.erasing;
  event.currentTarget.classList.toggle("active", state.erasing);
});

document.querySelector("#fillButton").addEventListener("click", () => {
  stopMedia();
  stopAnimation();
  setOutputContext({ kind: "canvas", name: "COLOR FILL" });
  const color = hexToRgb(colorPicker.value);
  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      setPixel(x, y, color);
    }
  }
  render();
  scheduleFrame();
});

document.querySelector("#clearButton").addEventListener("click", () => {
  stopMedia();
  stopAnimation();
  setOutputContext({ kind: "canvas", name: "CLEARED FRAME" });
  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      setPixel(x, y, [0, 0, 0]);
    }
  }
  render();
  scheduleFrame();
});

function currentMediaControls() {
  return normalizeMediaControls({
    fit: document.querySelector("#mediaFit").value,
    sampling: document.querySelector("#mediaSampling").value,
    saturation: Number(document.querySelector("#mediaSaturation").value) / 100,
    contrast: Number(document.querySelector("#mediaContrast").value) / 100,
    brightness: 1,
    gamma: Number(document.querySelector("#mediaGamma").value) / 100,
  });
}

function drawMediaFrame() {
  const media = state.mediaElement;
  if (!media) return;
  const sourceWidth = media.videoWidth || media.naturalWidth || media.width;
  const sourceHeight = media.videoHeight || media.naturalHeight || media.height;
  if (!sourceWidth || !sourceHeight) return;

  const controls = currentMediaControls();
  mediaCanvas.width = state.width;
  mediaCanvas.height = state.height;
  mediaContext.imageSmoothingEnabled = controls.sampling === "smooth";
  mediaContext.imageSmoothingQuality = "high";
  mediaContext.fillStyle = "#000";
  mediaContext.fillRect(0, 0, state.width, state.height);
  const rectangle = fitRect(
    sourceWidth,
    sourceHeight,
    state.width,
    state.height,
    controls.fit,
  );
  mediaContext.drawImage(
    media,
    rectangle.x,
    rectangle.y,
    rectangle.width,
    rectangle.height,
  );
  const data = mediaContext.getImageData(
    0,
    0,
    state.width,
    state.height,
  ).data;
  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      const index = y * state.width + x;
      setPixel(
        x,
        y,
        adjustRgb(
          [data[index * 4], data[index * 4 + 1], data[index * 4 + 2]],
          controls,
        ),
      );
    }
  }
  render();
  scheduleFrame();
}

function stopMedia(showNotice = false) {
  if (state.mediaFrame) cancelAnimationFrame(state.mediaFrame);
  state.mediaFrame = null;
  state.mediaElement?.pause?.();
  if (state.mediaUrl) URL.revokeObjectURL(state.mediaUrl);
  state.mediaUrl = null;
  state.mediaElement = null;
  state.mediaLastFrame = 0;
  if (state.animationName === "media") state.animationName = null;
  document.querySelector("#mediaModeReadout").textContent =
    showNotice ? "FRAME HELD" : "IDLE";
  if (showNotice) toast("Media stopped. The last frame remains live.");
}

function startMediaLoop(kind) {
  const tick = (now) => {
    if (!state.mediaElement) return;
    if (now - state.mediaLastFrame >= 50) {
      drawMediaFrame();
      state.mediaLastFrame = now;
    }
    state.mediaFrame = requestAnimationFrame(tick);
  };
  document.querySelector("#mediaModeReadout").textContent = kind;
  state.mediaFrame = requestAnimationFrame(tick);
}

function updateMediaControls() {
  document.querySelector("#mediaSaturationValue").textContent =
    `${document.querySelector("#mediaSaturation").value}%`;
  document.querySelector("#mediaContrastValue").textContent =
    `${document.querySelector("#mediaContrast").value}%`;
  document.querySelector("#mediaGammaValue").textContent =
    (Number(document.querySelector("#mediaGamma").value) / 100).toFixed(2);
  document.querySelector("#mediaSpeedValue").textContent =
    `${(Number(document.querySelector("#mediaSpeed").value) / 100).toFixed(2)}×`;
  [
    "mediaSaturation",
    "mediaContrast",
    "mediaGamma",
    "mediaSpeed",
  ].forEach((id) => updateRangeFill(document.querySelector(`#${id}`)));
  if (state.mediaElement instanceof HTMLVideoElement) {
    state.mediaElement.playbackRate =
      Number(document.querySelector("#mediaSpeed").value) / 100;
  }
  if (state.mediaElement && !state.mediaFrame) drawMediaFrame();
}

function initializeMediaControls() {
  ["mediaFit", "mediaSampling"].forEach((id) => {
    document.querySelector(`#${id}`).addEventListener("change", () => {
      if (state.mediaElement) drawMediaFrame();
    });
  });
  [
    "mediaSaturation",
    "mediaContrast",
    "mediaGamma",
    "mediaSpeed",
  ].forEach((id) => {
    document.querySelector(`#${id}`).addEventListener("input", updateMediaControls);
  });
  document
    .querySelector("#stopMediaButton")
    .addEventListener("click", () => stopMedia(true));
  updateMediaControls();
}

document.querySelector("#imageInput").addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (!file) return;
  stopMedia();
  stopAnimation();
  state.animationName = "media";
  setOutputContext({ kind: "media", name: file.name.toUpperCase() });
  const url = URL.createObjectURL(file);
  state.mediaUrl = url;

  if (file.type.startsWith("video/")) {
    const video = document.createElement("video");
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.addEventListener(
      "loadeddata",
      () => {
        if (state.mediaElement !== video) return;
        video.playbackRate =
          Number(document.querySelector("#mediaSpeed").value) / 100;
        void video.play();
        startMediaLoop("VIDEO LIVE");
        toast(`Playing ${file.name} on the pixel stage.`);
      },
      { once: true },
    );
    video.addEventListener(
      "error",
      () => {
        stopMedia();
        toast("That video could not be decoded by this browser.", true);
      },
      { once: true },
    );
    state.mediaElement = video;
    video.src = url;
  } else {
    const image = new Image();
    image.addEventListener(
      "load",
      () => {
        if (state.mediaElement !== image) return;
        drawMediaFrame();
        if (file.type === "image/gif") startMediaLoop("GIF LIVE");
        else document.querySelector("#mediaModeReadout").textContent = "IMAGE";
        toast(`Loaded ${file.name} onto the pixel stage.`);
      },
      { once: true },
    );
    image.addEventListener(
      "error",
      () => {
        stopMedia();
        toast("That image could not be decoded by this browser.", true);
      },
      { once: true },
    );
    state.mediaElement = image;
    image.src = url;
  }
  event.target.value = "";
});

function updateBrightnessVisual(value) {
  brightnessValue.textContent = `${value}%`;
  updateRangeFill(brightnessSlider);
  updateSceneMonitor();
}

function updateRangeFill(input) {
  const minimum = Number(input.min);
  const maximum = Number(input.max);
  const percent = ((Number(input.value) - minimum) / (maximum - minimum)) * 100;
  input.style.setProperty("--fill", `${percent}%`);
}

function updateModulationVisuals() {
  state.effectSpeed = Number(effectSpeed.value) / 100;
  state.effectIntensity = Number(effectIntensity.value) / 100;
  document.querySelector("#effectSpeedValue").textContent =
    `${state.effectSpeed.toFixed(1)}×`;
  document.querySelector("#effectIntensityValue").textContent =
    `${effectIntensity.value}%`;
  updateRangeFill(effectSpeed);
  updateRangeFill(effectIntensity);
}

function updatePaletteControls() {
  const select = document.querySelector("#paletteSelect");
  const isCurated = CURATED_PALETTES.some(
    (palette) => palette.id === state.palette.id,
  );
  select.value = isCurated ? state.palette.id : "custom";
  const colors = state.palette.colors;
  document.querySelector("#gradientStart").value = colors[0];
  document.querySelector("#gradientMiddle").value =
    colors[Math.floor((colors.length - 1) / 2)];
  document.querySelector("#gradientEnd").value = colors.at(-1);
  document.querySelector("#palettePreview").style.background =
    `linear-gradient(90deg, ${colors.join(", ")})`;
}

function applyPalette(palette, announce = false) {
  state.palette = normalizePalette(palette);
  updatePaletteControls();
  if (announce) toast(`Palette set to ${state.palette.id.toUpperCase()}.`);
}

function initializePalettes() {
  const select = document.querySelector("#paletteSelect");
  CURATED_PALETTES.forEach((palette) => {
    const option = document.createElement("option");
    option.value = palette.id;
    option.textContent = palette.name;
    select.append(option);
  });
  const customOption = document.createElement("option");
  customOption.value = "custom";
  customOption.textContent = "CUSTOM GRADIENT";
  select.append(customOption);
  select.addEventListener("change", () => {
    if (select.value === "custom") return;
    applyPalette(
      CURATED_PALETTES.find((palette) => palette.id === select.value),
      true,
    );
  });
  document.querySelector("#applyGradientButton").addEventListener("click", () => {
    applyPalette(
      {
        id: "custom",
        colors: [
          document.querySelector("#gradientStart").value,
          document.querySelector("#gradientMiddle").value,
          document.querySelector("#gradientEnd").value,
        ],
      },
      true,
    );
  });
  updatePaletteControls();
}

function applyZone(zone, announce = false) {
  state.zone = normalizeZone(zone, state.width, state.height);
  renderZoneControls();
  render();
  if (announce) toast(`Target: ${describeZone(state.zone)}.`);
}

function renderZoneControls() {
  const typeSelect = document.querySelector("#zoneType");
  if (!typeSelect) return;
  typeSelect.value = state.zone.type;
  const panelEditor = document.querySelector("#panelZoneGrid");
  const axisEditor = document.querySelector("#zoneAxisEditor");
  const rectEditor = document.querySelector("#zoneRectEditor");
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
    const input = document.querySelector("#zoneIndex");
    const isRow = state.zone.type === "row";
    document.querySelector("#zoneIndexLabel").textContent =
      isRow ? "ROW NUMBER" : "COLUMN NUMBER";
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
      document.querySelector(`#${id}`).value = value;
    });
    document.querySelector("#zoneX").max = state.width;
    document.querySelector("#zoneY").max = state.height;
    document.querySelector("#zoneWidth").max = state.width - state.zone.x;
    document.querySelector("#zoneHeight").max = state.height - state.zone.y;
  }
  document.querySelector("#zoneReadout").textContent = describeZone(state.zone);
}

function initializeZones() {
  document.querySelector("#zoneType").addEventListener("change", (event) => {
    const type = event.target.value;
    if (type === "panel") applyZone({ type, column: 0, row: 0 }, true);
    else if (type === "row" || type === "column") {
      applyZone({ type, index: 0 }, true);
    } else if (type === "custom") {
      applyZone({ type, x: 0, y: 0, width: 8, height: 8 }, true);
    } else applyZone({ type: "all" }, true);
  });
  document.querySelector("#zoneIndex").addEventListener("input", (event) => {
    applyZone(
      { type: state.zone.type, index: Number(event.target.value) - 1 },
      true,
    );
  });
  ["zoneX", "zoneY", "zoneWidth", "zoneHeight"].forEach((id) => {
    document.querySelector(`#${id}`).addEventListener("input", () => {
      applyZone(
        {
          type: "custom",
          x: Number(document.querySelector("#zoneX").value) - 1,
          y: Number(document.querySelector("#zoneY").value) - 1,
          width: Number(document.querySelector("#zoneWidth").value),
          height: Number(document.querySelector("#zoneHeight").value),
        },
        true,
      );
    });
  });
  renderZoneControls();
}

function updateLayerControls() {
  const layerStudio = document.querySelector(".layer-studio");
  document.querySelector("#overlayEnabled").checked = state.overlay.enabled;
  document.querySelector("#overlayEffect").value = state.overlay.effect;
  document.querySelector("#overlayPalette").value = state.overlay.paletteId;
  document.querySelector("#overlayBlend").value = state.overlay.blend;
  document.querySelector("#overlayOpacity").value = state.overlay.opacity;
  document.querySelector("#overlayOpacityValue").textContent =
    `${state.overlay.opacity}%`;
  updateRangeFill(document.querySelector("#overlayOpacity"));
  layerStudio.classList.toggle("enabled", state.overlay.enabled);
}

function readLayerControls() {
  state.overlay = normalizeLayer({
    enabled: document.querySelector("#overlayEnabled").checked,
    effect: document.querySelector("#overlayEffect").value,
    paletteId: document.querySelector("#overlayPalette").value,
    blend: document.querySelector("#overlayBlend").value,
    opacity: document.querySelector("#overlayOpacity").value,
  });
  updateLayerControls();
}

function initializeLayers() {
  const effectSelect = document.querySelector("#overlayEffect");
  effectSelect.replaceChildren();
  EFFECT_CATALOG.forEach((effect) => {
    const option = document.createElement("option");
    option.value = effect.id;
    option.textContent = effect.name;
    effectSelect.append(option);
  });
  const paletteSelect = document.querySelector("#overlayPalette");
  CURATED_PALETTES.forEach((palette) => {
    const option = document.createElement("option");
    option.value = palette.id;
    option.textContent = palette.name;
    paletteSelect.append(option);
  });
  const blendSelect = document.querySelector("#overlayBlend");
  BLEND_MODES.forEach((mode) => {
    const option = document.createElement("option");
    option.value = mode.id;
    option.textContent = mode.name;
    blendSelect.append(option);
  });
  ["overlayEnabled", "overlayEffect", "overlayPalette", "overlayBlend"].forEach(
    (id) => document.querySelector(`#${id}`).addEventListener("change", readLayerControls),
  );
  document
    .querySelector("#overlayOpacity")
    .addEventListener("input", readLayerControls);
  updateLayerControls();
}

function updateTransitionControls() {
  document.querySelector("#sceneTransition").value = state.transition.type;
  document.querySelector("#transitionDuration").value = state.transition.duration;
  document.querySelector("#transitionDurationValue").textContent =
    `${state.transition.duration}ms`;
  updateRangeFill(document.querySelector("#transitionDuration"));
}

function readTransitionControls() {
  state.transition = normalizeTransition({
    type: document.querySelector("#sceneTransition").value,
    duration: document.querySelector("#transitionDuration").value,
  });
  updateTransitionControls();
}

function initializeTransitions() {
  document
    .querySelector("#sceneTransition")
    .addEventListener("change", readTransitionControls);
  document
    .querySelector("#transitionDuration")
    .addEventListener("input", readTransitionControls);
  updateTransitionControls();
}

let brightnessTimer;
brightnessSlider.addEventListener("input", () => {
  const requestedBrightness = brightnessSlider.value;
  updateBrightnessVisual(requestedBrightness);
  clearTimeout(brightnessTimer);
  brightnessTimer = setTimeout(async () => {
    try {
      applyStatus(
        await api("/api/brightness", {
          method: "POST",
          body: JSON.stringify({ value: requestedBrightness }),
        }),
      );
    } catch (error) {
      toast(error.message, true);
    }
  }, 120);
});

effectSpeed.addEventListener("input", updateModulationVisuals);
effectIntensity.addEventListener("input", updateModulationVisuals);

async function setMode(mode) {
  stopMedia();
  stopAnimation();
  try {
    applyStatus(
      await api("/api/mode", {
        method: "POST",
        body: JSON.stringify({ mode }),
      }),
    );
    setOutputContext({
      kind: mode === "off" ? "off" : "stock",
      name: mode === "off" ? "OUTPUT OFF" : "TWINKLY STOCK MODE",
    });
    toast(mode === "off" ? "Panel switched off." : "Stock Twinkly animation restored.");
  } catch (error) {
    toast(error.message, true);
  }
}

document.querySelector("#offButton").addEventListener("click", () => void setMode("off"));
document.querySelector("#stockButton").addEventListener("click", () => void setMode("movie"));
document
  .querySelector("#stopMotionButton")
  .addEventListener("click", () => stopAnimation(true));

document.querySelectorAll("[data-rotation]").forEach((button) => {
  button.addEventListener("click", async () => {
    const degrees = Number(button.dataset.rotation);
    if (degrees === state.rotation) return;
    stopMedia();
    stopAnimation();
    state.frameQueued = false;
    try {
      const status = await api("/api/rotation", {
        method: "POST",
        body: JSON.stringify({ degrees }),
      });
      saveRotation(degrees);
      applyStatus(status);
      state.pixels.fill(0);
      render();
      scheduleFrame();
      toast(`Display rotated to ${degrees}°.`);
    } catch (error) {
      toast(error.message, true);
    }
  });
});

function renderGeneratedFrame(
  name,
  time,
  backdrop,
  target,
  primaryBuffer = new Uint8Array(target.length),
  overlayBuffer = new Uint8Array(target.length),
) {
  primaryBuffer.fill(0);
  effectPainters[name](time, primaryBuffer, state.palette.colors);
  overlayBuffer.fill(0);
  const overlayPalette = CURATED_PALETTES.find(
    (palette) => palette.id === state.overlay.paletteId,
  ) ?? CURATED_PALETTES[0];
  if (state.overlay.enabled) {
    effectPainters[state.overlay.effect](
      time * 0.87 + 0.61,
      overlayBuffer,
      overlayPalette.colors,
    );
  }

  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      const offset = (y * state.width + x) * 3;
      if (!zoneContains(state.zone, x, y, state.width, state.height)) {
        target[offset] = backdrop[offset];
        target[offset + 1] = backdrop[offset + 1];
        target[offset + 2] = backdrop[offset + 2];
        continue;
      }
      const base = [
        clampByte(primaryBuffer[offset] * state.effectIntensity),
        clampByte(primaryBuffer[offset + 1] * state.effectIntensity),
        clampByte(primaryBuffer[offset + 2] * state.effectIntensity),
      ];
      const mixed = state.overlay.enabled
        ? blendRgb(
            base,
            [
              clampByte(overlayBuffer[offset] * state.effectIntensity),
              clampByte(overlayBuffer[offset + 1] * state.effectIntensity),
              clampByte(overlayBuffer[offset + 2] * state.effectIntensity),
            ],
            state.overlay.blend,
            state.overlay.opacity / 100,
          )
        : base;
      target.set(mixed, offset);
    }
  }
  return target;
}

function startGeneratedEffect(name, { preserveOutput = false } = {}) {
  stopMedia();
  stopAnimation();
  state.animationName = name;
  if (!preserveOutput) {
    setOutputContext({
      kind: "effect",
      name: effectById(name)?.name ?? name.toUpperCase(),
      effect: name,
    });
  }
  document
    .querySelector(`[data-effect="${name}"]`)
    ?.classList.add("active");
  const startedAt = performance.now();
  const backdrop = state.pixels.slice();
  const primaryBuffer = new Uint8Array(state.pixels.length);
  const overlayBuffer = new Uint8Array(state.pixels.length);
  let previousFrame = 0;

  const tick = (now) => {
    if (state.animationName !== name) return;
    if (now - previousFrame >= 50) {
      const time = ((now - startedAt) / 1000) * state.effectSpeed;
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
      previousFrame = now;
    }
    state.animationFrame = requestAnimationFrame(tick);
  };
  state.animationFrame = requestAnimationFrame(tick);
}

function paintEffectPixel(target, x, y, rgb) {
  if (
    x < 0 ||
    y < 0 ||
    x >= state.width ||
    y >= state.height ||
    !zoneContains(state.zone, x, y, state.width, state.height)
  ) {
    return;
  }
  target.set(rgb, (y * state.width + x) * 3);
}

const effectPainters = {
  tide(time, target, paletteColors) {
    for (let y = 0; y < state.height; y += 1) {
      for (let x = 0; x < state.width; x += 1) {
        const wave =
          Math.sin(x * 0.24 + time * 1.3) +
          Math.cos(y * 0.31 - time * 0.95) +
          Math.sin((x + y) * 0.11 + time * 0.7);
        const phase = (x * 0.018 - y * 0.011 + time * 0.075 + wave * 0.08);
        const color = sampleGradient(paletteColors, phase);
        const gain = 0.58 + (wave + 3) * 0.075;
        paintEffectPixel(
          target,
          x,
          y,
          color.map((channel) => clampByte(channel * gain)),
        );
      }
    }
  },
  radar(time, target, paletteColors) {
    const centerX = (state.width - 1) / 2;
    const centerY = (state.height - 1) / 2;
    const sweep = time * 1.4;
    for (let y = 0; y < state.height; y += 1) {
      for (let x = 0; x < state.width; x += 1) {
        const dx = x - centerX;
        const dy = y - centerY;
        const angle = Math.atan2(dy, dx);
        const delta = Math.atan2(Math.sin(angle - sweep), Math.cos(angle - sweep));
        const ring = Math.abs(Math.sin(Math.hypot(dx, dy) * 1.15)) < 0.08 ? 0.18 : 0;
        const sweepLight = Math.max(0, 1 - Math.abs(delta) * 3.2);
        const spark = ((x * 17 + y * 31) % 71 === 0) ? 0.65 : 0;
        const value = Math.min(1, 0.025 + ring + sweepLight * 0.72 + spark);
        const color = sampleGradient(
          paletteColors,
          angle / (Math.PI * 2) + time * 0.035,
        );
        paintEffectPixel(
          target,
          x,
          y,
          color.map((channel) => clampByte(channel * value)),
        );
      }
    }
  },
  ember(time, target, paletteColors) {
    for (let y = 0; y < state.height; y += 1) {
      for (let x = 0; x < state.width; x += 1) {
        const rise = 1 - y / state.height;
        const noise =
          Math.sin(x * 1.31 + time * 3.1) *
          Math.sin(y * 0.73 - time * 2.3) *
          Math.sin((x + y) * 0.42 + time);
        const heat = Math.max(0, rise * 0.72 + noise * 0.33 - 0.08);
        const color = sampleGradient(paletteColors, heat * 0.82);
        paintEffectPixel(
          target,
          x,
          y,
          color.map((channel) => clampByte(channel * Math.min(1, heat * 1.35))),
        );
      }
    }
  },
  orbit(time, target, paletteColors) {
    const cx = (state.width - 1) / 2;
    const cy = (state.height - 1) / 2;
    const first = [cx + Math.cos(time) * 8.5, cy + Math.sin(time * 1.17) * 6];
    const second = [cx + Math.cos(-time * 0.73 + 2) * 11, cy + Math.sin(-time + 1) * 8];
    for (let y = 0; y < state.height; y += 1) {
      for (let x = 0; x < state.width; x += 1) {
        const d1 = Math.hypot(x - first[0], y - first[1]);
        const d2 = Math.hypot(x - second[0], y - second[1]);
        const a = Math.exp(-d1 * 0.42);
        const b = Math.exp(-d2 * 0.38);
        const firstColor = sampleGradient(paletteColors, time * 0.025 + 0.2);
        const secondColor = sampleGradient(paletteColors, -time * 0.02 + 0.72);
        paintEffectPixel(
          target,
          x,
          y,
          firstColor.map((channel, index) =>
            clampByte(channel * a + secondColor[index] * b),
          ),
        );
      }
    }
  },
  plasma(time, target, paletteColors) {
    const movingX = state.width * (0.5 + Math.cos(time * 0.37) * 0.28);
    const movingY = state.height * (0.5 + Math.sin(time * 0.43) * 0.3);
    for (let y = 0; y < state.height; y += 1) {
      for (let x = 0; x < state.width; x += 1) {
        const field =
          Math.sin(x * 0.34 + time * 1.4) +
          Math.sin(y * 0.29 - time * 1.1) +
          Math.sin(Math.hypot(x - movingX, y - movingY) * 0.42 - time * 1.8);
        const phase = 0.5 + field / 6;
        const color = sampleGradient(paletteColors, phase);
        const gain = 0.65 + Math.abs(field) * 0.11;
        paintEffectPixel(
          target,
          x,
          y,
          color.map((channel) => clampByte(channel * gain)),
        );
      }
    }
  },
  confetti(time, target, paletteColors) {
    const particleCount = Math.max(36, Math.round(state.width * 1.8));
    for (let particle = 0; particle < particleCount; particle += 1) {
      const speed = 2.5 + hashUnit(particle * 31 + 7) * 6;
      const x = Math.floor(hashUnit(particle * 17 + 3) * state.width);
      const start = hashUnit(particle * 43 + 11) * state.height;
      const y = Math.floor((start + time * speed) % (state.height + 3)) - 2;
      const color = sampleGradient(
        paletteColors,
        hashUnit(particle * 59 + 13) + time * 0.015,
      );
      paintEffectPixel(target, x, y, color);
      paintEffectPixel(
        target,
        x,
        y - 1,
        color.map((channel) => clampByte(channel * 0.38)),
      );
    }
  },
  rain(time, target, paletteColors) {
    for (let x = 0; x < state.width; x += 1) {
      const speed = 4 + hashUnit(x * 37 + 5) * 8;
      const head = Math.floor(
        (time * speed + hashUnit(x * 71 + 9) * state.height * 2) %
          (state.height + 10),
      );
      for (let trail = 0; trail < 10; trail += 1) {
        const y = head - trail;
        const gain = Math.max(0, 1 - trail / 10);
        const color = sampleGradient(
          paletteColors,
          x / state.width + trail * 0.025,
        );
        paintEffectPixel(
          target,
          x,
          y,
          color.map((channel) => clampByte(channel * gain)),
        );
      }
    }
  },
  fireworks(time, target, paletteColors) {
    const maximumRadius = Math.hypot(state.width, state.height) * 0.32;
    for (let burst = 0; burst < 4; burst += 1) {
      const cycle = time * 0.42 + burst * 0.29;
      const epoch = Math.floor(cycle);
      const age = cycle - epoch;
      const centerX =
        (0.15 + hashUnit(epoch * 97 + burst * 17) * 0.7) * state.width;
      const centerY =
        (0.15 + hashUnit(epoch * 53 + burst * 31) * 0.65) * state.height;
      const radius = age * maximumRadius;
      const fade = Math.pow(1 - age, 1.45);
      const color = sampleGradient(
        paletteColors,
        hashUnit(epoch * 113 + burst * 41),
      );
      for (let y = 0; y < state.height; y += 1) {
        for (let x = 0; x < state.width; x += 1) {
          const distance = Math.hypot(x - centerX, y - centerY);
          const spark = Math.max(0, 1 - Math.abs(distance - radius) * 0.9);
          if (spark <= 0) continue;
          const offset = (y * state.width + x) * 3;
          const current = target.subarray(offset, offset + 3);
          paintEffectPixel(
            target,
            x,
            y,
            color.map((channel, index) =>
              clampByte(current[index] + channel * spark * fade),
            ),
          );
        }
      }
    }
  },
  ripples(time, target, paletteColors) {
    const centers = [
      [state.width * 0.28, state.height * 0.38],
      [state.width * 0.72, state.height * 0.63],
    ];
    for (let y = 0; y < state.height; y += 1) {
      for (let x = 0; x < state.width; x += 1) {
        const waves = centers.map(([centerX, centerY], index) => {
          const distance = Math.hypot(x - centerX, y - centerY);
          return 0.5 + 0.5 * Math.cos(distance * 1.1 - time * (2.6 + index * 0.4));
        });
        const value = Math.pow(Math.max(...waves), 5);
        const color = sampleGradient(
          paletteColors,
          (waves[0] - waves[1]) * 0.5 + time * 0.03,
        );
        paintEffectPixel(
          target,
          x,
          y,
          color.map((channel) => clampByte(channel * value)),
        );
      }
    }
  },
  vortex(time, target, paletteColors) {
    const centerX = (state.width - 1) / 2;
    const centerY = (state.height - 1) / 2;
    for (let y = 0; y < state.height; y += 1) {
      for (let x = 0; x < state.width; x += 1) {
        const dx = x - centerX;
        const dy = y - centerY;
        const radius = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx);
        const phase = angle / (Math.PI * 2) + radius * 0.085 - time * 0.16;
        const pulse = 0.48 + 0.52 * Math.sin(radius * 0.72 - time * 2.1 + angle * 3);
        const color = sampleGradient(paletteColors, phase);
        paintEffectPixel(
          target,
          x,
          y,
          color.map((channel) => clampByte(channel * (0.32 + pulse * 0.68))),
        );
      }
    }
  },
};

function initializeEffectCatalog() {
  const grid = document.querySelector(".effect-grid");
  grid.replaceChildren();
  EFFECT_CATALOG.forEach((effect) => {
    const button = document.createElement("button");
    button.className = `effect-card effect-card--${effect.id}`;
    button.dataset.effect = effect.id;
    button.type = "button";
    const visual = document.createElement("span");
    visual.className = "effect-visual";
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
}

function readTextControls() {
  const select = document.querySelector("#fontSelect");
  const selectedOption = select.selectedOptions[0];
  state.textFont =
    selectedOption?.dataset.family ??
    FONT_STACKS[select.value] ??
    FONT_STACKS.condensed;
  state.textSize = Number(document.querySelector("#fontSize").value);
  state.textDirection = document.querySelector("#textDirection").value;
  document.querySelector("#fontSizeValue").textContent = `${state.textSize}px`;
  updateRangeFill(document.querySelector("#fontSize"));
}

function initializeTextStudio() {
  const fontSelect = document.querySelector("#fontSelect");
  Object.entries(FONT_STACKS).forEach(([id, family]) => {
    fontSelect.querySelector(`option[value="${id}"]`).dataset.family = family;
  });
  fontSelect.addEventListener("change", readTextControls);
  document.querySelector("#fontSize").addEventListener("input", readTextControls);
  document
    .querySelector("#textDirection")
    .addEventListener("change", readTextControls);
  document.querySelector("#fontInput").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    try {
      const family = `SquaresCustom${Date.now()}`;
      const face = new FontFace(family, await file.arrayBuffer());
      await face.load();
      document.fonts.add(face);
      const option = document.createElement("option");
      option.value = family;
      option.dataset.family = `"${family}", sans-serif`;
      option.textContent = `CUSTOM / ${file.name.toUpperCase()}`;
      fontSelect.append(option);
      fontSelect.value = family;
      readTextControls();
      toast(`Loaded font ${file.name} for this browser session.`);
    } catch {
      toast("That font could not be loaded.", true);
    } finally {
      event.target.value = "";
    }
  });
  readTextControls();
}

function startTextMode(text, clock = false) {
  stopMedia();
  stopAnimation();
  state.animationName = clock ? "clock" : "message";
  setOutputContext({
    kind: "text",
    name: clock ? "LOCAL CLOCK" : text.toUpperCase(),
  });
  const textCanvas = document.createElement("canvas");
  const textContext = textCanvas.getContext("2d");
  let offset = state.width;
  let previousFrame = 0;

  const drawText = (content) => {
    textContext.font = `700 ${state.textSize}px ${state.textFont}`;
    const measured = Math.ceil(textContext.measureText(content).width);
    textCanvas.width = Math.max(measured + 8, state.width);
    textCanvas.height = state.height;
    textContext.clearRect(0, 0, textCanvas.width, textCanvas.height);
    textContext.font = `700 ${state.textSize}px ${state.textFont}`;
    textContext.textBaseline = "middle";
    textContext.fillStyle = "white";
    textContext.fillText(content, 2, state.height / 2 + 1);
    return measured;
  };

  let currentText = clock
    ? new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : text.toUpperCase();
  let textWidth = drawText(currentText);
  if (!clock && state.textDirection === "right") offset = -textWidth;

  const tick = (now) => {
    if (state.animationName !== (clock ? "clock" : "message")) return;
    if (now - previousFrame >= (clock ? 500 : 90)) {
      if (clock) {
        const latest = new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
        if (latest !== currentText) {
          currentText = latest;
          textWidth = drawText(currentText);
        }
        offset = Math.floor((state.width - textWidth) / 2);
      } else {
        offset += state.textDirection === "right" ? 1 : -1;
        if (state.textDirection === "right" && offset > state.width + 3) {
          offset = -textWidth;
        } else if (
          state.textDirection === "left" &&
          offset < -textWidth - 3
        ) {
          offset = state.width;
        }
      }

      const sampleContext = document.createElement("canvas").getContext("2d");
      sampleContext.canvas.width = state.width;
      sampleContext.canvas.height = state.height;
      sampleContext.clearRect(0, 0, state.width, state.height);
      sampleContext.drawImage(textCanvas, offset, 0);
      const image = sampleContext.getImageData(0, 0, state.width, state.height).data;
      const color = hexToRgb(colorPicker.value);
      for (let index = 0; index < state.width * state.height; index += 1) {
        const x = index % state.width;
        const y = Math.floor(index / state.width);
        if (!zoneContains(state.zone, x, y, state.width, state.height)) continue;
        const intensity = image[index * 4 + 3] / 255;
        state.pixels[index * 3] = clampByte(color[0] * intensity);
        state.pixels[index * 3 + 1] = clampByte(color[1] * intensity);
        state.pixels[index * 3 + 2] = clampByte(color[2] * intensity);
      }
      render();
      scheduleFrame();
      previousFrame = now;
    }
    state.animationFrame = requestAnimationFrame(tick);
  };
  state.animationFrame = requestAnimationFrame(tick);
}

document.querySelector("#scrollButton").addEventListener("click", () => {
  const text = document.querySelector("#messageInput").value.trim();
  if (!text) {
    toast("Type a message first.", true);
    return;
  }
  startTextMode(text);
});
document.querySelector("#messageInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") document.querySelector("#scrollButton").click();
});
document.querySelector("#clockButton").addEventListener("click", () => startTextMode("", true));

function readSavedPresets() {
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

async function sendBrightness(value) {
  brightnessSlider.value = value;
  updateBrightnessVisual(value);
  if (!state.connected) return;
  applyStatus(
    await api("/api/brightness", {
      method: "POST",
      body: JSON.stringify({ value }),
    }),
  );
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

async function loadPreset(preset, options = {}) {
  stopMedia();
  effectSpeed.value = preset.speed ?? 100;
  effectIntensity.value = preset.intensity ?? 75;
  updateModulationVisuals();
  if (preset.palette) applyPalette(preset.palette);
  if (preset.zone) applyZone(preset.zone);
  if (preset.layers?.overlay) {
    state.overlay = normalizeLayer(preset.layers.overlay);
    updateLayerControls();
  }
  if (preset.transition && !options.transition) {
    state.transition = normalizeTransition(preset.transition);
    updateTransitionControls();
  }
  const selectedTransition = normalizeTransition(
    options.transition ?? preset.transition ?? state.transition,
  );

  try {
    await sendBrightness(preset.brightness ?? brightnessSlider.value);
    let target;
    if (preset.effect && effectById(preset.effect) && effectPainters[preset.effect]) {
      target = new Uint8Array(state.pixels.length);
      renderGeneratedFrame(
        preset.effect,
        0,
        state.pixels.slice(),
        target,
      );
    } else {
      if (
        preset.width !== state.width ||
        preset.height !== state.height ||
        !Array.isArray(preset.pixels) ||
        preset.pixels.length !== state.pixels.length
      ) {
        throw new Error("This preset was saved for a different panel layout.");
      }
      target = new Uint8Array(preset.pixels);
    }
    const completed = await transitionToFrame(target, selectedTransition);
    if (!completed) return false;
    if (preset.effect && effectById(preset.effect) && effectPainters[preset.effect]) {
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
  previewLabel.textContent =
    state.outputContext.sceneKey === key
      ? "ON AIR"
      : saved
        ? "SAVED"
        : "BUILT-IN";
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
  copy.append(name, details);
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
    const deleteButton = document.createElement("button");
    deleteButton.className = "preset-delete";
    deleteButton.type = "button";
    deleteButton.setAttribute("aria-label", `Delete ${preset.name}`);
    deleteButton.textContent = "×";
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
    row.append(deleteButton);
  }

  return row;
}

function renderPresets() {
  const presetList = document.querySelector("#presetList");
  presetList.replaceChildren();
  builtInPresets.forEach((preset) => {
    presetList.append(createPresetRow(preset));
  });
  state.library.scenes.forEach((preset) => {
    presetList.append(createPresetRow(preset, true));
  });
}

async function saveCurrentPreset() {
  const input = document.querySelector("#presetName");
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
  });
  if (existing) preset.id = existing.id;

  try {
    const response = await api("/api/scenes", {
      method: "POST",
      body: JSON.stringify(preset),
    });
    input.value = "";
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
      const { id: _legacyId, ...portablePreset } = preset;
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

function sceneForId(sceneId) {
  return state.library.scenes.find((scene) => scene.id === sceneId);
}

function populatePlaylistSceneSelect() {
  const select = document.querySelector("#playlistSceneSelect");
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
    option.value = scene.id;
    option.textContent = scene.name;
    select.append(option);
  });
}

function renderPlaylistDraft() {
  const draft = document.querySelector("#playlistDraft");
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

function stopPlaylist(showNotice = false) {
  clearTimeout(state.playlistTimer);
  clearInterval(state.playlistProgressTimer);
  state.playlistTimer = null;
  state.playlistProgressTimer = null;
  const wasRunning = Boolean(state.activePlaylistId);
  state.activePlaylistId = null;
  state.activePlaylistStep = null;
  renderPlaylists();
  updateSceneMonitor();
  if (showNotice && wasRunning) toast("Playlist stopped.");
}

async function runPlaylistStep(playlist, index) {
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
  if (!loaded || state.activePlaylistId !== playlist.id) return;
  state.activePlaylistStep = {
    index,
    startedAt: Date.now(),
    duration: step.duration,
    transition: step.transition,
  };
  updateSceneMonitor();
  state.playlistTimer = setTimeout(() => {
    const next = advancePlaylist(index, playlist.steps.length, playlist.repeat);
    if (next.done) {
      stopPlaylist();
      toast(`${playlist.name} finished.`);
      return;
    }
    void runPlaylistStep(playlist, next.index);
  }, step.duration * 1000);
}

function playPlaylist(playlist) {
  stopPlaylist();
  state.activePlaylistId = playlist.id;
  state.playlistProgressTimer = setInterval(updateSceneMonitor, 250);
  renderPlaylists();
  updateSceneMonitor();
  toast(`Running ${playlist.name}.`);
  void runPlaylistStep(playlist, 0);
}

function renderPlaylists() {
  const list = document.querySelector("#playlistList");
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
        toast(error.message, true);
      }
    });
    row.append(play, runtime, remove);
    list.append(row);
  });
}

function renderAutomations() {
  const list = document.querySelector("#automationList");
  list.replaceChildren();
  state.automations.forEach((automation) => {
    const row = document.createElement("div");
    row.className = "automation-row";
    row.classList.toggle("inactive", !automation.enabled);
    const copy = document.createElement("div");
    copy.className = "automation-copy";
    const name = document.createElement("strong");
    name.textContent = automation.name;
    const detail = document.createElement("small");
    detail.textContent = describeAutomation(automation);
    copy.append(name, detail);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = automation.enabled ? "PAUSE" : "ARM";
    toggle.setAttribute(
      "aria-label",
      `${automation.enabled ? "Pause" : "Arm"} ${automation.name}`,
    );
    toggle.addEventListener("click", async () => {
      try {
        await api("/api/automations", {
          method: "POST",
          body: JSON.stringify({ ...automation, enabled: !automation.enabled }),
        });
        await loadAutomations();
      } catch (error) {
        toast(error.message, true);
      }
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Delete ${automation.name}`);
    remove.addEventListener("click", async () => {
      try {
        await api(`/api/automations/${encodeURIComponent(automation.id)}`, {
          method: "DELETE",
        });
        await loadAutomations();
        toast(`Deleted ${automation.name}.`);
      } catch (error) {
        toast(error.message, true);
      }
    });
    row.append(copy, toggle, remove);
    list.append(row);
  });
}

async function loadAutomations() {
  const response = await api("/api/automations");
  state.automations = Array.isArray(response.automations)
    ? response.automations
    : [];
  renderAutomations();
}

async function saveAutomation(automation) {
  await api("/api/automations", {
    method: "POST",
    body: JSON.stringify(automation),
  });
  await loadAutomations();
}

function updateAutomationValueState() {
  const action = document.querySelector("#automationAction").value;
  const input = document.querySelector("#automationValue");
  input.disabled = !["wake", "brightness"].includes(action);
}

function initializeAutomations() {
  document.querySelector("#wakeAt").value = localDateTime(
    new Date(Date.now() + 8 * 60 * 60 * 1000),
  );
  document
    .querySelector("#automationAction")
    .addEventListener("change", updateAutomationValueState);
  updateAutomationValueState();

  document
    .querySelector("#scheduleSleepButton")
    .addEventListener("click", async () => {
      try {
        const automation = buildSleepAutomation(
          document.querySelector("#sleepMinutes").value,
        );
        await saveAutomation(automation);
        toast(`${automation.name} armed.`);
      } catch (error) {
        toast(error.message, true);
      }
    });

  document
    .querySelector("#scheduleWakeButton")
    .addEventListener("click", async () => {
      const runAt = document.querySelector("#wakeAt").value;
      const value = Number(document.querySelector("#wakeBrightness").value);
      if (!runAt || new Date(runAt).getTime() <= Date.now()) {
        toast("Choose a future wake time.", true);
        return;
      }
      try {
        await saveAutomation({
          name: "WAKE",
          kind: "once",
          runAt,
          action: "wake",
          value,
        });
        toast("Wake action armed.");
      } catch (error) {
        toast(error.message, true);
      }
    });

  document
    .querySelector("#saveAutomationButton")
    .addEventListener("click", async () => {
      const action = document.querySelector("#automationAction").value;
      const time = document.querySelector("#automationTime").value;
      const nameInput = document.querySelector("#automationName");
      const name =
        nameInput.value.trim().toUpperCase() ||
        `DAILY ${action.toUpperCase()}`;
      const automation = {
        name,
        kind: "daily",
        time,
        days: daysForPreset(document.querySelector("#automationDays").value),
        action,
        ...(["wake", "brightness"].includes(action)
          ? { value: Number(document.querySelector("#automationValue").value) }
          : {}),
      };
      try {
        await saveAutomation(automation);
        nameInput.value = "";
        toast(`Saved ${name}.`);
      } catch (error) {
        toast(error.message, true);
      }
    });

  void loadAutomations().catch((error) =>
    toast(`Automation unavailable: ${error.message}`, true),
  );
}

async function loadLibrary() {
  const library = normalizeLibrary(await api("/api/library"));
  state.library = library;
  state.playlistDraft = state.playlistDraft.filter((step) => sceneForId(step.sceneId));
  renderPresets();
  populatePlaylistSceneSelect();
  renderPlaylistDraft();
  renderPlaylists();
}

async function initializeLibrary() {
  try {
    await migrateBrowserPresets();
    await loadLibrary();
  } catch (error) {
    toast(`Scene library unavailable: ${error.message}`, true);
    renderPresets();
  }
}

document
  .querySelector("#savePresetButton")
  .addEventListener("click", () => void saveCurrentPreset());
document.querySelector("#presetName").addEventListener("keydown", (event) => {
  if (event.key === "Enter") void saveCurrentPreset();
});

document.querySelector("#addPlaylistStepButton").addEventListener("click", () => {
  const sceneId = document.querySelector("#playlistSceneSelect").value;
  const duration = Number(document.querySelector("#playlistDuration").value);
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
    transition: document.querySelector("#playlistTransition").value,
  });
  renderPlaylistDraft();
});

document.querySelector("#savePlaylistButton").addEventListener("click", async () => {
  const nameInput = document.querySelector("#playlistName");
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
        repeat: document.querySelector("#playlistRepeat").checked,
        steps: state.playlistDraft,
      }),
    });
    nameInput.value = "";
    state.playlistDraft = [];
    await loadLibrary();
    toast(`Saved ${name}.`);
  } catch (error) {
    toast(error.message, true);
  }
});

document
  .querySelector("#stopPlaylistButton")
  .addEventListener("click", () => stopPlaylist(true));

document.querySelector("#exportLibraryButton").addEventListener("click", async () => {
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

document.querySelector("#importLibraryInput").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    const library = JSON.parse(await file.text());
    await api("/api/library/import", {
      method: "POST",
      body: JSON.stringify({ library, merge: true }),
    });
    await loadLibrary();
    toast(`Imported ${file.name}.`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    event.target.value = "";
  }
});

render();
updateSceneMonitor();
updateModulationVisuals();
initializeEffectCatalog();
initializePalettes();
initializeZones();
initializeLayers();
initializeTransitions();
initializeMediaControls();
initializeTextStudio();
initializeAutomations();
renderPresets();
renderPlaylistDraft();
void loadStatus();
void initializeLibrary();
startStateSync();
setInterval(() => {
  if (!state.animationName) void loadStatus();
  void loadAutomations().catch(() => {});
}, 60_000);
