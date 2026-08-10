import json
import threading
import unittest
from http.client import HTTPConnection
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock

from src.automation_store import AutomationStore
from src.http_api import AppContext, SquaresHandler, SquaresServer
from src.library_store import LibraryStore
from src.runtime_policy import FrameActivity, RuntimePolicyStore
from src.state_broker import StateBroker
from src.store_recovery import load_store_with_recovery

PUBLIC_DIR = Path(__file__).resolve().parent.parent / "public"


def connected_status(**overrides):
    status = {
        "connected": True,
        "ip": "192.168.1.50",
        "name": "Test Squares",
        "productCode": "TST",
        "firmware": "2.9.1",
        "ledCount": 4,
        "width": 2,
        "height": 2,
        "rotation": 0,
        "frameRate": 40,
        "measuredFrameRate": 38.4,
        "streamTargetFps": 37.5,
        "mode": "movie",
        "currentMovie": None,
        "brightness": 40,
        "brightnessControl": "device",
        "streaming": False,
        "streamTelemetry": {"sentFrames": 0},
        "lastError": None,
    }
    status.update(overrides)
    return status


class ServerRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = TemporaryDirectory()
        root = Path(self.tempdir.name)
        self.client = Mock()
        self.client.refresh_status.return_value = connected_status()
        self.client.layout = None
        self.ctx = AppContext(
            public_dir=PUBLIC_DIR,
            app_version="0.0-test",
            state_broker=StateBroker(),
            library_store=LibraryStore(root / "library.json"),
            automation_store=AutomationStore(root / "automations.json"),
            runtime_policy_store=RuntimePolicyStore(root / "runtime.json"),
            frame_activity=FrameActivity(),
            shutting_down=threading.Event(),
            client=self.client,
        )
        self.server = SquaresServer(("127.0.0.1", 0), SquaresHandler, self.ctx)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(
            target=lambda: self.server.serve_forever(poll_interval=0.05),
            daemon=True,
        )
        self.thread.start()

    def tearDown(self) -> None:
        self.ctx.shutting_down.set()
        self.server.shutdown()
        self.thread.join(timeout=2)
        self.server.server_close()
        self.tempdir.cleanup()

    def request(
        self,
        method: str,
        path: str,
        body: dict | None = None,
        content_type: str = "application/json",
    ):
        connection = HTTPConnection("127.0.0.1", self.port, timeout=5)
        headers = {}
        payload = None
        if body is not None:
            payload = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = content_type
        connection.request(method, path, body=payload, headers=headers)
        response = connection.getresponse()
        data = response.read()
        connection.close()
        return response.status, json.loads(data) if data else {}

    def test_health_reports_configuration_and_storage_state(self) -> None:
        status, payload = self.request("GET", "/api/v1/health")
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["deviceConfigured"])
        self.assertEqual(payload["storageWarnings"], [])

    def test_every_documented_openapi_path_is_served(self) -> None:
        document = json.loads((PUBLIC_DIR / "openapi.json").read_text())
        for path, operations in document["paths"].items():
            for method in operations:
                if method == "get":
                    status, _ = self.request("GET", path)
                else:
                    status, _ = self.request(
                        "POST", path, body={"action": "status"}
                    )
                self.assertNotEqual(
                    status, 404, f"{method.upper()} {path} is documented but 404s"
                )

    def test_rejects_json_bodies_that_are_not_objects(self) -> None:
        status, payload = self.request("POST", "/api/scenes", body=["not", "an", "object"])
        self.assertEqual(status, 400)
        self.assertIn("JSON object", payload["error"])

    def test_rejects_non_json_content_type(self) -> None:
        status, payload = self.request(
            "POST", "/api/scenes", body={"name": "X"}, content_type="text/plain"
        )
        self.assertEqual(status, 400)
        self.assertIn("Content-Type", payload["error"])

    def test_unknown_api_route_is_a_404(self) -> None:
        status, _ = self.request("POST", "/api/nonsense", body={})
        self.assertEqual(status, 404)

    def test_scene_round_trip_and_missing_delete(self) -> None:
        status, payload = self.request(
            "POST", "/api/scenes", body={"name": "Route Test"}
        )
        self.assertEqual(status, 200)
        scene_id = payload["scene"]["id"]

        status, library = self.request("GET", "/api/library")
        self.assertEqual(status, 200)
        self.assertEqual(len(library["scenes"]), 1)

        status, _ = self.request("DELETE", f"/api/scenes/{scene_id}")
        self.assertEqual(status, 200)
        status, _ = self.request("DELETE", f"/api/scenes/{scene_id}")
        self.assertEqual(status, 404)

    def test_brightness_route_shares_strict_command_validation(self) -> None:
        status, payload = self.request(
            "POST", "/api/brightness", body={"value": 0}
        )
        self.assertEqual(status, 400)
        self.assertIn("1 to 100", payload["error"])
        self.client.set_brightness.assert_not_called()

        self.client.set_brightness.return_value = connected_status(brightness=55)
        status, payload = self.request(
            "POST", "/api/brightness", body={"value": 55}
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["brightness"], 55)
        self.client.set_brightness.assert_called_once_with(55.0)

    def test_unreachable_panel_maps_to_503_not_400(self) -> None:
        self.client.set_mode.side_effect = ConnectionError("panel gone")
        status, payload = self.request(
            "POST", "/api/mode", body={"mode": "off"}
        )
        self.assertEqual(status, 503)
        self.assertEqual(payload["error"], "panel gone")

    def test_unconfigured_controller_returns_503(self) -> None:
        self.ctx.client = None
        self.ctx.configuration_error = "No panel is configured."
        try:
            status, payload = self.request(
                "POST", "/api/mode", body={"mode": "off"}
            )
            self.assertEqual(status, 503)
            self.assertIn("No panel", payload["error"])
        finally:
            self.ctx.client = self.client
            self.ctx.configuration_error = None

    def test_frame_accepts_base64_pixels(self) -> None:
        import base64

        self.client.set_raster_frame.return_value = connected_status(
            mode="rt", streaming=True
        )
        pixels = bytes(range(12))
        status, payload = self.request(
            "POST",
            "/api/frame",
            body={
                "width": 2,
                "height": 2,
                "pixelsBase64": base64.b64encode(pixels).decode("ascii"),
            },
        )
        self.assertEqual(status, 200)
        self.assertTrue(payload["streaming"])
        self.client.set_raster_frame.assert_called_once_with(pixels, 2, 2)

    def test_repeated_frames_publish_only_stream_transitions(self) -> None:
        self.client.set_raster_frame.return_value = connected_status(
            mode="rt", streaming=True
        )
        body = {"width": 2, "height": 2, "pixels": [0] * 12}
        self.request("POST", "/api/frame", body=body)
        version_after_first = self.ctx.state_broker.current().version
        self.request("POST", "/api/frame", body=body)
        self.request("POST", "/api/frame", body=body)
        self.assertEqual(
            self.ctx.state_broker.current().version, version_after_first
        )

    def test_only_one_tagged_source_may_stream_at_a_time(self) -> None:
        self.client.set_raster_frame.return_value = connected_status(
            mode="rt", streaming=True
        )
        frame = {"width": 2, "height": 2, "pixels": [0] * 12}

        # First tab starts streaming and owns the wall.
        status, _ = self.request(
            "POST", "/api/frame", body={**frame, "source": "tab-a"}
        )
        self.assertEqual(status, 200)

        # A second tab without a user gesture is rejected.
        status, payload = self.request(
            "POST", "/api/frame", body={**frame, "source": "tab-b"}
        )
        self.assertEqual(status, 409)
        self.assertIn("Another controller", payload["error"])

        # Untagged callers (scripts, external API users) stay ungoverned.
        status, _ = self.request("POST", "/api/frame", body=frame)
        self.assertEqual(status, 200)

        # A user gesture in the second tab takes the wall over...
        status, _ = self.request(
            "POST", "/api/frame", body={**frame, "source": "tab-b", "claim": True}
        )
        self.assertEqual(status, 200)

        # ...after which the first tab is the one locked out.
        status, _ = self.request(
            "POST", "/api/frame", body={**frame, "source": "tab-a"}
        )
        self.assertEqual(status, 409)

        # Once the owner goes idle, any tab may stream without a claim.
        self.ctx.frame_source_seen -= 3.0
        status, _ = self.request(
            "POST", "/api/frame", body={**frame, "source": "tab-a"}
        )
        self.assertEqual(status, 200)

        # A claimed frame that fails validation must not steal ownership.
        bad_frame = {"width": 2, "height": 2, "pixels": [0] * 3}
        status, _ = self.request(
            "POST",
            "/api/frame",
            body={**bad_frame, "source": "tab-b", "claim": True},
        )
        self.assertEqual(status, 400)
        status, _ = self.request(
            "POST", "/api/frame", body={**frame, "source": "tab-a"}
        )
        self.assertEqual(status, 200, "owner survived the failed takeover")

    def test_state_events_resume_ignores_stale_boot_epochs(self) -> None:
        connection = HTTPConnection("127.0.0.1", self.port, timeout=5)
        # An id from a previous server process must not starve the stream.
        connection.request(
            "GET", "/api/events", headers={"Last-Event-ID": "deadbeef-57"}
        )
        response = connection.getresponse()
        received_id = None
        for _ in range(10):
            line = response.fp.readline().decode("utf-8").strip()
            if line.startswith("id: "):
                received_id = line.removeprefix("id: ")
                break
        connection.close()
        self.assertIsNotNone(received_id, "no SSE event arrived")
        epoch, _, version = received_id.rpartition("-")
        self.assertEqual(epoch, self.ctx.boot_id)
        self.assertGreaterEqual(int(version), 1)


class StoreRecoveryTests(unittest.TestCase):
    def test_corrupt_store_is_quarantined_instead_of_fatal(self) -> None:
        with TemporaryDirectory() as tempdir:
            path = Path(tempdir) / "library.json"
            path.write_text("{ this is not json")
            warnings: list[str] = []
            store = load_store_with_recovery(
                LibraryStore, path, "Scene library", warnings
            )
            self.assertEqual(store.snapshot()["scenes"], [])
            self.assertEqual(len(warnings), 1)
            quarantined = list(Path(tempdir).glob("library.json.corrupt.*"))
            self.assertEqual(len(quarantined), 1)
            self.assertEqual(
                quarantined[0].read_text(), "{ this is not json"
            )


if __name__ == "__main__":
    unittest.main()
