from __future__ import annotations

import copy
import json
import threading
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class StateEvent:
    version: int
    source: str
    payload: dict[str, Any]


# Monotonically increasing counters would defeat deduplication: two statuses
# that differ only in telemetry are the same state as far as the UI cares.
VOLATILE_STATUS_KEYS = frozenset({"streamTelemetry"})


class StateBroker:
    """Thread-safe, deduplicated state fan-out for browser clients."""

    def __init__(self) -> None:
        self._condition = threading.Condition()
        self._event: StateEvent | None = None
        self._fingerprint: str | None = None

    def publish(self, payload: dict[str, Any], source: str) -> StateEvent:
        event_payload = copy.deepcopy(payload)
        fingerprint = json.dumps(
            {
                "source": source,
                "payload": {
                    key: value
                    for key, value in event_payload.items()
                    if key not in VOLATILE_STATUS_KEYS
                },
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        with self._condition:
            if self._event is not None and fingerprint == self._fingerprint:
                return self._event
            version = 1 if self._event is None else self._event.version + 1
            self._event = StateEvent(version, source, event_payload)
            self._fingerprint = fingerprint
            self._condition.notify_all()
            return self._event

    def current(self) -> StateEvent | None:
        with self._condition:
            return self._event

    def wait_after(self, version: int, timeout: float) -> StateEvent | None:
        with self._condition:
            changed = self._condition.wait_for(
                lambda: self._event is not None
                and self._event.version > version,
                timeout=timeout,
            )
            return self._event if changed else None
