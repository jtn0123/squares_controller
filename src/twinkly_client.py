from __future__ import annotations

import base64
import json
import os
import socket
import threading
import time
import urllib.error
import urllib.request
import uuid
from collections import deque
from dataclasses import dataclass
from typing import Any

API_PREFIX = "/xled/v1"
UDP_PORT = 7777
FRAME_CHUNK_SIZE = 900
MAX_STABLE_STREAM_FPS = 37.5
REQUEST_TIMEOUT_SECONDS = 4
TOKEN_MAX_AGE_SECONDS = 3 * 60 * 60
SUPPORTED_ROTATIONS = (0, 90, 180, 270)


def choose_stream_fps(device: dict[str, Any] | None) -> float:
    if not device:
        return MAX_STABLE_STREAM_FPS
    raw_rate = device.get("measured_frame_rate", device.get("frame_rate"))
    try:
        device_rate = float(raw_rate)
    except (TypeError, ValueError):
        return MAX_STABLE_STREAM_FPS
    if device_rate <= 0:
        return MAX_STABLE_STREAM_FPS
    return min(device_rate, MAX_STABLE_STREAM_FPS)


def stream_interval_seconds(device: dict[str, Any] | None) -> float:
    return 1.0 / choose_stream_fps(device)


def next_stream_deadline(previous: float, now: float, interval: float) -> float:
    target = previous + interval
    return now + interval if target <= now else target


@dataclass(frozen=True)
class Layout:
    width: int
    height: int
    led_count: int
    device_to_raster: tuple[int, ...]


def calculate_layout(coordinates: list[dict[str, float]]) -> Layout:
    if not coordinates:
        raise ValueError("The controller returned an empty LED layout.")

    width = len({round(float(point["x"]), 5) for point in coordinates})
    height = len({round(float(point["y"]), 5) for point in coordinates})
    xs = [float(point["x"]) for point in coordinates]
    ys = [float(point["y"]) for point in coordinates]
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)

    if width * height != len(coordinates) or x_min == x_max or y_min == y_max:
        raise ValueError(
            f"Unsupported panel geometry: {width}x{height} "
            f"for {len(coordinates)} LEDs."
        )

    device_to_raster: list[int] = []
    for point in coordinates:
        column = round(
            ((float(point["x"]) - x_min) / (x_max - x_min)) * (width - 1)
        )
        device_row = round(
            ((float(point["y"]) - y_min) / (y_max - y_min)) * (height - 1)
        )
        column = max(0, min(width - 1, column))
        device_row = max(0, min(height - 1, device_row))
        row = height - 1 - device_row
        device_to_raster.append(row * width + column)

    if len(set(device_to_raster)) != len(coordinates):
        raise ValueError("The stored LED layout contains overlapping coordinates.")

    return Layout(width, height, len(coordinates), tuple(device_to_raster))


def raster_to_device_frame(pixels: bytes | bytearray | list[int], layout: Layout) -> bytes:
    source = bytes(pixels)
    expected = layout.led_count * 3
    if len(source) != expected:
        raise ValueError(f"Expected {expected} RGB values; received {len(source)}.")

    output = bytearray(expected)
    for device_index, raster_index in enumerate(layout.device_to_raster):
        output[device_index * 3 : device_index * 3 + 3] = source[
            raster_index * 3 : raster_index * 3 + 3
        ]
    return bytes(output)


def validate_rotation(value: int | float | str) -> int:
    try:
        rotation = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError("Rotation must be 0, 90, 180, or 270 degrees.") from error
    if rotation not in SUPPORTED_ROTATIONS:
        raise ValueError("Rotation must be 0, 90, 180, or 270 degrees.")
    return rotation


def oriented_dimensions(layout: Layout, rotation: int | float | str) -> tuple[int, int]:
    normalized = validate_rotation(rotation)
    if normalized in {90, 270}:
        return layout.height, layout.width
    return layout.width, layout.height


