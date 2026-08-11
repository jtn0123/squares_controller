#!/usr/bin/env python3
"""Shared session for the on-wall diagnostic tools.

Every tool needs the same things: reach the configured panel, learn its
layout, put it into realtime mode, push frames, and — whatever happens —
put it back into stored playback afterwards. Doing that per script meant
several copies of the same code and several chances to leave the wall
stuck in realtime after a traceback.

HTTP, authentication, and retry live in `src.twinkly_client`, which is
the tested implementation; this only adds the UDP streaming and timing
the studies need. `PanelSession` is a context manager, so restoration
and socket cleanup run on every exit path including KeyboardInterrupt.

    with PanelSession(brightness=10) as panel:
        panel.lead_in(15)
        panel.stream(render, fps=36, seconds=20)
"""
from __future__ import annotations

import math
import socket
import sys
import time
from collections.abc import Callable, Iterable
from pathlib import Path
from types import TracebackType

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import load_device_ip  # noqa: E402
from src.twinkly_client import TwinklyClient  # noqa: E402
from src.twinkly_protocol import (  # noqa: E402
    UDP_PORT,
    Layout,
    build_realtime_packets,
    oriented_raster_to_device_frame,
)


class PanelSession:
    """Realtime access to the wall that always cleans up after itself."""

    def __init__(
        self,
        ip: str | None = None,
        *,
        brightness: int = 10,
        restore_mode: str = "movie",
    ) -> None:
        # Default to whatever the app is configured against rather than
        # pinning one developer's panel into the tooling.
        self.client = TwinklyClient(ip or load_device_ip())
        self.brightness = brightness
        # Filled in by __enter__; None means "never learned it", and
        # exit then leaves brightness alone rather than guessing.
        self.previous_brightness: int | None = None
        self.restore_mode = restore_mode
        self.socket: socket.socket | None = None

    @property
    def layout(self) -> Layout:
        assert self.client.layout is not None
        return self.client.layout

    def api(self, path: str) -> dict:
        payload: dict = self.client.request(path)
        return payload

    def set_mode(self, mode: str) -> None:
        self.client.request("/led/mode", method="POST", body={"mode": mode})

    def set_brightness(self, value: int) -> None:
        self.client.request(
            "/led/out/brightness",
            method="POST",
            body={"mode": "enabled", "type": "A", "value": int(value)},
        )

    # -- lifecycle --------------------------------------------------

    def __enter__(self) -> PanelSession:
        self.client.connect()
        self.socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            # Remember the user's brightness so exit can put it back;
            # a diagnostic run must not permanently redim the wall.
            current = self.api("/led/out/brightness").get("value")
            if isinstance(current, int):
                self.previous_brightness = current
            self.set_mode("rt")
            self.set_brightness(self.brightness)
        except BaseException:
            # __exit__ never runs if __enter__ raises, so a failure here
            # would strand the panel in realtime with the socket open.
            self.__exit__(None, None, None)
            raise
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        # Each restore is guarded on its own: a failed brightness write
        # must not stop the mode restore, and neither may mask the
        # original error while unwinding. ConnectionError (and
        # TwinklyHTTPError under it) are OSError subclasses.
        try:
            if self.previous_brightness is not None:
                self.set_brightness(self.previous_brightness)
        except OSError:
            pass
        try:
            self.set_mode(self.restore_mode)
        except OSError:
            pass
        if self.socket is not None:
            self.socket.close()
            self.socket = None

    # -- frames -----------------------------------------------------

    def send(self, raster: bytes, spacing: float = 0.0) -> None:
        """Send one raster frame. spacing spreads its UDP fragments."""
        assert self.socket is not None
        layout = self.layout
        device = oriented_raster_to_device_frame(
            raster, layout.width, layout.height, layout, 0
        )
        packets = build_realtime_packets(self.client.authenticate(), device)
        last = len(packets) - 1
        for position, packet in enumerate(packets):
            self.socket.sendto(packet, (self.client.ip, UDP_PORT))
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
        if fps <= 0 or seconds <= 0:
            raise ValueError("Seconds and FPS must be positive.")
        interval = 1.0 / fps
        deadline = time.monotonic()
        for index in range(int(fps * seconds)):
            self.send(render(index, index * interval), spacing=spacing)
            deadline += interval
            rest = deadline - time.monotonic()
            if rest > 0:
                time.sleep(rest)

    def hold(self, raster: bytes, seconds: float, fps: float = 30.0) -> None:
        self.stream(lambda _index, _elapsed: raster, fps=fps, seconds=seconds)

    def lead_in(self, seconds: float, fps: float = 30.0) -> None:
        """Slow white pulse: time to walk to the wall before a study."""
        if seconds <= 0:
            return
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
