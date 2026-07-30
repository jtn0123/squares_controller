import {
  brightnessFromStatus,
  statusOptionsForSource,
} from "./status_sync.js";
import {
  advancePlaylist,
  createSceneSnapshot,
  normalizeLibrary,
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

const canvas = document.querySelector("#pixelCanvas");
const context = canvas.getContext("2d", { alpha: false });
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
  activePlaylistId: null,
  palette: normalizePalette(null),
  zone: { type: "all" },
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
}

function stopAnimation(showNotice = false) {
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
  stopAnimation();
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
  stopAnimation();
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
  stopAnimation();
  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      setPixel(x, y, [0, 0, 0]);
    }
  }
  render();
  scheduleFrame();
});

document.querySelector("#imageInput").addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (!file) return;
  const image = new Image();
  image.onload = () => {
    stopAnimation();
    const buffer = document.createElement("canvas");
    buffer.width = state.width;
    buffer.height = state.height;
    const bufferContext = buffer.getContext("2d");
    bufferContext.imageSmoothingEnabled = true;
    bufferContext.drawImage(image, 0, 0, state.width, state.height);
    const data = bufferContext.getImageData(0, 0, state.width, state.height).data;
    for (let y = 0; y < state.height; y += 1) {
      for (let x = 0; x < state.width; x += 1) {
        const index = y * state.width + x;
        setPixel(x, y, [
          data[index * 4],
          data[index * 4 + 1],
          data[index * 4 + 2],
        ]);
      }
    }
    render();
    scheduleFrame();
    URL.revokeObjectURL(image.src);
    toast(`Loaded ${file.name} onto the 32×24 stage.`);
  };
  image.src = URL.createObjectURL(file);
  event.target.value = "";
});

function updateBrightnessVisual(value) {
  brightnessValue.textContent = `${value}%`;
  updateRangeFill(brightnessSlider);
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
  stopAnimation();
  try {
    applyStatus(
      await api("/api/mode", {
        method: "POST",
        body: JSON.stringify({ mode }),
      }),
    );
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

function startGeneratedEffect(name, painter) {
  stopAnimation();
  state.animationName = name;
  document
    .querySelector(`[data-effect="${name}"]`)
    ?.classList.add("active");
  const startedAt = performance.now();
  let previousFrame = 0;

  const tick = (now) => {
    if (state.animationName !== name) return;
    if (now - previousFrame >= 50) {
      painter(((now - startedAt) / 1000) * state.effectSpeed);
      for (let index = 0; index < state.pixels.length; index += 1) {
        state.pixels[index] = clampByte(
          state.pixels[index] * state.effectIntensity,
        );
      }
      render();
      scheduleFrame();
      previousFrame = now;
    }
    state.animationFrame = requestAnimationFrame(tick);
  };
  state.animationFrame = requestAnimationFrame(tick);
}

const effectPainters = {
  tide(time) {
    for (let y = 0; y < state.height; y += 1) {
      for (let x = 0; x < state.width; x += 1) {
        const wave =
          Math.sin(x * 0.24 + time * 1.3) +
          Math.cos(y * 0.31 - time * 0.95) +
          Math.sin((x + y) * 0.11 + time * 0.7);
        const phase = (x * 0.018 - y * 0.011 + time * 0.075 + wave * 0.08);
        const color = sampleGradient(state.palette.colors, phase);
        const gain = 0.58 + (wave + 3) * 0.075;
        setPixel(x, y, color.map((channel) => clampByte(channel * gain)));
      }
    }
  },
  radar(time) {
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
          state.palette.colors,
          angle / (Math.PI * 2) + time * 0.035,
        );
        setPixel(x, y, color.map((channel) => clampByte(channel * value)));
      }
    }
  },
  ember(time) {
    for (let y = 0; y < state.height; y += 1) {
      for (let x = 0; x < state.width; x += 1) {
        const rise = 1 - y / state.height;
        const noise =
          Math.sin(x * 1.31 + time * 3.1) *
          Math.sin(y * 0.73 - time * 2.3) *
          Math.sin((x + y) * 0.42 + time);
        const heat = Math.max(0, rise * 0.72 + noise * 0.33 - 0.08);
        const color = sampleGradient(state.palette.colors, heat * 0.82);
        setPixel(
          x,
          y,
          color.map((channel) => clampByte(channel * Math.min(1, heat * 1.35))),
        );
      }
    }
  },
  orbit(time) {
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
        const firstColor = sampleGradient(state.palette.colors, time * 0.025 + 0.2);
        const secondColor = sampleGradient(state.palette.colors, -time * 0.02 + 0.72);
        setPixel(
          x,
          y,
          firstColor.map((channel, index) =>
            clampByte(channel * a + secondColor[index] * b),
          ),
        );
      }
    }
  },
};

