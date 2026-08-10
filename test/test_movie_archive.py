"""Tests for the local movie archive.

The archive is the only path back from a baked movie: the controller
returns 404 for every frame-read endpoint, so an entry that saves wrong
or restores wrong is unrecoverable. These tests hold that round trip.
"""

from __future__ import annotations

import base64
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from src.movie_archive import MovieArchive


def build_pixels(frames: int = 3, width: int = 4, height: int = 2) -> bytes:
    """Frames that differ from each other, so ordering bugs show up."""
    return bytes(
        (index + frame) % 256
        for frame in range(frames)
        for index in range(width * height * 3)
    )


class MovieArchiveTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.archive = MovieArchive(Path(self.temporary.name) / "movies")

    def save_one(self, name: str = "TEST", **overrides: Any) -> dict[str, Any]:
        fields: dict[str, Any] = {
            "name": name,
            "pixels": build_pixels(),
            "width": 4,
            "height": 2,
            "frame_count": 3,
            "fps": 24,
            "gamma": 2.2,
            "saturation": 1.0,
        }
        fields.update(overrides)
        return self.archive.save(**fields)

    def test_save_returns_metadata_and_a_single_frame_thumbnail(self) -> None:
        saved = self.save_one("SUNSET")

        self.assertEqual(saved["name"], "SUNSET")
        self.assertEqual(saved["frameCount"], 3)
        thumbnail = base64.b64decode(saved["thumbnailBase64"])
        self.assertEqual(len(thumbnail), 4 * 2 * 3)
        self.assertEqual(thumbnail, build_pixels()[: 4 * 2 * 3])
        self.assertNotIn("pixelsBase64", saved)

    def test_save_rejects_a_pixel_buffer_that_does_not_match_the_geometry(
        self,
    ) -> None:
        with self.assertRaises(ValueError):
            self.save_one(pixels=build_pixels(frames=2))

    def test_save_rejects_a_movie_larger_than_the_ceiling(self) -> None:
        with self.assertRaises(ValueError):
            self.save_one(
                pixels=b"\x00" * 9_000_000,
                width=1,
                height=1,
                frame_count=3_000_000,
            )

    def test_export_then_import_reproduces_the_frame_data_exactly(self) -> None:
        original = self.save_one("ROUND TRIP")
        exported = self.archive.read(original["id"])
        self.assertTrue(self.archive.delete(original["id"]))
        self.assertEqual(self.archive.snapshot(), [])

        reimported = self.archive.import_entry(exported)
        restored = self.archive.read(reimported["id"])

        self.assertEqual(restored["pixelsBase64"], exported["pixelsBase64"])
        self.assertEqual(
            base64.b64decode(restored["pixelsBase64"]), build_pixels()
        )
        self.assertEqual(restored["name"], "ROUND TRIP")
        self.assertEqual(restored["fps"], 24)
        # A re-import is a new local copy, not a claim on the old slot.
        self.assertNotEqual(reimported["id"], original["id"])

    def test_import_rejects_a_future_archive_version(self) -> None:
        entry = self.archive.read(self.save_one()["id"])
        entry["archiveVersion"] = 99

        with self.assertRaises(ValueError):
            self.archive.import_entry(entry)

    def test_import_names_the_missing_field_instead_of_leaking_a_key(
        self,
    ) -> None:
        entry = self.archive.read(self.save_one()["id"])
        del entry["width"]

        with self.assertRaises(ValueError) as caught:
            self.archive.import_entry(entry)
        self.assertNotEqual(str(caught.exception), "'width'")
        self.assertIn("size", str(caught.exception))

    def test_import_rejects_payloads_that_are_not_objects(self) -> None:
        for payload in ([], "movie", None, 7):
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                self.archive.import_entry(payload)

    def test_import_rejects_frame_data_that_is_not_base64(self) -> None:
        entry = self.archive.read(self.save_one()["id"])
        entry["pixelsBase64"] = "not base64 at all!!"

        with self.assertRaises(ValueError):
            self.archive.import_entry(entry)

    def test_snapshot_lists_newest_first_and_skips_corrupt_entries(
        self,
    ) -> None:
        older = self.save_one("OLDER")
        newer = self.save_one("NEWER")
        # savedAt has one-second resolution, so order it explicitly rather
        # than depending on how fast the test machine is.
        self.stamp(older["id"], 1_000)
        self.stamp(newer["id"], 2_000)
        (self.archive.directory / "broken.json").write_text(
            "{ not json", encoding="utf-8"
        )

        listed = self.archive.snapshot()

        self.assertEqual([item["name"] for item in listed], ["NEWER", "OLDER"])

    def test_snapshot_is_empty_before_anything_is_archived(self) -> None:
        self.assertEqual(self.archive.snapshot(), [])

    def test_delete_reports_whether_anything_was_removed(self) -> None:
        saved = self.save_one()

        self.assertTrue(self.archive.delete(saved["id"]))
        self.assertFalse(self.archive.delete(saved["id"]))

    def test_read_raises_for_an_unknown_id(self) -> None:
        with self.assertRaises(KeyError):
            self.archive.read("0123456789abcdef")

    def test_ids_that_could_escape_the_archive_directory_are_refused(
        self,
    ) -> None:
        for archive_id in ("../secrets", "a/b", "", "x" * 65):
            with self.subTest(archive_id=archive_id):
                with self.assertRaises(ValueError):
                    self.archive.read(archive_id)
                with self.assertRaises(ValueError):
                    self.archive.delete(archive_id)

    def stamp(self, archive_id: str, saved_at: int) -> None:
        path = self.archive.directory / f"{archive_id}.json"
        entry = json.loads(path.read_text(encoding="utf-8"))
        entry["savedAt"] = saved_at
        path.write_text(json.dumps(entry), encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
