"""Tests for the pure protocol transforms in src/twinkly_protocol.py.

Split from test_twinkly_client.py to keep both under the file-size
limit; the seam is natural because nothing here needs a TwinklyClient —
each test drives a stateless function: geometry, raster reordering,
rotation, packetization, rate selection, and brightness scaling.
"""

import base64
import unittest

from src.twinkly_protocol import (
    Layout,
    build_realtime_packets,
    calculate_layout,
    choose_stream_fps,
    fused_channel_permutation,
    oriented_dimensions,
    oriented_raster_to_device_frame,
    oriented_raster_movie_to_device,
    raster_to_device_frame,
    scale_frame_brightness,
    stream_interval_seconds,
)


def rectangular_coordinates(width: int, height: int) -> list[dict[str, float]]:
    return [
        {
            "x": -1 + (column / (width - 1)) * 2,
            "y": row / (height - 1),
            "z": 1,
        }
        for row in range(height)
        for column in range(width)
    ]


class TwinklyProtocolTests(unittest.TestCase):
    def test_relay_keeps_headroom_below_measured_panel_rate(self) -> None:
        device = {"frame_rate": 40, "measured_frame_rate": 38.46}

        self.assertEqual(choose_stream_fps(device), 37.5)
        self.assertAlmostEqual(stream_interval_seconds(device), 1 / 37.5)

    def test_relay_respects_slower_device_measurement(self) -> None:
        device = {"frame_rate": 25, "measured_frame_rate": 23.26}

        self.assertEqual(choose_stream_fps(device), 23.26)

    def test_calculates_32_by_24_geometry_and_flips_device_y(self) -> None:
        layout = calculate_layout(rectangular_coordinates(32, 24))
        self.assertEqual(layout.width, 32)
        self.assertEqual(layout.height, 24)
        self.assertEqual(layout.led_count, 768)
        self.assertEqual(layout.device_to_raster[0], 23 * 32)
        self.assertEqual(layout.device_to_raster[-1], 31)
        self.assertEqual(len(set(layout.device_to_raster)), 768)

    def test_reorders_raster_values_into_device_order(self) -> None:
        layout = Layout(2, 1, 2, (1, 0))
        frame = raster_to_device_frame(
            bytes([255, 0, 0, 0, 0, 255]), layout
        )
        self.assertEqual(frame, bytes([0, 0, 255, 255, 0, 0]))

    def test_reports_oriented_dimensions(self) -> None:
        layout = Layout(3, 2, 6, tuple(range(6)))

        self.assertEqual(oriented_dimensions(layout, 0), (3, 2))
        self.assertEqual(oriented_dimensions(layout, 90), (2, 3))
        self.assertEqual(oriented_dimensions(layout, 180), (3, 2))
        self.assertEqual(oriented_dimensions(layout, 270), (2, 3))

    def test_rotates_entire_raster_before_device_mapping(self) -> None:
        layout = Layout(3, 2, 6, tuple(range(6)))
        landscape = bytes(
            channel
            for pixel_id in range(1, 7)
            for channel in (pixel_id, 0, 0)
        )
        portrait = bytes(
            channel
            for pixel_id in range(1, 7)
            for channel in (pixel_id, 0, 0)
        )

        self.assertEqual(
            oriented_raster_to_device_frame(landscape, 3, 2, layout, 0)[::3],
            bytes([1, 2, 3, 4, 5, 6]),
        )
        self.assertEqual(
            oriented_raster_to_device_frame(portrait, 2, 3, layout, 90)[::3],
            bytes([2, 4, 6, 1, 3, 5]),
        )
        self.assertEqual(
            oriented_raster_to_device_frame(landscape, 3, 2, layout, 180)[::3],
            bytes([6, 5, 4, 3, 2, 1]),
        )
        self.assertEqual(
            oriented_raster_to_device_frame(portrait, 2, 3, layout, 270)[::3],
            bytes([5, 3, 1, 6, 4, 2]),
        )

    def test_fused_permutation_matches_reference_transform(self) -> None:
        layout = calculate_layout(rectangular_coordinates(6, 4))
        frame = bytes((index * 7) % 256 for index in range(layout.led_count * 3))
        for rotation in (0, 90, 180, 270):
            width, height = oriented_dimensions(layout, rotation)
            expected = oriented_raster_to_device_frame(
                frame, width, height, layout, rotation
            )
            perm = fused_channel_permutation(layout, rotation)
            self.assertEqual(
                bytes(map(frame.__getitem__, perm)),
                expected,
                f"fused permutation diverges at {rotation} degrees",
            )

    def test_rejects_invalid_display_rotation(self) -> None:
        layout = Layout(3, 2, 6, tuple(range(6)))

        with self.assertRaisesRegex(ValueError, "0, 90, 180, or 270"):
            oriented_dimensions(layout, 45)

    def test_splits_768_pixel_frame_into_protocol_v3_fragments(self) -> None:
        token = base64.b64encode(b"12345678").decode("ascii")
        packets = build_realtime_packets(token, bytes([42]) * (768 * 3))
        self.assertEqual([len(packet) for packet in packets], [912, 912, 516])
        self.assertEqual([packet[11] for packet in packets], [0, 1, 2])
        self.assertEqual(packets[0][0], 0x03)

    def test_rejects_frame_with_wrong_number_of_channels(self) -> None:
        layout = Layout(2, 1, 2, (0, 1))

        with self.assertRaisesRegex(ValueError, "Expected 6 RGB values"):
            raster_to_device_frame(bytes([0, 0, 0]), layout)

    def test_reorders_every_raster_movie_frame_into_device_order(self) -> None:
        layout = Layout(2, 1, 2, (1, 0))
        first = bytes([255, 0, 0, 0, 0, 255])
        second = bytes([0, 255, 0, 255, 255, 0])

        movie = oriented_raster_movie_to_device(
            first + second,
            frame_count=2,
            width=2,
            height=1,
            layout=layout,
            rotation=0,
        )

        self.assertEqual(
            movie,
            bytes([0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 0]),
        )

    def test_scales_realtime_frame_brightness(self) -> None:
        frame = bytes([0, 1, 127, 128, 254, 255])

        self.assertEqual(scale_frame_brightness(frame, 100), frame)
        self.assertEqual(
            scale_frame_brightness(frame, 50),
            bytes([0, 1, 64, 64, 127, 128]),
        )
        self.assertEqual(scale_frame_brightness(frame, 0), bytes(len(frame)))

    def test_clamps_realtime_frame_brightness(self) -> None:
        frame = bytes([20, 200])

        self.assertEqual(scale_frame_brightness(frame, -10), bytes([0, 0]))
        self.assertEqual(scale_frame_brightness(frame, 110), frame)


if __name__ == "__main__":
    unittest.main()
