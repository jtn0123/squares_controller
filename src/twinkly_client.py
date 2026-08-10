"""Stateful HTTP + UDP client for a Twinkly controller.

Pure protocol math lives in `src.twinkly_protocol`; delivery counters live
in `src.stream_telemetry`. This module owns authentication, device state,
and the realtime stream thread.
"""

from __future__ import annotations

import base64
import json
import os
import socket
import threading
import time
import urllib.error
import urllib.request
from typing import Any

import src.twinkly_movies as twinkly_movies
from src.color_pipeline import DEFAULT_GAMMA, DEFAULT_SATURATION
from src.stream_telemetry import StreamTelemetry
from src.twinkly_protocol import (
    API_PREFIX,
    REQUEST_TIMEOUT_SECONDS,
    TOKEN_MAX_AGE_SECONDS,
    UDP_PORT,
    Layout,
    TwinklyHTTPError,
    build_realtime_packets,
    calculate_layout,
    choose_stream_fps,
    fused_channel_permutation,
    oriented_dimensions,
    scale_frame_brightness,
    stream_interval_seconds,
    validate_rotation,
)

# With no fresh frame to forward, the relay re-sends the last one at this
# pace purely to keep the panel from timing out of realtime mode. Identical
# repeats are visual no-ops, so the rate only needs to beat the timeout.
STREAM_KEEPALIVE_SECONDS = 0.5