document.querySelectorAll("[data-effect]").forEach((button) => {
  button.addEventListener("click", () => {
    const name = button.dataset.effect;
    startGeneratedEffect(name, effectPainters[name]);
  });
});

function startTextMode(text, clock = false) {
  stopAnimation();
  state.animationName = clock ? "clock" : "message";
  const textCanvas = document.createElement("canvas");
  const textContext = textCanvas.getContext("2d");
  let offset = state.width;
  let previousFrame = 0;

  const drawText = (content) => {
    textContext.font = '700 13px "Avenir Next Condensed", sans-serif';
    const measured = Math.ceil(textContext.measureText(content).width);
    textCanvas.width = Math.max(measured + 8, state.width);
    textCanvas.height = state.height;
    textContext.clearRect(0, 0, textCanvas.width, textCanvas.height);
    textContext.font = '700 13px "Avenir Next Condensed", sans-serif';
    textContext.textBaseline = "middle";
    textContext.fillStyle = "white";
    textContext.fillText(content, 2, state.height / 2 + 1);
    return measured;
  };

  let currentText = clock
    ? new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : text.toUpperCase();
  let textWidth = drawText(currentText);

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
        offset -= 1;
        if (offset < -textWidth - 3) offset = state.width;
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

async function loadPreset(preset) {
  effectSpeed.value = preset.speed ?? 100;
  effectIntensity.value = preset.intensity ?? 75;
  updateModulationVisuals();
  if (preset.palette) applyPalette(preset.palette);
  if (preset.zone) applyZone(preset.zone);

  try {
    await sendBrightness(preset.brightness ?? brightnessSlider.value);
    if (preset.effect && effectPainters[preset.effect]) {
      startGeneratedEffect(preset.effect, effectPainters[preset.effect]);
    } else {
      if (
        preset.width !== state.width ||
        preset.height !== state.height ||
        !Array.isArray(preset.pixels) ||
        preset.pixels.length !== state.pixels.length
      ) {
        throw new Error("This preset was saved for a different panel layout.");
      }
      stopAnimation();
      state.pixels.set(preset.pixels);
      render();
      scheduleFrame();
    }
    toast(`Loaded ${preset.name}.`);
  } catch (error) {
    toast(error.message, true);
  }
}

function createPresetRow(preset, saved = false) {
  const row = document.createElement("div");
  row.className = "preset-row";

  const loadButton = document.createElement("button");
  loadButton.className = "preset-load";
  loadButton.type = "button";
  const name = document.createElement("span");
  name.textContent = preset.name;
  const type = document.createElement("small");
  type.textContent = preset.effect ? preset.effect.toUpperCase() : "FRAME";
  loadButton.append(name, type);
  loadButton.addEventListener("click", () => {
    stopPlaylist();
    void loadPreset(preset);
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
        await loadLibrary();
        renderPresets();
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
  });
  if (existing) preset.id = existing.id;

  try {
    await api("/api/scenes", {
      method: "POST",
      body: JSON.stringify(preset),
    });
    input.value = "";
    await loadLibrary();
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
    duration.textContent = `${step.duration}s`;
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
  state.playlistTimer = null;
  const wasRunning = Boolean(state.activePlaylistId);
  state.activePlaylistId = null;
  renderPlaylists();
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
  await loadPreset(scene);
  if (state.activePlaylistId !== playlist.id) return;
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
  renderPlaylists();
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
  state.playlistDraft.push({ sceneId, duration, transition: "cut" });
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
updateModulationVisuals();
initializePalettes();
initializeZones();
renderPresets();
renderPlaylistDraft();
void loadStatus();
void initializeLibrary();
startStateSync();
setInterval(() => {
  if (!state.animationName) void loadStatus();
}, 60_000);
