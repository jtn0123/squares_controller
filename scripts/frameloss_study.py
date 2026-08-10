#!/usr/bin/env python3
"""Find whether displayed-frame loss depends on how fast we send.

Realtime frames cost three UDP packets each, so 36 FPS is 108 packets a
second at the panel's receive path. Ping cannot measure that — it probes
at five packets a second — so this makes loss visible instead: one lit
row advances per SENT frame, and any frame the panel misses shows up as
the marker skipping rows or freezing.

One block per send rate, each in its own colour so blocks can be named
without counting flashes:

    RED 12 FPS   GREEN 20 FPS   BLUE 28 FPS   AMBER 36 FPS

    python3 scripts/frameloss_study.py [brightness] [seconds] [rates...]

Report which colours march evenly and which stutter. If the slow blocks
are visibly cleaner, lowering the production rate is a real fix; if all
of them stutter alike, the loss is in the panel's radio and no send-rate
change will help.
"""
from __future__ import annotations

import base64
import json
import math
import os
import socket
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.twinkly_protocol import (  # noqa: E402
    build_realtime_packets,
    calculate_layout,
    oriented_raster_to_device_frame,
)

PANEL_IP = "10.27.27.212"
PANEL = f"http://{PANEL_IP}/xled/v1"
UDP = (PANEL_IP, 7777)
W, H = 32, 24
# Bright, well separated, and all above the panel's measured black floor.
BLOCK_COLOURS = [
    ("RED", (255, 0, 0)),
    ("GREEN", (0, 255, 0)),
    ("BLUE", (40, 80, 255)),
    ("AMBER", (255, 140, 0)),
]


def api(path: str, body: dict | None = None, token: str | None = None) -> dict:
    request = urllib.request.Request(
        PANEL + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            **({"X-Auth-Token": token} if token else {}),
        },
        method="GET" if body is None else "POST",
    )
    with urllib.request.urlopen(request, timeout=6) as response:
        return json.load(response)


def marcher_frame(index: int, colour: tuple[int, int, int]) -> bytes:
    """One row per sent frame, with a short trail for direction."""
    pixels = bytearray(W * H * 3)
    for trail in range(3):
        y = (index - trail) % H
        fade = 1.0 - trail * 0.33
        for x in range(W):
            offset = (y * W + x) * 3
            pixels[offset] = int(colour[0] * fade)
            pixels[offset + 1] = int(colour[1] * fade)
            pixels[offset + 2] = int(colour[2] * fade)
    return bytes(pixels)


def main(argv: list[str]) -> int:
    brightness = int(argv[1]) if len(argv) > 1 else 10
    seconds = float(argv[2]) if len(argv) > 2 else 12.0
    rates = [float(rate) for rate in argv[3:]] or [12.0, 20.0, 28.0, 36.0]
    # Set LEAD_IN=0 to skip the walk-to-the-wall pulse.
    lead_in = float(os.environ.get("LEAD_IN", "15"))

    login = api("/login", {"challenge": base64.b64encode(bytes(32)).decode()})
    token = login["authentication_token"]
    api("/verify", {"challenge-response": login["challenge-response"]}, token)
    layout = calculate_layout(api("/led/layout/full", token=token)["coordinates"])

    for (name, _rgb), rate in zip(BLOCK_COLOURS, rates):
        print(f"  {name:<6} {rate:g} FPS  "
              f"({rate * 3:.0f} UDP packets/sec)")
    print(f"\n{seconds:.0f}s per colour at {brightness}% brightness\n",
          flush=True)

    api("/led/mode", {"mode": "rt"}, token)
    api("/led/out/brightness",
        {"mode": "enabled", "type": "A", "value": brightness}, token)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    def blank(duration: float) -> None:
        empty = oriented_raster_to_device_frame(bytes(W * H * 3), W, H, layout, 0)
        finish = time.monotonic() + duration
        while time.monotonic() < finish:
            for packet in build_realtime_packets(token, empty):
                sock.sendto(packet, UDP)
            time.sleep(1 / 30)

    # A slow white pulse first, so there is time to walk to the wall
    # before the first measured block starts.
    if lead_in > 0:
        print(f"  lead-in {lead_in:.0f}s (slow white pulse) …", flush=True)
        steps = int(30 * lead_in)
        for step in range(steps):
            level = int(120 * (0.5 + 0.5 * math.sin(step / 30 * 2.2)))
            raster = bytes([level, level, level] * (W * H))
            frame = oriented_raster_to_device_frame(raster, W, H, layout, 0)
            for packet in build_realtime_packets(token, frame):
                sock.sendto(packet, UDP)
            time.sleep(1 / 30)

    for (name, colour), rate in zip(BLOCK_COLOURS, rates):
        blank(1.2)
        print(f"  -> {name} at {rate:g} FPS …", flush=True)
        interval = 1.0 / rate
        deadline = time.monotonic()
        for index in range(int(rate * seconds)):
            raster = marcher_frame(index, colour)
            frame = oriented_raster_to_device_frame(raster, W, H, layout, 0)
            for packet in build_realtime_packets(token, frame):
                sock.sendto(packet, UDP)
            deadline += interval
            rest = deadline - time.monotonic()
            if rest > 0:
                time.sleep(rest)

    api("/led/out/brightness",
        {"mode": "enabled", "type": "A", "value": brightness}, token)
    api("/led/mode", {"mode": "movie"}, token)
    sock.close()
    print("\ndone — restored to movie mode")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
