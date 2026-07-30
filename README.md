# Squares Controller

A local-first browser controller for Twinkly Squares. It keeps the stock
Twinkly firmware and coordinate map, so there is nothing to flash, open, or
solder.

![Version](https://img.shields.io/badge/version-0.8.1-d9ff5b)
![Tests](https://img.shields.io/badge/tests-60%20passing-d9ff5b)
![License](https://img.shields.io/badge/license-MIT-d9ff5b)

## What it can do

- Paint, erase, fill, and preview the entire matrix in real time
- Import still images, animated GIFs, and video with fit, sampling, saturation,
  contrast, gamma, and playback controls
- Run ten procedural 2D and particle effects with speed and intensity controls
- Select curated palettes or create a custom three-color gradient
- Compose two effect layers with opacity and five blend modes
- Target the whole wall, a panel, a row, a column, or a custom rectangle
- Save server-persisted scenes and timed playlists with cut, crossfade, push,
  or dissolve transitions
- See real scene thumbnails, an exact live-output monitor, active-scene state,
  and playlist step progress in the controller UI
- Display scrolling text, a clock, and locally loaded fonts
- Schedule sleep, wake, brightness, stock-mode, and off actions
- Rotate the complete display to 0°, 90°, 180°, or 270°
- Control live brightness while custom frames are streaming
- Integrate local tools through a versioned JSON API, OpenAPI document, CLI,
  Server-Sent Events, and a Home Assistant example
- Return to the original Twinkly animation at any time

The layout is read from the Twinkly controller at startup. This project has
been physically tested with a 4×3, 768-pixel Twinkly Squares wall: 32×24 at
0°/180° and 24×32 at 90°/270°.

## Quick start

Requires Python 3.11 or newer. Node 18 or newer is optional; `npm` is only used
as a convenient command runner and test runner.

```bash
cp config.example.json config.json
```

Edit `config.json` and set the private IPv4 address of your Twinkly controller:

```json
{
  "deviceIp": "192.168.1.100"
}
```

Then start the app:

```bash
npm start
```

Or without Node:

```bash
python3 server.py
```

On macOS, you can also double-click `scripts/start.command`.

Open [http://127.0.0.1:4312](http://127.0.0.1:4312). Press `Control-C` to stop;
a graceful shutdown returns the panel to its saved Twinkly animation.

Scenes, playlists, and automations are stored in `.squares/` beside the
controller. That directory and `config.json` are ignored by Git.

## Local integrations

The versioned local API is documented in
[docs/INTEGRATIONS.md](docs/INTEGRATIONS.md). A few examples:

```bash
./scripts/squaresctl status
./scripts/squaresctl brightness 25
./scripts/squaresctl rotate 270
./scripts/squaresctl off
./scripts/squaresctl stock
```

The live OpenAPI document is served at
[http://127.0.0.1:4312/openapi.json](http://127.0.0.1:4312/openapi.json).

## Configuration

Environment variables override the defaults:

| Variable | Purpose | Default |
| --- | --- | --- |
| `TWINKLY_IP` | Twinkly controller IPv4 address | `config.json` |
| `HOST` | Web server bind address | `127.0.0.1` |
| `PORT` | Web server port | `4312` |
| `SQUARES_CONFIG` | Alternate configuration file | `./config.json` |
| `SQUARES_LIBRARY` | Alternate scene/playlist file | `./.squares/library.json` |
| `SQUARES_AUTOMATIONS` | Alternate automation file | `./.squares/automations.json` |
| `ALLOW_UNAUTHENTICATED_LAN` | Explicitly allow a non-loopback bind | unset |

## Start automatically on macOS

From the project directory:

```bash
./scripts/install-macos-service.sh
```

This installs a user LaunchAgent, starts the controller at login, and keeps it
running after a crash. Remove it with:

```bash
./scripts/uninstall-macos-service.sh
```

## Security

The server has no authentication and therefore binds only to `127.0.0.1` by
default. A non-loopback bind is refused unless you make the risk explicit:

```bash
HOST=0.0.0.0 ALLOW_UNAUTHENTICATED_LAN=1 npm start
```

Use that only on a trusted, firewalled home network. Never port-forward port
4312 or expose it to the internet. The app also rejects public IP addresses as
panel targets. See [SECURITY.md](SECURITY.md).

## Test

```bash
npm test
```

The current suite contains 29 Python and 31 browser-model tests. It covers
device protocol behavior, coordinate mapping, brightness, rotation, state
synchronization, persistence, scheduling, API validation, palettes, zones,
blending, transitions, effects, media controls, scenes, and playlists.

## How it works

The browser talks only to the local Python server. The server authenticates
directly with the Twinkly controller over HTTP and streams RGB frames over the
controller's local realtime protocol on UDP port 7777. The runtime uses the
Python standard library and native browser APIs.

## WLED inspiration and attribution

[WLED](https://github.com/wled/WLED) is an excellent community-built LED
firmware project. Its established product concepts—including
[presets and playlists](https://kno.wled.ge/features/presets/),
[segments](https://kno.wled.ge/features/segments/),
[palettes](https://kno.wled.ge/features/palettes/), transitions, effects,
scheduling, and a [JSON API](https://kno.wled.ge/interfaces/json-api/)—helped
shape the roadmap for Squares Controller.

Squares Controller is an independent implementation for stock Twinkly
hardware. It does not include or modify WLED firmware, source code, web UI
assets, or branding, and it is not affiliated with the WLED or Twinkly
projects. WLED is licensed under EUPL-1.2; Squares Controller remains MIT
licensed. See [NOTICE.md](NOTICE.md) for the durable attribution statement.

## License

MIT
