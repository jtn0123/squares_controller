import { $, updateRangeFill } from "./dom.js";
import { state } from "./app_state.js";
import { scheduleFrame, toast } from "./net.js";
import {
  releaseAudioResources,
  stopAnimation,
  stopMedia,
  updateAudioMeters,
} from "./playback.js";
import { render } from "./render_core.js";
import { setOutputContext } from "./monitor.js";
import { startMediaLoop } from "./media_input.js";
import {
  detectAudioBeat,
  measureAudioBands,
  normalizeAudioControls,
  renderAudioFrame,
} from "./live_input_model.js";
import { alignFrameTime, FRAME_INTERVAL_MS } from "./frame_timing.js";

function currentAudioControls() {
  return normalizeAudioControls({
    mode: $("#audioMode").value,
    sensitivity: Number($("#audioSensitivity").value) / 100,
    smoothing: Number($("#audioSmoothing").value) / 100,
  });
}

function updateAudioControls() {
  const settings = currentAudioControls();
  $("#audioSensitivityValue").textContent =
    `${settings.sensitivity.toFixed(2)}×`;
  $("#audioSmoothingValue").textContent =
    `${Math.round(settings.smoothing * 100)}%`;
  updateRangeFill($("#audioSensitivity"));
  updateRangeFill($("#audioSmoothing"));
  if (state.audioAnalyser) {
    state.audioAnalyser.smoothingTimeConstant = settings.smoothing;
  }
}

async function startMicrophoneInput() {
  if (!navigator.mediaDevices?.getUserMedia) {
    toast("Microphone capture is not available in this browser.", true);
    return;
  }
  const modeReadout = $("#mediaModeReadout");
  const previousMode = modeReadout.textContent;
  let stream = null;
  let permissionGranted = false;
  modeReadout.textContent = "REQUESTING MIC";
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false,
      },
      video: false,
    });
    permissionGranted = true;
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextClass) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("Web Audio is not available in this browser.");
    }
    stopMedia();
    stopAnimation();
    const audioContext = new AudioContextClass();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    const controls = currentAudioControls();
    analyser.fftSize = 256;
    analyser.minDecibels = -90;
    analyser.maxDecibels = -10;
    analyser.smoothingTimeConstant = controls.smoothing;
    source.connect(analyser);
    state.audioStream = stream;
    state.audioContext = audioContext;
    state.audioSource = source;
    state.audioAnalyser = analyser;
    state.audioData = new Uint8Array(analyser.frequencyBinCount);
    state.audioBeatState = null;
    state.audioLastFrame = 0;
    await audioContext.resume();

    state.animationName = "audio";
    setOutputContext({
      kind: "audio",
      name: `MIC / ${controls.mode.toUpperCase()}`,
    });

    const startedAt = performance.now();
    const tick = (now) => {
      if (
        state.animationName !== "audio" ||
        !state.audioAnalyser ||
        !state.audioData
      ) {
        return;
      }
      if (now - state.audioLastFrame >= FRAME_INTERVAL_MS) {
        const settings = currentAudioControls();
        state.audioAnalyser.getByteFrequencyData(state.audioData);
        const metrics = measureAudioBands(
          state.audioData,
          settings.sensitivity,
        );
        state.audioBeatState = detectAudioBeat(
          state.audioBeatState,
          metrics.bass,
          now,
        );
        state.pixels.set(
          renderAudioFrame({
            width: state.width,
            height: state.height,
            bins: state.audioData,
            mode: settings.mode,
            sensitivity: settings.sensitivity,
            palette: state.palette.colors,
            time: (now - startedAt) / 1000,
            beatPulse: state.audioBeatState.pulse,
          }),
        );
        updateAudioMeters(metrics);
        render();
        scheduleFrame();
        state.audioLastFrame = alignFrameTime(state.audioLastFrame, now);
      }
      state.animationFrame = requestAnimationFrame(tick);
    };
    $("#mediaModeReadout").textContent = "MIC LIVE";
    state.animationFrame = requestAnimationFrame(tick);
    toast("Microphone visualizer is live.");
  } catch (error) {
    if (state.audioStream === stream) {
      releaseAudioResources();
    } else {
      stream?.getTracks().forEach((track) => track.stop());
    }
    modeReadout.textContent = permissionGranted ? "IDLE" : previousMode;
    toast(
      error?.name === "NotAllowedError"
        ? "Microphone permission was not granted."
        : error.message,
      true,
    );
  }
}

async function startScreenCapture() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    toast("Screen capture is not available in this browser.", true);
    return;
  }
  const modeReadout = $("#mediaModeReadout");
  const previousMode = modeReadout.textContent;
  let stream = null;
  let permissionGranted = false;
  modeReadout.textContent = "CHOOSE SCREEN";
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: {
        frameRate: 1000 / FRAME_INTERVAL_MS,
      },
    });
    permissionGranted = true;
    stopMedia();
    stopAnimation();
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    state.mediaStream = stream;
    state.mediaElement = video;
    state.animationName = "media";
    setOutputContext({ kind: "screen", name: "SCREEN MIRROR" });
    stream.getVideoTracks()[0]?.addEventListener(
      "ended",
      () => {
        if (state.mediaStream === stream) stopMedia(true);
      },
      { once: true },
    );
    await video.play();
    startMediaLoop("SCREEN LIVE");
    toast("Screen mirror is live.");
  } catch (error) {
    if (state.mediaStream === stream) {
      stopMedia();
    } else {
      stream?.getTracks().forEach((track) => track.stop());
    }
    modeReadout.textContent = permissionGranted ? "IDLE" : previousMode;
    toast(
      error?.name === "NotAllowedError"
        ? "Screen sharing was cancelled."
        : error.message,
      true,
    );
  }
}

export function initializeLiveInputs() {
  $("#startMicrophoneButton").addEventListener(
    "click",
    () => void startMicrophoneInput(),
  );
  $("#startScreenButton").addEventListener(
    "click",
    () => void startScreenCapture(),
  );
  $("#audioMode").addEventListener("change", () => {
    updateAudioControls();
    if (state.animationName === "audio") {
      const mode = currentAudioControls().mode.toUpperCase();
      setOutputContext({ kind: "audio", name: `MIC / ${mode}` });
    }
  });
  ["audioSensitivity", "audioSmoothing"].forEach((id) => {
    $(`#${id}`).addEventListener("input", updateAudioControls);
  });
  updateAudioControls();
  updateAudioMeters();
}
