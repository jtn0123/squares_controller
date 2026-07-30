from __future__ import annotations

import json
import os
import re
import threading
import uuid
from copy import deepcopy
from pathlib import Path
from typing import Any

LIBRARY_VERSION = 1
MAX_SCENES = 64
MAX_PLAYLISTS = 32
MAX_PLAYLIST_STEPS = 64
MAX_SCENE_BYTES = 512_000
ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
SCENE_FIELDS = {
    "effect",
    "width",
    "height",
    "pixels",
    "previewPixels",
    "speed",
    "intensity",
    "brightness",
    "palette",
    "layers",
    "zone",
    "zones",
    "text",
    "font",
    "media",
    "transition",
}


def _empty_library() -> dict[str, Any]:
    return {"version": LIBRARY_VERSION, "scenes": [], "playlists": []}


def _identifier(value: Any, *, generate: bool = False) -> str:
    if value is None and generate:
        return uuid.uuid4().hex
    if not isinstance(value, str) or not ID_PATTERN.fullmatch(value):
        raise ValueError("Library IDs may only use letters, numbers, _ and -.")
    return value


def _name(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} name is required.")
    cleaned = value.strip()
    if len(cleaned) > 48:
        raise ValueError(f"{label} name must be 48 characters or fewer.")
    return cleaned


