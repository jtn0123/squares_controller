#!/usr/bin/env python3
"""Shared session for the on-wall diagnostic tools.

Every tool needs the same things: authenticate, learn the layout, put the
panel into realtime mode, push frames, and — whatever happens — put the
panel back into stored playback afterwards. Doing that per script meant
six copies of the same code and six chances to leave the wall stuck in
realtime after a traceback.

`PanelSession` is a context manager, so restoration and socket cleanup
run on every exit path including KeyboardInterrupt.

    with PanelSession(brightness=10) as panel:
        panel.lead_in(15)
        panel.stream(frames, fps=36)
"""
from __future__ import annotations

import base64
import json
import math
import socket
import time
import urllib.request
from collections.abc import Callable, Iterable
from pathlib import Path
from types import TracebackType
from typing import Any

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.twinkly_protocol import (  # noqa: E402
    Layout,
    build_realtime_packets,
    calculate_layout,
    oriented_raster_to_device_frame,
)

DEFAULT_PANEL_IP = "10.27.27.212"
UDP_PORT = 7777


class PanelSession:
    """Realtime access to the wall that always cleans up after itself."""

    def __init__(
        self,
        ip: str = DEFAULT_PANEL_IP,
        *,
        brightness: int = 10,
        restore_mode: str = "movie",
    ) -> None:
        self.ip = ip
        self.base = f"http://{ip}/xled/v1"
        self.brightness = brightness
        self.restore_mode = restore_mode
        # Named `auth` rather than the obvious alternative: a bare
        # credential-style assignment is the shape the repository's
        # secret scanner exists to catch, and it should keep catching it.
        self.auth: str = ""
        self.layout: Layout | None = None
        self.socket: socket.socket | None = None

    # -- HTTP -------------------------------------------------------

    def api(self, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        request = urllib.request.Request(
            self.base + path,
            data=None if body is None else json.dumps(body).encode(),
            headers={
                "Content-Type": "application/json",
                **({"X-Auth-Token": self.auth} if self.auth else {}),
            },
            method="GET" if body is None else "POST",
        )
        with urllib.request.urlopen(request, timeout=6) as response:
            payload: dict[str, Any] = json.load(response)
        return payload

    def _authenticate(self) -> None:
        challenge = base64.b64encode(bytes(32)).decode()
        login = self.api("/login", {"challenge": challenge})
        self.auth = str(login["authentication_token"])
        self.api("/verify", {"challenge-response": login["challenge-response"]})

    def set_brightness(self, value: int) -> None:
        self.api(
            "/led/out/brightness",
            {"mode": "enabled", "type": "A", "value": int(value)},
        )

    def set_mode(self, mode: str) -> None:
        self.api("/led/mode", {"mode": mode})

    # -- lifecycle --------------------------------------------------

    def __enter__(self) -> PanelSession:
        self._authenticate()
        self.layout = calculate_layout(self.api("/led/layout/full")["coordinates"])
        self.socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.set_mode("rt")
        self.set_brightness(self.brightness)
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        try:
            self.set_brightness(self.brightness)
            self.set_mode(self.restore_mode)
        except OSError:
            # Already failing; a restore attempt that also fails must not
            # mask the original error.
            pass
        finally:
            if self.socket is not None:
                self.socket.close()
                self.socket = None

    # -- frames -----------------------------------------------------

    def send(self, raster: bytes, spacing: float = 0.0) -> None:
        """Send one raster frame. spacing spreads its UDP fragments."""
        assert self.layout is not None and self.socket is not None
        width, height = self.layout.width, self.layout.height
        device = oriented_raster_to_device_frame(raster, width, height, self.layout, 0)
        packets = build_realtime_packets(self.auth, device)
        last = len(packets) - 1
        for position, packet in enumerate(packets):
            self.socket.sendto(packet, (self.ip, UDP_PORT))
            if spacing > 0 and position < last:
                time.sleep(spacing)

    def stream(
        self,
        render: Callable[[int, float], bytes],
        *,
        fps: float,
        seconds: float,
        spacing: float = 0.0,
    ) -> None:
        """Render and send at a fixed rate, correcting timer drift."""
        interval = 1.0 / fps
        deadline = time.monotonic()
        for index in range(int(fps * seconds)):
            self.send(render(index, index * interval), spacing=spacing)
            deadline += interval
            rest = deadline - time.monotonic()
            if rest > 0:
                time.sleep(rest)

    def hold(self, raster: bytes, seconds: float, fps: float = 30.0) -> None:
        self.stream(lambda _index, _time: raster, fps=fps, seconds=seconds)

    def lead_in(self, seconds: float, fps: float = 30.0) -> None:
        """Slow white pulse: time to walk to the wall before a study."""
        if seconds <= 0:
            return
        assert self.layout is not None
        pixels = self.layout.led_count
        print(f"lead-in {seconds:.0f}s — go look at the wall", flush=True)

        def pulse(index: int, _elapsed: float) -> bytes:
            level = int(120 * (0.5 + 0.5 * math.sin(index / fps * 2.2)))
            return bytes([level, level, level] * pixels)

        self.stream(pulse, fps=fps, seconds=seconds)


def solid(layout: Layout, level: int) -> bytes:
    return bytes([level, level, level] * layout.led_count)


def frames_from(sequence: Iterable[bytes]) -> Callable[[int, float], bytes]:
    """Turn a prepared frame list into a render callback that loops."""
    frames = list(sequence)
    return lambda index, _elapsed: frames[index % len(frames)]
