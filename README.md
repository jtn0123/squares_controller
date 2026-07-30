# Squares Controller

A local-first browser controller for Twinkly Squares. It uses the controller's
stock firmware and stored LED coordinate map, so there is nothing to flash,
open, or solder.

## Features

- Live pixel painting, fill, erase, and image import
- Realtime generated effects with speed and intensity controls
- Scrolling text and a local clock
- Browser-local presets
- Realtime software brightness that works while frames are streaming
- Off and return-to-stock controls
- No cloud service and no third-party runtime packages

The layout is read from the Twinkly controller at startup. The current UI is
optimized for rectangular Squares arrangements and has been tested with a
32×24, 768-pixel installation.

## Quick start

Requires Python 3.11 or newer. Node is optional; `npm` is only used as a
convenient command runner.

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

Open [http://127.0.0.1:4312](http://127.0.0.1:4312). Press `Control-C` to stop;
a graceful shutdown returns the panel to its saved Twinkly animation.

`TWINKLY_IP`, `HOST`, and `PORT` environment variables override the config file
and server defaults.

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

The server binds to `127.0.0.1` by default. Keep that default unless you
specifically need another device on your trusted LAN to access the controls.
There is currently no authentication layer.

To use another device on the same trusted network:

```bash
HOST=0.0.0.0 npm start
```

Do not expose port 4312 to the internet or an untrusted network. The app also
rejects public IP addresses as panel targets. See [SECURITY.md](SECURITY.md).

## Test

```bash
npm test
```

The test suite covers coordinate mapping, RGB reordering, frame validation,
software brightness, and realtime-protocol fragmentation.

## How it works

The browser talks only to the local Python server. The server authenticates
directly with the controller over HTTP and streams RGB frames to UDP port 7777.
All application code is original; no third-party project code is vendored.

## License

MIT
