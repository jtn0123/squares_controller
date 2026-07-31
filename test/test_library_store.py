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
                "width": 2,
                "height": 1,
                "previewPixels": [1, 2, 3, 4, 5, 6],
                "speed": 110,
                "intensity": 58,
                "brightness": 24,
            }
        )

        self.assertRegex(scene["id"], r"^[a-f0-9]{32}$")
        self.assertEqual(scene["name"], "Night Radar")
        self.assertEqual(scene["previewPixels"], [1, 2, 3, 4, 5, 6])
        self.assertEqual(LibraryStore(self.path).snapshot()["scenes"], [scene])
        self.assertEqual(json.loads(self.path.read_text())["version"], 2)

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

    def test_sanitizes_scene_folders_tags_and_favorites(self) -> None:
        scene = self.store.upsert_scene(
            {
                "name": "Organized",
                "effect": "tide",
                "folder": "  Studio  ",
                "tags": [" ambient ", "NIGHT", "AMBIENT"],
                "favorite": 1,
            }
        )

        self.assertEqual(scene["folder"], "STUDIO")
        self.assertEqual(scene["tags"], ["AMBIENT", "NIGHT"])
        self.assertIs(scene["favorite"], True)

        with self.assertRaisesRegex(ValueError, "at most 8"):
            self.store.upsert_scene(
                {
                    "name": "Too many tags",
                    "effect": "tide",
                    "tags": [f"tag-{index}" for index in range(9)],
                }
            )

    def test_saves_reusable_multi_stop_palettes(self) -> None:
        palette = self.store.upsert_palette(
            {
                "name": " Northern Lights ",
                "colors": ["#001122", "#22CCAA", "#8855FF"],
            }
        )

        self.assertEqual(palette["name"], "Northern Lights")
        self.assertEqual(palette["colors"], ["#001122", "#22ccaa", "#8855ff"])
        self.assertEqual(LibraryStore(self.path).snapshot()["palettes"], [palette])
        self.assertTrue(self.store.delete_palette(palette["id"]))

        with self.assertRaisesRegex(ValueError, "2 to 8"):
            self.store.upsert_palette({"name": "Broken", "colors": ["#000000"]})


if __name__ == "__main__":
    unittest.main()
