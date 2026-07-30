import base64
import time
import unittest
from unittest.mock import patch

from src.twinkly_client import (
    Layout,
    TwinklyClient,
    build_realtime_packets,
    calculate_layout,
    raster_to_device_frame,
    scale_frame_brightness,
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


class TwinklyClientTests(unittest.TestCase):
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

    def test_splits_768_pixel_frame_into_protocol_v3_fragments(self) -> None:
        token = base64.b64encode(b"12345678").decode("ascii")
        packets = build_realtime_packets(token, bytes([42]) * (768 * 3))
        self.assertEqual([len(packet) for packet in packets], [912, 912, 516])
        self.assertEqual([packet[11] for packet in packets], [0, 1, 2])
        self.assertEqual(packets[0][0], 0x03)

    def test_rejects_frame_with_wrong_number_of_channels(self) -> None:
        with self.assertRaisesRegex(ValueError, "Expected 6 RGB values"):
            raster_to_device_frame(
                bytes([0, 0, 0]), Layout(2, 1, 2, (0, 1))
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

    def test_applies_brightness_before_realtime_packetization(self) -> None:
        client = TwinklyClient("192.168.1.100")
        client.token = base64.b64encode(b"12345678").decode("ascii")
        client.token_created_at = time.monotonic()
        client.last_frame = bytes([10, 100, 255])
        client.brightness = 50
        sent_packets: list[bytes] = []
        client._socket.close()
        client._socket = type(
            "RecordingSocket",
            (),
            {"sendto": lambda _self, packet, _address: sent_packets.append(packet)},
        )()

        with patch(
            "src.twinkly_client.build_realtime_packets",
            side_effect=lambda _token, frame: [frame],
        ):
            client._send_last_frame()

        self.assertEqual(sent_packets, [bytes([5, 50, 128])])


if __name__ == "__main__":
    unittest.main()