def oriented_raster_to_device_frame(
    pixels: bytes | bytearray | list[int],
    width: int,
    height: int,
    layout: Layout,
    rotation: int | float | str,
) -> bytes:
    normalized = validate_rotation(rotation)
    expected_width, expected_height = oriented_dimensions(layout, normalized)
    if int(width) != expected_width or int(height) != expected_height:
        raise ValueError(
            f"Frame must be {expected_width}x{expected_height} pixels "
            f"at {normalized} degrees."
        )

    source = bytes(pixels)
    expected_channels = layout.led_count * 3
    if len(source) != expected_channels:
        raise ValueError(
            f"Expected {expected_channels} RGB values; received {len(source)}."
        )

    native = bytearray(expected_channels)
    for display_y in range(expected_height):
        for display_x in range(expected_width):
            if normalized == 0:
                native_x, native_y = display_x, display_y
            elif normalized == 90:
                native_x = display_y
                native_y = layout.height - 1 - display_x
            elif normalized == 180:
                native_x = layout.width - 1 - display_x
                native_y = layout.height - 1 - display_y
            else:
                native_x = layout.width - 1 - display_y
                native_y = display_x

            source_offset = (display_y * expected_width + display_x) * 3
            native_offset = (native_y * layout.width + native_x) * 3
            native[native_offset : native_offset + 3] = source[
                source_offset : source_offset + 3
            ]

    return raster_to_device_frame(native, layout)


def oriented_raster_movie_to_device(
    pixels: bytes | bytearray | list[int],
    *,
    frame_count: int,
    width: int,
    height: int,
    layout: Layout,
    rotation: int | float | str,
) -> bytes:
    source = bytes(pixels)
    frame_size = layout.led_count * 3
    if frame_count < 1 or len(source) != frame_count * frame_size:
        raise ValueError(
            f"Expected {frame_count * frame_size} movie RGB values; "
            f"received {len(source)}."
        )
    output = bytearray(len(source))
    for frame_index in range(frame_count):
        offset = frame_index * frame_size
        output[offset : offset + frame_size] = oriented_raster_to_device_frame(
            source[offset : offset + frame_size],
            width,
            height,
            layout,
            rotation,
        )
    return bytes(output)


