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
import { FRAME_INTERVAL_MS, startPacedLoop } from "./frame_timing.js";
import type { AudioControls } from "./live_input_model.js";

function currentAudioControls(): AudioControls {
  return normalizeAudioControls({
    mode: $<HTMLSelectElement>("#audioMode").value,
    sensitivity: Number($<HTMLInputElement>("#audioSensitivity").value) / 100,
    smoothing: Number($<HTMLInputElement>("#audioSmoothing").value) / 100,
  });
}

function updateAudioControls(): void {
  const settings = currentAudioControls();
  $("#audioSensitivityValue").textContent =
    `${settings.sensitivity.toFixed(2)}×`;
  $("#audioSmoothingValue").textContent =
    `${Math.round(settings.smoothing * 100)}%`;
  updateRangeFill($<HTMLInputElement>("#audioSensitivity"));
  updateRangeFill($<HTMLInputElement>("#audioSmoothing"));
  if (state.audioAnalyser) {
    state.audioAnalyser.smoothingTimeConstant = settings.smoothing;
  }
}

async function startMicrophoneInput(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    toast("Microphone capture is not available in this browser.", true);
    return;
  }
  const modeReadout = $("#mediaModeReadout");
  const previousMode = modeReadout.textContent;
  let stream: MediaStream | null = null;
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
    const AudioContextClass =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
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
    const tick = (now: number): void => {
      if (
        state.animationName !== "audio" ||
        !state.audioAnalyser ||
        !state.audioData
      ) {
        return;
      }
      const settings = currentAudioControls();
      // Allocated above as new Uint8Array(...), so its buffer is a real
      // ArrayBuffer even though the state slot's type does not say so.
      state.audioAnalyser.getByteFrequencyData(
        state.audioData as Uint8Array<ArrayBuffer>,
      );
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
    };
    $("#mediaModeReadout").textContent = "MIC LIVE";
    state.animationFrame = startPacedLoop(tick);
    toast("Microphone visualizer is live.");
  } catch (error) {
    if (state.audioStream === stream) {
      releaseAudioResources();
    } else {
      stream?.getTracks().forEach((track) => track.stop());
    }
    modeReadout.textContent = permissionGranted ? "IDLE" : previousMode;
    // getUserMedia failures are DOMException-shaped; anything else falls
    // back to its string form.
    const failure = error as { name?: string; message?: string } | null;
    toast(
      failure?.name === "NotAllowedError"
        ? "Microphone permission was not granted."
        : failure?.message ?? String(error),
      true,
    );
  }
}

async function startScreenCapture(): Promise<void> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    toast("Screen capture is not available in this browser.", true);
    return;
  }
  const modeReadout = $("#mediaModeReadout");
  const previousMode = modeReadout.textContent;
  let stream: MediaStream | null = null;
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
    // getDisplayMedia failures are DOMException-shaped; anything else falls
    // back to its string form.
    const failure = error as { name?: string; message?: string } | null;
    toast(
      failure?.name === "NotAllowedError"
        ? "Screen sharing was cancelled."
        : failure?.message ?? String(error),
      true,
    );
  }
}

export function initializeLiveInputs(): void {
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
    $<HTMLInputElement>(`#${id}`).addEventListener("input", updateAudioControls);
  });
  updateAudioControls();
  updateAudioMeters();
}
