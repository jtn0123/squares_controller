"""Maps stored automation items onto controller commands."""

from __future__ import annotations

from typing import Any

from src.automation_store import ACTIONS
from src.command_api import ControllerClient


def run_automation(
    client: ControllerClient, item: dict[str, Any]
) -> dict[str, Any]:
    action = item.get("action")
    if action not in ACTIONS:
        raise ValueError(f"Unknown automation action: {action}")
    if action == "off":
        return client.set_mode("off")
    if action == "stock":
        return client.set_mode("movie")
    if action == "brightness":
        return client.set_brightness(item["value"])
    # "wake": restore the stock animation, then apply the stored brightness.
    client.set_mode("movie")
    return client.set_brightness(item["value"])
