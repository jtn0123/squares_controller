from __future__ import annotations

import base64
import binascii
from typing import Any

MAX_MOVIE_FRAMES = 600


def decode_movie_payload(
    body: dict[str, Any], *, max_frames: int = MAX_MOVIE_FRAMES
) -> dict[str, Any]:
    name = str(body.get("name", "")).strip()
    try:
        width = int(body["width"])
        height = int(body["height"])
        frame_count = int(body["frameCount"])
        fps = float(body["fps"])
    except (KeyError, TypeError, ValueError, OverflowError) as error:
        raise ValueError("Movie dimensions, frame count, and FPS are required.") from error

    if width < 1 or height < 1:
        raise ValueError("Movie dimensions must be positive.")
    if frame_count < 1 or frame_count > max_frames:
        raise ValueError(f"Movie must contain 1 to {max_frames} frames.")
    if fps <= 0:
        raise ValueError("Movie FPS must be positive.")

    encoded = body.get("pixelsBase64")
    if not isinstance(encoded, str):
        raise ValueError("Movie RGB data is missing.")
    try:
        pixels = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError("Movie RGB data is not valid base64.") from error

    expected_bytes = width * height * 3 * frame_count
    if len(pixels) != expected_bytes:
        raise ValueError(
            f"Expected {expected_bytes} movie RGB bytes; received {len(pixels)}."
        )
    return {
        "name": name,
        "width": width,
        "height": height,
        "frame_count": frame_count,
        "fps": fps,
        "pixels": pixels,
    }
