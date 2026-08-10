#!/usr/bin/env python3
"""Compare the two delivery paths with identical content.

The panel's own movie playback is visibly smooth while realtime
streaming judders. Varying settings *inside* the streaming path cannot
answer whether the path itself is the limit, so this runs the same
animation three ways:

  BAKED   played from panel storage on the panel's own clock — no
          network involved. This is the smoothness ceiling.
  LIVE    realtime UDP exactly as the app streams today: each frame's
          fragments sent back to back.
  SPACED  realtime UDP with the fragments spread evenly across the frame
          interval, in case bursts are overrunning the receive path.

    python3 scripts/path_study.py [brightness] [seconds] [cycles]

Verdict on this wall: BAKED is flawless and both realtime blocks judder,
so finished looks belong in panel storage (see docs/PERFORMANCE.md).
"""
from __future__ import annotations

import math
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import src.twinkly_movies as twinkly_movies  # noqa: E402
from panel_lab import PanelSession, frames_from  # noqa: E402
from src.color_pipeline import correct_frame  # noqa: E402
from server import load_device_ip  # noqa: E402
from src.twinkly_client import TwinklyClient  # noqa: E402

W, H = 32, 24
MOVIE_FPS = 38
LOOP_FRAMES = 76
MOVIE_NAME = "PATH STUDY"
FRAGMENTS_PER_FRAME = 3  # 32x24 RGB splits into three UDP datagrams


def loop_frame(index: int) -> bytes:
    """Smooth diagonal sweep; identical maths for every delivery path."""
    pixels = bytearray(W * H * 3)
    phase = index / LOOP_FRAMES * math.tau
    for y in range(H):
        for x in range(W):
            wave = 0.5 + 0.5 * math.sin((x * 0.16 + y * 0.1) - phase * 2)
            level = wave * wave
            offset = (y * W + x) * 3
            pixels[offset] = int(40 * level)
            pixels[offset + 1] = int(200 * level)
            pixels[offset + 2] = int(255 * level)
    return bytes(pixels)


def ensure_baked(client: TwinklyClient, frames: list[bytes]) -> dict | None:
    """Reuse the stored study movie, or bake it when there is room."""
    movies = client.list_movies()
    existing = next(
        (movie for movie in movies["movies"]
         if str(movie.get("name", "")).strip().upper() == MOVIE_NAME),
        None,
    )
    if existing is not None:
        return existing
    if int(movies.get("available_frames", 0)) < LOOP_FRAMES:
        return None
    baked: dict = client.bake_movie(
        MOVIE_NAME, b"".join(frames), width=W, height=H,
        frame_count=LOOP_FRAMES, fps=MOVIE_FPS,
    )["bakedMovie"]
    return baked


def main(argv: list[str]) -> int:
    brightness = int(argv[1]) if len(argv) > 1 else 10
    seconds = float(argv[2]) if len(argv) > 2 else 20.0
    cycles = int(argv[3]) if len(argv) > 3 else 1
    lead_in = float(os.environ.get("LEAD_IN", "15"))
    if seconds <= 0 or cycles < 1:
        raise SystemExit("Seconds must be positive and cycles at least 1.")

    frames = [loop_frame(index) for index in range(LOOP_FRAMES)]
    client = TwinklyClient(load_device_ip())
    client.connect()
    client.set_brightness(brightness)
    baked = ensure_baked(client, frames)
    if baked is None:
        print(f"not enough movie storage for {MOVIE_NAME}; "
              "skipping the baked block")

    # bake_movie corrects before upload, so the streamed blocks have to
    # carry the same correction or this compares colour, not delivery.
    render = frames_from([correct_frame(frame) for frame in frames])
    # Spread fragments across the WHOLE interval, not a fraction of it.
    spacing = (1.0 / MOVIE_FPS) / FRAGMENTS_PER_FRAME

    for cycle in range(1, cycles + 1):
        if baked is not None:
            print(f"cycle {cycle}: BAKED — panel storage, no network",
                  flush=True)
            twinkly_movies.play_stored_movie(client, int(baked["id"]))
            import time
            time.sleep(seconds)

        with PanelSession(client.ip, brightness=brightness) as panel:
            if cycle == 1:
                panel.lead_in(lead_in)
            print(f"cycle {cycle}: LIVE — fragments back to back",
                  flush=True)
            panel.stream(render, fps=MOVIE_FPS, seconds=seconds)
            print(f"cycle {cycle}: SPACED — fragments "
                  f"{spacing * 1000:.1f}ms apart", flush=True)
            panel.stream(render, fps=MOVIE_FPS, seconds=seconds,
                         spacing=spacing)

    if baked is not None:
        twinkly_movies.play_stored_movie(client, int(baked["id"]))
    print("\ndone — panel back on stored playback")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
