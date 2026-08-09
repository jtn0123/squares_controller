"""Entry point for the Squares controller.

Reads configuration, builds the application context, and runs the HTTP
server plus background loops. All request handling lives in
`src.http_api`; importing this module has no side effects, so tests can
reuse `load_device_ip` and `build_context` freely.
"""

from __future__ import annotations

import ipaddress
import json
import os
import signal
import sys
import threading
from pathlib import Path
from typing import Any

from src.automation_store import AutomationStore
from src.background import automation_loop, execute_runtime_action, frame_loss_loop
from src.command_api import validate_bind_security
from src.http_api import AppContext, SquaresHandler, SquaresServer
from src.library_store import LibraryStore
from src.runtime_policy import (
    FrameActivity,
    RuntimePolicyStore,
    panel_mode_for_action,
)
from src.state_broker import StateBroker
from src.store_recovery import load_store_with_recovery
from src.twinkly_client import TwinklyClient

ROOT = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT / "public"
CONFIG_PATH = Path(os.environ.get("SQUARES_CONFIG", ROOT / "config.json"))
LIBRARY_PATH = Path(
    os.environ.get("SQUARES_LIBRARY", ROOT / ".squares" / "library.json")
)
AUTOMATION_PATH = Path(
    os.environ.get("SQUARES_AUTOMATIONS", ROOT / ".squares" / "automations.json")
)
RUNTIME_POLICY_PATH = Path(
    os.environ.get("SQUARES_RUNTIME_POLICY", ROOT / ".squares" / "runtime.json")
)
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "4312"))
ALLOW_UNAUTHENTICATED_LAN = (
    os.environ.get("ALLOW_UNAUTHENTICATED_LAN", "0") == "1"
)
APP_VERSION = "0.11.0"


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


def build_context() -> AppContext:
    storage_warnings: list[str] = []
    library_store = load_store_with_recovery(
        LibraryStore, LIBRARY_PATH, "Scene library", storage_warnings
    )
    automation_store = load_store_with_recovery(
        AutomationStore, AUTOMATION_PATH, "Automations", storage_warnings
    )
    runtime_policy_store = load_store_with_recovery(
        RuntimePolicyStore, RUNTIME_POLICY_PATH, "Runtime policy", storage_warnings
    )
    for warning in storage_warnings:
        print(f"Storage warning: {warning}", file=sys.stderr)

    client: TwinklyClient | None
    configuration_error: str | None
    try:
        client = TwinklyClient(load_device_ip())
        configuration_error = None
    except ValueError as error:
        client = None
        configuration_error = str(error)

    return AppContext(
        public_dir=PUBLIC_DIR,
        app_version=APP_VERSION,
        state_broker=StateBroker(),
        library_store=library_store,
        automation_store=automation_store,
        runtime_policy_store=runtime_policy_store,
        frame_activity=FrameActivity(),
        shutting_down=threading.Event(),
        client=client,
        configuration_error=configuration_error,
        storage_warnings=storage_warnings,
    )


def connect_at_startup(ctx: AppContext) -> None:
    client = ctx.client
    assert client is not None
    print(f"Connecting to {client.ip}...")
    try:
        status = client.connect()
        startup_action = ctx.runtime_policy_store.snapshot()["startupAction"]
        startup_mode = panel_mode_for_action(startup_action)
        if startup_mode is not None and startup_mode != status["mode"]:
            execute_runtime_action(ctx, startup_action, "runtime:startup")
            status = client.status()
        print(
            f"Connected: {status['width']}x{status['height']}, "
            f"{status['ledCount']} LEDs, firmware {status['firmware']}"
        )
    except (ConnectionError, KeyError, ValueError) as error:
        print(f"Initial connection failed: {error}", file=sys.stderr)
        print("The web interface will retry when opened.", file=sys.stderr)


def main() -> None:
    validate_bind_security(
        HOST,
        allow_unauthenticated_lan=ALLOW_UNAUTHENTICATED_LAN,
    )
    ctx = build_context()
    server = SquaresServer((HOST, PORT), SquaresHandler, ctx)

    def shutdown(signum: int, _frame: Any) -> None:
        if ctx.shutting_down.is_set():
            return
        ctx.shutting_down.set()
        signal_name = signal.Signals(signum).name
        print(f"\n{signal_name}: returning Squares to its saved animation...")
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    print(f"Squares Local is available at http://{HOST}:{PORT}")
    if ctx.client is None:
        print(f"Configuration needed: {ctx.configuration_error}", file=sys.stderr)
    else:
        connect_at_startup(ctx)

    threading.Thread(
        target=automation_loop,
        args=(ctx,),
        name="squares-automation",
        daemon=True,
    ).start()
    threading.Thread(
        target=frame_loss_loop,
        args=(ctx,),
        name="squares-frame-loss",
        daemon=True,
    ).start()

    try:
        server.serve_forever()
    finally:
        if ctx.client is not None:
            ctx.client.close()
        server.server_close()


if __name__ == "__main__":
    main()
