"""Pure Twinkly XLED protocol helpers.

Everything in this module is a side-effect-free function over plain data:
layout math, frame reordering, rotation, brightness scaling, and realtime
UDP packet construction. The stateful HTTP/UDP client lives in
`src.twinkly_client`.

Protocol notes (XLED v1):
- Authentication is challenge/response over HTTP: POST /login with a random
  base64 challenge, then POST /verify with the returned challenge-response,
  keeping the `authentication_token` as the X-Auth-Token header.
- Realtime frames are sent over UDP port 7777. Each datagram is a version-3
  header followed by up to `FRAME_CHUNK_SIZE` bytes of RGB payload:
  byte 0        0x03 (protocol version 3)
  bytes 1-8     the 8-byte decoded authentication token
  bytes 9-10    0x00 0x00 (reserved)
  byte 11       fragment index (0-based)
  bytes 12+     RGB channel data for this fragment
"""

from __future__ import annotations

import functools
from dataclasses import dataclass
from typing import Any
import base64

API_PREFIX = "/xled/v1"
UDP_PORT = 7777
FRAME_CHUNK_SIZE = 900
MAX_STABLE_STREAM_FPS = 37.5
REQUEST_TIMEOUT_SECONDS = 4
TOKEN_MAX_AGE_SECONDS = 3 * 60 * 60
SUPPORTED_ROTATIONS = (0, 90, 180, 270)


class TwinklyHTTPError(ConnectionError):
    """An HTTP-level failure from the controller, carrying its status code.

    Subclasses ConnectionError so existing handlers keep working; callers
    that need to branch on a specific status (for example the firmware
    variants that serve /movies/current instead of /led/movies/current)
    should check `status_code` rather than parsing the message.
    """

    def __init__(self, path: str, status_code: int) -> None:
        super().__init__(f"Twinkly {path} failed with HTTP {status_code}.")
        self.path = path
        self.status_code = status_code


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
    """Derive a rectangular grid from the controller's stored coordinates.

    The controller reports physical LED positions; distinct rounded x and y
    values give the grid dimensions. Device rows count upward from the wall's
    bottom, while raster rows count downward from the top, so the y axis is
    flipped (`row = height - 1 - device_row`) to produce screen-order rasters.
    """
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


def fused_channel_permutation(
    layout: Layout, rotation: int | float | str
) -> tuple[int, ...]:
    """Channel index map for the full oriented-raster-to-device transform.

    `output[k] = source[perm[k]]` reproduces
    `oriented_raster_to_device_frame` exactly, but the mapping depends only
    on (layout, rotation), so the relay computes it once per rotation change
    instead of running two Python loops on every frame.
    """
    normalized = validate_rotation(rotation)
    expected_width, expected_height = oriented_dimensions(layout, normalized)

    # native raster index -> oriented source index
    native_from_source = [0] * layout.led_count
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
            native_from_source[native_y * layout.width + native_x] = (
                display_y * expected_width + display_x
            )

    perm: list[int] = []
    for raster_index in layout.device_to_raster:
        source_offset = native_from_source[raster_index] * 3
        perm.extend((source_offset, source_offset + 1, source_offset + 2))
    return tuple(perm)


@functools.lru_cache(maxsize=8)
def _brightness_table(percent: int) -> bytes:
    return bytes((channel * percent + 50) // 100 for channel in range(256))


def scale_frame_brightness(frame: bytes, brightness: int | float) -> bytes:
    """Apply the controller's logical brightness to a realtime RGB frame."""
    percent = max(0, min(100, round(float(brightness))))
    if percent == 100:
        return frame
    if percent == 0:
        return bytes(len(frame))
    # bytes.translate runs in C; the 256-entry table is cached per percent.
    return frame.translate(_brightness_table(percent))


@functools.lru_cache(maxsize=4)
def _decoded_token(token: str) -> bytes:
    token_bytes = base64.b64decode(token)
    if len(token_bytes) != 8:
        raise ValueError("The controller supplied an invalid realtime token.")
    return token_bytes


def build_realtime_packets(token: str, device_frame: bytes) -> list[bytes]:
    """Split a device-ordered RGB frame into version-3 realtime datagrams.

    See the module docstring for the byte layout. The decoded token must be
    exactly 8 bytes; the controller rejects other lengths. Tokens rotate at
    most every few hours, so the decode is cached.
    """
    token_bytes = _decoded_token(token)
    packets: list[bytes] = []
    for fragment, offset in enumerate(
        range(0, len(device_frame), FRAME_CHUNK_SIZE)
    ):
        header = b"\x03" + token_bytes + b"\x00\x00" + bytes([fragment])
        packets.append(header + device_frame[offset : offset + FRAME_CHUNK_SIZE])
    return packets
