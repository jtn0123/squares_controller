# Local integrations

Squares Controller exposes a versioned JSON API at
`http://127.0.0.1:4312/api/v1`. It is designed for software running on the
same Mac: Apple Shortcuts, Stream Deck shell actions, local scripts, and
development tools.

The OpenAPI document is available at
[`/openapi.json`](http://127.0.0.1:4312/openapi.json), and the live capability
description is available at `/api/v1/capabilities`.

## Command-line helper

From the repository:

```bash
./scripts/squaresctl status
./scripts/squaresctl brightness 25
./scripts/squaresctl rotate 270
./scripts/squaresctl off
./scripts/squaresctl stock
```

Set `SQUARES_URL` if the controller uses a different local port.

## JSON commands

All commands use `POST /api/v1/command` with `Content-Type:
application/json`.

```bash
curl -sS http://127.0.0.1:4312/api/v1/command \
  -H 'Content-Type: application/json' \
  -d '{"action":"brightness","value":25}'
```

Supported actions are:

- `status`
- `mode` with `mode` set to `off` or `movie`
- `brightness` with `value` from 1 through 100
- `rotation` with `degrees` set to 0, 90, 180, or 270
- `frame` with `width`, `height`, and a flat RGB `pixels` array

`GET /api/v1/state` returns controller state plus scene, playlist, and
automation counts. `GET /api/events` is a Server-Sent Events stream for live
controller changes.

Generated effects, media, fonts, transitions, and playlist rendering run in
the browser. The external API controls hardware state and complete raster
frames directly.

## Apple Shortcuts and Stream Deck

For Shortcuts, use **Get Contents of URL**:

- URL: `http://127.0.0.1:4312/api/v1/command`
- Method: `POST`
- Request body: JSON
- Example keys: `action = brightness`, `value = 25`

For Stream Deck, use a shell-action plugin to call `scripts/squaresctl`.

## Home Assistant

An example `rest_command` configuration is in
[`examples/home-assistant.yaml`](../examples/home-assistant.yaml).

Home Assistant commonly runs on another machine. Squares Controller refuses
non-loopback binding unless you explicitly opt in:

```bash
HOST=0.0.0.0 ALLOW_UNAUTHENTICATED_LAN=1 npm start
```

Only do this on a trusted, firewalled home network. The API has no
authentication. Never port-forward port 4312 or expose it to the internet.
