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

function applyStatus(status) {
  setConnection(status);
  document.querySelector("#resolutionReadout").textContent = `${status.width}×${status.height}`;
  document.querySelector("#pixelReadout").textContent = status.ledCount;
  document.querySelector("#fpsReadout").textContent = status.frameRate;
  document.querySelector("#firmwareReadout").textContent = `FW ${status.firmware}`;
  document.querySelector("#routeReadout").textContent = status.ip;
  document.querySelector("#modeReadout").textContent = status.streaming
    ? "LIVE"
    : status.mode.toUpperCase();
  brightnessSlider.value = status.brightness;
  updateBrightnessVisual(status.brightness);
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
    applyStatus(status);
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
  for (let index = 0; index < state.width * state.height; index += 1) {
    state.pixels.set(color, index * 3);
  }
  render();
  scheduleFrame();
});

document.querySelector("#clearButton").addEventListener("click", () => {
  stopAnimation();
  state.pixels.fill(0);
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
    for (let index = 0; index < state.width * state.height; index += 1) {
      state.pixels[index * 3] = data[index * 4];
      state.pixels[index * 3 + 1] = data[index * 4 + 1];
      state.pixels[index * 3 + 2] = data[index * 4 + 2];
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

let brightnessTimer;
brightnessSlider.addEventListener("input", () => {
  updateBrightnessVisual(brightnessSlider.value);
  clearTimeout(brightnessTimer);
  brightnessTimer = setTimeout(async () => {
    try {
      applyStatus(
        await api("/api/brightness", {
          method: "POST",
          body: JSON.stringify({ value: brightnessSlider.value }),
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
        const hue = x * 5.2 - y * 2.4 + time * 28 + wave * 24;
        setPixel(x, y, hslToRgb(hue, 0.88, 0.28 + (wave + 3) * 0.045));
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
        setPixel(x, y, [clampByte(value * 155), clampByte(value * 255), clampByte(value * 80)]);
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
        setPixel(x, y, [
          clampByte(heat * 255),
          clampByte(Math.max(0, heat - 0.24) * 175),
          clampByte(Math.max(0, heat - 0.68) * 80),
        ]);
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
        setPixel(x, y, [
          clampByte(b * 225 + a * 25),
          clampByte(a * 230 + b * 45),
          clampByte(a * 215 + b * 250),
        ]);
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

function writeSavedPresets(presets) {
  localStorage.setItem(
    PRESET_STORAGE_KEY,
    JSON.stringify(presets.slice(0, MAX_SAVED_PRESETS)),
  );
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
  loadButton.addEventListener("click", () => void loadPreset(preset));
  row.append(loadButton);

  if (saved) {
    const deleteButton = document.createElement("button");
    deleteButton.className = "preset-delete";
    deleteButton.type = "button";
    deleteButton.setAttribute("aria-label", `Delete ${preset.name}`);
    deleteButton.textContent = "×";
    deleteButton.addEventListener("click", () => {
      const remaining = readSavedPresets().filter((item) => item.id !== preset.id);
      try {
        writeSavedPresets(remaining);
        renderPresets();
        toast(`Deleted ${preset.name}.`);
      } catch {
        toast("Browser storage is unavailable.", true);
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
  readSavedPresets().forEach((preset) => {
    presetList.append(createPresetRow(preset, true));
  });
}

function saveCurrentPreset() {
  const input = document.querySelector("#presetName");
  const name = input.value.trim().toUpperCase();
  if (!name) {
    toast("Name the preset first.", true);
    input.focus();
    return;
  }

  const presets = readSavedPresets();
  const existing = presets.findIndex((preset) => preset.name === name);
  const effect = Object.hasOwn(effectPainters, state.animationName)
    ? state.animationName
    : null;
  const preset = {
    id: existing >= 0 ? presets[existing].id : `${Date.now()}-${Math.random()}`,
    name,
    effect,
    width: state.width,
    height: state.height,
    pixels: effect ? null : Array.from(state.pixels),
    speed: Number(effectSpeed.value),
    intensity: Number(effectIntensity.value),
    brightness: Number(brightnessSlider.value),
  };

  if (existing >= 0) presets.splice(existing, 1);
  presets.unshift(preset);
  try {
    writeSavedPresets(presets);
    input.value = "";
    renderPresets();
    toast(`Saved ${name} in this browser.`);
  } catch {
    toast("Browser storage is unavailable or full.", true);
  }
}

document
  .querySelector("#savePresetButton")
  .addEventListener("click", saveCurrentPreset);
document.querySelector("#presetName").addEventListener("keydown", (event) => {
  if (event.key === "Enter") saveCurrentPreset();
});

render();
updateModulationVisuals();
renderPresets();
void loadStatus();
setInterval(() => {
  if (!state.animationName) void loadStatus();
}, 15_000);
