import base64
import time
import unittest
from unittest.mock import Mock, patch

from src.twinkly_client import (
    Layout,
    TwinklyClient,
    build_realtime_packets,
    calculate_layout,
    oriented_dimensions,
    oriented_raster_to_device_frame,
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
    @staticmethod
    def connected_client() -> TwinklyClient:
        client = TwinklyClient("192.168.1.100")
        client.device = {
            "device_name": "Test Squares",
            "product_code": "TST",
            "frame_rate": 25,
        }
        client.firmware = "2.9.1"
        client.layout = Layout(1, 1, 1, (0,))
        client.mode = "movie"
        client.brightness = 100
        return client

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

    def test_streaming_brightness_stays_in_software(self) -> None:
        client = self.connected_client()
        stream_thread = Mock()
        stream_thread.is_alive.return_value = True
        client._stream_thread = stream_thread

        with patch.object(client, "request") as request:
            status = client.set_brightness(17)

        request.assert_not_called()
        self.assertEqual(status["brightness"], 17)
        self.assertEqual(status["brightnessControl"], "realtime-rgb")
        client.close(restore_movie=False)

    def test_stock_mode_brightness_uses_device_endpoint(self) -> None:
        client = self.connected_client()

        with patch.object(client, "request", return_value={}) as request:
            status = client.set_brightness(42)

        request.assert_called_once_with(
            "/led/out/brightness",
            method="POST",
            body={"mode": "enabled", "type": "A", "value": 42},
        )
        self.assertEqual(status["brightness"], 42)
        self.assertEqual(status["brightnessControl"], "device")
        client.close(restore_movie=False)


if __name__ == "__main__":
    unittest.main()
