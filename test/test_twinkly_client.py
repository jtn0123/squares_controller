import base64
import time
import unittest
from unittest.mock import Mock, patch

from src.twinkly_client import TwinklyClient
from src.twinkly_protocol import (
    Layout,
    TwinklyHTTPError,
    build_realtime_packets,
    calculate_layout,
    choose_stream_fps,
    next_stream_deadline,
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


class TwinklyClientTests(unittest.TestCase):
    def test_relay_keeps_headroom_below_measured_panel_rate(self) -> None:
        device = {"frame_rate": 40, "measured_frame_rate": 38.46}

        self.assertEqual(choose_stream_fps(device), 37.5)
        self.assertAlmostEqual(stream_interval_seconds(device), 1 / 37.5)

    def test_relay_respects_slower_device_measurement(self) -> None:
        device = {"frame_rate": 25, "measured_frame_rate": 23.26}

        self.assertEqual(choose_stream_fps(device), 23.26)

    def test_relay_skips_missed_deadlines_without_bursting(self) -> None:
        interval = 1 / 37.5
        self.assertAlmostEqual(next_stream_deadline(1.0, 1.01, interval), 1.0 + interval)
        self.assertAlmostEqual(
            next_stream_deadline(1.0, 1.04, interval),
            1.04 + interval,
        )

    @staticmethod
    def connected_client() -> TwinklyClient:
        client = TwinklyClient("192.168.1.100")
        client.device = {
            "device_name": "Test Squares",
            "product_code": "TST",
            "frame_rate": 25,
            "measured_frame_rate": 23.26,
        }
        client.firmware = "2.9.1"
        client.layout = Layout(1, 1, 1, (0,))
        client.mode = "movie"
        client.brightness = 100
        return client

    def test_status_exposes_advertised_measured_and_relay_rates(self) -> None:
        client = self.connected_client()
        status = client.status()

        self.assertEqual(status["frameRate"], 25)
        self.assertEqual(status["measuredFrameRate"], 23.26)
        self.assertEqual(status["streamTargetFps"], 23.26)
        client.close(restore_movie=False)

    def test_refresh_status_exposes_the_active_controller_movie(self) -> None:
        client = self.connected_client()

        def request(path, **_kwargs):
            if path == "/led/mode":
                return {"mode": "movie"}
            if path == "/led/out/brightness":
                return {"value": 24}
            if path == "/led/movies/current":
                raise TwinklyHTTPError("/led/movies/current", 404)
            if path == "/movies/current":
                return {
                    "id": 14,
                    "name": "Color Plasma",
                    "unique_id": "movie-14",
                }
            raise AssertionError(f"Unexpected request: {path}")

        with patch.object(client, "request", side_effect=request):
            status = client.refresh_status()

        self.assertEqual(
            status["currentMovie"],
            {
                "id": 14,
                "name": "Color Plasma",
                "unique_id": "movie-14",
            },
        )
        client.close(restore_movie=False)

    def test_non_movie_status_clears_a_stale_controller_movie(self) -> None:
        client = self.connected_client()
        client.current_movie = {"id": 14, "name": "Color Plasma"}

        def request(path, **_kwargs):
            if path == "/led/mode":
                return {"mode": "off"}
            if path == "/led/out/brightness":
                return {"value": 24}
            raise AssertionError(f"Unexpected request: {path}")

        with patch.object(client, "request", side_effect=request):
            status = client.refresh_status()

        self.assertIsNone(status["currentMovie"])
        client.close(restore_movie=False)

    def test_missing_current_movie_endpoint_keeps_status_available(self) -> None:
        client = self.connected_client()

        def request(path, **_kwargs):
            if path == "/led/mode":
                return {"mode": "movie"}
            if path == "/led/out/brightness":
                return {"value": 24}
            if path in {"/led/movies/current", "/movies/current"}:
                raise TwinklyHTTPError(path, 404)
            raise AssertionError(f"Unexpected request: {path}")

        with patch.object(client, "request", side_effect=request):
            status = client.refresh_status()

        self.assertEqual(status["mode"], "movie")
        self.assertIsNone(status["currentMovie"])
        client.close(restore_movie=False)

    def test_stream_telemetry_separates_unique_and_repeated_frames(self) -> None:
        client = self.connected_client()
        client._record_stream_delivery(1.000, 0.999, 7)
        client._record_stream_delivery(1.028, 1.026, 7)
        client._record_stream_delivery(1.055, 1.053, 8)

        telemetry = client.stream_telemetry()

        self.assertEqual(telemetry["sentFrames"], 3)
        self.assertEqual(telemetry["uniqueFrames"], 2)
        self.assertEqual(telemetry["repeatedFrames"], 1)
        self.assertEqual(telemetry["lateFrames"], 2)
        self.assertEqual(telemetry["missedDeadlines"], 0)
        self.assertAlmostEqual(telemetry["actualFps"], 36.36, places=2)
        self.assertEqual(telemetry["maxGapMs"], 28.0)
        client.close(restore_movie=False)

    def test_stream_telemetry_counts_full_deadline_misses(self) -> None:
        client = self.connected_client()
        interval = stream_interval_seconds(client.device)
        client._record_stream_delivery(2.0, 2.0 - interval - 0.001, 1)

        telemetry = client.stream_telemetry()

        self.assertEqual(telemetry["missedDeadlines"], 1)
        client.close(restore_movie=False)

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

    def test_bakes_additive_controller_movie_without_overwriting_library(self) -> None:
        client = self.connected_client()
        client.layout = Layout(2, 1, 2, (1, 0))
        client.device["number_of_led"] = 2
        client.device["frame_rate"] = 40
        client.device["measured_frame_rate"] = 38.46
        client.brightness = 24
        frames = bytes(
            [
                255, 0, 0, 0, 0, 255,
                0, 255, 0, 255, 255, 0,
            ]
        )
        before = {
            "movies": [{"id": 0, "name": "STOCK"}],
            "available_frames": 100,
            "max_capacity": 100,
        }
        after = {
            "movies": [
                {"id": 0, "name": "STOCK"},
                {"id": 1, "name": "CODEX LOOP", "unique_id": "new-id"},
            ],
            "available_frames": 98,
            "max_capacity": 100,
        }

        def request(path, **kwargs):
            if path == "/movies" and request.movie_reads == 0:
                request.movie_reads += 1
                return before
            if path == "/movies":
                return after
            if path == "/movies/new":
                body = kwargs["body"]
                after["movies"][1]["unique_id"] = body["unique_id"]
                return {"code": 1000}
            return {"code": 1000}

        request.movie_reads = 0
        with (
            patch.object(client, "request", side_effect=request) as api_request,
            patch.object(
                client, "_request_bytes", return_value={"code": 1000}
            ) as upload,
        ):
            result = client.bake_movie(
                "Codex Loop",
                frames,
                width=2,
                height=1,
                frame_count=2,
                fps=38,
            )

        create_call = next(
            call for call in api_request.call_args_list
            if call.args[0] == "/movies/new"
        )
        self.assertEqual(create_call.kwargs["body"]["descriptor_type"], "rgb_raw")
        self.assertEqual(create_call.kwargs["body"]["fps"], 38)
        upload.assert_called_once_with(
            "/movies/full",
            bytes([0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 0]),
        )
        self.assertEqual(result["bakedMovie"]["id"], 1)
        self.assertEqual(result["status"]["mode"], "movie")
        client.close(restore_movie=False)

    def test_rejects_movie_larger_than_free_controller_capacity(self) -> None:
        client = self.connected_client()
        with patch.object(
            client,
            "request",
            return_value={
                "movies": [],
                "available_frames": 1,
                "max_capacity": 100,
            },
        ):
            with self.assertRaisesRegex(ValueError, "available movie frames"):
                client.bake_movie(
                    "Too Long",
                    bytes([0, 0, 0, 1, 1, 1]),
                    width=1,
                    height=1,
                    frame_count=2,
                    fps=38,
                )
        client.close(restore_movie=False)

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

    def test_mode_change_serializes_against_concurrent_frames(self) -> None:
        import threading

        client = self.connected_client()
        client.layout = Layout(2, 1, 2, (0, 1))
        client.token = base64.b64encode(b"12345678").decode("ascii")
        client.token_created_at = time.monotonic()
        client._socket.close()
        client._socket = type(
            "NullSocket",
            (),
            {"sendto": lambda _self, _packet, _address: None,
             "close": lambda _self: None},
        )()

        def slow_request(path, **_kwargs):
            if path == "/led/mode":
                time.sleep(0.08)
            return {}

        with patch.object(client, "request", side_effect=slow_request):
            mode_thread = threading.Thread(
                target=lambda: client.set_mode("movie")
            )
            mode_thread.start()
            time.sleep(0.02)
            # A frame arriving mid-transition must wait for the mode change
            # instead of restarting the stream underneath it.
            client.set_raster_frame(bytes(6), 2, 1)
            mode_thread.join(timeout=2)

            status = client.status()
            self.assertFalse(
                status["mode"] == "movie" and status["streaming"],
                "mode reports stock playback while the relay is streaming",
            )
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
