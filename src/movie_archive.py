"""Local copies of movies this app baked onto the controller.

The controller will not give frame data back — every read path returns
404 — so a movie that only exists on the panel is write-only: it cannot
be previewed, exported, or restored after an erase. Keeping the source
frames here at bake time is what makes those things possible.

Entries are plain JSON so they can be handed to a browser for download
and handed back later unchanged. Writes are atomic, matching the other
stores: a half-written archive is worse than none, because it would
look restorable and not be.
"""

from __future__ import annotations

import base64
import json
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any

ARCHIVE_VERSION = 1
SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
# One frame of a 32x24 wall is 2,304 bytes; a 600-frame movie is ~1.4 MB
# before base64. Keep a ceiling so a malformed import cannot exhaust disk.
MAX_PIXEL_BYTES = 8_000_000


class MovieArchive:
    """Baked movies kept on this machine so they can come back."""

    def __init__(self, directory: Path) -> None:
        self.directory = directory

    def _path(self, archive_id: str) -> Path:
        if not SAFE_ID.match(archive_id):
            raise ValueError("Archive id contains unsupported characters.")
        return self.directory / f"{archive_id}.json"

    def save(
        self,
        *,
        name: str,
        pixels: bytes,
        width: int,
        height: int,
        frame_count: int,
        fps: int,
        gamma: float,
        saturation: float,
        device_movie_id: int | None = None,
    ) -> dict[str, Any]:
        """Store the pre-correction source frames and how to rebuild."""
        if len(pixels) > MAX_PIXEL_BYTES:
            raise ValueError("Movie is too large to archive.")
        expected = width * height * 3 * frame_count
        if len(pixels) != expected:
            raise ValueError(
                f"Expected {expected} RGB bytes; received {len(pixels)}."
            )
        archive_id = uuid.uuid4().hex[:16]
        entry = {
            "archiveVersion": ARCHIVE_VERSION,
            "id": archive_id,
            "name": name,
            "width": width,
            "height": height,
            "frameCount": frame_count,
            "fps": fps,
            "gamma": gamma,
            "saturation": saturation,
            "deviceMovieId": device_movie_id,
            "savedAt": int(time.time()),
            # Source frames, before colour correction: restoring re-runs
            # the same pipeline, so a later correction change is picked
            # up rather than baked in twice.
            "pixelsBase64": base64.b64encode(pixels).decode("ascii"),
        }
        self._write(self._path(archive_id), entry)
        return self.describe(entry)

    def _write(self, path: Path, entry: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        with temporary.open("w", encoding="utf-8") as handle:
            json.dump(entry, handle, separators=(",", ":"))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)

    @staticmethod
    def describe(entry: dict[str, Any]) -> dict[str, Any]:
        """Metadata plus one thumbnail frame — never the whole movie."""
        width = int(entry["width"])
        height = int(entry["height"])
        frame_bytes = width * height * 3
        pixels = base64.b64decode(entry["pixelsBase64"])
        return {
            "id": entry["id"],
            "name": entry["name"],
            "width": width,
            "height": height,
            "frameCount": int(entry["frameCount"]),
            "fps": int(entry["fps"]),
            "savedAt": int(entry.get("savedAt", 0)),
            "deviceMovieId": entry.get("deviceMovieId"),
            "thumbnailBase64": base64.b64encode(
                pixels[:frame_bytes]
            ).decode("ascii"),
        }

    def read(self, archive_id: str) -> dict[str, Any]:
        path = self._path(archive_id)
        if not path.exists():
            raise KeyError(archive_id)
        entry: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
        return entry

    def snapshot(self) -> list[dict[str, Any]]:
        """Every archived movie, newest first, without the frame data."""
        entries: list[dict[str, Any]] = []
        if not self.directory.exists():
            return entries
        for path in sorted(self.directory.glob("*.json")):
            try:
                entries.append(
                    self.describe(json.loads(path.read_text(encoding="utf-8")))
                )
            except (KeyError, ValueError, OSError):
                # A corrupt archive should not hide the healthy ones.
                continue
        entries.sort(key=lambda item: item["savedAt"], reverse=True)
        return entries

    def delete(self, archive_id: str) -> bool:
        path = self._path(archive_id)
        if not path.exists():
            return False
        path.unlink()
        return True

    def import_entry(self, payload: Any) -> dict[str, Any]:
        """Accept a previously exported entry and store it again."""
        if not isinstance(payload, dict):
            raise ValueError("Archive file must be a JSON object.")
        if int(payload.get("archiveVersion", 0)) != ARCHIVE_VERSION:
            raise ValueError("Unsupported archive version.")
        try:
            pixels = base64.b64decode(
                str(payload["pixelsBase64"]), validate=True
            )
        except (KeyError, ValueError) as error:
            raise ValueError("Archive frame data is missing or invalid.") from error
        try:
            width = int(payload["width"])
            height = int(payload["height"])
            frame_count = int(payload["frameCount"])
            fps = int(payload["fps"])
        except (KeyError, TypeError, ValueError) as error:
            # A bare KeyError would surface to the browser as just 'width'.
            raise ValueError(
                "Archive file is missing its size or timing fields."
            ) from error
        return self.save(
            name=str(payload.get("name", "IMPORTED"))[:32],
            pixels=pixels,
            width=width,
            height=height,
            frame_count=frame_count,
            fps=fps,
            gamma=float(payload.get("gamma", 2.2)),
            saturation=float(payload.get("saturation", 1.0)),
        )
