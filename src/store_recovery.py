"""Boot-time recovery for corrupt persistence files.

A truncated or hand-mangled JSON file must never keep the server from
starting: the bad file is quarantined next to the original and the store
starts from defaults, with a warning surfaced through /api/v1/health.
"""

from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from typing import Callable, TypeVar

StoreT = TypeVar("StoreT")


def quarantine_corrupt_file(path: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    quarantine = path.with_name(f"{path.name}.corrupt.{stamp}")
    counter = 0
    while quarantine.exists():
        counter += 1
        quarantine = path.with_name(f"{path.name}.corrupt.{stamp}.{counter}")
    os.replace(path, quarantine)
    return quarantine


def load_store_with_recovery(
    factory: Callable[[Path], StoreT],
    path: Path,
    label: str,
    warnings: list[str],
) -> StoreT:
    try:
        return factory(path)
    except (OSError, ValueError) as error:
        quarantine = quarantine_corrupt_file(path)
        warnings.append(
            f"{label} was unreadable and has been moved to "
            f"{quarantine.name}; starting with defaults. ({error})"
        )
        return factory(path)
