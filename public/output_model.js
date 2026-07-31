function safeMovie(status) {
  const movie = status?.currentMovie;
  return movie && typeof movie === "object" ? movie : null;
}

function movieName(movie) {
  const name = String(movie?.name ?? "").trim();
  return name ? name.toUpperCase() : "CONTROLLER MOVIE";
}

function movieMeta(movie, brightness) {
  const parts = [];
  const fps = Number(movie?.fps);
  const frames = Number(movie?.frames_number);
  if (Number.isFinite(fps) && fps > 0) parts.push(`${fps} FPS`);
  if (Number.isFinite(frames) && frames > 0) {
    parts.push(`${frames} FRAMES`);
  }
  if (!parts.length) parts.push("DEVICE MOVIE");
  parts.push(`${Math.round(Number(brightness) || 0)}%`);
  return parts.join(" / ");
}

export function mergeMovieDetails(status, movies = []) {
  const known = movies.find((movie) => movie.id === status?.currentMovie?.id);
  return known
    ? {
        ...status,
        currentMovie: { ...status.currentMovie, ...known },
      }
    : status;
}

export function outputPresentation(status, current = {}) {
  if (!status?.connected) {
    return {
      kind: "offline",
      name: "PANEL UNREACHABLE",
      badge: "NO SIGNAL",
      kicker: "OUTPUT STATUS",
      meta: "CONNECTION REQUIRED",
      note: "The browser cannot read the controller state.",
      playback: "offline",
    };
  }

  if (status.streaming) {
    const staleKinds = new Set(["controller", "stock", "off", "offline"]);
    return {
      ...current,
      kind: staleKinds.has(current.kind) ? "canvas" : (current.kind ?? "canvas"),
      name: staleKinds.has(current.kind)
        ? "CURRENT BROWSER FRAME"
        : (current.name ?? "CURRENT BROWSER FRAME"),
      badge: "BROWSER LIVE",
      kicker: "BROWSER → RELAY → PANEL",
      meta: null,
      playback: "realtime",
      note: "The browser preview is the frame source for realtime output.",
      controllerMovie: null,
    };
  }

  const mode = String(status.mode ?? "").toLowerCase();
  if (mode === "movie") {
    const movie = safeMovie(status);
    return {
      kind: "controller",
      name: movieName(movie),
      badge: "PANEL LOCAL",
      kicker: "CONTROLLER PLAYBACK",
      meta: movieMeta(movie, status.brightness),
      note:
        "Playing from panel memory; exact pixels are not exposed by the Twinkly API.",
      playback: "local",
      controllerMovie: movie,
    };
  }
  if (mode === "off") {
    return {
      kind: "off",
      name: "OUTPUT OFF",
      badge: "PANEL OFF",
      kicker: "CONTROLLER STATE",
      meta: `${Math.round(Number(status.brightness) || 0)}% SAVED LEVEL`,
      note: "The controller reports that panel output is off.",
      playback: "off",
    };
  }
  if (mode === "demo") {
    return {
      kind: "controller",
      name: "CONTROLLER DEMO",
      badge: "PANEL LOCAL",
      kicker: "CONTROLLER PLAYBACK",
      meta: `${Math.round(Number(status.brightness) || 0)}% / DEMO MODE`,
      note:
        "Playing from the panel controller; exact pixels are not exposed by the Twinkly API.",
      playback: "local",
    };
  }
  return {
    kind: "idle",
    name: "CONTROLLER IDLE",
    badge: "STANDBY",
    kicker: "OUTPUT STATUS",
    meta: mode ? mode.toUpperCase() : "UNKNOWN MODE",
    note: "No browser frame stream is active.",
    playback: "idle",
  };
}

export function outputSignalPath(status) {
  if (!status?.connected) {
    return {
      mode: "offline",
      headline: "NO CONTROLLER SIGNAL",
      nodes: ["BROWSER", "RELAY", "PANEL"].map((label) => ({
        label,
        value: "OFFLINE",
        state: "error",
      })),
      note: "Reconnect the local controller to inspect output.",
    };
  }

  if (status.streaming) {
    const actual = Number(status.streamTelemetry?.actualFps);
    const relayValue =
      Number.isFinite(actual) && actual > 0 ? `${actual.toFixed(2)} FPS` : "STARTING";
    const missed = Number(status.streamTelemetry?.missedDeadlines) || 0;
    return {
      mode: "realtime",
      headline: missed ? "REALTIME / CHECK TIMING" : "REALTIME PATH ACTIVE",
      nodes: [
        { label: "BROWSER", value: "LIVE FRAMES", state: "active" },
        {
          label: "RELAY",
          value: relayValue,
          state: missed ? "warning" : "active",
        },
        { label: "PANEL", value: "RT MODE", state: "active" },
      ],
      note: "Delivery timing is measured here; physical light still requires camera validation.",
    };
  }

  const mode = String(status.mode ?? "").toLowerCase();
  if (mode === "movie" || mode === "demo") {
    const fps = Number(status.currentMovie?.fps);
    const panelValue =
      Number.isFinite(fps) && fps > 0 ? `LOCAL ${fps} FPS` : "LOCAL LOOP";
    return {
      mode: "local",
      headline: "PANEL-LOCAL PLAYBACK",
      nodes: [
        { label: "BROWSER", value: "STANDBY", state: "idle" },
        { label: "RELAY", value: "BYPASSED", state: "idle" },
        { label: "PANEL", value: panelValue, state: "active" },
      ],
      note: "The animation is running from controller memory, independent of this page.",
    };
  }

  return {
    mode: mode === "off" ? "off" : "idle",
    headline: mode === "off" ? "PANEL OUTPUT OFF" : "OUTPUT IDLE",
    nodes: [
      { label: "BROWSER", value: "STANDBY", state: "idle" },
      { label: "RELAY", value: "IDLE", state: "idle" },
      {
        label: "PANEL",
        value: mode === "off" ? "OFF" : "STANDBY",
        state: mode === "off" ? "off" : "idle",
      },
    ],
    note: mode === "off"
      ? "The controller confirms that output is off."
      : "No active output path is reported.",
  };
}
