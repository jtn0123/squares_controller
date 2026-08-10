import { $, mediaCanvas, mediaContext, updateRangeFill } from "./dom.js";
import { state } from "./app_state.js";
import { scheduleFrame, toast } from "./net.js";
import { stopAnimation, stopMedia } from "./playback.js";
import { render } from "./render_core.js";
import { setOutputContext } from "./monitor.js";
import { adjustRgb, fitRect, normalizeMediaControls } from "./media_model.js";
import { startPacedLoop } from "./frame_timing.js";

function currentMediaControls() {
  return normalizeMediaControls({
    fit: $<HTMLSelectElement>("#mediaFit").value,
    sampling: $<HTMLSelectElement>("#mediaSampling").value,
    saturation: Number($<HTMLInputElement>("#mediaSaturation").value) / 100,
    contrast: Number($<HTMLInputElement>("#mediaContrast").value) / 100,
    brightness: 1,
    gamma: Number($<HTMLInputElement>("#mediaGamma").value) / 100,
  });
}

export function renderMediaPixels(
  media: HTMLVideoElement | HTMLImageElement | null,
): Uint8Array | undefined {
  if (!media) return;
  // Videos report videoWidth, images naturalWidth; the union type hides
  // each side's fields, so read the sizes through a merged view of both.
  const source = media as Partial<HTMLVideoElement> &
    Partial<HTMLImageElement> & { width: number; height: number };
  const sourceWidth = source.videoWidth || source.naturalWidth || source.width;
  const sourceHeight = source.videoHeight || source.naturalHeight || source.height;
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
  const pixels = new Uint8Array(state.width * state.height * 3);
  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      const index = y * state.width + x;
      pixels.set(
        adjustRgb(
          [data[index * 4], data[index * 4 + 1], data[index * 4 + 2]],
          controls,
        ),
        index * 3,
      );
    }
  }
  return pixels;
}

export function drawMediaFrame(): void {
  const pixels = renderMediaPixels(state.mediaElement);
  if (!pixels) return;
  state.pixels.set(pixels);
  render();
  scheduleFrame();
}

export function startMediaLoop(kind: string): void {
  $("#mediaModeReadout").textContent = kind;
  // Video and GIF content advance on their own clock; sampling them at a
  // steady cadence is what keeps their motion even on the wall.
  state.mediaFrame = startPacedLoop(() => {
    if (!state.mediaElement) return;
    drawMediaFrame();
  });
}

function updateMediaControls(): void {
  $("#mediaSaturationValue").textContent =
    `${$<HTMLInputElement>("#mediaSaturation").value}%`;
  $("#mediaContrastValue").textContent =
    `${$<HTMLInputElement>("#mediaContrast").value}%`;
  $("#mediaGammaValue").textContent =
    (Number($<HTMLInputElement>("#mediaGamma").value) / 100).toFixed(2);
  $("#mediaSpeedValue").textContent =
    `${(Number($<HTMLInputElement>("#mediaSpeed").value) / 100).toFixed(2)}×`;
  [
    "mediaSaturation",
    "mediaContrast",
    "mediaGamma",
    "mediaSpeed",
  ].forEach((id) => updateRangeFill($<HTMLInputElement>(`#${id}`)));
  if (
    state.mediaElement instanceof HTMLVideoElement &&
    !state.mediaStream
  ) {
    state.mediaElement.playbackRate =
      Number($<HTMLInputElement>("#mediaSpeed").value) / 100;
  }
  if (state.mediaElement && !state.mediaFrame) drawMediaFrame();
}

function loadMediaFile(file: File): void {
  stopMedia();
  stopAnimation();
  state.animationName = "media";
  setOutputContext({ kind: "media", name: file.name.toUpperCase() });
  const url = URL.createObjectURL(file);
  if (!url.startsWith("blob:")) {
    // createObjectURL always yields a local blob: URL; making the
    // invariant explicit keeps user file content from ever being treated
    // as a navigable URL.
    throw new Error("Media object URLs must be blob: URLs.");
  }
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
        video.playbackRate = Number($<HTMLInputElement>("#mediaSpeed").value) / 100;
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
        else $("#mediaModeReadout").textContent = "IMAGE";
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
}

export function initializeMediaControls(): void {
  ["mediaFit", "mediaSampling"].forEach((id) => {
    $(`#${id}`).addEventListener("change", () => {
      if (state.mediaElement) drawMediaFrame();
    });
  });
  [
    "mediaSaturation",
    "mediaContrast",
    "mediaGamma",
    "mediaSpeed",
  ].forEach((id) => {
    $(`#${id}`).addEventListener("input", updateMediaControls);
  });
  $("#stopMediaButton").addEventListener("click", () => {
    if (state.animationName === "audio") {
      stopAnimation();
      $("#mediaModeReadout").textContent = "FRAME HELD";
      toast("Audio input stopped. The last frame remains live.");
    } else {
      stopMedia(true);
    }
  });
  const imageInput = $<HTMLInputElement>("#imageInput");
  imageInput.addEventListener("change", () => {
    // A file input always exposes a FileList.
    const [file] = imageInput.files!;
    if (!file) return;
    loadMediaFile(file);
    imageInput.value = "";
  });
  updateMediaControls();
}
