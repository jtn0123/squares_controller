"""Server-sent events for controller state.

Streaming is a different shape of work from request/response routing —
it holds a socket open for the life of a browser tab — so it lives apart
from the handler's route tables.

Functions take the handler and read `handler.ctx`, `handler.wfile`, and
`handler.headers`; that keeps the wire format in one place without the
handler growing another responsibility.
"""

from __future__ import annotations

import json
from http import HTTPStatus
from typing import Any

from src.state_broker import StateEvent

HEARTBEAT_SECONDS = 15.0


def send_state_event(handler: Any, event: StateEvent) -> None:
    message = json.dumps(
        {
            "source": event.source,
            "status": event.payload,
        },
        separators=(",", ":"),
    )
    body = (
        f"id: {handler.ctx.boot_id}-{event.version}\n"
        "event: state\n"
        f"data: {message}\n\n"
    ).encode("utf-8")
    handler.wfile.write(body)
    handler.wfile.flush()


def last_seen_version(handler: Any) -> int:
    """Resume position from Last-Event-ID, ignoring other boots.

    Versions restart at 1 whenever the server restarts, so ids carry a
    per-process boot epoch. A resume id from a previous boot would
    otherwise silently starve the client until the version counter
    caught up.
    """
    raw = handler.headers.get("Last-Event-ID", "")
    epoch, _, version_text = raw.rpartition("-")
    if epoch != handler.ctx.boot_id:
        return 0
    try:
        return int(version_text)
    except ValueError:
        return 0


def serve(handler: Any) -> None:
    """Stream state changes until the client leaves or the server stops."""
    context = handler.ctx
    status = context.get_client().refresh_status()
    event = context.publish(status, "snapshot")
    last_seen = last_seen_version(handler)

    handler.send_response(HTTPStatus.OK)
    handler.send_header("Content-Type", "text/event-stream; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Connection", "keep-alive")
    handler.send_header("X-Accel-Buffering", "no")
    handler.end_headers()

    try:
        if event.version > last_seen:
            send_state_event(handler, event)
            last_seen = event.version
        while not context.shutting_down.is_set():
            update = context.state_broker.wait_after(
                last_seen, timeout=HEARTBEAT_SECONDS
            )
            if update is None:
                handler.wfile.write(b": keep-alive\n\n")
                handler.wfile.flush()
                continue
            send_state_event(handler, update)
            last_seen = update.version
    except OSError:
        return
