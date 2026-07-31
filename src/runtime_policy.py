from __future__ import annotations

import json
import os
import threading
import uuid
from copy import deepcopy
from pathlib import Path
from typing import Any

DEFAULT_POLICY = {
    "startupAction": "unchanged",
    "frameLossAction": "hold",
    "frameLossSeconds": 10,
}
STARTUP_ACTIONS = {"unchanged", "stock", "off"}
FRAME_LOSS_ACTIONS = {"hold", "stock", "off"}


def _normalize(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("Runtime policy must be a JSON object.")
    startup = raw.get("startupAction", DEFAULT_POLICY["startupAction"])
    frame_loss = raw.get("frameLossAction", DEFAULT_POLICY["frameLossAction"])
    if startup not in STARTUP_ACTIONS:
        raise ValueError("Runtime startup action is invalid.")
    if frame_loss not in FRAME_LOSS_ACTIONS:
        raise ValueError("Runtime frame-loss action is invalid.")
    seconds = max(
        3,
        min(
            120,
            round(
                float(
                    raw.get(
                        "frameLossSeconds",
                        DEFAULT_POLICY["frameLossSeconds"],
                    )
                )
            ),
        ),
    )
    return {
        "startupAction": startup,
        "frameLossAction": frame_loss,
        "frameLossSeconds": seconds,
    }


def panel_mode_for_action(action: str) -> str | None:
    return {"stock": "movie", "off": "off"}.get(action)


class RuntimePolicyStore:
    """Atomic local policy for startup and stale browser frames."""

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self._lock = threading.RLock()
        self._policy = self._load()

    def _load(self) -> dict[str, Any]:
        if not self.path.exists():
            return deepcopy(DEFAULT_POLICY)
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as error:
            raise ValueError(
                f"Could not read runtime policy at {self.path}."
            ) from error
        return _normalize(raw)

    def _write(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_name(
            f".{self.path.name}.{uuid.uuid4().hex}.tmp"
        )
        try:
            with temporary.open("w", encoding="utf-8") as destination:
                json.dump(
                    self._policy,
                    destination,
                    ensure_ascii=False,
                    indent=2,
                    sort_keys=True,
                )
                destination.write("\n")
                destination.flush()
                os.fsync(destination.fileno())
            os.replace(temporary, self.path)
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return deepcopy(self._policy)

    def update(self, raw: Any) -> dict[str, Any]:
        with self._lock:
            self._policy = _normalize({**self._policy, **raw})
            self._write()
            return deepcopy(self._policy)


class FrameActivity:
    """Claims one frame-loss action per gap between browser frames."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._last_frame_at: float | None = None
        self._claimed = False

    def note(self, now: float) -> None:
        with self._lock:
            self._last_frame_at = now
            self._claimed = False

    def claim_stale_action(
        self, policy: dict[str, Any], now: float
    ) -> str | None:
        with self._lock:
            action = str(policy.get("frameLossAction", "hold"))
            seconds = float(policy.get("frameLossSeconds", 10))
            if (
                action == "hold"
                or self._last_frame_at is None
                or self._claimed
                or now - self._last_frame_at < seconds
            ):
                return None
            self._claimed = True
            return action
