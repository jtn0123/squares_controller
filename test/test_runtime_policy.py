import tempfile
import unittest
from pathlib import Path

from src.runtime_policy import (
    FrameActivity,
    RuntimePolicyStore,
    panel_mode_for_action,
)


class RuntimePolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.path = Path(self.temporary_directory.name) / "runtime.json"

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_defaults_are_non_disruptive_and_updates_persist(self) -> None:
        store = RuntimePolicyStore(self.path)
        self.assertEqual(
            store.snapshot(),
            {
                "startupAction": "unchanged",
                "frameLossAction": "hold",
                "frameLossSeconds": 10,
            },
        )
        updated = store.update(
            {
                "startupAction": "stock",
                "frameLossAction": "off",
                "frameLossSeconds": 25.7,
            }
        )
        self.assertEqual(updated["frameLossSeconds"], 26)
        self.assertEqual(RuntimePolicyStore(self.path).snapshot(), updated)

    def test_rejects_unknown_actions_and_clamps_timeout(self) -> None:
        store = RuntimePolicyStore(self.path)
        with self.assertRaisesRegex(ValueError, "startup"):
            store.update({"startupAction": "demo"})
        with self.assertRaisesRegex(ValueError, "frame-loss"):
            store.update({"frameLossAction": "restart"})
        self.assertEqual(
            store.update({"frameLossSeconds": 999})["frameLossSeconds"],
            120,
        )

    def test_frame_loss_triggers_once_until_new_activity(self) -> None:
        activity = FrameActivity()
        policy = {
            "frameLossAction": "stock",
            "frameLossSeconds": 10,
        }
        activity.note(100)
        self.assertIsNone(activity.claim_stale_action(policy, 109.9))
        self.assertEqual(activity.claim_stale_action(policy, 110), "stock")
        self.assertIsNone(activity.claim_stale_action(policy, 120))
        activity.note(121)
        self.assertEqual(activity.claim_stale_action(policy, 131), "stock")
        self.assertIsNone(
            activity.claim_stale_action(
                {**policy, "frameLossAction": "hold"},
                200,
            )
        )

    def test_maps_policy_actions_to_supported_panel_modes(self) -> None:
        self.assertIsNone(panel_mode_for_action("unchanged"))
        self.assertIsNone(panel_mode_for_action("hold"))
        self.assertEqual(panel_mode_for_action("stock"), "movie")
        self.assertEqual(panel_mode_for_action("off"), "off")


if __name__ == "__main__":
    unittest.main()
