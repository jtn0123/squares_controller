#!/usr/bin/env python3
"""Alternate baked playback against spaced realtime streaming.

Same animation, same speed, two colours so the blocks are never
confused:

    CYAN   baked  — played from panel storage on the panel's clock
    AMBER  spaced — realtime UDP with each frame's three fragments
                    spread across the frame interval

Alternates so the two can be compared back to back rather than from
memory.

    python3 scripts/bake_vs_stream.py [brightness] [seconds] [cycles]
"""
from __future__ import annotations

import math
import os
import socket
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import src.twinkly_movies as twinkly_movies  # noqa: E402
from src.twinkly_client import TwinklyClient  # noqa: E402
from src.twinkly_protocol import (  # noqa: E402
    build_realtime_packets,
    oriented_raster_to_device_frame,
)

PANEL_IP = "10.27.27.212"
UDP = (PANEL_IP, 7777)
W, H = 32, 24
MOVIE_FPS = 38
LOOP_FRAMES = 76
MOVIE_NAME = "PATH STUDY"
CYAN = (40, 200, 255)
AMBER = (255, 150, 20)


def loop_frame(index: int, colour: tuple[int, int, int]) -> bytes:
    """The same sweep the baked movie contains, in a chosen colour."""
    pixels = bytearray(W * H * 3)
    phase = index / LOOP_FRAMES * math.tau
    for y in range(H):
        for x in range(W):
            wave = 0.5 + 0.5 * math.sin((x * 0.16 + y * 0.1) - phase * 2)
            level = wave * wave
            offset = (y * W + x) * 3
            pixels[offset] = int(colour[0] * level)
            pixels[offset + 1] = int(colour[1] * level)
            pixels[offset + 2] = int(colour[2] * level)
    return bytes(pixels)


def main(argv: list[str]) -> int:
    brightness = int(argv[1]) if len(argv) > 1 else 10
    seconds = float(argv[2]) if len(argv) > 2 else 15.0
    cycles = int(argv[3]) if len(argv) > 3 else 2
    lead_in = float(os.environ.get("LEAD_IN", "15"))

    client = TwinklyClient(PANEL_IP)
    client.connect()
    assert client.layout is not None
    client.set_brightness(brightness)

    movies = client.list_movies()
    baked = next(
        (m for m in movies["movies"]
         if str(m.get("name", "")).strip().upper() == MOVIE_NAME),
        None,
    )
    if baked is None:
        print(f"baking {MOVIE_NAME!r} …", flush=True)
        frames = b"".join(loop_frame(i, CYAN) for i in range(LOOP_FRAMES))
        result = client.bake_movie(
            MOVIE_NAME, frames, width=W, height=H,
            frame_count=LOOP_FRAMES, fps=MOVIE_FPS,
        )
        baked = result["bakedMovie"]

    amber = [loop_frame(index, AMBER) for index in range(LOOP_FRAMES)]
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    spacing = (1.0 / MOVIE_FPS) / 4

    def stream(seconds_to_run: float) -> None:
        token = client.authenticate()
        interval = 1.0 / MOVIE_FPS
        deadline = time.monotonic()
        for n in range(int(MOVIE_FPS * seconds_to_run)):
            device = oriented_raster_to_device_frame(
                amber[n % LOOP_FRAMES], W, H, client.layout, 0
            )
            packets = build_realtime_packets(token, device)
            for position, packet in enumerate(packets):
                sock.sendto(packet, UDP)
                if position < len(packets) - 1:
                    time.sleep(spacing)
            deadline += interval
            rest = deadline - time.monotonic()
            if rest > 0:
                time.sleep(rest)

    if lead_in > 0:
        print(f"lead-in {lead_in:.0f}s — go look at the wall", flush=True)
        client.request("/led/mode", method="POST", body={"mode": "rt"})
        token = client.authenticate()
        for step in range(int(30 * lead_in)):
            level = int(120 * (0.5 + 0.5 * math.sin(step / 30 * 2.2)))
            device = oriented_raster_to_device_frame(
                bytes([level, level, level] * (W * H)), W, H, client.layout, 0
            )
            for packet in build_realtime_packets(token, device):
                sock.sendto(packet, UDP)
            time.sleep(1 / 30)

    for cycle in range(1, cycles + 1):
        print(f"cycle {cycle}: CYAN baked …", flush=True)
        twinkly_movies.select_current_movie(client, int(baked["id"]))
        client.request("/led/mode", method="POST", body={"mode": "movie"})
        time.sleep(seconds)

        print(f"cycle {cycle}: AMBER spaced realtime …", flush=True)
        client.request("/led/mode", method="POST", body={"mode": "rt"})
        stream(seconds)

    twinkly_movies.select_current_movie(client, int(baked["id"]))
    client.request("/led/mode", method="POST", body={"mode": "movie"})
    sock.close()
    print("\ndone — panel left on stored playback")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
