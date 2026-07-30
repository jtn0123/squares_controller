from __future__ import annotations

from typing import Any, Protocol

API_VERSION = "1.0"
ACTIONS = ["status", "mode", "brightness", "rotation", "frame"]


class ControllerClient(Protocol):
    def refresh_status(self) -> dict[str, Any]: ...

    def set_mode(self, mode: str) -> dict[str, Any]: ...

    def set_brightness(self, value: float) -> dict[str, Any]: ...

    def set_rotation(self, degrees: int) -> dict[str, Any]: ...

    def set_raster_frame(
        self, pixels: bytes, width: int, height: int
    ) -> dict[str, Any]: ...


def validate_bind_security(
    host: str, *, allow_unauthenticated_lan: bool
) -> None:
    if host.strip().lower() in {"127.0.0.1", "::1", "localhost"}:
        return
    if allow_unauthenticated_lan:
        return
    raise ValueError(
        "Refusing to bind beyond loopback without explicit opt-in. "
        "Set ALLOW_UNAUTHENTICATED_LAN=1 only on a trusted network."
    )


def capability_payload() -> dict[str, Any]:
    return {
        "apiVersion": API_VERSION,
        "actions": ACTIONS,
        "commandEndpoint": "/api/v1/command",
        "stateEndpoint": "/api/v1/state",
        "healthEndpoint": "/api/v1/health",
        "eventStream": "/api/events (text/event-stream)",
        "openApiDocument": "/openapi.json",
        "authentication": "none; loopback-only by default",
    }


def execute_command(
    client: ControllerClient, payload: Any
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Command body must be a JSON object.")
    action = payload.get("action")
    if action == "status":
        return client.refresh_status()
    if action == "mode":
        mode = payload.get("mode")
        if mode not in {"off", "movie"}:
            raise ValueError("Mode must be off or movie.")
        return client.set_mode(mode)
    if action == "brightness":
        value = payload.get("value")
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not 1 <= value <= 100
        ):
            raise ValueError("Brightness must be from 1 to 100.")
        return client.set_brightness(float(value))
    if action == "rotation":
        degrees = payload.get("degrees")
        if (
            isinstance(degrees, bool)
            or not isinstance(degrees, (int, float))
            or int(degrees) != degrees
            or int(degrees) not in {0, 90, 180, 270}
        ):
            raise ValueError("Rotation must be 0, 90, 180, or 270.")
        return client.set_rotation(int(degrees))
    if action == "frame":
        width = payload.get("width")
        height = payload.get("height")
        raw_pixels = payload.get("pixels")
        if (
            isinstance(width, bool)
            or not isinstance(width, int)
            or isinstance(height, bool)
            or not isinstance(height, int)
            or width < 1
            or height < 1
        ):
            raise ValueError("Frame dimensions must be positive whole numbers.")
        if not isinstance(raw_pixels, list):
            raise ValueError("Frame pixels are missing.")
        expected = width * height * 3
        if len(raw_pixels) != expected:
            raise ValueError(f"Expected {expected} RGB values.")
        try:
            pixels = bytes(
                max(0, min(255, round(float(value)))) for value in raw_pixels
            )
        except (OverflowError, TypeError, ValueError) as error:
            raise ValueError("Frame pixels must be numeric RGB values.") from error
        return client.set_raster_frame(pixels, width, height)
    raise ValueError(f"Unknown command action: {action}")
