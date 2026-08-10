#!/usr/bin/env python3
"""Compare saturation levels side by side, using the shipping pipeline.

Gamma is settled: correcting sRGB values for linear LED drivers is what
stopped realtime output looking washed out. How hard to push saturation
is a taste call, so this puts several levels on the wall at once, all
processed by `src.color_pipeline` — what you see is exactly what a bake
would store.

    python3 scripts/color_study.py [brightness] [seconds] [levels...]

Each strip is numbered by lit dots in its top row: strip 1 shows one
dot, strip 2 two dots, and so on. Markers are drawn after processing so
they look identical in every strip.

Note on judging: perceived colourfulness falls with luminance, so the
same correction reads far more vivid at 30% brightness than at 10%.
Compare strips against each other, not against a memory of daylight.
"""
from __future__ import annotations

import colorsys
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from panel_lab import PanelSession  # noqa: E402
from src.color_pipeline import (  # noqa: E402
    DEFAULT_GAMMA,
    DEFAULT_SATURATION,
    correct_frame,
)

W, H = 32, 24
STRIP_W, GAP = 7, 1
LOOP_FRAMES = 72
LOOP_FPS = 24.0
DEFAULT_LEVELS = [1.0, 1.6, 2.2, 3.0]


def base_raster(elapsed: float) -> bytes:
    """Saturated moving content, before any correction."""
    pixels = bytearray(W * H * 3)
    for y in range(H):
        for x in range(W):
            u = (x % (STRIP_W + GAP)) / max(1, STRIP_W - 1)
            v = y / (H - 1)
            hue = (u * 0.75 + elapsed * 0.07) % 1.0
            value = 0.12 + 0.88 * (
                0.5 + 0.5 * math.sin(v * math.pi * 2 - elapsed * 1.4)
            )
            red, green, blue = colorsys.hsv_to_rgb(hue, 0.85, value)
            offset = (y * W + x) * 3
            pixels[offset] = int(red * 255)
            pixels[offset + 1] = int(green * 255)
            pixels[offset + 2] = int(blue * 255)
    return bytes(pixels)


def build_loop(levels: list[float]) -> list[bytes]:
    """Precompute the loop: correction per strip is too slow live."""
    frames: list[bytes] = []
    for index in range(LOOP_FRAMES):
        raster = base_raster(index / LOOP_FPS)
        corrected = [
            correct_frame(raster, gamma=DEFAULT_GAMMA, saturation=level)
            for level in levels
        ]
        composite = bytearray(W * H * 3)
        for strip, variant in enumerate(corrected):
            x0 = strip * (STRIP_W + GAP)
            for y in range(H):
                for local_x in range(STRIP_W):
                    offset = (y * W + x0 + local_x) * 3
                    composite[offset:offset + 3] = variant[offset:offset + 3]
            # Identification dots, drawn after processing.
            for dot in range(strip + 1):
                marker = (x0 + dot) * 3
                composite[marker] = composite[marker + 1] = 200
                composite[marker + 2] = 200
        frames.append(bytes(composite))
    return frames


def main(argv: list[str]) -> int:
    brightness = int(argv[1]) if len(argv) > 1 else 10
    seconds = float(argv[2]) if len(argv) > 2 else 60.0
    levels = [float(value) for value in argv[3:]] or DEFAULT_LEVELS
    if seconds <= 0:
        raise SystemExit("Seconds must be positive.")
    if not 1 <= len(levels) <= 4:
        raise SystemExit("Pass one to four saturation levels.")
    if any(level < 0 for level in levels):
        raise SystemExit("Saturation cannot be negative.")

    for index, level in enumerate(levels, start=1):
        dots = "dot" if index == 1 else "dots"
        print(f"  strip {index} ({index} {dots}): saturation {level:g}"
              f"{'  (current default)' if level == DEFAULT_SATURATION else ''}")
    print(f"\nbuilding {LOOP_FRAMES} corrected frames …", flush=True)
    frames = build_loop(levels)
    print(f"running {seconds:.0f}s at {brightness}% brightness", flush=True)

    with PanelSession(brightness=brightness) as panel:
        panel.stream(
            lambda index, _elapsed: frames[index % len(frames)],
            fps=LOOP_FPS,
            seconds=seconds,
        )

    print("done — restored to stored playback")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
