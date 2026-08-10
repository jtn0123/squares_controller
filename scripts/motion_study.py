#!/usr/bin/env python3
"""Measure delivered frame cadence on the live wall at several rates.

Streams continuous motion through the running controller and reports what
the relay actually delivered, so "it looks choppy" can be checked against
numbers instead of impressions.

    python3 scripts/motion_study.py                # 10% brightness sweep
    python3 scripts/motion_study.py 40 30 36       # 40% at 30 and 36 FPS

Each run stops the stream first so relay telemetry resets, streams
SECONDS of motion, then reads /api/telemetry. The wall is returned to
stock movie playback at the end.

Columns: delivered = fresh frames per second reaching the panel; gaps are
between fresh frames (idle keepalive repeats are excluded); producer p95
is this script's own send spacing, for separating host stalls from relay
stalls.
"""
from __future__ import annotations

import base64
import json
import math
import sys
import time
import urllib.request

BASE = "http://127.0.0.1:4312"
WIDTH, HEIGHT = 32, 24
SECONDS = 10


def post(path: str, body: dict, timeout: float = 8) -> dict:
    request = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def get(path: str, timeout: float = 8) -> dict:
    with urllib.request.urlopen(BASE + path, timeout=timeout) as response:
        return json.load(response)


def sweep_frame(seconds: float) -> bytes:
    """A slow diagonal sweep — the easiest pattern to spot judder in."""
    pixels = bytearray(WIDTH * HEIGHT * 3)
    for y in range(HEIGHT):
        for x in range(WIDTH):
            phase = (x * 0.18 + y * 0.12) - seconds * 1.6
            level = 0.5 + 0.5 * math.sin(phase)
            level *= level  # sharpen the edge so stepping is obvious
            offset = (y * WIDTH + x) * 3
            pixels[offset] = int(255 * level)
            pixels[offset + 1] = int(120 * level)
            pixels[offset + 2] = int(200 * level)
    return bytes(pixels)


def run_rate(fps: float) -> dict:
    post("/api/mode", {"mode": "movie"})  # stop stream, reset counters
    time.sleep(0.6)
    interval = 1.0 / fps
    encoded_frames = [
        base64.b64encode(sweep_frame(index * interval)).decode()
        for index in range(int(fps * SECONDS))
    ]

    send_gaps: list[float] = []
    deadline = time.monotonic()
    previous: float | None = None
    for encoded in encoded_frames:
        post(
            "/api/frame",
            {
                "width": WIDTH,
                "height": HEIGHT,
                "pixelsBase64": encoded,
                "source": "motion-study",
                "claim": previous is None,
            },
        )
        now = time.monotonic()
        if previous is not None:
            send_gaps.append((now - previous) * 1000)
        previous = now
        deadline += interval
        remaining = deadline - time.monotonic()
        if remaining > 0:
            time.sleep(remaining)

    telemetry = get("/api/telemetry")["streamTelemetry"]
    send_gaps.sort()
    telemetry["producerP95Ms"] = round(
        send_gaps[int(len(send_gaps) * 0.95)], 2
    )
    return telemetry


def main(argv: list[str]) -> int:
    brightness = int(argv[1]) if len(argv) > 1 else 10
    rates = [float(rate) for rate in argv[2:]] or [24.0, 30.0, 33.0, 36.0]

    post("/api/brightness", {"value": brightness})
    print(f"brightness set to {brightness}%\n")
    print(
        f"{'target':>7} {'delivered':>10} {'p95 gap':>9} {'max gap':>9} "
        f"{'repeats':>8} {'late':>6} {'missed':>7} {'producer p95':>13}"
    )
    for rate in rates:
        result = run_rate(rate)
        print(
            f"{rate:>7.1f} {result['uniqueFps']:>10.2f} "
            f"{result['p95UniqueGapMs']:>8.1f}m {result['maxUniqueGapMs']:>8.1f}m "
            f"{result['repeatedFrames']:>8} {result['lateFrames']:>6} "
            f"{result['missedDeadlines']:>7} {result['producerP95Ms']:>12.1f}m"
        )

    restored = post("/api/mode", {"mode": "movie"})
    movie = (restored.get("currentMovie") or {}).get("name")
    print(f"\nrestored: {restored['mode']} / {movie}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
