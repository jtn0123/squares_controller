from __future__ import annotations

import ipaddress
import json
import os
import signal
import sys
import threading
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from src.twinkly_client import TwinklyClient

ROOT = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT / "public"
CONFIG_PATH = Path(os.environ.get("SQUARES_CONFIG", ROOT / "config.json"))
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "4312"))
MAX_BODY_BYTES = 256_000
APP_VERSION = "0.3.0"


def load_device_ip() -> str:
    configured_ip = os.environ.get("TWINKLY_IP")
    if not configured_ip and CONFIG_PATH.exists():
        try:
            config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as error:
            raise ValueError("config.json could not be read.") from error
        configured_ip = config.get("deviceIp")

    if not isinstance(configured_ip, str) or not configured_ip.strip():
        raise ValueError(
            "No panel is configured. Copy config.example.json to config.json "
            "and set deviceIp, or set TWINKLY_IP."
        )

    try:
        address = ipaddress.ip_address(configured_ip.strip())
    except ValueError as error:
        raise ValueError("The configured deviceIp is not a valid IP address.") from error
    if address.version != 4 or not (address.is_private or address.is_link_local):
        raise ValueError("deviceIp must be a private or link-local IPv4 address.")
    return str(address)


try:
    DEVICE_IP = load_device_ip()
    client: TwinklyClient | None = TwinklyClient(DEVICE_IP)
    configuration_error: str | None = None
except ValueError as error:
    DEVICE_IP = None
    client = None
    configuration_error = str(error)


def get_client() -> TwinklyClient:
    if client is None:
        raise ConnectionError(configuration_error or "No panel is configured.")
    return client


class SquaresHandler(SimpleHTTPRequestHandler):
    server_version = f"SquaresController/{APP_VERSION}"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(PUBLIC_DIR), **kwargs)

    def log_message(self, format: str, *args: Any) -> None:
        if self.path.startswith("/api/") and args and str(args[0]).startswith("5"):
            super().log_message(format, *args)

    def send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        response_payload = dict(payload)
        if response_payload.get("connected"):
            response_payload["controllerVersion"] = APP_VERSION
        body = json.dumps(response_payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict[str, Any]:
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0]
        if content_type.strip().lower() != "application/json":
            raise ValueError("Content-Type must be application/json.")
        length = int(self.headers.get("Content-Length", "0"))
        if length < 0:
            raise ValueError("Content-Length cannot be negative.")
        if length > MAX_BODY_BYTES:
            raise ValueError("Request body is too large.")
        if length == 0:
            return {}
        try:
            return json.loads(self.rfile.read(length))
        except json.JSONDecodeError as error:
            raise ValueError("Request body must be valid JSON.") from error

    def do_GET(self) -> None:
        if self.path == "/api/status":
            try:
                status = get_client().refresh_status()
                self.send_json(HTTPStatus.OK, status)
            except (ConnectionError, KeyError, ValueError) as error:
                self.send_json(
                    HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)}
                )
            return
        super().do_GET()

    def do_POST(self) -> None:
        try:
            body = self.read_json()
            if self.path == "/api/frame":
                raw_pixels = body.get("pixels")
                if not isinstance(raw_pixels, list):
                    raise ValueError("Frame pixels are missing.")
                pixels = bytes(
                    max(0, min(255, round(float(value)))) for value in raw_pixels
                )
                result = get_client().set_raster_frame(
                    pixels, int(body["width"]), int(body["height"])
                )
            elif self.path == "/api/brightness":
                result = get_client().set_brightness(body["value"])
            elif self.path == "/api/rotation":
                result = get_client().set_rotation(body["degrees"])
            elif self.path == "/api/mode":
                result = get_client().set_mode(str(body["mode"]))
            else:
                self.send_json(
                    HTTPStatus.NOT_FOUND, {"error": "Unknown API route."}
                )
                return
            self.send_json(HTTPStatus.OK, result)
        except (
            ConnectionError,
            KeyError,
            OverflowError,
            TypeError,
            ValueError,
        ) as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})


server = ThreadingHTTPServer((HOST, PORT), SquaresHandler)
shutting_down = threading.Event()


def shutdown(signum: int, _frame: Any) -> None:
    if shutting_down.is_set():
        return
    shutting_down.set()
    signal_name = signal.Signals(signum).name
    print(f"\n{signal_name}: returning Squares to its saved animation...")
    threading.Thread(target=server.shutdown, daemon=True).start()


signal.signal(signal.SIGINT, shutdown)
signal.signal(signal.SIGTERM, shutdown)

print(f"Squares Local is available at http://{HOST}:{PORT}")
if client is None:
    print(f"Configuration needed: {configuration_error}", file=sys.stderr)
else:
    print(f"Connecting to {DEVICE_IP}...")
    try:
        status = client.connect()
        print(
            f"Connected: {status['width']}x{status['height']}, "
            f"{status['ledCount']} LEDs, firmware {status['firmware']}"
        )
    except (ConnectionError, KeyError, ValueError) as error:
        print(f"Initial connection failed: {error}", file=sys.stderr)
        print("The web interface will retry when opened.", file=sys.stderr)

try:
    server.serve_forever()
finally:
    if client is not None:
        client.close()
    server.server_close()
