import json
import tempfile
import unittest
from pathlib import Path

from src.library_store import LibraryStore


class LibraryStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.path = Path(self.temporary_directory.name) / "library.json"
        self.store = LibraryStore(self.path)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_upserts_scene_and_persists_it_atomically(self) -> None:
        scene = self.store.upsert_scene(
            {
                "name": "Night Radar",
                "effect": "radar",
                "width": 32,
                "height": 24,
                "speed": 110,
                "intensity": 58,
                "brightness": 24,
            }
        )

        self.assertRegex(scene["id"], r"^[a-f0-9]{32}$")
        self.assertEqual(scene["name"], "Night Radar")
        self.assertEqual(LibraryStore(self.path).snapshot()["scenes"], [scene])
        self.assertEqual(json.loads(self.path.read_text())["version"], 1)

    def test_rejects_invalid_frame_and_unknown_playlist_scene(self) -> None:
        with self.assertRaisesRegex(ValueError, "RGB values"):
            self.store.upsert_scene(
                {
                    "name": "Broken",
                    "width": 2,
                    "height": 2,
                    "pixels": [255, 0, 0],
                }
            )

        with self.assertRaisesRegex(ValueError, "does not exist"):
            self.store.upsert_playlist(
                {
                    "name": "Evening",
                    "steps": [{"sceneId": "missing", "duration": 30}],
                }
            )

    def test_deleting_scene_removes_playlist_steps_and_empty_playlists(self) -> None:
        first = self.store.upsert_scene({"name": "First", "effect": "tide"})
        second = self.store.upsert_scene({"name": "Second", "effect": "orbit"})
        playlist = self.store.upsert_playlist(
            {
                "name": "Show",
                "repeat": True,
                "steps": [
                    {"sceneId": first["id"], "duration": 10},
                    {"sceneId": second["id"], "duration": 20},
                ],
            }
        )

        self.assertTrue(self.store.delete_scene(first["id"]))
        remaining = self.store.snapshot()
        self.assertEqual(
            remaining["playlists"][0]["steps"],
            [{"sceneId": second["id"], "duration": 20, "transition": "cut"}],
        )
        self.assertTrue(self.store.delete_scene(second["id"]))
        self.assertEqual(self.store.snapshot()["playlists"], [])
        self.assertFalse(self.store.delete_playlist(playlist["id"]))

    def test_import_can_merge_or_replace_library(self) -> None:
        original = self.store.upsert_scene({"id": "original", "name": "Original", "effect": "tide"})
        imported = {
            "version": 1,
            "scenes": [{"id": "imported", "name": "Imported", "effect": "orbit"}],
            "playlists": [],
        }

        merged = self.store.import_library(imported, merge=True)
        self.assertEqual({scene["id"] for scene in merged["scenes"]}, {original["id"], "imported"})

        replaced = self.store.import_library(imported, merge=False)
        self.assertEqual([scene["id"] for scene in replaced["scenes"]], ["imported"])


if __name__ == "__main__":
    unittest.main()
