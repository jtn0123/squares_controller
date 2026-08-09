import { $, $$, canvas, colorPicker, colorValue } from "./dom.js";
import { state } from "./app_state.js";
import { hexToRgb } from "./color_utils.js";
import { scheduleFrame, toast } from "./net.js";
import { stopAnimation, stopMedia } from "./playback.js";
import { drawRgbCanvas, render, setPixel } from "./render_core.js";
import { setOutputContext } from "./monitor.js";
import { clipFrameIndex, MAX_CLIP_FRAMES } from "./clip_model.js";

function setEraserActive(active: boolean): void {
  state.erasing = active;
  const eraser = $("#eraserButton");
  eraser.classList.toggle("active", active);
  eraser.setAttribute("aria-pressed", String(active));
}

function paintAtEvent(event: PointerEvent): void {
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

export function initializeDrawTools(): void {
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
    setEraserActive(false);
  });

  $$("[data-color]").forEach((button) => {
    button.addEventListener("click", () => {
      // The [data-color] selector guarantees the attribute exists.
      colorPicker.value = button.dataset.color!;
      colorValue.textContent = button.dataset.color!.toUpperCase();
      setEraserActive(false);
    });
  });

  $$("[data-brush]").forEach((button) => {
    button.addEventListener("click", () => {
      state.brush = Number(button.dataset.brush);
      $$("[data-brush]").forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
    });
  });

  $("#eraserButton").addEventListener("click", () => {
    setEraserActive(!state.erasing);
  });

  $("#fillButton").addEventListener("click", () => {
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

  $("#clearButton").addEventListener("click", () => {
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
}

function updateClipSelectionVisual(index: number): void {
  $(".clip-frame.active")?.classList.remove("active");
  $(`[data-clip-frame="${index}"]`)?.classList.add("active");
}

export function renderClipTimeline(): void {
  const timeline = $("#clipTimeline");
  if (!timeline) return;
  const frames = state.clip.frames;
  const selected = frames[state.clip.selected] ? state.clip.selected : -1;
  state.clip.selected = selected;
  timeline.replaceChildren();
  frames.forEach((frame, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "clip-frame";
    button.dataset.clipFrame = String(index);
    button.classList.toggle("active", index === selected);
    button.setAttribute("aria-label", `Select clip frame ${index + 1}`);
    const preview = document.createElement("canvas");
    drawRgbCanvas(preview, frame.pixels, state.width, state.height);
    const label = document.createElement("span");
    label.textContent = `${index + 1} / ${frame.duration}ms`;
    button.append(preview, label);
    button.addEventListener("click", () => selectClipFrame(index));
    timeline.append(button);
  });
  if (!frames.length) {
    const empty = document.createElement("small");
    empty.className = "local-note";
    empty.textContent = "CAPTURE THE CURRENT WALL TO CREATE FRAME 01.";
    timeline.append(empty);
  }
  const hasSelection = selected >= 0;
  ["updateClipFrame", "duplicateClipFrame", "deleteClipFrame"].forEach((id) => {
    $<HTMLButtonElement>(`#${id}`).disabled = !hasSelection;
  });
  $<HTMLButtonElement>("#playClip").disabled = frames.length < 2;
  const duration = $<HTMLInputElement>("#clipFrameDuration");
  duration.disabled = !hasSelection;
  duration.value = String(hasSelection ? frames[selected].duration : 250);
  $("#clipFrameDurationValue").textContent = `${duration.value}ms`;
  $("#clipStatus").textContent =
    `${frames.length} / ${MAX_CLIP_FRAMES} FRAMES`;
}

function selectClipFrame(index: number): void {
  const frame = state.clip.frames[index];
  if (!frame) return;
  stopMedia();
  stopAnimation();
  state.clip.selected = index;
  state.pixels.set(frame.pixels);
  setOutputContext({ kind: "clip", name: `PIXEL CLIP / FRAME ${index + 1}` });
  render();
  scheduleFrame();
  renderClipTimeline();
}

function startClipPlayback(): void {
  if (state.animationName === "clip") {
    stopAnimation(true);
    return;
  }
  if (state.clip.frames.length < 2) {
    toast("Capture at least two frames before playing a clip.", true);
    return;
  }
  stopMedia();
  stopAnimation();
  state.animationName = "clip";
  setOutputContext({ kind: "clip", name: "PIXEL CLIP LOOP" });
  const button = $("#playClip");
  button.classList.add("active");
  button.setAttribute("aria-pressed", "true");
  button.textContent = "■ STOP LOOP";
  const startedAt = performance.now();
  let previousIndex = -1;
  const tick = (now: number): void => {
    if (state.animationName !== "clip") return;
    const index = clipFrameIndex(state.clip.frames, now - startedAt);
    if (index !== previousIndex) {
      previousIndex = index;
      state.clip.selected = index;
      state.pixels.set(state.clip.frames[index].pixels);
      render();
      scheduleFrame();
      updateClipSelectionVisual(index);
    }
    state.animationFrame = requestAnimationFrame(tick);
  };
  state.animationFrame = requestAnimationFrame(tick);
}

export function initializeClipStudio(): void {
  $("#captureClipFrame").addEventListener("click", () => {
    if (state.clip.frames.length >= MAX_CLIP_FRAMES) {
      toast("Pixel clips are capped at 32 frames.", true);
      return;
    }
    const selected = state.clip.frames[state.clip.selected];
    state.clip.frames.push({
      pixels: state.pixels.slice(),
      duration: selected?.duration ?? 250,
    });
    state.clip.selected = state.clip.frames.length - 1;
    renderClipTimeline();
    toast(`Captured frame ${state.clip.selected + 1}.`);
  });
  $("#updateClipFrame").addEventListener("click", () => {
    const frame = state.clip.frames[state.clip.selected];
    if (!frame) return;
    frame.pixels = state.pixels.slice();
    renderClipTimeline();
    toast(`Updated frame ${state.clip.selected + 1}.`);
  });
  $("#duplicateClipFrame").addEventListener("click", () => {
    const frame = state.clip.frames[state.clip.selected];
    if (!frame) return;
    if (state.clip.frames.length >= MAX_CLIP_FRAMES) {
      toast("Pixel clips are capped at 32 frames.", true);
      return;
    }
    state.clip.frames.splice(state.clip.selected + 1, 0, {
      pixels: frame.pixels.slice(),
      duration: frame.duration,
    });
    state.clip.selected += 1;
    renderClipTimeline();
  });
  $("#deleteClipFrame").addEventListener("click", () => {
    if (state.animationName === "clip") stopAnimation();
    state.clip.frames.splice(state.clip.selected, 1);
    state.clip.selected = Math.min(
      state.clip.selected,
      state.clip.frames.length - 1,
    );
    if (state.clip.selected >= 0) {
      state.pixels.set(state.clip.frames[state.clip.selected].pixels);
      render();
      scheduleFrame();
    }
    renderClipTimeline();
  });
  const durationInput = $<HTMLInputElement>("#clipFrameDuration");
  durationInput.addEventListener("input", () => {
    const frame = state.clip.frames[state.clip.selected];
    if (!frame) return;
    frame.duration = Math.max(25, Math.min(2_000, Number(durationInput.value)));
    $("#clipFrameDurationValue").textContent = `${frame.duration}ms`;
    $(`[data-clip-frame="${state.clip.selected}"] span`).textContent =
      `${state.clip.selected + 1} / ${frame.duration}ms`;
  });
  $("#playClip").addEventListener("click", startClipPlayback);
  renderClipTimeline();
}
