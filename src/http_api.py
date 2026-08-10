"""HTTP layer: request handling, routing, and server-sent state events.

`AppContext` carries every dependency the handler needs, so tests can build
a real `SquaresServer` on an ephemeral port with fake stores and a fake
controller client.
"""

from __future__ import annotations

import json
import sys
import threading
import time
import uuid
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from src.automation_store import AutomationStore
from src.command_api import API_VERSION, capability_payload, execute_command
from src.library_store import LibraryStore
from src.movie_payload import MAX_MOVIE_FRAMES, decode_movie_payload
from src.runtime_policy import FrameActivity, RuntimePolicyStore
from src.state_broker import StateBroker, StateEvent

MAX_BODY_BYTES = 2_000_000
BAKE_BODY_OVERHEAD_BYTES = 65_536
STATE_HEARTBEAT_SECONDS = 15.0
# A frame source that stays silent this long has stopped producing; any
# other tab may then start streaming without an explicit takeover.
FRAME_SOURCE_IDLE_SECONDS = 2.0


class FrameSourceBusyError(Exception):
    """Another client currently owns the frame stream."""

# The keys of a status payload that describe the streaming state a browser
# must react to; frame uploads publish an event only when these change.
_STREAM_SIGNATURE_KEYS = ("connected", "mode", "brightness")


def _stream_signature(payload: dict[str, Any]) -> tuple[Any, ...]:
    movie = payload.get("currentMovie")
    return (
        *(payload.get(key) for key in _STREAM_SIGNATURE_KEYS),
        bool(payload.get("streaming")),
        movie.get("id") if isinstance(movie, dict) else None,
    )


@dataclass
class AppContext:
    """Shared application state, injectable for tests."""

    public_dir: Path
    app_version: str
    state_broker: StateBroker
    library_store: LibraryStore
    automation_store: AutomationStore
    runtime_policy_store: RuntimePolicyStore
    frame_activity: FrameActivity
    shutting_down: threading.Event
    client: Any | None = None
    configuration_error: str | None = None
    storage_warnings: list[str] = field(default_factory=list)
    boot_id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])
    frame_mode_lock: threading.Lock = field(default_factory=threading.Lock)
    # Single-driver arbitration: only one browser tab may stream frames at
    # a time. Guarded by frame_mode_lock.
    frame_source_id: str | None = None
    frame_source_seen: float = 0.0

    def get_client(self) -> Any:
        if self.client is None:
            raise ConnectionError(
                self.configuration_error or "No panel is configured."
            )
        return self.client

    def controller_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        result = dict(payload)
        if result.get("connected"):
            result["controllerVersion"] = self.app_version
        return result

    def publish(self, payload: dict[str, Any], source: str) -> StateEvent:
        return self.state_broker.publish(
            self.controller_payload(payload), source
        )


class SquaresServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(
        self,
        server_address: tuple[str, int],
        handler_class: type[SquaresHandler],
        context: AppContext,
    ) -> None:
        self.context = context
        super().__init__(server_address, handler_class)

    def handle_error(self, request: Any, client_address: Any) -> None:
        error = sys.exc_info()[1]
        if isinstance(error, (BrokenPipeError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)


class SquaresHandler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(
        self, request: Any, client_address: Any, server: SquaresServer
    ) -> None:
        self.ctx = server.context
        self.server_version = f"SquaresController/{self.ctx.app_version}"
        super().__init__(
            request,
            client_address,
            server,
            directory=str(self.ctx.public_dir),
        )

    def log_message(self, message_format: str, *args: Any) -> None:
        # self.path is unset until the request line has parsed; send_error
        # can log before that point.
        path = getattr(self, "path", "")
        if path.startswith("/api/") and args and str(args[0]).startswith("5"):
            super().log_message(message_format, *args)

    def end_headers(self) -> None:
        if not getattr(self, "path", "").startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        response_payload = self.ctx.controller_payload(payload)
        body = json.dumps(response_payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self, max_bytes: int = MAX_BODY_BYTES) -> dict[str, Any]:
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0]
        if content_type.strip().lower() != "application/json":
            raise ValueError("Content-Type must be application/json.")
        length = int(self.headers.get("Content-Length", "0"))
        if length < 0:
            raise ValueError("Content-Length cannot be negative.")
        if length > max_bytes:
            raise ValueError("Request body is too large.")
        if length == 0:
            return {}
        try:
            body = json.loads(self.rfile.read(length))
        except json.JSONDecodeError as error:
            raise ValueError("Request body must be valid JSON.") from error
        # json.loads also yields lists/strings/numbers/null; routes call
        # .get() on the result, so anything but an object must 400 here.
        if not isinstance(body, dict):
            raise ValueError("Request body must be a JSON object.")
        return body

    def _body_limit(self, path: str) -> int:
        if path != "/api/movies/bake":
            return MAX_BODY_BYTES
        # A full-length bake is MAX_MOVIE_FRAMES frames of base64 RGB
        # (4 bytes per 3 channels); size the cap to the connected wall
        # instead of rejecting legitimate uploads from larger layouts.
        try:
            layout = self.ctx.get_client().layout
        except ConnectionError:
            return MAX_BODY_BYTES
        if layout is None:
            return MAX_BODY_BYTES
        encoded_movie_bytes = MAX_MOVIE_FRAMES * int(layout.led_count) * 4
        return max(MAX_BODY_BYTES, encoded_movie_bytes + BAKE_BODY_OVERHEAD_BYTES)

    def send_state_event(self, event: StateEvent) -> None:
        message = json.dumps(
            {
                "source": event.source,
                "status": event.payload,
            },
            separators=(",", ":"),
        )
        body = (
            f"id: {self.ctx.boot_id}-{event.version}\n"
            "event: state\n"
            f"data: {message}\n\n"
        ).encode("utf-8")
        self.wfile.write(body)
        self.wfile.flush()

    def _last_seen_version(self) -> int:
        """Resume position from Last-Event-ID, ignoring other boots.

        Versions restart at 1 whenever the server restarts, so ids carry a
        per-process boot epoch. A resume id from a previous boot would
        otherwise silently starve the client until the version counter
        caught up.
        """
        raw = self.headers.get("Last-Event-ID", "")
        epoch, _, version_text = raw.rpartition("-")
        if epoch != self.ctx.boot_id:
            return 0
        try:
            return int(version_text)
        except ValueError:
            return 0

    def serve_state_events(self) -> None:
        status = self.ctx.get_client().refresh_status()
        event = self.ctx.publish(status, "snapshot")
        last_seen = self._last_seen_version()

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        try:
            if event.version > last_seen:
                self.send_state_event(event)
                last_seen = event.version
            while not self.ctx.shutting_down.is_set():
                update = self.ctx.state_broker.wait_after(
                    last_seen, timeout=STATE_HEARTBEAT_SECONDS
                )
                if update is None:
                    self.wfile.write(b": keep-alive\n\n")
                    self.wfile.flush()
                    continue
                self.send_state_event(update)
                last_seen = update.version
        except OSError:
            return

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if self._get_local_route(path) or self._get_controller_route(path):
            return
        super().do_GET()

    def _get_local_route(self, path: str) -> bool:
        """Routes served entirely from local state (no device contact)."""
        if path == "/api/v1/health":
            self.send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "apiVersion": API_VERSION,
                    "controllerVersion": self.ctx.app_version,
                    "deviceConfigured": self.ctx.client is not None,
                    "storageWarnings": list(self.ctx.storage_warnings),
                },
            )
            return True
        if path == "/api/v1/capabilities":
            self.send_json(HTTPStatus.OK, capability_payload())
            return True
        if path in {"/api/library", "/api/library/export"}:
            self.send_json(HTTPStatus.OK, self.ctx.library_store.snapshot())
            return True
        if path == "/api/automations":
            self.send_json(
                HTTPStatus.OK,
                {"automations": self.ctx.automation_store.snapshot()},
            )
            return True
        if path == "/api/runtime-policy":
            self.send_json(
                HTTPStatus.OK,
                {"runtimePolicy": self.ctx.runtime_policy_store.snapshot()},
            )
            return True
        return False

    def _get_controller_route(self, path: str) -> bool:
        """Routes that talk to the panel and answer 503 when it is away."""
        if path == "/api/telemetry":
            try:
                self.send_json(
                    HTTPStatus.OK,
                    {"streamTelemetry": self.ctx.get_client().stream_telemetry()},
                )
            except (ConnectionError, KeyError, ValueError) as error:
                self.send_json(
                    HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)}
                )
            return True
        if path == "/api/movies":
            try:
                movies = self.ctx.get_client().list_movies()
                self.send_json(
                    HTTPStatus.OK,
                    {
                        "movies": movies["movies"],
                        "availableFrames": int(movies.get("available_frames", 0)),
                        "maxCapacity": int(movies.get("max_capacity", 0)),
                    },
                )
            except (ConnectionError, KeyError, TypeError, ValueError) as error:
                self.send_json(
                    HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)}
                )
            return True
        if path == "/api/v1/state":
            try:
                self._send_v1_state()
            except (ConnectionError, KeyError, ValueError) as error:
                self.send_json(
                    HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)}
                )
            return True
        if path == "/api/events":
            try:
                self.serve_state_events()
            except (ConnectionError, KeyError, ValueError) as error:
                self.send_json(
                    HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)}
                )
            return True
        if path == "/api/status":
            try:
                status = self.ctx.get_client().refresh_status()
                self.ctx.publish(status, "snapshot")
                self.send_json(HTTPStatus.OK, status)
            except (ConnectionError, KeyError, ValueError) as error:
                self.send_json(
                    HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)}
                )
            return True
        return False

    def _send_v1_state(self) -> None:
        status = self.ctx.get_client().refresh_status()
        self.ctx.publish(status, "api")
        library = self.ctx.library_store.snapshot()
        automations = self.ctx.automation_store.snapshot()
        self.send_json(
            HTTPStatus.OK,
            {
                "apiVersion": API_VERSION,
                "controller": self.ctx.controller_payload(status),
                "library": {
                    "sceneCount": len(library["scenes"]),
                    "playlistCount": len(library["playlists"]),
                },
                "automations": {
                    "count": len(automations),
                    "enabledCount": sum(
                        1 for item in automations if item["enabled"]
                    ),
                },
            },
        )

    def _check_frame_source(self, body: dict[str, Any]) -> str | None:
        """Enforce one streaming tab at a time (caller holds frame_mode_lock).

        Two clients streaming concurrently fight last-writer-wins for the
        wall, which shows up as heavy frame drops. The first tagged source
        owns the stream; another source is rejected with 409 until the
        owner goes idle or the newcomer claims it from a user gesture.
        Untagged bodies (scripts, external API callers) stay ungoverned.

        Returns the source to commit once the frame actually succeeds —
        an invalid claimed frame must not steal ownership from a healthy
        streamer.
        """
        source = body.get("source")
        if not isinstance(source, str) or not source:
            return None
        owner = self.ctx.frame_source_id
        if (
            owner is not None
            and owner != source
            and not body.get("claim")
            and time.monotonic() - self.ctx.frame_source_seen
            <= FRAME_SOURCE_IDLE_SECONDS
        ):
            raise FrameSourceBusyError(
                "Another controller tab is driving the wall."
            )
        return source

    def _execute_frame(self, body: dict[str, Any]) -> dict[str, Any]:
        with self.ctx.frame_mode_lock:
            source = self._check_frame_source(body)
            result = execute_command(
                self.ctx.get_client(), {**body, "action": "frame"}
            )
            if source is not None:
                self.ctx.frame_source_id = source
                self.ctx.frame_source_seen = time.monotonic()
            self.ctx.frame_activity.note(time.monotonic())
        # Publishing every frame would fan a full status payload out to all
        # SSE clients ~40x/sec; browsers only react to streaming-state
        # transitions (see public/status_sync.js), so publish just those.
        current = self.ctx.state_broker.current()
        if current is None or _stream_signature(current.payload) != (
            _stream_signature(self.ctx.controller_payload(result))
        ):
            self.ctx.publish(result, "frame")
        return result

    def do_POST(self) -> None:
        path = urlsplit(self.path).path
        try:
            body = self.read_json(self._body_limit(path))
            if self._post_store_route(path, body):
                return
            if self._post_controller_route(path, body):
                return
            self.send_json(
                HTTPStatus.NOT_FOUND, {"error": "Unknown API route."}
            )
        except FrameSourceBusyError as error:
            self.send_json(HTTPStatus.CONFLICT, {"error": str(error)})
        except ConnectionError as error:
            self.send_json(
                HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)}
            )
        except (
            KeyError,
            OSError,
            OverflowError,
            TypeError,
            ValueError,
        ) as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})

    def _post_store_route(self, path: str, body: dict[str, Any]) -> bool:
        if path == "/api/scenes":
            scene = self.ctx.library_store.upsert_scene(body)
            self.send_json(HTTPStatus.OK, {"scene": scene})
            return True
        if path == "/api/playlists":
            playlist = self.ctx.library_store.upsert_playlist(body)
            self.send_json(HTTPStatus.OK, {"playlist": playlist})
            return True
        if path == "/api/palettes":
            palette = self.ctx.library_store.upsert_palette(body)
            self.send_json(HTTPStatus.OK, {"palette": palette})
            return True
        if path == "/api/library/import":
            imported = self.ctx.library_store.import_library(
                body.get("library"), merge=bool(body.get("merge", True))
            )
            self.send_json(HTTPStatus.OK, imported)
            return True
        if path == "/api/automations":
            automation = self.ctx.automation_store.upsert(body)
            self.send_json(HTTPStatus.OK, {"automation": automation})
            return True
        if path == "/api/runtime-policy":
            policy = self.ctx.runtime_policy_store.update(body)
            self.send_json(HTTPStatus.OK, {"runtimePolicy": policy})
            return True
        return False

    def _post_controller_route(self, path: str, body: dict[str, Any]) -> bool:
        if path == "/api/v1/command":
            action = str(body.get("action", "unknown"))
            if action == "frame":
                result = self._execute_frame(body)
            else:
                result = execute_command(self.ctx.get_client(), body)
                self.ctx.publish(result, f"api:{action}")
            self.send_json(
                HTTPStatus.OK,
                {"apiVersion": API_VERSION, "result": result},
            )
            return True
        if path == "/api/movies/bake":
            movie = decode_movie_payload(body)
            # Baking switches panel modes over several seconds; hold the
            # frame lock so a concurrent frame upload cannot restart the
            # realtime relay mid-bake.
            with self.ctx.frame_mode_lock:
                baked = self.ctx.get_client().bake_movie(**movie)
            self.ctx.publish(baked["status"], "movie:bake")
            self.send_json(HTTPStatus.OK, baked)
            return True
        if path == "/api/frame":
            result = self._execute_frame(body)
            self.send_json(HTTPStatus.OK, result)
            return True
        # The unversioned single-purpose routes stay for the bundled UI,
        # but validation is shared with /api/v1/command.
        commands = {
            "/api/brightness": ("brightness", {"value": body.get("value")}),
            "/api/rotation": ("rotation", {"degrees": body.get("degrees")}),
            "/api/mode": ("mode", {"mode": body.get("mode")}),
        }
        if path not in commands:
            return False
        source, arguments = commands[path]
        result = execute_command(
            self.ctx.get_client(), {"action": source, **arguments}
        )
        self.ctx.publish(result, source)
        self.send_json(HTTPStatus.OK, result)
        return True

    def do_DELETE(self) -> None:
        try:
            path = urlsplit(self.path).path
            if path.startswith("/api/scenes/"):
                item_id = path.removeprefix("/api/scenes/")
                deleted = self.ctx.library_store.delete_scene(item_id)
            elif path.startswith("/api/playlists/"):
                item_id = path.removeprefix("/api/playlists/")
                deleted = self.ctx.library_store.delete_playlist(item_id)
            elif path.startswith("/api/palettes/"):
                item_id = path.removeprefix("/api/palettes/")
                deleted = self.ctx.library_store.delete_palette(item_id)
            elif path.startswith("/api/automations/"):
                item_id = path.removeprefix("/api/automations/")
                deleted = self.ctx.automation_store.delete(item_id)
            else:
                self.send_json(
                    HTTPStatus.NOT_FOUND, {"error": "Unknown API route."}
                )
                return
            if not deleted:
                self.send_json(
                    HTTPStatus.NOT_FOUND, {"error": "Library item was not found."}
                )
                return
            self.send_json(HTTPStatus.OK, {"deleted": item_id})
        except (OSError, TypeError, ValueError) as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
