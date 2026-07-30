from __future__ import annotations

import base64
import json
import os
import socket
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

API_PREFIX = "/xled/v1"
UDP_PORT = 7777
FRAME_CHUNK_SIZE = 900
STREAM_INTERVAL_SECONDS = 0.04
REQUEST_TIMEOUT_SECONDS = 4
TOKEN_MAX_AGE_SECONDS = 3 * 60 * 60


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
        self.last_frame: bytes | None = None
        self.last_error: str | None = None
        self._lock = threading.RLock()
        self._stream_stop = threading.Event()
        self._stream_thread: threading.Thread | None = None
        self._socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    def _fetch_json(
        self,
        path: str,
        *,
        method: str = "GET",
        body: dict[str, Any] | None = None,
        token: str | None = None,
    ) -> dict[str, Any]:
        payload = None if body is None else json.dumps(body).encode("utf-8")
        headers = {"Content-Type": "application/json"}
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
            return {
                "connected": True,
                "ip": self.ip,
                "name": self.device["device_name"],
                "productCode": self.device["product_code"],
                "firmware": self.firmware,
                "ledCount": self.layout.led_count,
                "width": self.layout.width,
                "height": self.layout.height,
                "frameRate": self.device["frame_rate"],
                "mode": self.mode,
                "brightness": self.brightness,
                "streaming": self._stream_thread is not None
                and self._stream_thread.is_alive(),
                "lastError": self.last_error,
            }

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

    def set_raster_frame(
        self, pixels: bytes | bytearray | list[int], width: int, height: int
    ) -> dict[str, Any]:
        if self.layout is None:
            self.connect()
        assert self.layout is not None
        if int(width) != self.layout.width or int(height) != self.layout.height:
            raise ValueError(
                f"Frame must be {self.layout.width}x{self.layout.height} pixels."
            )
        frame = raster_to_device_frame(pixels, self.layout)
        with self._lock:
            self.last_frame = frame

        if self._stream_thread is None or not self._stream_thread.is_alive():
            self.request("/led/mode", method="POST", body={"mode": "rt"})
            self.request(
                "/led/out/brightness",
                method="POST",
                body={"mode": "enabled", "type": "A", "value": 100},
            )
            with self._lock:
                self.mode = "rt"
            self._stream_stop.clear()
            self._stream_thread = threading.Thread(
                target=self._stream_loop,
                name="twinkly-realtime",
                daemon=True,
            )
            self._stream_thread.start()
        return self.status()

    def _stream_loop(self) -> None:
        next_frame = time.monotonic()
        while not self._stream_stop.is_set():
            self._send_last_frame()
            next_frame += STREAM_INTERVAL_SECONDS
            delay = max(0.0, next_frame - time.monotonic())
            self._stream_stop.wait(delay)

    def _send_last_frame(self) -> None:
        try:
            token = self.authenticate()
            with self._lock:
                frame = self.last_frame
                brightness = self.brightness if self.brightness is not None else 100
            if frame is None:
                return
            output_frame = scale_frame_brightness(frame, brightness)
            for packet in build_realtime_packets(token, output_frame):
                self._socket.sendto(packet, (self.ip, UDP_PORT))
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
