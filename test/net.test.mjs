import assert from "node:assert/strict";
import test from "node:test";

// net.js pulls in dom.js, which resolves elements at import time; give the
// module graph a minimal DOM before importing it.
function stubElement() {
  const classes = new Set();
  return {
    classList: {
      toggle(name, force) {
        const shouldHave = force === undefined ? !classes.has(name) : force;
        if (shouldHave) classes.add(name);
        else classes.delete(name);
      },
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    },
    style: { setProperty() {} },
    dataset: {},
    textContent: "",
    setAttribute() {},
    getAttribute: () => null,
    addEventListener() {},
    getContext: () => ({}),
  };
}

const elements = new Map();
globalThis.document = {
  querySelector(selector) {
    if (!elements.has(selector)) elements.set(selector, stubElement());
    return elements.get(selector);
  },
  querySelectorAll: () => [],
  createElement: () => stubElement(),
};
globalThis.window = globalThis;

const { api, flushFrame, setConnection } = await import("../public/net.js");
const { state } = await import("../public/app_state.js");

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 500 ? "Internal Server Error" : "Bad Request",
    text: async () => body,
  };
}

test("api surfaces the server's error field", async () => {
  globalThis.fetch = async () =>
    jsonResponse(400, JSON.stringify({ error: "Brightness must be from 1 to 100." }));
  await assert.rejects(api("/api/brightness"), (error) => {
    assert.equal(error.message, "Brightness must be from 1 to 100.");
    assert.equal(error.status, 400);
    return true;
  });
});

test("api reports status text when the body is not JSON", async () => {
  globalThis.fetch = async () => jsonResponse(500, "<html>traceback</html>");
  await assert.rejects(api("/api/status"), (error) => {
    assert.match(error.message, /500 Internal Server Error/);
    assert.equal(error.status, 500);
    return true;
  });
});

test("api translates network failure into a human message", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(api("/api/status"), (error) => {
    assert.match(error.message, /Controller unreachable/);
    assert.equal(error.status, 0);
    return true;
  });
});

test("api returns parsed JSON on success", async () => {
  globalThis.fetch = async () => jsonResponse(200, JSON.stringify({ ok: true }));
  assert.deepEqual(await api("/api/v1/health"), { ok: true });
});

test("a dead server marks the panel offline and stops the frame loop", async () => {
  setConnection({ ip: "192.168.1.50", mode: "rt" });
  state.frameQueued = true;
  state.frameSending = false;
  state.nextFrameAt = 0;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    throw new TypeError("Failed to fetch");
  };

  await flushFrame();

  assert.equal(attempts, 1);
  assert.equal(state.connected, false);
  assert.equal(state.frameQueued, false);
  assert.equal(state.frameErrorShown, true);
  assert.match(
    document.querySelector("#toast").textContent,
    /Panel connection lost/,
  );
});

test("a validation error keeps the panel online and toasts once", async () => {
  setConnection({ ip: "192.168.1.50", mode: "rt" });
  state.frameErrorShown = false;
  state.nextFrameAt = 0;
  globalThis.fetch = async () =>
    jsonResponse(400, JSON.stringify({ error: "Expected 12 RGB values." }));

  state.frameQueued = true;
  await flushFrame();

  assert.equal(state.connected, true);
  assert.equal(state.frameErrorShown, true);
  assert.equal(
    document.querySelector("#toast").textContent,
    "Expected 12 RGB values.",
  );
});

test("frames upload as base64 and clear the error flag on success", async () => {
  setConnection({ ip: "192.168.1.50", mode: "rt" });
  state.nextFrameAt = 0;
  let sentBody = null;
  globalThis.fetch = async (_path, options) => {
    sentBody = JSON.parse(options.body);
    return jsonResponse(200, JSON.stringify({ streaming: true }));
  };

  state.frameQueued = true;
  await flushFrame();

  assert.equal(typeof sentBody.pixelsBase64, "string");
  assert.equal(sentBody.width, state.width);
  assert.equal(sentBody.height, state.height);
  assert.ok(!("pixels" in sentBody));
  assert.equal(state.frameErrorShown, false);
});
