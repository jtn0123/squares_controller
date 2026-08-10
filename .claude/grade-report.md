# Codebase Grade Report

> **Historical snapshot.** This audit describes the tree as of 2026-08-09,
> before the TypeScript migration (PR #6): the stack line, test counts, and
> "no type checker" claims below are intentionally left as graded. Run
> `/grade-codebase rerun` for fresh grades.

**Project:** squares-controller
**Audited:** 2026-08-09
**Stack:** Python 3.11+ stdlib backend (http.server + urllib + UDP), vanilla-JS frontend (no framework, no deps), unittest + node --test

## Summary

| ID | Category | Grade | Items |
|----|----------|-------|-------|
| A | Architecture & Design | B− | 6 |
| B | Backend Quality | B− | 8 |
| C | Frontend Quality | B− | 8 |
| D | Testing & Reliability | C+ | 6 |
| E | Security | A− | 5 |
| F | Dependencies & Tech Currency | A | 3 |
| G | Performance & Scalability | A− | 6 |
| H | Documentation & Onboarding | B+ | 5 |
| I | Developer Experience & Tooling | B− | 6 |
| **Overall** | | **B** | **53** |

**Top 5 highest-leverage fixes:** B1, C1, E1, A1, B2

> **2026-08-09:** All A, B, C, and D items executed (28 items), plus an under-500-lines split of every code file (`index.html` at 929 lines is the deliberate exception — declarative markup, no build step). Suite grew from 116 to 142 tests with a 75% coverage gate on `src/` in CI. Remaining open items: E1–E5, F1–F3, G4 (partial), H1–H5, I1–I6. Run `/grade-codebase rerun` for fresh grades.

---

## A — Architecture & Design — B−

Dependency direction is genuinely clean: `server.py` imports `src/*` and never the reverse; `command_api.py:9-20` defines a `ControllerClient` Protocol so commands depend on an interface, not `TwinklyClient`. The frontend has 17 pure, individually-tested model modules forming an acyclic graph. The two structural failures: `server.py` is simultaneously entry point and application layer (untestable — see A1/D1), and a 492-line lump of pure rendering logic never got extracted from the 4260-line `app.js` the way its siblings did.

#### ~~A1~~ ✓ done 2026-08-09 — `server.py` has no `main()` — importing it binds a port and starts threads
- **Where:** `server.py:439`, `:511-512`, `:534-545`, `:548`
- **What's wrong:** Module scope binds the listening socket, installs SIGINT/SIGTERM handlers, starts two daemon threads, and calls `serve_forever()`. No `if __name__ == "__main__"` guard. Any test that imports `server` takes over the process — which is why zero HTTP-layer tests exist.
- **Fix:** Move handler construction, thread startup, signal wiring, and `serve_forever()` into `def main()` behind a `__main__` guard. Make store/client singletons parameters of a `create_app(...)` factory so tests can build a handler against a fake `ControllerClient` and temp-dir stores.
- **Effort:** M
- **Grade lift:** B− → B+ (unblocks D1/D6; removes the biggest layering violation)

#### ~~A2~~ ✓ done 2026-08-09 — Business logic leaked into the HTTP handler
- **Where:** `server.py:370-381` (inline frame pixel packing, duplicating `command_api.py:99-105`) and `server.py:443-457` (`execute_automation`)
- **What's wrong:** `do_POST` clamps and byte-packs RGB inline, duplicating validated logic in `command_api`. Automation action→device mapping lives in the entry point while the action vocabulary lives in `automation_store.py:16` — one concept split across two layers.
- **Fix:** Route `/api/frame` through `execute_command(client, {"action":"frame", ...})`; move `execute_automation` into `src/automation_runner.py` that takes a `ControllerClient` and imports `ACTIONS` from `automation_store`.
- **Effort:** S
- **Grade lift:** B− → B (single validation path; automation concept lives in one place)

#### ~~A3~~ ✓ done 2026-08-09 — `effectPainters` is a 492-line un-extracted module inside `app.js`
- **Where:** `public/app.js:2356-2847` (16 painters)
- **What's wrong:** Pure pixel math with no DOM access — the exact profile of the 17 extracted-and-tested files. It stays only because painters read module-global `state.width/height/zone` via `paintEffectPixel` (`app.js:2343-2354`).
- **Fix:** Change painter signatures to `(time, target, paletteColors, {width, height, zone})`, move to `public/effect_painters.js`, add `test/effect_painters.test.mjs`. Drops `app.js` ~12% and makes the core visual output testable.
- **Effort:** M
- **Grade lift:** B− → B (largest remaining unextracted pure-logic block)

#### ~~A4~~ ✓ done 2026-08-09 — Global-state mutation used as parameter passing
- **Where:** `public/app.js:2212` (restored `:2296`), same pattern `:3026`
- **What's wrong:** `renderGeneratedFrame` temporarily overwrites shared `state.zone` so painters pick up the right zone, restoring in `finally`. Works only because rendering is synchronous; any future `await` in the loop corrupts the live zone.
- **Fix:** Falls out of A3 — pass the zone as an argument.
- **Effort:** S (bundled with A3)
- **Grade lift:** included in A3

#### ~~A5~~ ✓ done 2026-08-09 — `app.js` has 138 top-level declarations and zero section markers
- **Where:** `public/app.js` (262 `document.querySelector` calls; no banner comments)
- **What's wrong:** The file is ordered sensibly (DOM refs → state → helpers → per-feature `initializeX()` → bootstrap) but nothing marks the ~20 feature-area boundaries; navigation is pure scrolling.
- **Fix:** Cheapest: `// ===== ZONES =====` banners per `initializeX` cluster. Better: split per-feature `initializeX()`/`renderX()` pairs into `public/features/*.js`, keeping `app.js` as composition root.
- **Effort:** S for banners / L for the split
- **Grade lift:** B− → B (navigability of the largest file)

#### ~~A6~~ ✓ done 2026-08-09 — Import statement at the bottom of `blend_model.js`
- **Where:** `public/blend_model.js:47`
- **What's wrong:** `import { EFFECT_CATALOG } ...` sits on the last line, after the code that consumes it at line 9. Works via hoisting but hides the module's only dependency.
- **Fix:** Move to line 1.
- **Effort:** S
- **Grade lift:** nit (no letter movement)

---

## B — Backend Quality — B−

Fundamentals are unusually disciplined: not one bare `except`, all four persistence writes use temp-file + fsync + `os.replace` (`library_store.py:89-109`), validation rejects `bool`-as-`int` (`command_api.py:63`), and `StateBroker` uses `Condition.wait_for` correctly. Dragged down by: two parallel API families with divergent validation, an SSE resume path that can silently starve a reconnecting browser, wrong status codes on device-unreachable, and constructors that kill the process on one corrupt JSON file.

#### ~~B1~~ ✓ done 2026-08-09 — SSE resume starves the client after a server restart
- **Where:** `server.py:191`, `:203`; `src/state_broker.py:35`
- **What's wrong:** Broker versions restart at 1 each boot, but `serve_state_events` trusts the browser's `Last-Event-ID` verbatim. A browser reconnecting after a restart with `last_seen=57` gets nothing until 57 new publishes accumulate — only keep-alives. The 60s polling fallback (`app.js:4256-4258`) is disabled while any effect is running, so the UI just goes stale.
- **Fix:** Prefix SSE ids with a per-process boot epoch (`f"{BOOT_ID}-{version}"`) and ignore a mismatched `Last-Event-ID`; or minimally clamp `last_seen = 0` when it exceeds the broker's current version.
- **Effort:** S
- **Grade lift:** B− → B (kills the worst user-visible reliability bug)

#### ~~B2~~ ✓ done 2026-08-09 — Any corrupt persistence file makes the server unbootable
- **Where:** `server.py:55-57`; `src/library_store.py:80-87`, `src/automation_store.py:44-59`, `src/runtime_policy.py:62-71`
- **What's wrong:** All `_load()` methods raise on unparseable content and run at module scope with no `try`. A truncated `.squares/library.json` kills the process with a traceback — inconsistent with the graceful degraded-mode handling for a bad `config.json` (`server.py:90-97`).
- **Fix:** On `ValueError`, rename the bad file to `<name>.corrupt.<timestamp>`, start from empty defaults, surface a warning via `/api/v1/health`.
- **Effort:** S
- **Grade lift:** B− → B (boot resilience matches the care taken elsewhere)

#### ~~B3~~ ✓ done 2026-08-09 — `ConnectionError` on POST returns 400 instead of 503
- **Where:** `server.py:399-407`
- **What's wrong:** "Panel unreachable" is caught in the same tuple as `KeyError`/`ValueError` and returned as 400 (caller error). The identical failure on `GET /api/status` correctly returns 503 (`server.py:318-321`).
- **Fix:** Add a preceding `except ConnectionError` → 503 branch; drop it from the 400 tuple.
- **Effort:** S
- **Grade lift:** B− → B− (correctness of the API contract; small but real)

#### ~~B4~~ ✓ done 2026-08-09 — Two parallel API surfaces; the documented one is unused, the used one undocumented
- **Where:** `server.py:355-363` (`/api/v1/command`) vs `:313-322`, `:370-391`; `public/openapi.json`
- **What's wrong:** `command_api.py` implements strict validated commands; `server.py` also exposes legacy `/api/mode|brightness|rotation|frame` with weaker checks (e.g. `/api/brightness` silently clamps where v1 rejects). The frontend calls only legacy routes; nothing in the repo exercises `/api/v1/*`. `openapi.json` documents 5 endpoints while ~16 are served.
- **Fix:** Make legacy routes thin adapters over `execute_command` (one validation path); document all routes or explicitly mark the legacy family UI-internal in the OpenAPI doc.
- **Effort:** M
- **Grade lift:** B− → B (one validation path, honest API doc)

#### ~~B5~~ ✓ done 2026-08-09 — Unsynchronized check-then-start on the realtime stream thread
- **Where:** `src/twinkly_client.py:722-738`
- **What's wrong:** The `is_alive()` check and thread assignment run outside `self._lock`. `/api/frame` is serialized by `frame_mode_lock`, but `/api/v1/command` with `action:"frame"` takes no lock — two concurrent requests can start two `twinkly-realtime` threads, doubling UDP send rate and corrupting telemetry counters.
- **Fix:** Move the whole check-and-start inside `with self._lock:`; then drop `frame_mode_lock` from `server.py:377`.
- **Effort:** S
- **Grade lift:** B− → B− (latent race; cheap to close)

#### ~~B6~~ ✓ done 2026-08-09 — Firmware fallback keyed on exception message substrings
- **Where:** `src/twinkly_client.py:570`, `:574`, `:687`
- **What's wrong:** The `/led/movies/current` vs `/movies/current` firmware split branches on `"HTTP 404" in str(error)` — a string produced 300 lines away. Any message reformat silently turns graceful fallback into hard failure.
- **Fix:** Define `TwinklyHTTPError(ConnectionError)` carrying `status_code`; branch on `error.status_code == 404`.
- **Effort:** S
- **Grade lift:** B− → B− (removes a fragile hidden coupling)

#### ~~B7~~ ✓ done 2026-08-09 — Hot frame path uses the least efficient encoding and re-broadcasts full status 40×/sec
- **Where:** `public/app.js:945-965`; `server.py:397`; `src/state_broker.py:26-31`
- **What's wrong:** `flushFrame` posts ~9 KB of JSON numbers every 25 ms; each POST triggers `publish_controller_state` with full status including ever-changing telemetry counters, so the broker's deepcopy + fingerprint dedup never matches and every browser gets a full SSE event 40×/sec. The cold path (`/api/movies/bake`) already uses compact base64.
- **Fix:** Accept `pixelsBase64` on `/api/frame` (see G6); skip the publish for `source == "frame"` (the client discards it — `status_sync.js:15-23`) or exclude `streamTelemetry` from the fingerprint.
- **Effort:** M
- **Grade lift:** B− → B (hot-path waste removed; overlaps G6)

#### ~~B8~~ ✓ done 2026-08-09 — `MAX_BODY_BYTES` can reject a legitimate max-length bake on a bigger wall
- **Where:** `server.py:51` vs `src/movie_payload.py:7`
- **What's wrong:** 600 base64 frames at 32×24 is ~1.84 MB — just under the 2 MB cap. A larger wall exceeds it, and the user gets an opaque 400 after the browser already spent seconds rendering all frames.
- **Fix:** Derive the cap from `MAX_MOVIE_FRAMES × led_count × 4` for the bake route, or precompute payload size client-side in `bakeCurrentLook` and fail fast before rendering.
- **Effort:** S
- **Grade lift:** B− → B− (future-proofing a real limit)

---

## C — Frontend Quality — B−

Craft is above average for vanilla JS: zero `innerHTML` in 4260 lines (everything `createElement`/`textContent`), all 41 catch blocks route to a user-visible toast, hard pure logic extracted into 18 DOM-free tested modules, real loading/disabled/empty states, exemplary mic/screen-capture permission flows, `<details>`-based accordions, `focus-visible` and `prefers-reduced-motion` in CSS. Held to B− by: one real failure mode (C1), interleaved concerns in the monolith, half-built accessibility (one heading, placeholder-only labels, no `aria-pressed`), and sub-AA contrast on ~93 micro-type declarations.

#### ~~C1~~ ✓ done 2026-08-09 — Frame-send failures never mark the panel offline → unbounded error-toast loop
- **Where:** `public/app.js:945-971` (catch at `:965`); `setConnection` nulls only at `:436`
- **What's wrong:** `flushFrame()` catches a failed `/api/frame` POST and toasts but never sets `state.connected = false`; `finally` re-invokes it while an effect loop schedules a frame every 25 ms. If the server dies mid-animation the app emits failing POSTs and error toasts forever while the badge still reads "PANEL ONLINE".
- **Fix:** In the catch: `setConnection(null, error.message)`, clear `state.frameQueued`, toast once behind a flag. Add a reconnect poll calling `loadStatus()` on backoff (2s → 30s) that resumes streaming when connected flips back.
- **Effort:** M
- **Grade lift:** B− → B (the one genuine runtime failure mode in the UI)

#### ~~C2~~ ✓ done 2026-08-09 — `api()` parses JSON before checking `response.ok`, masking real failures
- **Where:** `public/app.js:222-233` (`.json()` at `:230` precedes the `!response.ok` check at `:231`)
- **What's wrong:** A 500 HTML page or empty 204 throws `SyntaxError: Unexpected token '<'` before status is inspected; all 28 call sites toast that instead of the actual failure. A network rejection surfaces as bare "Failed to fetch".
- **Fix:** Read `response.text()` first, `JSON.parse` in a try; on `!response.ok` throw `parsed?.error ?? \`${status} ${statusText}\``. Wrap fetch rejection with "Controller unreachable — is `python3 server.py` running?".
- **Effort:** S
- **Grade lift:** B− → B (every error message in the app gets more honest)

#### ~~C3~~ ✓ done 2026-08-09 — Micro-typography in muted greys fails WCAG AA contrast
- **Where:** `public/styles.css:753-754`, `:1115`, `:1345`, `:1523-1524`, `:1695`; ~93 declarations at 5–9px
- **What's wrong:** `#596155` (~3.1:1) and `#656d61` (~3.4:1) on near-black panels are below the 4.5:1 AA threshold, at sizes far too small to qualify as large text — and they carry real content (clip-studio instructions, effect hints, output notes).
- **Fix:** Floor informational text at 11px; promote the grey ramp to two tokens (`--text-dim` ≥4.5:1; `--text-faint` for non-informational chrome only). Verify with a contrast checker.
- **Effort:** M
- **Grade lift:** B− → B (legibility of the whole control surface)

#### ~~C4~~ ✓ done 2026-08-09 — 4260-line monolith with 262 uncached `document.querySelector` calls
- **Where:** `public/app.js:92-104` (only 10 cached refs); `renderSceneMirrors()` `:673-687` runs a descendant query inside the 40fps render path; painters at `:2356-2849` read globals (forces the C4/A4 state-swap hack)
- **What's wrong:** DOM refs, event wiring, state, canvas painting, and fetch are interleaved; `updateStreamTelemetry` (`:344-373`) does 9 lookups per 2s tick; painters can't be unit tested.
- **Fix:** Extract `dom.js` resolving every static `#id` once; extract `effect_painters.js` with explicit `{width, height, zone}` (= A3); split into `boot.js` / `net.js` / per-panel wiring. Hoist the `.preset-row.active` lookup out of `render()`.
- **Effort:** L
- **Grade lift:** B− → B+ (structural; overlaps A3/A5)

#### ~~C5~~ ✓ done 2026-08-09 — Toggle buttons expose state only via CSS class, never `aria-pressed`
- **Where:** effect cards `public/app.js:2313-2315`/`:768-770`; brush `:1023-1030`; eraser `:1032-1035`; rotation `:291-293` (+ `public/index.html:94-107`, `:830-839`)
- **What's wrong:** Screen readers announce "ERASE, button" identically on and off. `#sceneFavoritesFilter` (`app.js:4106-4109`) already sets `aria-pressed` — the pattern exists, just unapplied.
- **Fix:** Set `aria-pressed` alongside each `classList.toggle("active", …)`; for the mutually-exclusive brush/rotation clusters use `role="radiogroup"` + `aria-checked`.
- **Effort:** S
- **Grade lift:** B− → B− (meaningful a11y for near-zero cost)

#### ~~C6~~ ✓ done 2026-08-09 — Five text inputs labeled only by `placeholder`
- **Where:** `public/index.html:378-385` (`#paletteName`), `:440-447` (`#segmentName`), `:588-595` (`#bakeMovieName`), `:747-754` (`#playlistName`), `:789` (`#automationName`)
- **What's wrong:** No `<label>`, `for=`, or `aria-label`; the accname comes from placeholder, which vanishes on typing and inherits C3's low-contrast grey. Every other input in the file uses the proper `<label><span>…</span><input></label>` pattern.
- **Fix:** Wrap in the existing label pattern (or minimum: `aria-label`).
- **Effort:** S
- **Grade lift:** B− → B− (closes the a11y labeling gap)

#### ~~C7~~ ✓ done 2026-08-09 — No heading hierarchy: seven rack sections unnavigable
- **Where:** `public/index.html:42` is the only heading; section titles at `:261-263`, `:309-311`, `:498-500`, `:547-549`, `:715-717`, `:766-768`, `:824-826` are `<div class="rack-title"><span>…`
- **What's wrong:** A screen-reader user browsing by heading finds exactly one in a dense seven-panel surface; `<section>`s carry no `aria-labelledby`.
- **Fix:** Change each rack-title `<span>` to `<h2 id="…">` with a `margin: 0` reset; add `aria-labelledby` on the parent `<section>`.
- **Effort:** S
- **Grade lift:** B− → B− (navigation landmarks)

#### ~~C8~~ ✓ done 2026-08-09 — Design tokens exist but aren't used: 151 raw hex literals vs 14 custom properties
- **Where:** `public/styles.css:1-15` defines 14 vars; below, 151 raw hex (`#090b09` ×17, `#656d61` ×13, `#070907` ×13), 64 raw `rgba()`, and the font stack spelled out 102 times. No stylelint/eslint/prettier anywhere.
- **What's wrong:** The token layer is decorative; a contrast pass (C3), light theme, or tonal shift means a 151-site find-and-replace with no safety net.
- **Fix:** Promote recurring literals to tokens (`--surface-1`, `--text-dim`, `--text-faint`, `--font-condensed`) and sweep; add stylelint banning bare hex outside `:root` (pairs with I1).
- **Effort:** M
- **Grade lift:** B− → B (makes C3 and any theming tractable)

---

## D — Testing & Reliability — C+

The tests that exist are legitimately good — `test_library_store.py` verifies cascade-delete invariants in tmpdirs, `test_twinkly_client.py:78-145` mocks the 404-firmware fallback, `test_state_broker.py:29-42` spins a real thread for SSE wakeup — and the suite runs clean (verified: 49 Python + 67 Node = 116 passing, matching the README badge). But ~48% of the code (4,812 of ~10,100 LOC) has zero tests: every route in `server.py` [BE] and all of `public/app.js` [FE]. There are zero integration tests and no coverage measurement in CI.

#### ~~D1~~ ✓ done 2026-08-09 — `server.py` is structurally untestable [BE]
- **Where:** `server.py:439`, `:90-98`, `:509-510`, `:547`
- **What's wrong:** Importing the module binds TCP :4312, constructs a `TwinklyClient`, registers signal handlers, launches threads, and serves forever. This is why zero route tests exist: `read_json`'s guards, the six-exception→400 mapping, DELETE prefix parsing, and SSE resume logic are all unverified.
- **Fix:** Same refactor as A1 (`create_server` factory + `main()`), then add `test/test_server_routes.py` binding port 0 with a mocked client: assert health, capabilities, 400 on bad content-type, 404 on unknown scene, 503 when client is None.
- **Effort:** M
- **Grade lift:** C+ → B (covers the entire HTTP contract)

#### ~~D2~~ ✓ done 2026-08-09 — `public/app.js`: 4,260 lines, 92 functions, zero tests [FE]
- **Where:** `public/app.js` (0 exports)
- **What's wrong:** All extractable pure logic already moved to the 16 tested models; what remains untested is stateful and substantial — `api()` (`:222`), `applyStatus()` (`:245`), `flushFrame()` (`:945`), `runPlaylistStep()` (`:3769`), `captureMovieFrames()` (`:2866`), `migrateBrowserPresets()` (`:3672`). A playlist-advance or preset-migration bug ships silently.
- **Fix:** Continue the extraction pattern: `api_client.js`, `playlist_runner.js`, `preset_migration.js` with injected `fetch` stubs. Target the ~10 highest-risk functions, not the whole file.
- **Effort:** L
- **Grade lift:** C+ → B− (covers the riskiest frontend paths)

#### ~~D3~~ ✓ done 2026-08-09 — `twinkly_client` network layer entirely unmocked [BE]
- **Where:** `src/twinkly_client.py:252`, `:299`, `:342`, `:362`, `:741`, `:762`
- **What's wrong:** Tests mock at the `client.request` seam, one level above urllib — the actual `urlopen` call, HTTP-error→`ConnectionError` translation, timeouts, the auth challenge/verify handshake, and the UDP `_stream_loop` are never executed.
- **Fix:** Patch `urllib.request.urlopen` with fake responses covering 401→re-auth, 500→ConnectionError, timeout, malformed JSON; patch `client._socket` to assert `_stream_loop` fragmentation and packet sequence.
- **Effort:** M
- **Grade lift:** C+ → B− (the protocol layer is the hardest-to-debug failure zone)

#### ~~D4~~ ✓ done 2026-08-09 — Two tests assert on source *text*, not behavior [FE]
- **Where:** `test/frame_timing.test.mjs:36-47`, `test/effect_preview_model.test.mjs:27-37`
- **What's wrong:** They `readFileSync` `app.js` and regex-slice it (`assert.doesNotMatch(frameUpload, /applyStatus/)`). They break on any rename and pass even when runtime behavior is wrong — and they're the only tests touching `app.js`, giving a false impression of coverage.
- **Fix:** Delete the source-scraping assertions; after D2's extraction, assert with an injected spy instead.
- **Effort:** S
- **Grade lift:** C+ → C+ (honesty of the suite)

#### ~~D5~~ ✓ done 2026-08-09 — No coverage measurement, so the 48% blind spot is invisible [both]
- **Where:** `.github/workflows/test.yml:19`, `:29`
- **What's wrong:** CI reports green with nothing telling a contributor that `server.py` and `app.js` are at 0%.
- **Fix:** `python -m coverage run -m unittest … && coverage report --fail-under=70` (dev-only dep, consistent with the zero-runtime-deps rule); Node: `node --test --experimental-test-coverage`.
- **Effort:** S
- **Grade lift:** C+ → B− (makes the gap visible and ratchetable)

#### ~~D6~~ ✓ done 2026-08-09 — Zero integration tests: unit/integration balance is 116/0 [both]
- **Where:** `test/` as a whole
- **What's wrong:** Nothing verifies frontend request shapes match backend parsers, that `openapi.json` matches real routes, or that the SSE stream is well-formed.
- **Fix:** After D1: one smoke test booting the server on port 0 with a mocked client — hit health/capabilities, POST a scene, read one SSE frame. Add a schema-drift test asserting every `openapi.json` path exists in `server.py`.
- **Effort:** M
- **Grade lift:** C+ → B− (catches contract drift)

---

## E — Security — A−

The threat model is handled deliberately: `HOST` defaults to loopback (`server.py:46`) and `validate_bind_security` (`command_api.py:23-33`) fails closed at import if you bind non-loopback without an explicit opt-in. Static serving delegates to stdlib `SimpleHTTPRequestHandler` (no custom path joins → no traversal). Zero `innerHTML`/`eval` across `public/` — XSS-free by construction. `deviceIp` must be private/link-local IPv4. CI: CodeQL both languages, gitleaks with defaults, dependabot, SHA-pinned actions, default-deny permissions.

#### E1 — No `Host` header validation — DNS rebinding reaches the whole API
- **Where:** `server.py:219` (`do_GET`), `:325` (`do_POST`)
- **What's wrong:** A page on `evil.com` that DNS-rebinds to `127.0.0.1` makes same-origin requests — no CORS preflight applies, so the content-type check that incidentally blocks form CSRF gives no protection. Full read/write control of the panel. The one browser-reachable attack on a loopback service.
- **Fix:** Shared request preamble: reject any `Host` not in `{"127.0.0.1", "localhost", "[::1]", HOST}` with 421. ~8 lines.
- **Effort:** S
- **Grade lift:** A− → A (closes the only real remote vector)

#### E2 — LAN mode is the documented recommendation but offers no auth at all
- **Where:** `docs/INTEGRATIONS.md:74-78`, `README.md:143-145`
- **What's wrong:** The Home Assistant docs instruct `HOST=0.0.0.0 ALLOW_UNAUTHENTICATED_LAN=1`, and no credential option exists — the choice is loopback-only or fully open to every device on the LAN.
- **Fix:** Optional `SQUARES_TOKEN` env var; when set, require `X-Squares-Token` via `hmac.compare_digest`, and let `validate_bind_security` accept non-loopback with a token. `squaresctl` reads the same var. ~30 lines.
- **Effort:** M
- **Grade lift:** A− → A (gives LAN users a real option)

#### E3 — `is_link_local` allows the cloud metadata address
- **Where:** `server.py:85`
- **What's wrong:** `169.254.169.254` passes the "private or link-local" SSRF guard that SECURITY.md advertises. Meaningless on a home Mac, but weaker than documented.
- **Fix:** Explicitly reject `169.254.169.254/32`, or drop link-local from the allowlist.
- **Effort:** S
- **Grade lift:** A− → A− (guard matches its documentation)

#### E4 — No baseline security response headers on the UI
- **Where:** `server.py:140-143` (`end_headers`)
- **What's wrong:** Only `Cache-Control` is set. The UI is `innerHTML`-free so exploitability is near zero, but a CSP would make that enforced rather than observed.
- **Fix:** For non-`/api/` paths add `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; base-uri 'none'` (verify against the blob media paths).
- **Effort:** S
- **Grade lift:** A− → A− (defense in depth)

#### E5 — Duplicate `Cache-Control` header on non-API JSON errors
- **Where:** `server.py:151` + `:140-143`
- **What's wrong:** `send_json` sends `no-store`, then `end_headers` re-sends it for non-`/api/` paths — e.g. `POST /foo` → 404 with the header twice. Cosmetic.
- **Fix:** Guard the override with a flag, or let `send_json` rely on the override.
- **Effort:** S
- **Grade lift:** nit

---

## F — Dependencies & Tech Currency — A

Verified, not just claimed: `package.json` has no dependency keys at all; every backend import is stdlib; `index.html` loads exactly one local stylesheet and one local module — no CDN, no vendored libs, no `node_modules`. Test runners are built-ins. Policy is written down (`CONTRIBUTING.md:11-13`) and dependabot pre-registers the npm ecosystem with a comment explaining the empty pip entry. The only near-deprecated API is a deliberate `webkitAudioContext` fallback.

#### F1 — Python floor is prose-only and unenforced
- **Where:** `README.md:56`
- **What's wrong:** "Requires Python 3.11+" exists nowhere machine-readable; an older interpreter gets an arbitrary traceback instead of a clear message.
- **Fix:** Minimal `pyproject.toml` with `requires-python = ">=3.11"`, or a three-line `sys.version_info` guard at the top of `server.py`.
- **Effort:** S
- **Grade lift:** A → A (clean failure mode)

#### F2 — Declared Node floor is never exercised
- **Where:** `package.json:16-18` vs `.github/workflows/test.yml:23-29`
- **What's wrong:** `engines.node: ">=18"` but CI runs only Node 22; `node --test` behavior differs meaningfully at 18.
- **Fix:** Matrix `["18", "22"]` on the browser-models job, or raise `engines` to `">=22"`.
- **Effort:** S
- **Grade lift:** A → A (claims match verification)

#### F3 — CI Python matrix trails current
- **Where:** `.github/workflows/test.yml:16`
- **What's wrong:** `["3.11", "3.13"]`; for a stdlib-only codebase, newest-interpreter compatibility is free to verify.
- **Fix:** Add `"3.14"` to the matrix.
- **Effort:** S
- **Grade lift:** A → A (currency signal)

---

## G — Performance & Scalability — A−

The architecture is right for the problem: browser-side latest-frame-wins backpressure with a single in-flight upload (`app.js:938-967`), a deadline-aligned relay clock that skips rather than burst-catches-up (`twinkly_client.py:42-44`, `:741-749`), one long-lived UDP socket, bounded telemetry deques, and rAF throttled to the 25 ms budget. `docs/PERFORMANCE.md` is exemplary — real-device p95 tables and an honest retraction about optical frame-drop testing. Deductions are constant-factor waste in the two hot paths — headroom that matters for larger walls.

#### ~~G1~~ ✓ done 2026-08-09 — Rotation+layout permutation recomputed per frame instead of cached
- **Where:** `src/twinkly_client.py:122` (`oriented_raster_to_device_frame`), called from `:705`
- **What's wrong:** Every inbound frame (40/s) runs a `height × width` Python loop for rotation, then a second full-`led_count` loop for layout — a pure function of `(layout, rotation)` that changes only on connect/rotate.
- **Fix:** Cache a fused flat channel-index permutation keyed by `(id(layout), rotation)`, invalidated in `set_rotation`/`connect`; per-frame work collapses to `bytes(map(source.__getitem__, channel_perm))`. ~3-4× off relay CPU per frame.
- **Effort:** M
- **Grade lift:** A− → A (biggest hot-path win)

#### ~~G2~~ ✓ done 2026-08-09 — Brightness scaling re-runs a per-channel Python generator on every UDP send
- **Where:** `src/twinkly_client.py:197`, called at `:759`
- **What's wrong:** 2,304-channel generator at 37.5 Hz — including identical recomputation on *held* static frames, forever.
- **Fix:** (a) `frame.translate(table)` with a memoized 256-byte table per brightness percent (moves it to C); (b) memoize on `(frame_version, percent)` so held frames scale once.
- **Effort:** S
- **Grade lift:** A− → A (near-free; largest steady-state saving)

#### ~~G3~~ ✓ done 2026-08-09 — Realtime token decoded and packet headers rebuilt every send
- **Where:** `src/twinkly_client.py:207` (`build_realtime_packets`)
- **What's wrong:** `base64.b64decode(token)` + fresh header bytes 37.5×/sec for a token that changes every ~3 hours.
- **Fix:** Cache `token_bytes` in `authenticate`; precompute per-fragment header prefixes once.
- **Effort:** S
- **Grade lift:** A− → A− (small, clean)

#### G4 (partial 2026-08-09: ImageData reuse, cached mirror lookup, hoisted gap math; per-cell fillRect look kept deliberately) — Main preview render uses ~1,000+ per-cell draw calls with string allocation each
- **Where:** `public/app.js:688`
- **What's wrong:** Per cell: an `rgb()` template string, `fillStyle` set, `fillRect` — ~40-60k calls + strings/sec during effects, steady GC pressure. The small mirror canvases already use the fast `createImageData`/`putImageData` path (`:505-526`).
- **Fix:** Render into a persistent offscreen `width × height` ImageData, `putImageData`, then one scaled `drawImage` with `imageSmoothingEnabled = false`; keep gap/glow as a static overlay rebuilt only on dimension/zone change.
- **Effort:** M
- **Grade lift:** A− → A (biggest frontend render win)

#### ~~G5~~ ✓ done 2026-08-09 — Text-scroll tick allocates a fresh `<canvas>` every frame
- **Where:** `public/app.js:3170`
- **What's wrong:** `createElement("canvas")` + new 2D context + `getImageData` 40×/sec, nothing reused.
- **Fix:** Hoist the sampling canvas/context to module scope beside `mediaCanvas` (`:95`); resize on dimension change; `clearRect` per frame.
- **Effort:** S
- **Grade lift:** A− → A− (easy win)

#### ~~G6~~ ✓ done 2026-08-09 — Realtime frames upload as JSON number arrays at ~3.6× byte cost
- **Where:** `public/app.js:962`; consumed at `server.py:370-381`
- **What's wrong:** ~8.3 KB JSON for 2.3 KB of RGB, 40×/sec, plus per-element float/round/clamp rebuild server-side. The bake path already proves `pixelsBase64` works (`movie_payload.py:29-35`).
- **Fix:** Add a `pixelsBase64` branch to `/api/frame` (keep the array form for compat); browser sends `btoa` over the typed array; server does one `b64decode`. (Same fix as B7.)
- **Effort:** M
- **Grade lift:** A− → A (hot-path encoding parity; overlaps B7)

---

## H — Documentation & Onboarding — B+

A new contributor is running in under 10 minutes: the quick start works, and the env-var table (`README.md:112-121`) matches `server.py:36-50` exactly. `docs/INTEGRATIONS.md` covers CLI/curl/Shortcuts/Stream Deck/Home Assistant; `docs/PERFORMANCE.md` is the standout. Gaps are contributor-facing: a 13-line CONTRIBUTING, an uncommented protocol module, and an OpenAPI doc covering a fraction of the live surface.

#### H1 — The 791-line protocol module has one docstring and zero comments
- **Where:** `src/twinkly_client.py:207` (`build_realtime_packets`), `:55` (`calculate_layout`), `:122`
- **What's wrong:** The least-guessable code in the project — an undocumented vendor protocol. Nothing explains the `\x03` header byte, the 8-byte token, the two zero bytes, the 900-byte chunk size, or the Y-axis flip in layout calculation. A contributor cannot safely modify it.
- **Fix:** Module docstring describing the XLED v1 flow (challenge → login → verify → token, then UDP :7777), a byte-layout comment table over the header, and a docstring on `calculate_layout` explaining the coordinate inversion. Prose only.
- **Effort:** S
- **Grade lift:** B+ → A− (unlocks the scariest file)

#### H2 — `CONTRIBUTING.md` omits the entire dev loop
- **Where:** `CONTRIBUTING.md:1-13`
- **What's wrong:** Only mechanical instruction is "run `npm test`". Missing: single-test invocation, running without hardware, the deliberate no-linter stance, and the `*_model.js` ↔ `*.test.mjs` extraction convention the codebase clearly follows.
- **Fix:** Extend to ~40 lines covering those four things plus version floors.
- **Effort:** S
- **Grade lift:** B+ → A− (contributor onboarding)

#### H3 — No architecture overview for a 20-module frontend and 8-module backend
- **Where:** `README.md:175-180` ("How it works" — four sentences)
- **What's wrong:** No map of what `state_broker`/`runtime_policy`/`library_store`/`automation_store` own; the four-stage timing pipeline is described only inside the benchmarks doc.
- **Fix:** `docs/ARCHITECTURE.md`: per-module table, the model-extraction convention, and an ASCII data-flow: `browser rAF → POST /api/frame → set_raster_frame → _stream_loop @37.5Hz → UDP:7777`, SSE fan-out as return path. Link from README.
- **Effort:** M
- **Grade lift:** B+ → A− (orientation for contributors)

#### H4 — `openapi.json` documents 6 of ~27 live operations, no response schemas
- **Where:** `public/openapi.json:12`
- **What's wrong:** The `/api/v1/command` request schema is genuinely good, but the doc omits the entire unversioned surface and every response is a bare description string — no client can be generated.
- **Fix:** (a) State in `info.description` that the doc intentionally covers only the stable `/api/v1` surface and unversioned routes are UI-internal. (b) Add `components.schemas` for `ControllerStatus` and `Error` and reference them. (Pairs with B4.)
- **Effort:** M
- **Grade lift:** B+ → B+ (honest, generatable API doc)

#### H5 — README test counts are hand-maintained and will drift
- **Where:** `README.md:8` (badge "116 passing"), `:157`
- **What's wrong:** Counts are accurate today but nothing regenerates them; they silently rot with the next added test.
- **Fix:** Point the badge at the GitHub Actions workflow status (self-updating) or drop the numeric counts.
- **Effort:** S
- **Grade lift:** B+ → B+ (trust preservation)

---

## I — Developer Experience & Tooling — B−

Supply-chain and CI hygiene are above average: SHA-pinned actions with version comments, dependabot with honest comments, CodeQL 2-language matrix, gitleaks, default-deny permissions. Type discipline is real (`server.py` 19/20 defs annotated; two src modules at 100%). But there is not a single linter, formatter, or type checker configured anywhere — the excellent type hints are decorative — the dev loop has no auto-reload, and CONTRIBUTING gives no engineering guidance.

#### I1 — No linter or formatter of any kind [both]
- **Where:** repo root (verified absent: `pyproject.toml`, `ruff.toml`, `.eslintrc*`, `.prettierrc*`, `.editorconfig`, `Makefile`)
- **What's wrong:** Nothing catches unused imports, shadowed builtins (`server.py:136` shadows `format`), or dead branches in the broad exception tuple at `server.py:400-408`. Style is maintained by hand.
- **Fix:** `pyproject.toml` with `[tool.ruff]` (`select = ["E","F","B","UP","SIM"]`), minimal flat `eslint.config.js` for `public/**` + `test/**`, `npm run lint`, and a lint job in `test.yml`. Dev-only, consistent with zero-runtime-deps.
- **Effort:** S
- **Grade lift:** B− → B+ (the single biggest tooling gap)

#### I2 — Comprehensive type hints exist but nothing checks them [BE]
- **Where:** `src/twinkly_client.py` (26/34 annotated), `src/command_api.py` (5/8), `src/movie_payload.py` (0/1), `server.py` (19/20)
- **What's wrong:** No mypy/pyright validates the annotations; gaps are uneven and invisible. Frontend has zero JSDoc across all 21 files.
- **Fix:** `[tool.mypy]` strict on `src/` first, ratchet for `server.py`, add to CI lint job. Frontend: JSDoc on the 16 model modules + `// @ts-check` — free coverage, no build step.
- **Effort:** S
- **Grade lift:** B− → B (hints become guarantees)

#### I3 — No auto-reload in the local dev loop [both]
- **Where:** `scripts/start.sh:5`, `package.json:14`
- **What's wrong:** Every backend edit needs Ctrl-C + restart + hardware re-handshake. (Frontend reloads fine — `Cache-Control: no-store` at `server.py:141-142` is a nice touch.)
- **Fix:** `npm run dev` wrapping a small stdlib `scripts/dev.py` (mtime polling over `server.py`/`src/*.py` + subprocess restart). Document in CONTRIBUTING.
- **Effort:** S
- **Grade lift:** B− → B (iteration speed)

#### I4 — `CONTRIBUTING.md` is process-only [both]
- **Where:** `CONTRIBUTING.md` (12 lines)
- **What's wrong:** Same gap as H2, from the tooling side: no layout map, no test-naming convention, no version floors (`engines` says node ≥18, CI runs 22; Python floor undeclared despite CI on 3.11/3.13).
- **Fix:** Covered by H2 + declare `requires-python = ">=3.11"` (F1).
- **Effort:** S
- **Grade lift:** counted under H2/F1

#### I5 — CI gates only on tests; no concurrency cancellation, duplicated runs [both]
- **Where:** `.github/workflows/test.yml:3-5`
- **What's wrong:** Unfiltered `on: push` + `pull_request` double-runs same-repo PR branches; no `concurrency` group (stale jobs survive force-pushes); no `timeout-minutes` (a hung `node --test` burns 6 hours).
- **Fix:** Add `concurrency: {group: workflow-ref, cancel-in-progress: true}`, `timeout-minutes: 10` on both jobs, `on: push: branches: [main]`, plus the lint job from I1.
- **Effort:** S
- **Grade lift:** B− → B (CI hygiene)

#### I6 — `squaresctl` covers 6 of ~20 routes and mishandles `--help` [BE]
- **Where:** `scripts/squaresctl:20-56`
- **What's wrong:** Well-built (`set -euo pipefail`, `curl --fail`, input regex validation) but reaches only status/health/off/stock/brightness/rotate — no scenes, playlists, automations, telemetry. `--help` falls into the `*)` catch-all and exits 2.
- **Fix:** Explicit `-h|--help|help)` → `usage; exit 0`; add `scenes`, `automations`, `telemetry` subcommands; shellcheck the five shell scripts in CI.
- **Effort:** S
- **Grade lift:** B− → B− (CLI completeness)

---

## What's genuinely good (protect these in review)

- Zero `innerHTML`/`eval` anywhere — XSS-free by construction; zero runtime dependencies — verified, with policy written down.
- Atomic persistence (temp file + fsync + `os.replace`) in all four stores.
- Fail-closed LAN binding gate tested in `test_command_api.py:73-78`.
- Every catch block surfaces to the user; media permission flows are exemplary.
- `docs/PERFORMANCE.md` with real-device numbers and an honest retraction.
- SHA-pinned CI actions, CodeQL, gitleaks, dependabot — better than most commercial repos.
