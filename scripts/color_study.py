#!/usr/bin/env python3
"""Compare colour-processing variants side by side on the live wall.

Splits the wall into vertical strips that all show the SAME moving,
saturated content, each processed differently, so variants are judged in
one glance instead of from memory. The panel is hardware-dimmed (full
8-bit pixels reach it) so this measures colour, not depth loss.

    python3 scripts/color_study.py [brightness] [seconds]

Each strip is numbered by lit dots in its top row: strip 1 shows one
dot, strip 2 two dots, and so on. Markers are drawn after processing so
they look identical in every strip.
"""
from __future__ import annotations

import colorsys
import math
import sys
from collections.abc import Callable
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from panel_lab import PanelSession  # noqa: E402
from src.color_pipeline import gamma_table  # noqa: E402

W, H = 32, 24
STRIP_W, GAP = 7, 1
Rgb = tuple[float, float, float]


def _gamma(rgb: Rgb, power: float) -> Rgb:
    return tuple(255.0 * ((channel / 255.0) ** power) for channel in rgb)


def variant_raw(rgb: Rgb, _hue: float, _value: float) -> Rgb:
    return rgb


def variant_gamma22(rgb: Rgb, _hue: float, _value: float) -> Rgb:
    return _gamma(rgb, 2.2)


def variant_gamma18(rgb: Rgb, _hue: float, _value: float) -> Rgb:
    return _gamma(rgb, 1.8)


def variant_gamma22_sat(_rgb: Rgb, hue: float, value: float) -> Rgb:
    boosted = colorsys.hsv_to_rgb(hue, 1.0, value)
    return _gamma(tuple(channel * 255.0 for channel in boosted), 2.2)


VARIANTS: list[tuple[str, Callable[[Rgb, float, float], Rgb]]] = [
    ("1  raw (today)", variant_raw),
    ("2  gamma 2.2", variant_gamma22),
    ("3  gamma 1.8", variant_gamma18),
    ("4  gamma 2.2 + saturation", variant_gamma22_sat),
]


def build_frame(_index: int, elapsed: float) -> bytes:
    pixels = bytearray(W * H * 3)
    for index, (_label, transform) in enumerate(VARIANTS):
        x0 = index * (STRIP_W + GAP)
        for local_x in range(STRIP_W):
            for y in range(H):
                u = local_x / max(1, STRIP_W - 1)
                v = y / (H - 1)
                hue = (u * 0.75 + elapsed * 0.07) % 1.0
                value = 0.12 + 0.88 * (
                    0.5 + 0.5 * math.sin(v * math.pi * 2 - elapsed * 1.4)
                )
                base = tuple(
                    channel * 255.0
                    for channel in colorsys.hsv_to_rgb(hue, 0.85, value)
                )
                red, green, blue = transform(base, hue, value)
                offset = (y * W + x0 + local_x) * 3
                pixels[offset] = max(0, min(255, int(red)))
                pixels[offset + 1] = max(0, min(255, int(green)))
                pixels[offset + 2] = max(0, min(255, int(blue)))
        # Identification dots, drawn unprocessed so they read the same.
        for dot in range(index + 1):
            offset = (x0 + dot) * 3
            pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 200
    return bytes(pixels)


def main(argv: list[str]) -> int:
    brightness = int(argv[1]) if len(argv) > 1 else 10
    seconds = float(argv[2]) if len(argv) > 2 else 60.0
    if seconds <= 0:
        raise SystemExit("Seconds must be positive.")
    # Touch the shared table so a broken pipeline fails before the wall
    # is taken over rather than half way through a study.
    gamma_table(2.2)

    for index, (label, _fn) in enumerate(VARIANTS, start=1):
        print(f"  strip {index} ({index} dot{'s' if index > 1 else ''}): {label}")
    print(f"\nrunning {seconds:.0f}s at {brightness}% hardware brightness …",
          flush=True)

    with PanelSession(brightness=brightness) as panel:
        panel.stream(build_frame, fps=36.0, seconds=seconds)

    print("done — restored to stored playback")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
