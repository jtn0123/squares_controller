#!/usr/bin/env python3
"""Probe what the panel actually supports, one colour per question.

The controller advertises numbers its radio and LED driver do not
necessarily deliver. Each zone isolates one capability so it can be
judged by eye:

  RED    tonal ramp     24 rows spanning the full range, gamma-corrected.
                        Count the bands you can distinguish — that is the
                        usable colour depth at this brightness.
  GREEN  dark end       rows are raw PWM 0..23. Where the rows stop being
                        distinguishable is the black floor; everything
                        below it is wasted range.
  BLUE   frame delivery one lit row marches down, one row per SENT frame.
                        A steady march means frames are landing; jumps,
                        freezes, or backwards skips are lost frames.
  AMBER  modulation     full on/off alternating every frame. NOTE: at 36
                        FPS this is an 18 Hz square wave, which flickers
                        visibly even when displayed perfectly — read it
                        as a temporal-response demo, not as evidence of
                        dropped frames. Use the BLUE zone for that.

    python3 scripts/capability_probe.py [brightness] [seconds] [fps]
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from panel_lab import PanelSession  # noqa: E402

W, H = 32, 24
STRIP_W, GAP = 7, 1


def gamma(level: float) -> int:
    return max(0, min(255, int(255.0 * (level ** 2.2))))


def paint(pixels: bytearray, zone: int, y: int, rgb: tuple[int, int, int]) -> None:
    x0 = zone * (STRIP_W + GAP)
    for local_x in range(STRIP_W):
        offset = (y * W + x0 + local_x) * 3
        pixels[offset], pixels[offset + 1], pixels[offset + 2] = rgb


def build_frame(index: int, _elapsed: float) -> bytes:
    pixels = bytearray(W * H * 3)
    for y in range(H):
        # RED — full-range tonal ramp, gamma corrected.
        paint(pixels, 0, y, (gamma((y + 1) / H), 0, 0))
        # GREEN — the very bottom of the PWM range, one step per row.
        paint(pixels, 1, y, (0, y, 0))
    # BLUE — one row per sent frame; drops show as jumps.
    paint(pixels, 2, index % H, (0, 0, 255))
    # AMBER — alternates every frame (see the module docstring).
    level = 255 if index % 2 == 0 else 0
    for y in range(H):
        paint(pixels, 3, y, (level, int(level * 0.55), 0))
    return bytes(pixels)


def main(argv: list[str]) -> int:
    brightness = int(argv[1]) if len(argv) > 1 else 10
    seconds = float(argv[2]) if len(argv) > 2 else 60.0
    fps = float(argv[3]) if len(argv) > 3 else 36.0
    if fps <= 0 or seconds <= 0:
        raise SystemExit("Seconds and FPS must be positive.")

    with PanelSession(brightness=brightness) as panel:
        device = panel.api("/gestalt")
        print("panel reports:")
        for key in ("frame_rate", "measured_frame_rate", "number_of_led",
                    "bytes_per_led", "hw_id", "fw_family"):
            if key in device:
                print(f"  {key}: {device[key]}")
        print("\nzones:  RED=tonal ramp  GREEN=dark end  "
              "BLUE=frame delivery  AMBER=modulation demo")
        print(f"running {seconds:.0f}s at {brightness}% brightness, "
              f"{fps:g} FPS\n", flush=True)
        panel.stream(build_frame, fps=fps, seconds=seconds)

    print("done — restored to stored playback")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
