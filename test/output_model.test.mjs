import assert from "node:assert/strict";
import test from "node:test";

import {
  outputPresentation,
  outputSignalPath,
} from "../public/output_model.js";

test("controller movie replaces a stale browser canvas presentation", () => {
  const presentation = outputPresentation(
    {
      connected: true,
      mode: "movie",
      streaming: false,
      brightness: 24,
      currentMovie: {
        id: 14,
        name: "Color Plasma",
        fps: 40,
        frames_number: 320,
      },
    },
    { kind: "canvas", name: "CURRENT CANVAS" },
  );

  assert.equal(presentation.kind, "controller");
  assert.equal(presentation.name, "COLOR PLASMA");
  assert.equal(presentation.badge, "PANEL LOCAL");
  assert.equal(presentation.meta, "40 FPS / 320 FRAMES / 24%");
  assert.match(presentation.note, /pixels are not exposed/i);
});

test("realtime output preserves the browser program identity", () => {
  const presentation = outputPresentation(
    {
      connected: true,
      mode: "rt",
      streaming: true,
      brightness: 31,
    },
    { kind: "effect", name: "NIGHT RADAR", effect: "radar" },
  );

  assert.equal(presentation.kind, "effect");
  assert.equal(presentation.name, "NIGHT RADAR");
  assert.equal(presentation.badge, "BROWSER LIVE");
  assert.equal(presentation.playback, "realtime");
});

test("off mode cannot leave stale live output copy behind", () => {
  const presentation = outputPresentation(
    {
      connected: true,
      mode: "off",
      streaming: false,
      brightness: 24,
    },
    { kind: "effect", name: "CHROMA TIDE" },
  );

  assert.equal(presentation.kind, "off");
  assert.equal(presentation.name, "OUTPUT OFF");
  assert.equal(presentation.badge, "PANEL OFF");
});

test("signal path distinguishes controller-local playback from relay delivery", () => {
  const path = outputSignalPath({
    connected: true,
    mode: "movie",
    streaming: false,
    currentMovie: { name: "Color Plasma", fps: 40 },
  });

  assert.equal(path.mode, "local");
  assert.deepEqual(
    path.nodes.map((node) => [node.label, node.value, node.state]),
    [
      ["BROWSER", "STANDBY", "idle"],
      ["RELAY", "BYPASSED", "idle"],
      ["PANEL", "LOCAL 40 FPS", "active"],
    ],
  );
  assert.match(path.note, /controller memory/i);
});

test("realtime signal path reports relay timing without claiming optical proof", () => {
  const path = outputSignalPath({
    connected: true,
    mode: "rt",
    streaming: true,
    streamTelemetry: { actualFps: 37.48, missedDeadlines: 0 },
  });

  assert.equal(path.mode, "realtime");
  assert.equal(path.nodes[0].value, "LIVE FRAMES");
  assert.equal(path.nodes[1].value, "37.48 FPS");
  assert.equal(path.nodes[2].value, "RT MODE");
  assert.match(path.note, /camera/i);
});
