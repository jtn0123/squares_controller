#!/usr/bin/env python3
"""Test whether OUR packet rate is what makes the wall stutter.

The panel is a 2.4 GHz radio; every realtime frame costs three UDP
packets of airtime. If delivery jitter comes from contention rather than
from frame rate, sending fewer packets per second should make motion
more consistent — something a side-by-side zone study cannot show,
because the carrier rate there is global and constant.

So this runs sequentially: one block per send rate, identical motion,
while measuring round-trip latency to the panel during that block.

    python3 scripts/airtime_study.py [brightness] [seconds] [rates...]

Each block announces itself with flashes (1 flash = block 1) and prints
the measured link statistics for that rate.
"""
from __future__ import annotations

import base64
import colorsys
import json
import math
import re
import socket
import statistics
import subprocess
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
SWEEPS_PER_SECOND = 0.9


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
    """Gamma on the colour only; coverage scales PWM linearly after."""
    return tuple(
        255.0 * (channel ** 2.2)
        for channel in colorsys.hsv_to_rgb(hue, 1.0, 1.0)
    )


BAR = hue_pwm(0.5)


def build_frame(seconds: float) -> bytes:
    pixels = bytearray(W * H * 3)
    head = (seconds * SWEEPS_PER_SECOND * H) % H
    for y in range(H):
        gap = abs(y - head)
        distance = min(gap, H - gap)
        coverage = max(0.0, 1.0 - distance / 3.5)
        if coverage <= 0:
            continue
        r, g, b = (channel * coverage for channel in BAR)
        for x in range(W):
            offset = (y * W + x) * 3
            pixels[offset] = max(0, min(255, int(r)))
            pixels[offset + 1] = max(0, min(255, int(g)))
            pixels[offset + 2] = max(0, min(255, int(b)))
    return bytes(pixels)


def solid(level: int) -> bytes:
    return bytes([level, level, level] * (W * H))


def send(sock, token, layout, raster) -> None:
    frame = oriented_raster_to_device_frame(raster, W, H, layout, 0)
    for packet in build_realtime_packets(token, frame):
        sock.sendto(packet, UDP)


def hold(sock, token, layout, raster, seconds, fps=36.0) -> None:
    interval = 1.0 / fps
    deadline = time.monotonic()
    for _ in range(max(1, int(fps * seconds))):
        send(sock, token, layout, raster)
        deadline += interval
        rest = deadline - time.monotonic()
        if rest > 0:
            time.sleep(rest)


def ping_stats(output: str) -> tuple[float, float, float]:
    times = [float(value) for value in re.findall(r"time=([\d.]+)", output)]
    if not times:
        return (0.0, 0.0, 0.0)
    times.sort()
    return (
        statistics.mean(times),
        times[int(len(times) * 0.95)],
        max(times),
    )


def main(argv: list[str]) -> int:
    brightness = int(argv[1]) if len(argv) > 1 else 10
    seconds = float(argv[2]) if len(argv) > 2 else 15.0
    rates = [float(rate) for rate in argv[3:]] or [12.0, 20.0, 28.0, 36.0]

    login = api("/login", {"challenge": base64.b64encode(bytes(32)).decode()})
    token = login["authentication_token"]
    api("/verify", {"challenge-response": login["challenge-response"]}, token)
    layout = calculate_layout(api("/led/layout/full", token=token)["coordinates"])

    for index, rate in enumerate(rates, start=1):
        print(f"  block {index} ({index} flash{'es' if index > 1 else ''}): "
              f"{rate:g} FPS send rate")
    print(f"\n{seconds:.0f}s per block at {brightness}% brightness\n", flush=True)

    api("/led/mode", {"mode": "rt"}, token)
    api("/led/out/brightness",
        {"mode": "enabled", "type": "A", "value": brightness}, token)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    print(f"{'send rate':>10} {'avg RTT':>9} {'p95 RTT':>9} {'max RTT':>9}")
    for index, rate in enumerate(rates, start=1):
        for _ in range(index):  # announce the block
            hold(sock, token, layout, solid(35), 0.3)
            hold(sock, token, layout, solid(0), 0.3)
        hold(sock, token, layout, solid(0), 0.4)

        probe = subprocess.Popen(
            ["ping", "-c", str(int(seconds * 5)), "-i", "0.2", PANEL_IP],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
        )
        interval = 1.0 / rate
        deadline = time.monotonic()
        for n in range(int(rate * seconds)):
            send(sock, token, layout, build_frame(n * interval))
            deadline += interval
            rest = deadline - time.monotonic()
            if rest > 0:
                time.sleep(rest)
        output, _ = probe.communicate(timeout=20)
        average, p95, worst = ping_stats(output)
        print(f"{rate:>10g} {average:>8.1f}m {p95:>8.1f}m {worst:>8.1f}m",
              flush=True)

    api("/led/out/brightness",
        {"mode": "enabled", "type": "A", "value": brightness}, token)
    api("/led/mode", {"mode": "movie"}, token)
    sock.close()
    print("\ndone — restored to movie mode")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