def scale_frame_brightness(frame: bytes, brightness: int | float) -> bytes:
    """Apply the controller's logical brightness to a realtime RGB frame."""
    percent = max(0, min(100, round(float(brightness))))
    if percent == 100:
        return frame
    if percent == 0:
        return bytes(len(frame))
    return bytes((channel * percent + 50) // 100 for channel in frame)


def build_realtime_packets(token: str, device_frame: bytes) -> list[bytes]:
    token_bytes = base64.b64decode(token)
    if len(token_bytes) != 8:
        raise ValueError("The controller supplied an invalid realtime token.")

    packets: list[bytes] = []
    for fragment, offset in enumerate(
        range(0, len(device_frame), FRAME_CHUNK_SIZE)
    ):
        header = b"\x03" + token_bytes + b"\x00\x00" + bytes([fragment])
        packets.append(header + device_frame[offset : offset + FRAME_CHUNK_SIZE])
    return packets


class TwinklyClient:
    def __init__(self, ip: str):
        self.ip = ip
        self.base_url = f"http://{ip}{API_PREFIX}"
        self.token: str | None = None
        self.token_created_at = 0.0
        self.layout: Layout | None = None
        self.device: dict[str, Any] | None = None
        self.firmware: str | None = None
        self.mode: str | None = None
        self.brightness: int | None = None
        self.rotation = 0
        self.last_frame: bytes | None = None
        self.last_error: str | None = None
        self._lock = threading.RLock()
        self._stream_stop = threading.Event()
        self._stream_thread: threading.Thread | None = None
        self._socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._frame_version = 0
        self._last_sent_version: int | None = None
        self._stream_started_at: float | None = None
        self._last_send_at: float | None = None
        self._sent_frames = 0
        self._unique_frames = 0
        self._repeated_frames = 0
        self._late_frames = 0
        self._missed_deadlines = 0
        self._stream_gaps_ms: deque[float] = deque(maxlen=240)
        self._stream_lateness_ms: deque[float] = deque(maxlen=240)

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
                result = json.load(response)
        except urllib.error.HTTPError as error:
            if error.code == 401:
                raise PermissionError("Twinkly token expired.") from error
            raise ConnectionError(
                f"Twinkly {path} failed with HTTP {error.code}."
            ) from error
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
            is_fresh = (
                self.token is not None
                and time.monotonic() - self.token_created_at < TOKEN_MAX_AGE_SECONDS
            )
            if is_fresh and not force:
                return self.token

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
            self.mode = str(mode["mode"])
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
                "brightness": self.brightness,
                "brightnessControl": "realtime-rgb" if is_streaming else "device",
                "streaming": is_streaming,
                "streamTelemetry": self.stream_telemetry(),
                "lastError": self.last_error,
            }

    @staticmethod
    def _percentile(values: deque[float], fraction: float) -> float:
        if not values:
            return 0.0
        ordered = sorted(values)
        index = min(len(ordered) - 1, round((len(ordered) - 1) * fraction))
        return ordered[index]

    def stream_telemetry(self) -> dict[str, Any]:
        with self._lock:
            elapsed = (
                (self._last_send_at - self._stream_started_at)
                if self._last_send_at is not None
                and self._stream_started_at is not None
                else 0.0
            )
            actual_fps = (
                (self._sent_frames - 1) / elapsed
                if self._sent_frames > 1 and elapsed > 0
                else 0.0
            )
            return {
                "targetFps": choose_stream_fps(self.device),
                "actualFps": round(actual_fps, 2),
                "sentFrames": self._sent_frames,
                "uniqueFrames": self._unique_frames,
                "repeatedFrames": self._repeated_frames,
                "lateFrames": self._late_frames,
                "missedDeadlines": self._missed_deadlines,
                "p95GapMs": round(
                    self._percentile(self._stream_gaps_ms, 0.95), 3
                ),
                "maxGapMs": round(max(self._stream_gaps_ms, default=0.0), 3),
                "p95LatenessMs": round(
                    self._percentile(self._stream_lateness_ms, 0.95), 3
                ),
            }

    def _reset_stream_telemetry(self) -> None:
        with self._lock:
            self._last_sent_version = None
            self._stream_started_at = None
            self._last_send_at = None
            self._sent_frames = 0
            self._unique_frames = 0
            self._repeated_frames = 0
            self._late_frames = 0
            self._missed_deadlines = 0
            self._stream_gaps_ms.clear()
            self._stream_lateness_ms.clear()

    def _record_stream_delivery(
        self, sent_at: float, deadline: float, frame_version: int
    ) -> None:
        interval = stream_interval_seconds(self.device)
        with self._lock:
            if self._stream_started_at is None:
                self._stream_started_at = sent_at
            if self._last_send_at is not None:
                self._stream_gaps_ms.append(
                    (sent_at - self._last_send_at) * 1000
                )
            lateness = max(0.0, sent_at - deadline)
            self._stream_lateness_ms.append(lateness * 1000)
            self._sent_frames += 1
            if frame_version == self._last_sent_version:
                self._repeated_frames += 1
            else:
                self._unique_frames += 1
            if lateness > 0.0015:
                self._late_frames += 1
            if lateness > interval:
                self._missed_deadlines += int(lateness // interval)
            self._last_sent_version = frame_version
            self._last_send_at = sent_at

    def refresh_status(self) -> dict[str, Any]:
        if self.device is None:
            return self.connect()
        mode = self.request("/led/mode")
        brightness = self.request("/led/out/brightness")
        with self._lock:
            self.mode = str(mode["mode"])
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
        self.stop_stream()
        with self._lock:
            self.rotation = rotation
        return self.status()

    def set_mode(self, mode: str) -> dict[str, Any]:
        if mode not in {"movie", "off", "demo"}:
            raise ValueError("Unsupported panel mode.")
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
        with self._lock:
            self.mode = mode
        return self.status()

    def list_movies(self) -> dict[str, Any]:
        result = self.request("/movies")
        if not isinstance(result.get("movies"), list):
            raise ConnectionError("Twinkly returned an invalid movie list.")
        return result

    def bake_movie(
        self,
        name: str,
        pixels: bytes | bytearray | list[int],
        *,
        width: int,
        height: int,
        frame_count: int,
        fps: int | float,
    ) -> dict[str, Any]:
        if self.layout is None or self.device is None:
            self.connect()
        assert self.layout is not None
        assert self.device is not None

        movie_name = str(name).strip().upper()
        if not movie_name or len(movie_name) > 32:
            raise ValueError("Movie name must contain 1 to 32 characters.")
        requested_fps = round(float(fps))
        measured_fps = float(
            self.device.get("measured_frame_rate", self.device["frame_rate"])
        )
        movie_fps = min(requested_fps, max(1, int(measured_fps)))
        if requested_fps < 1:
            raise ValueError("Movie FPS must be positive.")

        movie_data = oriented_raster_movie_to_device(
            pixels,
            frame_count=frame_count,
            width=width,
            height=height,
            layout=self.layout,
            rotation=self.rotation,
        )
        before = self.list_movies()
        available_frames = int(before.get("available_frames", 0))
        if frame_count > available_frames:
            raise ValueError(
                f"Movie needs {frame_count} frames but the controller has "
                f"{available_frames} available movie frames."
            )
        if any(
            str(movie.get("name", "")).strip().upper() == movie_name
            for movie in before["movies"]
        ):
            raise ValueError(
                "A controller movie already uses that name. Choose a new name."
            )

        unique_id = str(uuid.uuid4())
        self.request(
            "/movies/new",
            method="POST",
            body={
                "name": movie_name,
                "unique_id": unique_id,
                "descriptor_type": "rgb_raw",
                "leds_per_frame": self.layout.led_count,
                "frames_number": frame_count,
                "fps": movie_fps,
            },
        )
        self._request_bytes("/movies/full", movie_data)
        after = self.list_movies()
        created = next(
            (
                movie
                for movie in after["movies"]
                if movie.get("unique_id") == unique_id
            ),
            None,
        )
        if created is None or not isinstance(created.get("id"), int):
            raise ConnectionError(
                "Movie uploaded but the controller did not return its identity."
            )

        self.stop_stream()
        self.request(
            "/led/out/brightness",
            method="POST",
            body={
                "mode": "enabled",
                "type": "A",
                "value": self.brightness if self.brightness is not None else 100,
            },
        )
        try:
            self.request(
                "/led/movies/current",
                method="POST",
                body={"id": created["id"]},
            )
        except ConnectionError as error:
            if "HTTP 404" not in str(error):
                raise
            self.request(
                "/movies/current",
                method="POST",
                body={"id": created["id"]},
            )
        self.request("/led/mode", method="POST", body={"mode": "movie"})
        with self._lock:
            self.mode = "movie"
        return {
            "bakedMovie": created,
            "movieCount": len(after["movies"]),
            "availableFrames": int(after.get("available_frames", 0)),
            "status": self.status(),
        }

    def set_raster_frame(
        self, pixels: bytes | bytearray | list[int], width: int, height: int
    ) -> dict[str, Any]:
        if self.layout is None:
            self.connect()
        assert self.layout is not None
        frame = oriented_raster_to_device_frame(
            pixels,
            width,
            height,
            self.layout,
            self.rotation,
        )
        with self._lock:
            self.last_frame = frame
            self._frame_version += 1

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
            self._stream_stop.clear()
            self._stream_thread = threading.Thread(
                target=self._stream_loop,
                name="twinkly-realtime",
                daemon=True,
            )
            self._stream_thread.start()
        return self.status()

    def _stream_loop(self) -> None:
        deadline = time.monotonic()
        interval = stream_interval_seconds(self.device)
        while not self._stream_stop.is_set():
            self._send_last_frame(deadline)
            deadline = next_stream_deadline(
                deadline, time.monotonic(), interval
            )
            self._stream_stop.wait(max(0.0, deadline - time.monotonic()))

    def _send_last_frame(self, deadline: float | None = None) -> None:
        try:
            token = self.authenticate()
            with self._lock:
                frame = self.last_frame
                brightness = self.brightness if self.brightness is not None else 100
                frame_version = self._frame_version
            if frame is None:
                return
            output_frame = scale_frame_brightness(frame, brightness)
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
        thread = self._stream_thread
        self._stream_stop.set()
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
