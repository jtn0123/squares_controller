import { $, colorPicker, updateRangeFill } from "./dom.js";
import { FONT_STACKS, state } from "./app_state.js";
import { clampByte, hexToRgb } from "./color_utils.js";
import { scheduleFrame, toast } from "./net.js";
import { stopAnimation, stopMedia } from "./playback.js";
import { render } from "./render_core.js";
import { setOutputContext } from "./monitor.js";
import { zoneContains } from "./zone_model.js";

function readTextControls() {
  const select = $("#fontSelect");
  const selectedOption = select.selectedOptions[0];
  state.textFont =
    selectedOption?.dataset.family ??
    FONT_STACKS[select.value] ??
    FONT_STACKS.condensed;
  state.textSize = Number($("#fontSize").value);
  state.textDirection = $("#textDirection").value;
  $("#fontSizeValue").textContent = `${state.textSize}px`;
  updateRangeFill($("#fontSize"));
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

export function initializeTextStudio() {
  const fontSelect = $("#fontSelect");
  Object.entries(FONT_STACKS).forEach(([id, family]) => {
    fontSelect.querySelector(`option[value="${id}"]`).dataset.family = family;
  });
  fontSelect.addEventListener("change", readTextControls);
  $("#fontSize").addEventListener("input", readTextControls);
  $("#textDirection").addEventListener("change", readTextControls);
  $("#fontInput").addEventListener("change", async (event) => {
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
  $("#scrollButton").addEventListener("click", () => {
    const text = $("#messageInput").value.trim();
    if (!text) {
      toast("Type a message first.", true);
      return;
    }
    startTextMode(text);
  });
  $("#messageInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") $("#scrollButton").click();
  });
  $("#clockButton").addEventListener("click", () => startTextMode("", true));
  readTextControls();
}
