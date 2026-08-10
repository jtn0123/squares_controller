import unittest
from unittest.mock import Mock

from src.command_api import (
    API_VERSION,
    capability_payload,
    execute_command,
    validate_bind_security,
)


class CommandApiTests(unittest.TestCase):
    def test_dispatches_supported_device_commands(self) -> None:
        client = Mock()
        client.refresh_status.return_value = {"connected": True}
        client.set_brightness.return_value = {"brightness": 18}
        client.set_rotation.return_value = {"rotation": 90}
        client.set_mode.return_value = {"mode": "off"}

        self.assertEqual(execute_command(client, {"action": "status"}), {"connected": True})
        self.assertEqual(
            execute_command(client, {"action": "brightness", "value": 18}),
            {"brightness": 18},
        )
        self.assertEqual(
            execute_command(client, {"action": "rotation", "degrees": 90}),
            {"rotation": 90},
        )
        self.assertEqual(
            execute_command(client, {"action": "mode", "mode": "off"}),
            {"mode": "off"},
        )
        client.set_brightness.assert_called_once_with(18.0)
        client.set_rotation.assert_called_once_with(90)
        client.set_mode.assert_called_once_with("off")

    def test_validates_frame_commands_before_dispatch(self) -> None:
        client = Mock()
        client.set_raster_frame.return_value = {"streaming": True}
        pixels = [255, 0, 0, 0, 0, 255]

        self.assertEqual(
            execute_command(
                client,
                {"action": "frame", "width": 2, "height": 1, "pixels": pixels},
            ),
            {"streaming": True},
        )
        client.set_raster_frame.assert_called_once_with(bytes(pixels), 2, 1)

        with self.assertRaisesRegex(ValueError, "Expected 6 RGB values"):
            execute_command(
                client,
                {"action": "frame", "width": 2, "height": 1, "pixels": [1, 2, 3]},
            )

    def test_rejects_unknown_or_out_of_range_commands(self) -> None:
        client = Mock()
        with self.assertRaisesRegex(ValueError, "Unknown command"):
            execute_command(client, {"action": "launch"})
        with self.assertRaisesRegex(ValueError, "1 to 100"):
            execute_command(client, {"action": "brightness", "value": 0})

    def test_describes_the_versioned_json_surface(self) -> None:
        payload = capability_payload()
        self.assertEqual(payload["apiVersion"], API_VERSION)
        self.assertEqual(
            payload["actions"],
            ["status", "mode", "brightness", "rotation", "frame", "movie"],
        )
        self.assertIn("text/event-stream", payload["eventStream"])

    def test_requires_explicit_opt_in_for_non_loopback_binding(self) -> None:
        validate_bind_security("127.0.0.1", allow_unauthenticated_lan=False)
        validate_bind_security("::1", allow_unauthenticated_lan=False)
        validate_bind_security("0.0.0.0", allow_unauthenticated_lan=True)
        with self.assertRaisesRegex(ValueError, "ALLOW_UNAUTHENTICATED_LAN"):
            validate_bind_security("0.0.0.0", allow_unauthenticated_lan=False)


if __name__ == "__main__":
    unittest.main()
