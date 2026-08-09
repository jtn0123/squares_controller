"""Background loops: scheduled automations and frame-loss policy."""

from __future__ import annotations

import sys
import time
from datetime import datetime

from src.automation_runner import run_automation
from src.http_api import AppContext
from src.runtime_policy import panel_mode_for_action

AUTOMATION_POLL_SECONDS = 5
FRAME_LOSS_POLL_SECONDS = 0.5


def execute_runtime_action(ctx: AppContext, action: str, source: str) -> None:
    mode = panel_mode_for_action(action)
    if mode is None:
        return
    result = ctx.get_client().set_mode(mode)
    ctx.publish(result, source)


def automation_loop(ctx: AppContext) -> None:
    while not ctx.shutting_down.wait(AUTOMATION_POLL_SECONDS):
        try:
            due = ctx.automation_store.claim_due(datetime.now())
        except (OSError, ValueError) as error:
            print(f"Automation check failed: {error}", file=sys.stderr)
            continue
        for item in due:
            try:
                result = run_automation(ctx.get_client(), item)
                ctx.publish(result, "automation")
                print(f"Automation ran: {item['name']}")
            except (KeyError, OSError, ValueError) as error:
                print(
                    f"Automation failed ({item['name']}): {error}",
                    file=sys.stderr,
                )


def frame_loss_loop(ctx: AppContext) -> None:
    while not ctx.shutting_down.wait(FRAME_LOSS_POLL_SECONDS):
        try:
            with ctx.frame_mode_lock:
                action = ctx.frame_activity.claim_stale_action(
                    ctx.runtime_policy_store.snapshot(),
                    time.monotonic(),
                )
                if action is None:
                    continue
                execute_runtime_action(ctx, action, "runtime:frame-loss")
            print(f"Frame-loss policy ran: {action}")
        except (KeyError, OSError, ValueError) as error:
            print(f"Frame-loss policy failed: {error}", file=sys.stderr)