class TwinklyClient:
    def __init__(self, ip: str) -> None:
        self.ip = ip
        self.base_url = f"http://{ip}{API_PREFIX}"
        self.token: str | None = None
        self.token_created_at = 0.0
        self.layout: Layout | None = None
        self.device: dict[str, Any] | None = None
        self.firmware: str | None = None
        self.mode: str | None = None
        self.current_movie: dict[str, Any] | None = None
        self.brightness: int | None = None
        self.rotation = 0
        self.last_frame: bytes | None = None
        self.last_error: str | None = None
        self._lock = threading.RLock()
        # Serializes every start/stop transition of the realtime stream:
        # set_raster_frame's check-and-start, stop_stream, and the mode
        # changes that must not interleave with either. RLock because the
        # guarded operations call stop_stream themselves.
        self._stream_start_lock = threading.RLock()
        self._stream_stop = threading.Event()
        # Set whenever a fresh frame lands; the relay forwards it at once
        # instead of waiting for a clock tick of its own.
        self._frame_ready = threading.Event()
        self._stream_thread: threading.Thread | None = None
        self._socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._frame_version = 0
        self._telemetry = StreamTelemetry()
        # Hot-path caches: the channel permutation is pure in
        # (layout, rotation); the scaled frame repeats unchanged while the
        # relay holds a static look.
        self._channel_perm: tuple[int, ...] | None = None
        self._channel_perm_key: tuple[Layout, int] | None = None
        self._scaled_frame_cache: tuple[bytes, int, bytes] | None = None

    def _fetch_json(
        self,
        path: str,
        *,
        method: str = "GET",
        body: dict[str, Any] | None = None,
        raw_body: bytes | None = None,
        content_type: str = "application/json",
        token: str | None = None,
    ) -> dict[str, Any]:
        if body is not None and raw_body is not None:
            raise ValueError("A request cannot contain JSON and binary bodies.")
        payload = (
            raw_body
            if raw_body is not None
            else None if body is None else json.dumps(body).encode("utf-8")
        )
        headers = {"Content-Type": content_type}
        if token:
            headers["X-Auth-Token"] = token
        request = urllib.request.Request(
            self.base_url + path,
            data=payload,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(
                request, timeout=REQUEST_TIMEOUT_SECONDS
            ) as response:
                result: dict[str, Any] = json.load(response)
        except urllib.error.HTTPError as error:
            if error.code == 401:
                raise PermissionError("Twinkly token expired.") from error
            raise TwinklyHTTPError(path, error.code) from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise ConnectionError(
                f"Cannot reach Twinkly at {self.ip}: {error.reason if hasattr(error, 'reason') else error}"
            ) from error

        code = result.get("code")
        if isinstance(code, int) and code >= 1100:
            raise ConnectionError(f"Twinkly {path} failed with code {code}.")
        return result

    def authenticate(self, force: bool = False) -> str:
        with self._lock:
            cached = self.token
            if (
                cached is not None
                and not force
                and time.monotonic() - self.token_created_at < TOKEN_MAX_AGE_SECONDS
            ):
                return cached

            challenge = base64.b64encode(os.urandom(32)).decode("ascii")
            login = self._fetch_json(
                "/login", method="POST", body={"challenge": challenge}
            )
            token = login.get("authentication_token")
            if not isinstance(token, str):
                raise ConnectionError("Twinkly login did not return a token.")
            self._fetch_json(
                "/verify",
                method="POST",
                body={"challenge-response": login.get("challenge-response")},
                token=token,
            )
            self.token = token
            self.token_created_at = time.monotonic()
            return token

    def request(
        self,
        path: str,
        *,
        method: str = "GET",
        body: dict[str, Any] | None = None,
        retry: bool = True,
    ) -> dict[str, Any]:
        token = self.authenticate()
        try:
            return self._fetch_json(path, method=method, body=body, token=token)
        except PermissionError:
            if not retry:
                raise
            token = self.authenticate(force=True)
            return self._fetch_json(path, method=method, body=body, token=token)

    def _request_bytes(self, path: str, payload: bytes) -> dict[str, Any]:
        token = self.authenticate()
        try:
            return self._fetch_json(
                path,
                method="POST",
                raw_body=payload,
                content_type="application/octet-stream",
                token=token,
            )
        except PermissionError:
            token = self.authenticate(force=True)
            return self._fetch_json(
                path,
                method="POST",
                raw_body=payload,
                content_type="application/octet-stream",
                token=token,
            )

    def connect(self) -> dict[str, Any]:
        device = self.request("/gestalt")
        firmware = self.request("/fw/version")
        raw_layout = self.request("/led/layout/full")
        mode = self.request("/led/mode")
        brightness = self.request("/led/out/brightness")
        mode_name = str(mode["mode"])
        current_movie = (
            self._read_current_movie() if mode_name == "movie" else None
        )

        layout = calculate_layout(raw_layout["coordinates"])
        if int(device["number_of_led"]) != layout.led_count:
            raise ValueError(
                f"Device reports {device['number_of_led']} LEDs but "
                f"layout contains {layout.led_count}."
            )

        with self._lock:
            self.device = device
            self.firmware = str(firmware["version"])
            self.layout = layout
            self.mode = mode_name
            self.current_movie = current_movie
            self.brightness = int(brightness["value"])
        return self.status()

    def status(self) -> dict[str, Any]:
        with self._lock:
            if self.device is None or self.layout is None:
                raise ConnectionError("The Twinkly controller has not been connected.")
            width, height = oriented_dimensions(self.layout, self.rotation)
            is_streaming = (
                self._stream_thread is not None
                and self._stream_thread.is_alive()
            )
            return {
                "connected": True,
                "ip": self.ip,
                "name": self.device["device_name"],
                "productCode": self.device["product_code"],
                "firmware": self.firmware,
                "ledCount": self.layout.led_count,
                "width": width,
                "height": height,
                "rotation": self.rotation,
                "frameRate": self.device["frame_rate"],
                "measuredFrameRate": self.device.get(
                    "measured_frame_rate", self.device["frame_rate"]
                ),
                "streamTargetFps": choose_stream_fps(self.device),
                "mode": self.mode,
                "currentMovie": (
                    dict(self.current_movie)
                    if self.current_movie is not None
                    else None
                ),
                "brightness": self.brightness,
                "brightnessControl": "realtime-rgb" if is_streaming else "device",
                "streaming": is_streaming,
                "streamTelemetry": self.stream_telemetry(),
                "lastError": self.last_error,
            }

    def stream_telemetry(self) -> dict[str, Any]:
        return self._telemetry.snapshot(choose_stream_fps(self.device))

    def _reset_stream_telemetry(self) -> None:
        self._telemetry.reset()

    def _record_stream_delivery(
        self, sent_at: float, deadline: float, frame_version: int
    ) -> None:
        self._telemetry.record_delivery(
            sent_at,
            deadline,
            frame_version,
            stream_interval_seconds(self.device),
        )

    def refresh_status(self) -> dict[str, Any]:
        if self.device is None:
            return self.connect()
        mode = self.request("/led/mode")
        brightness = self.request("/led/out/brightness")
        mode_name = str(mode["mode"])
        current_movie = (
            self._read_current_movie() if mode_name == "movie" else None
        )
        with self._lock:
            self.mode = mode_name
            self.current_movie = current_movie
            is_streaming = (
                self._stream_thread is not None
                and self._stream_thread.is_alive()
            )
            if not is_streaming:
                self.brightness = int(brightness["value"])
        return self.status()

    def set_brightness(self, value: int | float) -> dict[str, Any]:
        brightness = max(1, min(100, round(float(value))))
        with self._lock:
            self.brightness = brightness
            is_streaming = (
                self._stream_thread is not None
                and self._stream_thread.is_alive()
            )
        if not is_streaming:
            self.request(
                "/led/out/brightness",
                method="POST",
                body={"mode": "enabled", "type": "A", "value": brightness},
            )
        return self.status()

    def set_rotation(self, value: int | float | str) -> dict[str, Any]:
        rotation = validate_rotation(value)
        with self._stream_start_lock:
            self.stop_stream()
            with self._lock:
                self.rotation = rotation
        return self.status()

    def set_mode(self, mode: str) -> dict[str, Any]:
        if mode not in {"movie", "off", "demo"}:
            raise ValueError("Unsupported panel mode.")
        # Hold the stream transition lock for the whole switch: a frame
        # arriving mid-transition would otherwise restart the realtime
        # stream after stop_stream and leave mode/stream state contradicting
        # each other (stream running while mode reads "movie").
        with self._stream_start_lock:
            self.stop_stream()
            if self.brightness is not None:
                self.request(
                    "/led/out/brightness",
                    method="POST",
                    body={
                        "mode": "enabled",
                        "type": "A",
                        "value": self.brightness,
                    },
                )
            self.request("/led/mode", method="POST", body={"mode": mode})
            current_movie = self._read_current_movie() if mode == "movie" else None
            with self._lock:
                self.mode = mode
                self.current_movie = current_movie
        return self.status()

    def select_movie(self, movie_id: int) -> dict[str, Any]:
        return twinkly_movies.play_stored_movie(self, movie_id)

    def _read_current_movie(self) -> dict[str, Any] | None:
        return twinkly_movies.read_current_movie(self)

    def list_movies(self) -> dict[str, Any]:
        return twinkly_movies.list_movies(self)

    def adopt_movie_state(self, movie: dict[str, Any] | None) -> None:
        """Record that the controller is now playing a stored movie.

        Accepts None: firmware without a current-movie endpoint still
        switches to movie mode, it just cannot name what is playing.
        """
        with self._lock:
            self.mode = "movie"
            self.current_movie = movie

    def bake_movie(
        self,
        name: str,
        pixels: bytes | bytearray | list[int],
        *,
        width: int,
        height: int,
        frame_count: int,
        fps: int | float,
        gamma: float = DEFAULT_GAMMA,
        saturation: float = DEFAULT_SATURATION,
        black_floor: int = 0,
    ) -> dict[str, Any]:
        return twinkly_movies.bake_movie(
            self,
            name,
            pixels,
            width=width,
            height=height,
            frame_count=frame_count,
            fps=fps,
            gamma=gamma,
            saturation=saturation,
            black_floor=black_floor,
        )

    def _oriented_device_frame(
        self, pixels: bytes | bytearray | list[int], width: int, height: int
    ) -> bytes:
        assert self.layout is not None
        layout = self.layout
        with self._lock:
            rotation = self.rotation
            # Key on the layout object itself (frozen dataclass equality),
            # not id(): a freed layout's address can be reused by a new one
            # with a different LED ordering.
            cache_key = (layout, rotation)
            perm = (
                self._channel_perm
                if self._channel_perm_key == cache_key
                else None
            )
        if perm is None:
            perm = fused_channel_permutation(layout, rotation)
            with self._lock:
                self._channel_perm = perm
                self._channel_perm_key = cache_key

        expected_width, expected_height = oriented_dimensions(layout, rotation)
        if int(width) != expected_width or int(height) != expected_height:
            raise ValueError(
                f"Frame must be {expected_width}x{expected_height} pixels "
                f"at {rotation} degrees."
            )
        source = bytes(pixels)
        expected_channels = layout.led_count * 3
        if len(source) != expected_channels:
            raise ValueError(
                f"Expected {expected_channels} RGB values; "
                f"received {len(source)}."
            )
        return bytes(map(source.__getitem__, perm))

    def set_raster_frame(
        self, pixels: bytes | bytearray | list[int], width: int, height: int
    ) -> dict[str, Any]:
        if self.layout is None:
            self.connect()
        assert self.layout is not None
        frame = self._oriented_device_frame(pixels, width, height)
        with self._lock:
            self.last_frame = frame
            self._frame_version += 1
        self._frame_ready.set()

        # The check-and-start below must be atomic: two concurrent frame
        # requests could otherwise both observe a dead thread and start two
        # relay loops streaming at double rate.
        with self._stream_start_lock:
            if self._stream_thread is None or not self._stream_thread.is_alive():
                self.request("/led/mode", method="POST", body={"mode": "rt"})
                self.request(
                    "/led/out/brightness",
                    method="POST",
                    body={"mode": "enabled", "type": "A", "value": 100},
                )
                with self._lock:
                    self.mode = "rt"
                self._reset_stream_telemetry()
                # Each relay thread gets its own stop event. Reusing (and
                # clearing) a shared event could revive an old thread whose
                # join timed out while it was blocked on a slow device call.
                stop_event = threading.Event()
                self._stream_stop = stop_event
                self._stream_thread = threading.Thread(
                    target=self._stream_loop,
                    args=(stop_event,),
                    name="twinkly-realtime",
                    daemon=True,
                )
                self._stream_thread.start()
        return self.status()

    def _stream_loop(self, stop_event: threading.Event) -> None:
        """Forward each fresh frame the moment it arrives.

        A clocked relay and a clocked producer can never share a phase, so
        their beat repeats or delays a frame every few hundred ms — visible
        judder. Event-driven forwarding makes the wall follow the producer's
        cadence exactly; the panel's own rate cap is the only pacing left,
        and idle keepalives (visual no-ops) hold realtime mode open.
        """
        interval = stream_interval_seconds(self.device)
        next_allowed = 0.0
        while not stop_event.is_set():
            fresh = self._frame_ready.wait(timeout=STREAM_KEEPALIVE_SECONDS)
            if stop_event.is_set():
                return
            if fresh:
                # Never exceed the panel's rate: coalesce a too-early
                # frame into the next allowed slot (newest content wins).
                delay = next_allowed - time.monotonic()
                if delay > 0 and stop_event.wait(delay):
                    return
            self._frame_ready.clear()
            self._send_last_frame()
            next_allowed = time.monotonic() + interval

    def _send_last_frame(self, deadline: float | None = None) -> None:
        try:
            token = self.authenticate()
            with self._lock:
                frame = self.last_frame
                brightness = self.brightness if self.brightness is not None else 100
                frame_version = self._frame_version
            if frame is None:
                return
            cache = self._scaled_frame_cache
            if cache is not None and cache[0] is frame and cache[1] == brightness:
                output_frame = cache[2]
            else:
                output_frame = scale_frame_brightness(frame, brightness)
                self._scaled_frame_cache = (frame, brightness, output_frame)
            for packet in build_realtime_packets(token, output_frame):
                self._socket.sendto(packet, (self.ip, UDP_PORT))
            sent_at = time.monotonic()
            self._record_stream_delivery(
                sent_at,
                deadline if deadline is not None else sent_at,
                frame_version,
            )
            with self._lock:
                self.last_error = None
        except (ConnectionError, OSError, ValueError) as error:
            with self._lock:
                self.last_error = str(error)

    def stop_stream(self) -> None:
        with self._stream_start_lock:
            thread = self._stream_thread
            self._stream_stop.set()
            # Wake the loop out of its keepalive wait so join returns fast.
            self._frame_ready.set()
            if thread and thread is not threading.current_thread():
                thread.join(timeout=0.5)
            with self._lock:
                self._stream_thread = None
                self.last_frame = None

    def close(self, restore_movie: bool = True) -> None:
        self.stop_stream()
        if restore_movie and self.token:
            try:
                self.request("/led/mode", method="POST", body={"mode": "movie"})
            except ConnectionError:
                pass
        self._socket.close()
