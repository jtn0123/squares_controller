#!/usr/bin/env python3
"""Compare colour-processing variants side by side on the live wall.

Splits the wall into vertical strips that all show the SAME moving,
saturated content, each processed differently, so variants can be judged
in one glance instead of from memory. The panel is hardware-dimmed (full
8-bit pixels reach it) so the comparison is about colour, not depth loss.

    python3 scripts/color_study.py [brightness] [seconds]

Each strip is numbered by lit dots in its top row: strip 1 shows one dot,
strip 2 two dots, and so on. Markers are drawn after processing so they
look identical in every strip.
"""
from __future__ import annotations

import base64
import colorsys
import json
import math
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
W, H, FPS = 32, 24, 36.0
STRIP_W, GAP = 7, 1  # 4 strips of 7px + 1px divider fills 32 columns


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


def gamma(channel: float, power: float) -> float:
    """sRGB-ish encoded value -> linear PWM duty the LED driver wants."""
    return 255.0 * ((channel / 255.0) ** power)


def variant_raw(rgb, _hue, _sat):
    return rgb


def variant_gamma22(rgb, _hue, _sat):
    return tuple(gamma(c, 2.2) for c in rgb)


def variant_gamma18(rgb, _hue, _sat):
    return tuple(gamma(c, 1.8) for c in rgb)


def variant_gamma22_sat(rgb, hue, value):
    boosted = colorsys.hsv_to_rgb(hue, 1.0, value)
    return tuple(gamma(c * 255.0, 2.2) for c in boosted)


VARIANTS = [
    ("1  raw (today)", variant_raw),
    ("2  gamma 2.2", variant_gamma22),
    ("3  gamma 1.8", variant_gamma18),
    ("4  gamma 2.2 + saturation", variant_gamma22_sat),
]


def build_frame(seconds: float) -> bytes:
    pixels = bytearray(W * H * 3)
    for index, (_label, transform) in enumerate(VARIANTS):
        x0 = index * (STRIP_W + GAP)
        for local_x in range(STRIP_W):
            for y in range(H):
                u = local_x / max(1, STRIP_W - 1)
                v = y / (H - 1)
                hue = (u * 0.75 + seconds * 0.07) % 1.0
                value = 0.12 + 0.88 * (
                    0.5 + 0.5 * math.sin(v * math.pi * 2 - seconds * 1.4)
                )
                base = tuple(
                    c * 255.0 for c in colorsys.hsv_to_rgb(hue, 0.85, value)
                )
                r, g, b = transform(base, hue, value)
                offset = (y * W + x0 + local_x) * 3
                pixels[offset] = max(0, min(255, int(r)))
                pixels[offset + 1] = max(0, min(255, int(g)))
                pixels[offset + 2] = max(0, min(255, int(b)))
        # Identification dots, drawn unprocessed so they read the same.
        for dot in range(index + 1):
            offset = (0 * W + x0 + dot) * 3
            pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 200
    return bytes(pixels)


def main(argv: list[str]) -> int:
    brightness = int(argv[1]) if len(argv) > 1 else 10
    seconds = float(argv[2]) if len(argv) > 2 else 60.0

    login = api("/login", {"challenge": base64.b64encode(bytes(32)).decode()})
    token = login["authentication_token"]
    api("/verify", {"challenge-response": login["challenge-response"]}, token)
    layout = calculate_layout(api("/led/layout/full", token=token)["coordinates"])

    for index, (label, _fn) in enumerate(VARIANTS, start=1):
        print(f"  strip {index} ({index} dot{'s' if index > 1 else ''}): {label}")
    print(f"\nrunning {seconds:.0f}s at {brightness}% hardware brightness …",
          flush=True)

    api("/led/mode", {"mode": "rt"}, token)
    api("/led/out/brightness",
        {"mode": "enabled", "type": "A", "value": brightness}, token)

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    interval = 1.0 / FPS
    deadline = time.monotonic()
    for n in range(int(FPS * seconds)):
        raster = build_frame(n * interval)
        frame = oriented_raster_to_device_frame(raster, W, H, layout, 0)
        for packet in build_realtime_packets(token, frame):
            sock.sendto(packet, UDP)
        deadline += interval
        rest = deadline - time.monotonic()
        if rest > 0:
            time.sleep(rest)

    api("/led/mode", {"mode": "movie"}, token)
    sock.close()
    print("done — restored to movie mode")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
