#!/usr/bin/env python3
"""Compare motion rates side by side on the live wall.

Four vertical zones each run the SAME sweeping bar, but each zone's
motion advances at its own rate, so perceived smoothness can be compared
directly instead of from memory. The wall itself is always fed at the
full stream rate — only how often each zone's content changes differs,
which is exactly what a lower producer rate does in the real app.

    python3 scripts/framerate_study.py [brightness] [seconds] [rates...]

Zones are numbered by lit dots in the top row (1 dot = zone 1) and also
carry distinct hues. Colour uses the treatment that won the colour study
(gamma 2.2 + saturation) so this looks like the shipping pipeline.
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
W, H = 32, 24
STRIP_W, GAP = 7, 1
SWEEPS_PER_SECOND = 0.9      # fast enough that low rates visibly step
ZONE_HUES = [0.0, 0.09, 0.33, 0.5]  # red, amber, green, cyan


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


def hue_pwm(hue: float) -> tuple[float, float, float]:
    """Full-intensity hue, gamma-corrected into linear PWM space.

    Gamma belongs on the colour only. Anti-aliased coverage must scale
    the PWM value linearly afterwards — gamma-ing the coverage crushes
    partial pixels (0.5 -> 0.22) and turns soft moving edges hard, which
    reads as judder no matter how high the frame rate is.
    """
    return tuple(
        255.0 * (channel ** 2.2)
        for channel in colorsys.hsv_to_rgb(hue, 1.0, 1.0)
    )


def build_frame(seconds: float, rates: list[float]) -> bytes:
    pixels = bytearray(W * H * 3)
    for index, rate in enumerate(rates):
        x0 = index * (STRIP_W + GAP)
        # Quantizing time to the zone's rate is what makes it look like a
        # producer running at that rate.
        zone_time = math.floor(seconds * rate) / rate
        head = (zone_time * SWEEPS_PER_SECOND * H) % H
        base = hue_pwm(ZONE_HUES[index % len(ZONE_HUES)])
        for y in range(H):
            gap = abs(y - head)
            distance = min(gap, H - gap)
            coverage = max(0.0, 1.0 - distance / 3.5)
            if coverage <= 0:
                continue
            r, g, b = (channel * coverage for channel in base)
            for local_x in range(STRIP_W):
                offset = (y * W + x0 + local_x) * 3
                pixels[offset] = max(0, min(255, int(r)))
                pixels[offset + 1] = max(0, min(255, int(g)))
                pixels[offset + 2] = max(0, min(255, int(b)))
        for dot in range(index + 1):
            offset = (0 * W + x0 + dot) * 3
            pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 200
    return bytes(pixels)


def main(argv: list[str]) -> int:
    brightness = int(argv[1]) if len(argv) > 1 else 10
    seconds = float(argv[2]) if len(argv) > 2 else 75.0
    rates = [float(r) for r in argv[3:]] or [34.0, 36.0, 37.5, 38.46]
    # Feed the panel at the fastest zone so no zone is capped by the carrier.
    stream_fps = max(rates)

    login = api("/login", {"challenge": base64.b64encode(bytes(32)).decode()})
    token = login["authentication_token"]
    api("/verify", {"challenge-response": login["challenge-response"]}, token)
    layout = calculate_layout(api("/led/layout/full", token=token)["coordinates"])

    hue_names = ["red", "amber", "green", "cyan"]
    for index, rate in enumerate(rates, start=1):
        dots = "dot" if index == 1 else "dots"
        print(f"  zone {index} ({index} {dots}, {hue_names[index - 1]}): "
              f"{rate:g} FPS motion")
    print(f"\nrunning {seconds:.0f}s at {brightness}% brightness, "
          f"panel fed at {stream_fps:g} FPS …", flush=True)

    api("/led/mode", {"mode": "rt"}, token)
    api("/led/out/brightness",
        {"mode": "enabled", "type": "A", "value": brightness}, token)

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    interval = 1.0 / stream_fps
    deadline = time.monotonic()
    for n in range(int(stream_fps * seconds)):
        raster = build_frame(n * interval, rates)
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
