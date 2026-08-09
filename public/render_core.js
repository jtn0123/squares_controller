import { $, canvas, context, sceneMonitorCanvas } from "./dom.js";
import { state } from "./app_state.js";
import { zoneBounds, zoneContains } from "./zone_model.js";

export function setPixel(x, y, rgb) {
  if (x < 0 || y < 0 || x >= state.width || y >= state.height) return;
  if (!zoneContains(state.zone, x, y, state.width, state.height)) return;
  const offset = (y * state.width + x) * 3;
  state.pixels[offset] = rgb[0];
  state.pixels[offset + 1] = rgb[1];
  state.pixels[offset + 2] = rgb[2];
}

export function drawRgbCanvas(targetCanvas, pixels, width, height) {
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

export function renderSceneMirrors() {
  drawRgbCanvas(
    sceneMonitorCanvas,
    state.pixels,
    state.width,
    state.height,
  );
  const activeSceneCanvas = $(".preset-row.active .scene-preview-canvas");
  if (activeSceneCanvas) {
    drawRgbCanvas(activeSceneCanvas, state.pixels, state.width, state.height);
  }
}

export function render() {
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
