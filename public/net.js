import { $, toastElement } from "./dom.js";
import { state } from "./app_state.js";
import { nextFrameDeadline } from "./frame_timing.js";

const RECONNECT_MIN_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;
// Frames sent this soon after a click or keypress carry a takeover claim:
// a human acting in this tab always wins the wall from a background tab.
const GESTURE_CLAIM_WINDOW_MS = 1_500;

const CLIENT_ID =
  globalThis.crypto?.randomUUID?.() ??
  `tab-${Math.random().toString(36).slice(2)}`;

let reconnectTimer = null;
let reconnectDelay = RECONNECT_MIN_MS;
let reconnectProbe = null;
let reconnectInFlight = false;
let frameDeferTimer = null;
let lastGestureAt = Number.NEGATIVE_INFINITY;
let controlLostHandler = null;

export function noteUserGesture() {
  lastGestureAt = performance.now();
}

// Registered at boot: stops every producer loop when another tab takes
// the wall, so two clients never silently fight last-writer-wins.
export function onControlLost(handler) {
  controlLostHandler = handler;
}

export function toast(message, error = false) {
  toastElement.textContent = message;
  toastElement.classList.toggle("error", error);
  toastElement.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toastElement.classList.remove("show"), 2600);
}

export async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      // A server that accepts but never answers must not wedge the frame
      // sender; time out and surface the same unreachable error.
      signal: options.signal ?? AbortSignal.timeout(10_000),
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  } catch {
    const unreachable = new Error(
      "Controller unreachable — is `python3 server.py` running?",
    );
    unreachable.status = 0;
    throw unreachable;
  }
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // A non-JSON body (proxy error page, empty response) falls through to
    // the status-based message below.
  }
  if (!response.ok) {
    const error = new Error(
      data?.error ?? `Request failed: ${response.status} ${response.statusText}`,
    );
    error.status = response.status;
    throw error;
  }
  return data ?? {};
}

export function setConnection(status, errorMessage = "") {
  const badge = $("#connectionBadge");
  const label = $("#connectionLabel");
  const detail = $("#connectionDetail");
  badge.dataset.state = status ? "online" : "error";
  label.textContent = status ? "PANEL ONLINE" : "PANEL UNREACHABLE";
  detail.textContent = status ? `${status.ip} / ${status.mode.toUpperCase()}` : errorMessage;
  state.connected = Boolean(status);
  if (status) {
    state.frameErrorShown = false;
    reconnectDelay = RECONNECT_MIN_MS;
  }
}

// The reconnect probe is registered at boot (a quiet status refresh) so this
// module does not depend on the status view.
export function onConnectionLost(probe) {
  reconnectProbe = probe;
}

function beginReconnect() {
  if (reconnectTimer || reconnectInFlight || !reconnectProbe) return;
  const attempt = async () => {
    reconnectTimer = null;
    reconnectInFlight = true;
    try {
      await reconnectProbe();
    } finally {
      reconnectInFlight = false;
    }
    if (state.connected) return;
    reconnectDelay = Math.min(RECONNECT_MAX_MS, reconnectDelay * 1.6);
    reconnectTimer = setTimeout(() => void attempt(), reconnectDelay);
  };
  reconnectTimer = setTimeout(() => void attempt(), reconnectDelay);
}

export function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCodePoint(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

export function scheduleFrame() {
  state.frameQueued = true;
  if (!state.frameSending) void flushFrame();
}

export async function flushFrame() {
  if (!state.frameQueued || !state.connected || state.frameSending) return;
  const now = performance.now();
  const delay = Math.max(0, state.nextFrameAt - now);
  if (delay > 0) {
    // One pending timer at a time, or overlapping schedules can start
    // two concurrent uploads when the deadline passes.
    if (frameDeferTimer === null) {
      frameDeferTimer = setTimeout(() => {
        frameDeferTimer = null;
        void flushFrame();
      }, delay);
    }
    return;
  }
  state.frameQueued = false;
  state.frameSending = true;
  try {
    state.nextFrameAt = nextFrameDeadline(state.nextFrameAt, now);
    await api("/api/frame", {
      method: "POST",
      body: JSON.stringify({
        width: state.width,
        height: state.height,
        pixelsBase64: bytesToBase64(state.pixels),
        source: CLIENT_ID,
        claim: now - lastGestureAt <= GESTURE_CLAIM_WINDOW_MS,
      }),
    });
    state.frameErrorShown = false;
  } catch (error) {
    if (error.status === 409) {
      // Another tab owns the wall: stop producing instead of fighting it
      // frame-for-frame. A fresh user gesture here claims it back.
      state.frameQueued = false;
      controlLostHandler?.();
    } else if (!error.status || error.status >= 500) {
      // The server or panel is gone: mark the panel offline so the effect
      // loop stops posting, tell the user once, and probe in the background.
      state.frameQueued = false;
      setConnection(null, error.message);
      if (!state.frameErrorShown) {
        state.frameErrorShown = true;
        toast("Panel connection lost. Retrying in the background…", true);
      }
      beginReconnect();
    } else if (!state.frameErrorShown) {
      state.frameErrorShown = true;
      toast(error.message, true);
    }
  } finally {
    state.frameSending = false;
    if (state.frameQueued) void flushFrame();
  }
}

export async function waitForFrameSender() {
  state.frameQueued = false;
  const deadline = performance.now() + 1_000;
  while (state.frameSending && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
