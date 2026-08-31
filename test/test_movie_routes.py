"""Tests for archive route dispatch.

These drive `handle` directly with a stub context so the whole table —
including restore, which needs a device — can be checked without one.
"""

from __future__ import annotations

import threading
import unittest
from http import HTTPStatus
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from src.movie_archive import MovieArchive
from src.movie_routes import handle


def build_pixels(frames: int = 3, width: int = 4, height: int = 2) -> bytes:
    """Frames that differ from each other, so ordering bugs show up."""
    return bytes(
        (index + frame) % 256
        for frame in range(frames)
        for index in range(width * height * 3)
    )


class FakeClient:
    def __init__(self) -> None:
        self.baked: list[dict[str, Any]] = []

    def bake_movie(
        self,
        name: str,
        pixels: bytes,
        *,
        width: int,
        height: int,
        frame_count: int,
        fps: int,
        gamma: float,
        saturation: float,
    ) -> dict[str, Any]:
        # Mirrors TwinklyClient.bake_movie's keyword-only signature so a
        # renamed route argument fails here instead of on hardware.
        self.baked.append({
            "name": name,
            "pixels": pixels,
            "width": width,
            "height": height,
            "frame_count": frame_count,
            "fps": fps,
            "gamma": gamma,
            "saturation": saturation,
        })
        return {"bakedMovie": {"id": 7}, "status": {"mode": "movie"}}


class FakeContext:
    def __init__(self, archive: MovieArchive) -> None:
        self.movie_archive = archive
        self.frame_mode_lock = threading.Lock()
        self.client = FakeClient()
        self.published: list[tuple[dict[str, Any], str]] = []

    def get_client(self) -> FakeClient:
        return self.client

    def publish(self, payload: dict[str, Any], source: str) -> None:
        self.published.append((payload, source))


class MovieRouteTest(unittest.TestCase):
    def setUp(self) -> None:
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.archive = MovieArchive(Path(temporary.name) / "movies")
        self.ctx = FakeContext(self.archive)

    def save_one(self, name: str = "TEST") -> dict[str, Any]:
        return self.archive.save(
            name=name,
            pixels=build_pixels(),
            width=4,
            height=2,
            frame_count=3,
            fps=24,
            gamma=2.2,
            saturation=1.0,
        )

    def call(
        self, method: str, path: str, body: dict[str, Any] | None = None
    ) -> tuple[HTTPStatus, dict[str, Any]] | None:
        return handle(self.ctx, method, path, body or {})

    def test_unrelated_paths_fall_through_to_the_handler(self) -> None:
        self.assertIsNone(self.call("GET", "/api/status"))
        self.assertIsNone(self.call("GET", "/api/movies"))
        # A known prefix with an unknown verb must also fall through
        # rather than claim the request.
        self.assertIsNone(self.call("PATCH", "/api/movies/archive/abc"))

    def test_only_canonical_paths_reach_delete_and_restore(self) -> None:
        saved = self.save_one()

        # A trailing segment must not resolve to the leading entry id.
        self.assertIsNone(
            self.call("DELETE", f"/api/movies/archive/{saved['id']}/restore")
        )
        self.assertIsNone(
            self.call(
                "POST", f"/api/movies/archive/{saved['id']}/x/restore"
            )
        )
        self.assertEqual(len(self.archive.snapshot()), 1)
        self.assertEqual(self.ctx.client.baked, [])

    def test_list_returns_metadata_without_frame_data(self) -> None:
        self.save_one("FIRST")

        result = self.call("GET", "/api/movies/archive")

        assert result is not None
        status, payload = result
        self.assertEqual(status, HTTPStatus.OK)
        self.assertEqual([item["name"] for item in payload["archive"]], ["FIRST"])
        self.assertNotIn("pixelsBase64", payload["archive"][0])

    def test_reading_one_entry_includes_the_frames_for_download(self) -> None:
        saved = self.save_one()

        result = self.call("GET", f"/api/movies/archive/{saved['id']}")

        assert result is not None
        status, payload = result
        self.assertEqual(status, HTTPStatus.OK)
        self.assertIn("pixelsBase64", payload["archive"])

    def test_missing_entries_report_not_found(self) -> None:
        unknown = "0123456789abcdef"
        for method, path in (
            ("GET", f"/api/movies/archive/{unknown}"),
            ("DELETE", f"/api/movies/archive/{unknown}"),
            ("POST", f"/api/movies/archive/{unknown}/restore"),
        ):
            with self.subTest(method=method):
                result = self.call(method, path)
                assert result is not None
                self.assertEqual(result[0], HTTPStatus.NOT_FOUND)

    def test_delete_removes_only_the_local_copy(self) -> None:
        saved = self.save_one()

        result = self.call("DELETE", f"/api/movies/archive/{saved['id']}")

        assert result is not None
        self.assertEqual(result, (HTTPStatus.OK, {"deleted": saved["id"]}))
        self.assertEqual(self.archive.snapshot(), [])
        # Nothing was asked of the panel: its copy is untouched.
        self.assertEqual(self.ctx.client.baked, [])

    def test_restore_rebakes_the_original_frames(self) -> None:
        saved = self.save_one("BACK ON")

        result = self.call(
            "POST", f"/api/movies/archive/{saved['id']}/restore"
        )

        assert result is not None
        status, payload = result
        self.assertEqual(status, HTTPStatus.OK)
        self.assertEqual(payload["bakedMovie"]["id"], 7)
        (baked,) = self.ctx.client.baked
        self.assertEqual(baked["name"], "BACK ON")
        self.assertEqual(baked["pixels"], build_pixels())
        self.assertEqual(baked["frame_count"], 3)
        self.assertEqual(baked["fps"], 24)
        self.assertEqual(self.ctx.published[-1][1], "movie:restore")

    def test_restore_can_be_given_a_new_name(self) -> None:
        saved = self.save_one("OLD NAME")

        self.call(
            "POST",
            f"/api/movies/archive/{saved['id']}/restore",
            {"name": "NEW NAME"},
        )

        self.assertEqual(self.ctx.client.baked[0]["name"], "NEW NAME")

    def test_import_stores_an_exported_entry(self) -> None:
        exported = self.archive.read(self.save_one("PORTABLE")["id"])
        self.archive.delete(exported["id"])

        result = self.call("POST", "/api/movies/import", {"archive": exported})

        assert result is not None
        status, payload = result
        self.assertEqual(status, HTTPStatus.OK)
        self.assertEqual(payload["archived"]["name"], "PORTABLE")
        self.assertEqual(len(self.archive.snapshot()), 1)

    def test_import_rejects_a_bad_file_loudly(self) -> None:
        with self.assertRaises(ValueError):
            self.call("POST", "/api/movies/import", {"archive": "nonsense"})


if __name__ == "__main__":
    unittest.main()
