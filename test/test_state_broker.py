import threading
import time
import unittest

from src.state_broker import StateBroker


class StateBrokerTests(unittest.TestCase):
    def test_publishes_versioned_immutable_events(self) -> None:
        broker = StateBroker()
        payload = {"brightness": 20}

        event = broker.publish(payload, "brightness")
        payload["brightness"] = 90

        self.assertEqual(event.version, 1)
        self.assertEqual(event.source, "brightness")
        self.assertEqual(event.payload["brightness"], 20)

    def test_deduplicates_identical_source_and_payload(self) -> None:
        broker = StateBroker()

        first = broker.publish({"mode": "rt"}, "frame")
        second = broker.publish({"mode": "rt"}, "frame")

        self.assertIs(first, second)
        self.assertEqual(second.version, 1)

    def test_wait_after_wakes_for_a_new_event(self) -> None:
        broker = StateBroker()
        received = []

        thread = threading.Thread(
            target=lambda: received.append(broker.wait_after(0, timeout=1))
        )
        thread.start()
        time.sleep(0.01)
        broker.publish({"rotation": 90}, "rotation")
        thread.join(timeout=1)

        self.assertFalse(thread.is_alive())
        self.assertEqual(received[0].payload["rotation"], 90)

    def test_wait_after_times_out_without_a_new_event(self) -> None:
        broker = StateBroker()

        self.assertIsNone(broker.wait_after(0, timeout=0.01))


if __name__ == "__main__":
    unittest.main()
