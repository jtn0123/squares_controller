from __future__ import annotations

import json
import os
import re
import threading
import uuid
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any

MAX_AUTOMATIONS = 64
ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
TIME_PATTERN = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
ACTIONS = {"off", "stock", "brightness", "wake"}


def _identifier(value: Any) -> str:
    if value is None:
        return uuid.uuid4().hex
    if not isinstance(value, str) or not ID_PATTERN.fullmatch(value):
        raise ValueError("Automation IDs may only use letters, numbers, _ and -.")
    return value


def _name(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Automation name is required.")
    cleaned = value.strip()
    if len(cleaned) > 48:
        raise ValueError("Automation name must be 48 characters or fewer.")
    return cleaned


class AutomationStore:
    """Atomic local schedules with claim-once due evaluation."""

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self._lock = threading.RLock()
        self._items = self._load()

    def _load(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as error:
            raise ValueError(f"Could not read automations at {self.path}.") from error
        if not isinstance(raw, dict) or not isinstance(raw.get("automations"), list):
            raise ValueError("Automation file has an invalid format.")
        items = [self._sanitize(item) for item in raw["automations"]]
        if len(items) > MAX_AUTOMATIONS:
            raise ValueError("Automation file exceeds the storage limit.")
        ids = [item["id"] for item in items]
        if len(ids) != len(set(ids)):
            raise ValueError("Automation IDs must be unique.")
        return items

    def _write(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = self.path.with_name(f".{self.path.name}.{uuid.uuid4().hex}.tmp")
        try:
            with temporary_path.open("w", encoding="utf-8") as destination:
                json.dump(
                    {"version": 1, "automations": self._items},
                    destination,
                    ensure_ascii=False,
                    indent=2,
                    sort_keys=True,
                )
                destination.write("\n")
                destination.flush()
                os.fsync(destination.fileno())
            os.replace(temporary_path, self.path)
        finally:
            try:
                temporary_path.unlink()
            except FileNotFoundError:
                pass

    @staticmethod
    def _sanitize(raw: Any) -> dict[str, Any]:
        if not isinstance(raw, dict):
            raise ValueError("Each automation must be a JSON object.")
        action = raw.get("action")
        if action not in ACTIONS:
            raise ValueError("Automation action is invalid.")
        kind = raw.get("kind")
        if kind not in {"once", "daily"}:
            raise ValueError("Automation kind must be once or daily.")
        result: dict[str, Any] = {
            "id": _identifier(raw.get("id")),
            "name": _name(raw.get("name")),
            "enabled": bool(raw.get("enabled", True)),
            "kind": kind,
            "action": action,
            "lastRun": raw.get("lastRun")
            if isinstance(raw.get("lastRun"), str)
            else None,
        }

        if action in {"brightness", "wake"}:
            value = raw.get("value")
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not 1 <= value <= 100
            ):
                raise ValueError("Brightness actions need a value from 1 to 100.")
            result["value"] = round(float(value), 2)

        if kind == "once":
            run_at = raw.get("runAt")
            if not isinstance(run_at, str):
                raise ValueError("Once automation needs a future local date and time.")
            try:
                parsed = datetime.fromisoformat(run_at)
            except ValueError as error:
                raise ValueError(
                    "Once automation needs a future local date and time."
                ) from error
            if parsed.tzinfo is not None:
                raise ValueError("Once automation time must use the controller's local time.")
            result["runAt"] = parsed.isoformat(timespec="minutes")
        else:
            time_value = raw.get("time")
            if not isinstance(time_value, str) or not TIME_PATTERN.fullmatch(time_value):
                raise ValueError("Daily automation time must use HH:MM.")
            raw_days = raw.get("days", list(range(7)))
            if (
                not isinstance(raw_days, list)
                or not raw_days
                or any(
                    isinstance(day, bool)
                    or not isinstance(day, int)
                    or day < 0
                    or day > 6
                    for day in raw_days
                )
            ):
                raise ValueError("Daily automation days must be numbers from 0 to 6.")
            result["time"] = time_value
            result["days"] = sorted(set(raw_days))
        return result

    def snapshot(self) -> list[dict[str, Any]]:
        with self._lock:
            return deepcopy(self._items)

    def upsert(self, raw: Any) -> dict[str, Any]:
        item = self._sanitize(raw)
        with self._lock:
            remaining = [
                existing for existing in self._items if existing["id"] != item["id"]
            ]
            if len(remaining) >= MAX_AUTOMATIONS:
                raise ValueError(
                    f"The controller can hold at most {MAX_AUTOMATIONS} automations."
                )
            self._items = [item, *remaining]
            self._write()
            return deepcopy(item)

    def delete(self, item_id: str) -> bool:
        clean_id = _identifier(item_id)
        with self._lock:
            remaining = [
                item for item in self._items if item["id"] != clean_id
            ]
            if len(remaining) == len(self._items):
                return False
            self._items = remaining
            self._write()
            return True

    def claim_due(self, now: datetime) -> list[dict[str, Any]]:
        if now.tzinfo is not None:
            raise ValueError("Automation checks use local naive datetimes.")
        due: list[dict[str, Any]] = []
        changed = False
        with self._lock:
            for item in self._items:
                if not item["enabled"]:
                    continue
                if item["kind"] == "once":
                    if now >= datetime.fromisoformat(item["runAt"]):
                        item["enabled"] = False
                        item["lastRun"] = now.isoformat(timespec="seconds")
                        due.append(deepcopy(item))
                        changed = True
                    continue
                today = now.date().isoformat()
                scheduled_hour, scheduled_minute = (
                    int(part) for part in item["time"].split(":")
                )
                if (
                    now.weekday() in item["days"]
                    and (now.hour, now.minute)
                    >= (scheduled_hour, scheduled_minute)
                    and item.get("lastRun") != today
                ):
                    item["lastRun"] = today
                    due.append(deepcopy(item))
                    changed = True
            if changed:
                self._write()
        return due
