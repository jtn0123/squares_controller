#!/usr/bin/env python3
"""Probe what the panel actually supports, one colour per question.

The controller advertises numbers (40 FPS, 8 bits per channel) that its
radio and LED driver do not necessarily deliver. Each zone isolates one
capability so it can be judged by eye:

  RED    tonal ramp     24 rows spanning the full range, gamma-corrected.
                        Count the bands you can distinguish — that is the
                        usable colour depth at this brightness.
  GREEN  dark end       rows are raw PWM 0..23. Where the rows stop being
                        distinguishable is the black floor; everything
                        below it is wasted range.
  BLUE   frame delivery one lit row marches down, one row per SENT frame.
                        A steady march means frames are landing; jumps,
                        freezes, or backwards skips are lost frames.
  AMBER  refresh        full on/off alternating every frame. Displayed
                        faithfully it reads as steady dim amber; visible
                        flicker or throbbing means frames are being
                        dropped or duplicated.

    python3 scripts/capability_probe.py [brightness] [seconds] [fps]
"""
from __future__ import annotations

import base64
import json
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
STRIP_W, GAP = 7, 1


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


def gamma(level: float) -> int:
    return max(0, min(255, int(255.0 * (level ** 2.2))))


def paint(pixels: bytearray, zone: int, y: int, rgb: tuple[int, int, int]) -> None:
    x0 = zone * (STRIP_W + GAP)
    for local_x in range(STRIP_W):
        offset = (y * W + x0 + local_x) * 3
        pixels[offset], pixels[offset + 1], pixels[offset + 2] = rgb


def build_frame(index: int) -> bytes:
    pixels = bytearray(W * H * 3)
    for y in range(H):
        # RED — full-range tonal ramp, gamma corrected.
        paint(pixels, 0, y, (gamma((y + 1) / H), 0, 0))
        # GREEN — the very bottom of the PWM range, one step per row.
        paint(pixels, 1, y, (0, y, 0))
    # BLUE — one row per sent frame; drops show as jumps.
    paint(pixels, 2, index % H, (0, 0, 255))
    # AMBER — alternate every frame; faithful display looks steady.
    level = 255 if index % 2 == 0 else 0
    for y in range(H):
        paint(pixels, 3, y, (level, int(level * 0.55), 0))
    return bytes(pixels)


def main(argv: list[str]) -> int:
    brightness = int(argv[1]) if len(argv) > 1 else 10
    seconds = float(argv[2]) if len(argv) > 2 else 60.0
    fps = float(argv[3]) if len(argv) > 3 else 36.0

    login = api("/login", {"challenge": base64.b64encode(bytes(32)).decode()})
    token = login["authentication_token"]
    api("/verify", {"challenge-response": login["challenge-response"]}, token)
    device = api("/gestalt", token=token)
    layout = calculate_layout(api("/led/layout/full", token=token)["coordinates"])

    print("panel reports:")
    for key in ("frame_rate", "measured_frame_rate", "number_of_led",
                "bytes_per_led", "hw_id", "fw_family"):
        if key in device:
            print(f"  {key}: {device[key]}")
    print("\nzones:  RED=tonal ramp  GREEN=dark end  "
          "BLUE=frame delivery  AMBER=refresh")
    print(f"running {seconds:.0f}s at {brightness}% brightness, "
          f"{fps:g} FPS\n", flush=True)

    api("/led/mode", {"mode": "rt"}, token)
    api("/led/out/brightness",
        {"mode": "enabled", "type": "A", "value": brightness}, token)

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    interval = 1.0 / fps
    deadline = time.monotonic()
    for index in range(int(fps * seconds)):
        raster = build_frame(index)
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
    print("done — restored to movie mode")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
