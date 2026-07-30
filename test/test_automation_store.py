import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from src.automation_store import AutomationStore


class AutomationStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.path = Path(self.temporary_directory.name) / "automations.json"
        self.store = AutomationStore(self.path)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_persists_valid_once_and_daily_actions(self) -> None:
        sleep = self.store.upsert(
            {
                "name": "Sleep",
                "kind": "once",
                "runAt": "2026-07-29T23:00",
                "action": "off",
            }
        )
        wake = self.store.upsert(
            {
                "id": "weekday-wake",
                "name": "Weekday Wake",
                "kind": "daily",
                "time": "07:30",
                "days": [0, 1, 2, 3, 4],
                "action": "wake",
                "value": 25,
            }
        )

        reloaded = AutomationStore(self.path).snapshot()
        self.assertEqual([item["id"] for item in reloaded], [wake["id"], sleep["id"]])
        self.assertTrue(all(item["enabled"] for item in reloaded))

    def test_claims_due_once_action_only_once(self) -> None:
        action = self.store.upsert(
            {
                "id": "sleep",
                "name": "Sleep",
                "kind": "once",
                "runAt": "2026-07-29T22:00",
                "action": "off",
            }
        )

        self.assertEqual(
            [item["id"] for item in self.store.claim_due(datetime(2026, 7, 29, 22, 1))],
            [action["id"]],
        )
        self.assertEqual(self.store.claim_due(datetime(2026, 7, 29, 22, 2)), [])
        self.assertFalse(self.store.snapshot()[0]["enabled"])

    def test_daily_action_respects_days_and_runs_once_per_date(self) -> None:
        self.store.upsert(
            {
                "id": "wake",
                "name": "Wake",
                "kind": "daily",
                "time": "07:30",
                "days": [0],
                "action": "wake",
                "value": 30,
            }
        )

        self.assertEqual(self.store.claim_due(datetime(2026, 8, 4, 8, 0)), [])
        due = self.store.claim_due(datetime(2026, 8, 3, 7, 30))
        self.assertEqual([item["id"] for item in due], ["wake"])
        self.assertEqual(self.store.claim_due(datetime(2026, 8, 3, 9, 0)), [])
        self.assertEqual(
            [item["id"] for item in self.store.claim_due(datetime(2026, 8, 10, 7, 31))],
            ["wake"],
        )

    def test_validates_actions_and_can_delete(self) -> None:
        with self.assertRaisesRegex(ValueError, "Brightness"):
            self.store.upsert(
                {
                    "name": "Bad",
                    "kind": "daily",
                    "time": "12:00",
                    "days": [0],
                    "action": "brightness",
                    "value": 200,
                }
            )
        with self.assertRaisesRegex(ValueError, "future"):
            self.store.upsert(
                {
                    "name": "Bad",
                    "kind": "once",
                    "runAt": "not-a-date",
                    "action": "off",
                }
            )

        saved = self.store.upsert(
            {
                "name": "Stock",
                "kind": "daily",
                "time": "18:00",
                "action": "stock",
            }
        )
        self.assertTrue(self.store.delete(saved["id"]))
        self.assertFalse(self.store.delete(saved["id"]))


if __name__ == "__main__":
    unittest.main()
