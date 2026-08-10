#!/usr/bin/env python3
"""Compare the two delivery paths with identical content.

The panel's own movie playback is visibly smooth while realtime
streaming judders. Every rate/colour experiment so far varied settings
*inside* the streaming path, which cannot answer whether the path itself
is the problem. This runs the same animation three ways:

  BAKED   played from panel storage on the panel's own clock — no
          network involved. This is the smoothness ceiling.
  LIVE    realtime UDP exactly as the app streams today: each frame's
          three fragments sent back to back.
  SPACED  realtime UDP with the fragments spread across the frame
          interval, in case bursts of three packets are overrunning the
          panel's receive path.

If BAKED is smooth and both realtime blocks judder, the path is the
limit and finished looks belong in panel storage. If SPACED is
noticeably better than LIVE, fragment bursts are the culprit and that is
a fix we control.

    python3 scripts/path_study.py [brightness] [seconds]
"""
from __future__ import annotations

import math
import os
import socket
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.twinkly_client import TwinklyClient  # noqa: E402
from src.twinkly_protocol import (  # noqa: E402
    build_realtime_packets,
    oriented_raster_to_device_frame,
    scale_frame_brightness,
)

PANEL_IP = "10.27.27.212"
UDP = (PANEL_IP, 7777)
W, H = 32, 24
MOVIE_FPS = 38          # the panel's integer playback rate
LOOP_FRAMES = 76        # ~2 s loop, small enough to be kind to storage
MOVIE_NAME = "PATH STUDY"


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


def stream(client, sock, frames, seconds, spacing) -> None:
    """Send the loop over realtime UDP; spacing spreads the fragments."""
    assert client.layout is not None
    token = client.authenticate()
    interval = 1.0 / MOVIE_FPS
    deadline = time.monotonic()
    total = int(MOVIE_FPS * seconds)
    for n in range(total):
        raster = frames[n % LOOP_FRAMES]
        device = oriented_raster_to_device_frame(raster, W, H, client.layout, 0)
        packets = build_realtime_packets(token, device)
        if spacing <= 0:
            for packet in packets:
                sock.sendto(packet, UDP)
        else:
            for position, packet in enumerate(packets):
                sock.sendto(packet, UDP)
                if position < len(packets) - 1:
                    time.sleep(spacing)
        deadline += interval
        rest = deadline - time.monotonic()
        if rest > 0:
            time.sleep(rest)


def main(argv: list[str]) -> int:
    brightness = int(argv[1]) if len(argv) > 1 else 10
    seconds = float(argv[2]) if len(argv) > 2 else 20.0
    lead_in = float(os.environ.get("LEAD_IN", "15"))

    client = TwinklyClient(PANEL_IP)
    client.connect()
    assert client.layout is not None

    frames = [loop_frame(index) for index in range(LOOP_FRAMES)]
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    def rt_hold(raster: bytes, duration: float) -> None:
        token = client.authenticate()
        device = oriented_raster_to_device_frame(raster, W, H, client.layout, 0)
        device = scale_frame_brightness(device, 100)
        finish = time.monotonic() + duration
        while time.monotonic() < finish:
            for packet in build_realtime_packets(token, device):
                sock.sendto(packet, UDP)
            time.sleep(1 / 30)

    client.set_brightness(brightness)
    if lead_in > 0:
        print(f"lead-in {lead_in:.0f}s — go look at the wall", flush=True)
        client.request("/led/mode", method="POST", body={"mode": "rt"})
        steps = int(30 * lead_in)
        for step in range(steps):
            level = int(120 * (0.5 + 0.5 * math.sin(step / 30 * 2.2)))
            rt_hold(bytes([level, level, level] * (W * H)), 1 / 30)

    print("\n1) BAKED — panel storage, panel clock, no network", flush=True)
    movies = client.list_movies()
    available = int(movies.get("available_frames", 0))
    if available < LOOP_FRAMES:
        print(f"   not enough movie storage ({available} frames free); "
              "skipping the baked block")
    else:
        existing = next(
            (m for m in movies["movies"]
             if str(m.get("name", "")).strip().upper() == MOVIE_NAME),
            None,
        )
        if existing is None:
            client.bake_movie(
                MOVIE_NAME,
                b"".join(frames),
                width=W, height=H,
                frame_count=LOOP_FRAMES, fps=MOVIE_FPS,
            )
        else:
            import src.twinkly_movies as movies_module
            movies_module.select_current_movie(client, int(existing["id"]))
            client.request("/led/mode", method="POST", body={"mode": "movie"})
        time.sleep(seconds)

    print("2) LIVE — realtime UDP, fragments back to back (today)",
          flush=True)
    client.request("/led/mode", method="POST", body={"mode": "rt"})
    stream(client, sock, frames, seconds, spacing=0.0)

    spacing = (1.0 / MOVIE_FPS) / 4
    print(f"3) SPACED — realtime UDP, fragments {spacing * 1000:.1f}ms apart",
          flush=True)
    stream(client, sock, frames, seconds, spacing=spacing)

    client.request("/led/mode", method="POST", body={"mode": "movie"})
    sock.close()
    print("\ndone — panel back on stored playback")
    print(f"note: a {LOOP_FRAMES}-frame movie named {MOVIE_NAME!r} now sits "
          "in panel storage; reuse or remove it as you like")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
