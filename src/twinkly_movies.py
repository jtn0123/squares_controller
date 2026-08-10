"""Controller movie storage: reading, listing, and baking movies.

These functions operate on a `TwinklyClient` instance; they live here to
keep the client focused on connection, status, and realtime streaming.
Firmware variants differ on the current-movie endpoint (`/led/movies/current`
vs `/movies/current`), so both paths branch on the typed 404.
"""

from __future__ import annotations

import uuid
from typing import Any

from src.color_pipeline import (
    DEFAULT_GAMMA,
    DEFAULT_SATURATION,
    correct_movie,
)
from src.twinkly_protocol import (
    TwinklyHTTPError,
    oriented_raster_movie_to_device,
)


def read_current_movie(client: Any) -> dict[str, Any] | None:
    try:
        result = client.request("/led/movies/current")
    except TwinklyHTTPError as error:
        if error.status_code != 404:
            raise
        try:
            result = client.request("/movies/current")
        except TwinklyHTTPError as fallback_error:
            if fallback_error.status_code == 404:
                return None
            raise
    movie_id = result.get("id")
    if not isinstance(movie_id, int):
        return None
    return {
        key: result[key]
        for key in ("id", "name", "unique_id")
        if key in result
    }


def list_movies(client: Any) -> dict[str, Any]:
    result: dict[str, Any] = client.request("/movies")
    if not isinstance(result.get("movies"), list):
        raise ConnectionError("Twinkly returned an invalid movie list.")
    return result


def select_current_movie(client: Any, movie_id: int) -> None:
    try:
        client.request(
            "/led/movies/current",
            method="POST",
            body={"id": movie_id},
        )
    except TwinklyHTTPError as error:
        if error.status_code != 404:
            raise
        client.request(
            "/movies/current",
            method="POST",
            body={"id": movie_id},
        )


def play_stored_movie(client: Any, movie_id: int) -> dict[str, Any]:
    """Play a movie already stored on the controller.

    Same transition discipline as set_mode: hold the stream lock for the
    whole switch so an in-flight frame cannot restart the relay part way
    through and leave mode and stream state disagreeing.
    """
    identifier = int(movie_id)
    with client._stream_start_lock:
        client.stop_stream()
        if client.brightness is not None:
            client.request(
                "/led/out/brightness",
                method="POST",
                body={
                    "mode": "enabled",
                    "type": "A",
                    "value": client.brightness,
                },
            )
        select_current_movie(client, identifier)
        client.request("/led/mode", method="POST", body={"mode": "movie"})
        client.adopt_movie_state(read_current_movie(client))
    status: dict[str, Any] = client.status()
    return status


def bake_movie(
    client: Any,
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
    if client.layout is None or client.device is None:
        client.connect()
    assert client.layout is not None
    assert client.device is not None

    movie_name = str(name).strip().upper()
    if not movie_name or len(movie_name) > 32:
        raise ValueError("Movie name must contain 1 to 32 characters.")
    requested_fps = round(float(fps))
    if requested_fps < 1:
        raise ValueError("Movie FPS must be positive.")
    measured_fps = float(
        client.device.get("measured_frame_rate", client.device["frame_rate"])
    )
    movie_fps = min(requested_fps, max(1, int(measured_fps)))

    # Correct once, here, rather than per displayed frame: a stored
    # movie plays straight off the panel, so this is the last chance to
    # map browser sRGB onto what the LED drivers actually do.
    corrected = correct_movie(
        bytes(pixels),
        gamma=gamma,
        saturation=saturation,
        black_floor=black_floor,
    )
    movie_data = oriented_raster_movie_to_device(
        corrected,
        frame_count=frame_count,
        width=width,
        height=height,
        layout=client.layout,
        rotation=client.rotation,
    )
    before = list_movies(client)
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
    client.request(
        "/movies/new",
        method="POST",
        body={
            "name": movie_name,
            "unique_id": unique_id,
            "descriptor_type": "rgb_raw",
            "leds_per_frame": client.layout.led_count,
            "frames_number": frame_count,
            "fps": movie_fps,
        },
    )
    client._request_bytes("/movies/full", movie_data)
    after = list_movies(client)
    # Firmware normalizes the UUID's case (uuid4() is lower case, the
    # controller echoes it upper case), so this match must be
    # case-insensitive or every successful bake looks like a failure.
    wanted = unique_id.casefold()
    created = next(
        (
            movie
            for movie in after["movies"]
            if str(movie.get("unique_id", "")).casefold() == wanted
        ),
        None,
    )
    if created is None or not isinstance(created.get("id"), int):
        raise ConnectionError(
            "Movie uploaded but the controller did not return its identity."
        )

    client.stop_stream()
    client.request(
        "/led/out/brightness",
        method="POST",
        body={
            "mode": "enabled",
            "type": "A",
            "value": client.brightness if client.brightness is not None else 100,
        },
    )
    select_current_movie(client, created["id"])
    client.request("/led/mode", method="POST", body={"mode": "movie"})
    client.adopt_movie_state(dict(created))
    return {
        "bakedMovie": created,
        "movieCount": len(after["movies"]),
        "availableFrames": int(after.get("available_frames", 0)),
        "status": client.status(),
    }
