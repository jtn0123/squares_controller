import { $, $$ } from "./dom.js";
import { state } from "./app_state.js";
import { toast } from "./net.js";

export function updateAudioMeters(metrics) {
  const { bass = 0, mid = 0, treble = 0 } = metrics ?? {};
  [
    ["audioBassMeter", bass],
    ["audioMidMeter", mid],
    ["audioTrebleMeter", treble],
  ].forEach(([id, value]) => {
    $(`#${id}`).style.setProperty("--level", `${Math.round(value * 100)}%`);
  });
}

export function releaseAudioResources() {
  const stream = state.audioStream;
  state.audioStream = null;
  stream?.getTracks().forEach((track) => track.stop());
  try {
    state.audioSource?.disconnect();
  } catch {
    // The source may already be detached by the browser.
  }
  state.audioSource = null;
  state.audioAnalyser = null;
  state.audioData = null;
  state.audioBeatState = null;
  state.audioLastFrame = 0;
  const audioContext = state.audioContext;
  state.audioContext = null;
  if (audioContext && audioContext.state !== "closed") {
    void audioContext.close().catch(() => {});
  }
  if (state.animationName === "audio") state.animationName = null;
  updateAudioMeters();
  $("#mediaModeReadout").textContent = "IDLE";
}

export function stopAnimation(showNotice = false) {
  const wasAudio = state.animationName === "audio";
  const wasClip = state.animationName === "clip";
  state.transitionToken += 1;
  if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
  state.animationFrame = null;
  state.animationName = null;
  if (wasAudio) releaseAudioResources();
  $$(".effect-card").forEach((button) => {
    button.classList.remove("active");
    button.setAttribute("aria-pressed", "false");
  });
  if (wasClip) {
    const play = $("#playClip");
    if (play) {
      play.classList.remove("active");
      play.setAttribute("aria-pressed", "false");
      play.textContent = "▶ PLAY LOOP";
    }
  }
  if (showNotice) toast("Motion stopped. The last frame remains live.");
}

export function stopMedia(showNotice = false) {
  if (state.mediaFrame) cancelAnimationFrame(state.mediaFrame);
  state.mediaFrame = null;
  state.mediaElement?.pause?.();
  if (state.mediaElement instanceof HTMLVideoElement) {
    state.mediaElement.srcObject = null;
  }
  const mediaStream = state.mediaStream;
  state.mediaStream = null;
  mediaStream?.getTracks().forEach((track) => track.stop());
  if (state.mediaUrl) URL.revokeObjectURL(state.mediaUrl);
  state.mediaUrl = null;
  state.mediaElement = null;
  state.mediaLastFrame = 0;
  if (state.animationName === "media") state.animationName = null;
  $("#mediaModeReadout").textContent = showNotice ? "FRAME HELD" : "IDLE";
  if (showNotice) toast("Media stopped. The last frame remains live.");
}