class LibraryStore:
    """Thread-safe, atomic storage for scenes and timed playlists."""

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self._lock = threading.RLock()
        self._library = self._load()

    def _load(self) -> dict[str, Any]:
        if not self.path.exists():
            return _empty_library()
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as error:
            raise ValueError(f"Could not read scene library at {self.path}.") from error
        return self._sanitize_library(raw)

    def _write(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = self.path.with_name(f".{self.path.name}.{uuid.uuid4().hex}.tmp")
        try:
            with temporary_path.open("w", encoding="utf-8") as destination:
                json.dump(
                    self._library,
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
    def _sanitize_scene(raw: Any) -> dict[str, Any]:
        if not isinstance(raw, dict):
            raise ValueError("Each scene must be a JSON object.")
        scene: dict[str, Any] = {
            "id": _identifier(raw.get("id"), generate=True),
            "name": _name(raw.get("name"), "Scene"),
        }
        for field in SCENE_FIELDS:
            if field in raw:
                scene[field] = deepcopy(raw[field])

        effect = scene.get("effect")
        if effect is not None and (
            not isinstance(effect, str) or not ID_PATTERN.fullmatch(effect)
        ):
            raise ValueError("Scene effect is invalid.")

        width = scene.get("width")
        height = scene.get("height")
        if width is not None or height is not None:
            if (
                not isinstance(width, int)
                or isinstance(width, bool)
                or not isinstance(height, int)
                or isinstance(height, bool)
                or not 1 <= width <= 256
                or not 1 <= height <= 256
            ):
                raise ValueError("Scene dimensions must be whole numbers from 1 to 256.")

        pixels = scene.get("pixels")
        if pixels is not None:
            if not isinstance(pixels, list) or width is None or height is None:
                raise ValueError("Frame scenes require dimensions and RGB values.")
            if len(pixels) != width * height * 3:
                raise ValueError(
                    f"Frame scene expected {width * height * 3} RGB values."
                )
            if any(
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not 0 <= value <= 255
                for value in pixels
            ):
                raise ValueError("Scene RGB values must be numbers from 0 to 255.")
            scene["pixels"] = [round(value) for value in pixels]

        preview_pixels = scene.get("previewPixels")
        if preview_pixels is not None:
            if (
                not isinstance(preview_pixels, list)
                or width is None
                or height is None
                or len(preview_pixels) != width * height * 3
                or any(
                    isinstance(value, bool)
                    or not isinstance(value, (int, float))
                    or not 0 <= value <= 255
                    for value in preview_pixels
                )
            ):
                raise ValueError(
                    "Scene preview RGB values must be numbers from 0 to 255."
                )
            scene["previewPixels"] = [round(value) for value in preview_pixels]

        try:
            encoded = json.dumps(scene, separators=(",", ":")).encode("utf-8")
        except (TypeError, ValueError) as error:
            raise ValueError("Scene contains data that cannot be saved as JSON.") from error
        if len(encoded) > MAX_SCENE_BYTES:
            raise ValueError("Scene is too large to save.")
        return scene

    @staticmethod
    def _sanitize_playlist(
        raw: Any, available_scene_ids: set[str]
    ) -> dict[str, Any]:
        if not isinstance(raw, dict):
            raise ValueError("Each playlist must be a JSON object.")
        steps = raw.get("steps")
        if not isinstance(steps, list) or not 1 <= len(steps) <= MAX_PLAYLIST_STEPS:
            raise ValueError(
                f"A playlist needs 1 to {MAX_PLAYLIST_STEPS} timed steps."
            )
        clean_steps: list[dict[str, Any]] = []
        for raw_step in steps:
            if not isinstance(raw_step, dict):
                raise ValueError("Each playlist step must be a JSON object.")
            scene_id = _identifier(raw_step.get("sceneId"))
            if scene_id not in available_scene_ids:
                raise ValueError(f"Playlist scene {scene_id} does not exist.")
            duration = raw_step.get("duration", 30)
            if (
                isinstance(duration, bool)
                or not isinstance(duration, (int, float))
                or not 1 <= duration <= 86_400
            ):
                raise ValueError("Playlist durations must be from 1 to 86400 seconds.")
            transition = raw_step.get("transition", "cut")
            if not isinstance(transition, str) or not ID_PATTERN.fullmatch(transition):
                raise ValueError("Playlist transition is invalid.")
            clean_steps.append(
                {
                    "sceneId": scene_id,
                    "duration": round(float(duration), 3),
                    "transition": transition,
                }
            )
        return {
            "id": _identifier(raw.get("id"), generate=True),
            "name": _name(raw.get("name"), "Playlist"),
            "repeat": bool(raw.get("repeat", False)),
            "steps": clean_steps,
        }

    @classmethod
    def _sanitize_library(cls, raw: Any) -> dict[str, Any]:
        if not isinstance(raw, dict):
            raise ValueError("Library backup must be a JSON object.")
        raw_scenes = raw.get("scenes", [])
        raw_playlists = raw.get("playlists", [])
        if not isinstance(raw_scenes, list) or not isinstance(raw_playlists, list):
            raise ValueError("Library scenes and playlists must be arrays.")
        if len(raw_scenes) > MAX_SCENES or len(raw_playlists) > MAX_PLAYLISTS:
            raise ValueError("Library backup exceeds the storage limits.")
        scenes = [cls._sanitize_scene(scene) for scene in raw_scenes]
        scene_ids = [scene["id"] for scene in scenes]
        if len(scene_ids) != len(set(scene_ids)):
            raise ValueError("Library scene IDs must be unique.")
        playlists = [
            cls._sanitize_playlist(playlist, set(scene_ids))
            for playlist in raw_playlists
        ]
        playlist_ids = [playlist["id"] for playlist in playlists]
        if len(playlist_ids) != len(set(playlist_ids)):
            raise ValueError("Library playlist IDs must be unique.")
        return {
            "version": LIBRARY_VERSION,
            "scenes": scenes,
            "playlists": playlists,
        }

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return deepcopy(self._library)

    def upsert_scene(self, raw: Any) -> dict[str, Any]:
        scene = self._sanitize_scene(raw)
        with self._lock:
            scenes = [
                existing
                for existing in self._library["scenes"]
                if existing["id"] != scene["id"]
            ]
            if len(scenes) >= MAX_SCENES:
                raise ValueError(f"The library can hold at most {MAX_SCENES} scenes.")
            self._library["scenes"] = [scene, *scenes]
            self._write()
            return deepcopy(scene)

    def delete_scene(self, scene_id: str) -> bool:
        clean_id = _identifier(scene_id)
        with self._lock:
            scenes = [
                scene for scene in self._library["scenes"] if scene["id"] != clean_id
            ]
            if len(scenes) == len(self._library["scenes"]):
                return False
            playlists = []
            for playlist in self._library["playlists"]:
                remaining_steps = [
                    step
                    for step in playlist["steps"]
                    if step["sceneId"] != clean_id
                ]
                if remaining_steps:
                    playlists.append({**playlist, "steps": remaining_steps})
            self._library["scenes"] = scenes
            self._library["playlists"] = playlists
            self._write()
            return True

    def upsert_playlist(self, raw: Any) -> dict[str, Any]:
        with self._lock:
            scene_ids = {scene["id"] for scene in self._library["scenes"]}
            playlist = self._sanitize_playlist(raw, scene_ids)
            playlists = [
                existing
                for existing in self._library["playlists"]
                if existing["id"] != playlist["id"]
            ]
            if len(playlists) >= MAX_PLAYLISTS:
                raise ValueError(
                    f"The library can hold at most {MAX_PLAYLISTS} playlists."
                )
            self._library["playlists"] = [playlist, *playlists]
            self._write()
            return deepcopy(playlist)

    def delete_playlist(self, playlist_id: str) -> bool:
        clean_id = _identifier(playlist_id)
        with self._lock:
            playlists = [
                playlist
                for playlist in self._library["playlists"]
                if playlist["id"] != clean_id
            ]
            if len(playlists) == len(self._library["playlists"]):
                return False
            self._library["playlists"] = playlists
            self._write()
            return True

    def import_library(self, raw: Any, *, merge: bool) -> dict[str, Any]:
        imported = self._sanitize_library(raw)
        with self._lock:
            if not merge:
                self._library = imported
            else:
                scenes_by_id = {
                    scene["id"]: scene for scene in self._library["scenes"]
                }
                scenes_by_id.update(
                    {scene["id"]: scene for scene in imported["scenes"]}
                )
                playlists_by_id = {
                    playlist["id"]: playlist
                    for playlist in self._library["playlists"]
                }
                playlists_by_id.update(
                    {
                        playlist["id"]: playlist
                        for playlist in imported["playlists"]
                    }
                )
                merged = {
                    "version": LIBRARY_VERSION,
                    "scenes": list(scenes_by_id.values()),
                    "playlists": list(playlists_by_id.values()),
                }
                self._library = self._sanitize_library(merged)
            self._write()
            return deepcopy(self._library)
