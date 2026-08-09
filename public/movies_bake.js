import { $ } from "./dom.js";
import { state } from "./app_state.js";
import { api, bytesToBase64, toast, waitForFrameSender } from "./net.js";
import { stopAnimation, stopMedia } from "./playback.js";
import { renderMediaPixels } from "./media_input.js";
import { effectPainters } from "./effect_painters.js";
import { renderGeneratedFrame } from "./effects_ui.js";
import { applyStatus, loadMovies } from "./status_view.js";
import { clipFrameIndex } from "./clip_model.js";
import { controllerMovieFps, movieFrameCount, packMovieFrames } from "./movie_model.js";

function seekVideo(video, time) {
  if (Math.abs(video.currentTime - time) < 0.0005) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => {
      video.removeEventListener("error", failed);
      resolve();
    };
    const failed = () => {
      video.removeEventListener("seeked", done);
      reject(new Error("The video could not be sampled."));
    };
    video.addEventListener("seeked", done, { once: true });
    video.addEventListener("error", failed, { once: true });
    video.currentTime = time;
  });
}

async function captureMovieFrames(frameCount, fps) {
  const video =
    state.mediaElement instanceof HTMLVideoElement && !state.mediaStream
      ? state.mediaElement
      : null;
  if (video) {
    if (state.mediaFrame) cancelAnimationFrame(state.mediaFrame);
    state.mediaFrame = null;
    video.pause();
    const frames = [];
    for (let index = 0; index < frameCount; index += 1) {
      await seekVideo(
        video,
        Math.min(index / fps, Math.max(0, video.duration - 0.001)),
      );
      const frame = renderMediaPixels(video);
      if (!frame) throw new Error("The video does not have a decodable frame.");
      frames.push(frame);
    }
    return frames;
  }

  if (state.animationName === "clip" && state.clip.frames.length) {
    return Array.from({ length: frameCount }, (_, index) => {
      const clipIndex = clipFrameIndex(state.clip.frames, index / fps * 1_000);
      return state.clip.frames[clipIndex].pixels.slice();
    });
  }

  const effect = effectPainters[state.animationName];
  if (!effect) return [state.pixels.slice()];
  const backdrop = state.pixels.slice();
  const primary = new Uint8Array(state.pixels.length);
  const overlay = new Uint8Array(state.pixels.length);
  return Array.from({ length: frameCount }, (_, index) =>
    renderGeneratedFrame(
      state.animationName,
      index / fps,
      backdrop,
      new Uint8Array(state.pixels.length),
      primary,
      overlay,
    ),
  );
}

async function bakeCurrentLook() {
  const button = $("#bakeMovieButton");
  const name = $("#bakeMovieName").value.trim().toUpperCase();
  const requestedDuration = Number($("#bakeDuration").value);
  if (!name) {
    toast("Name the panel movie first.", true);
    return;
  }
  if (state.mediaStream || state.animationName === "audio") {
    toast("Live screen and audio inputs cannot be baked.", true);
    return;
  }

  try {
    button.disabled = true;
    button.textContent = "PREPARING…";
    const library = await loadMovies();
    const fps = controllerMovieFps(state.measuredFrameRate);
    const video =
      state.mediaElement instanceof HTMLVideoElement ? state.mediaElement : null;
    const duration = video && Number.isFinite(video.duration)
      ? Math.min(requestedDuration, video.duration)
      : requestedDuration;
    const isMotion = Boolean(
      video ||
      effectPainters[state.animationName] ||
      (state.animationName === "clip" && state.clip.frames.length > 1),
    );
    const frameCount = isMotion
      ? movieFrameCount(duration, fps, library.availableFrames)
      : 1;
    if (frameCount < 1 || library.availableFrames < frameCount) {
      throw new Error("The panel does not have enough free movie frames.");
    }
    const seconds = frameCount / fps;
    if (
      !window.confirm(
        `Add ${name} (${frameCount} frames / ${seconds.toFixed(2)}s) to the ` +
        "controller and switch the wall to panel-local playback? Existing " +
        "movies will not be replaced.",
      )
    ) {
      return;
    }

    button.textContent = "RENDERING…";
    const frames = await captureMovieFrames(frameCount, fps);
    const packed = packMovieFrames(frames, state.pixels.length);
    stopMedia();
    stopAnimation();
    await waitForFrameSender();
    button.textContent = "UPLOADING…";
    const result = await api("/api/movies/bake", {
      method: "POST",
      body: JSON.stringify({
        name,
        width: state.width,
        height: state.height,
        frameCount: frames.length,
        fps,
        pixelsBase64: bytesToBase64(packed),
      }),
    });
    applyStatus(result.status);
    await loadMovies();
    toast(`${name} is now looping from the panel controller.`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "BAKE TO PANEL";
  }
}

export function initializeMovieBaking() {
  $("#bakeMovieButton").addEventListener(
    "click",
    () => void bakeCurrentLook(),
  );
}
