"""Colour correction for frames on their way to the LEDs.

LED drivers dim linearly, but the colours the browser produces are
sRGB-encoded. Sent straight through, every mid-tone lands far brighter
than intended, which flattens contrast and desaturates the picture —
the reason realtime output looked washed out next to the controller's
own stored movies.

Correction happens in this order, matching what tested best on a live
wall (see docs/PERFORMANCE.md):

1. saturation, in the encoded space, around each pixel's luma
2. gamma, mapping encoded values onto linear PWM duty
3. an optional black-floor lift, for panels that emit nothing below some
   duty at low brightness

Everything here is pure and works on plain bytes, so it can run over a
whole baked movie without touching device state.
"""

from __future__ import annotations

import functools
import math

# Rec. 601 luma weights, scaled to integers to keep the hot loop in ints.
_LUMA_R, _LUMA_G, _LUMA_B = 299, 587, 114
DEFAULT_GAMMA = 2.2
DEFAULT_SATURATION = 1.25


@functools.lru_cache(maxsize=16)
def gamma_table(gamma: float, black_floor: int = 0) -> bytes:
    """Encoded value -> linear PWM duty, as a 256-entry lookup table.

    True black stays black; every other level is mapped into
    [black_floor, 255] so faint content still reaches a duty the panel
    can actually emit.
    """
    if gamma <= 0:
        raise ValueError("Gamma must be positive.")
    floor = max(0, min(254, int(black_floor)))
    span = 255 - floor
    table = bytearray(256)
    for value in range(1, 256):
        corrected = (value / 255.0) ** gamma
        table[value] = max(0, min(255, round(floor + span * corrected)))
    return bytes(table)


def saturate_frame(frame: bytes, amount: float) -> bytes:
    """Push each pixel away from its own luma. 1.0 leaves it untouched."""
    # Float equality is unreliable; treat anything within a rounding
    # error of 1.0 as "leave it alone".
    if math.isclose(amount, 1.0, rel_tol=1e-9, abs_tol=1e-9):
        return frame
    if amount < 0:
        raise ValueError("Saturation cannot be negative.")
    scale = int(round(amount * 1000))
    out = bytearray(len(frame))
    for index in range(0, len(frame) - 2, 3):
        red, green, blue = frame[index], frame[index + 1], frame[index + 2]
        luma = (_LUMA_R * red + _LUMA_G * green + _LUMA_B * blue) // 1000
        for channel, value in enumerate((red, green, blue)):
            shifted = luma + ((value - luma) * scale) // 1000
            out[index + channel] = 0 if shifted < 0 else min(255, shifted)
    return bytes(out)


def correct_frame(
    frame: bytes,
    *,
    gamma: float = DEFAULT_GAMMA,
    saturation: float = DEFAULT_SATURATION,
    black_floor: int = 0,
) -> bytes:
    """Apply the full correction to one RGB frame."""
    saturated = saturate_frame(frame, saturation)
    return saturated.translate(gamma_table(gamma, black_floor))


def correct_movie(
    pixels: bytes,
    *,
    gamma: float = DEFAULT_GAMMA,
    saturation: float = DEFAULT_SATURATION,
    black_floor: int = 0,
) -> bytes:
    """Correct a whole concatenated movie.

    Saturation is per pixel and gamma is a table lookup, so both apply
    just as well to the concatenation as to individual frames — no need
    to split the buffer up.
    """
    return correct_frame(
        pixels,
        gamma=gamma,
        saturation=saturation,
        black_floor=black_floor,
    )
