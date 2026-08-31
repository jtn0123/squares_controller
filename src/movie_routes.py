"""Routes for the local movie archive.

Kept out of http_api so the handler stays under the project's file-size
limit and so archive behaviour can be tested without a server.

`handle` returns a (status, payload) pair, or None when the path is not
an archive route, which lets the handler fall through to its own tables.
"""

from __future__ import annotations

import base64
from http import HTTPStatus
from typing import Any

PREFIX = "/api/movies/archive"
NOT_FOUND = (HTTPStatus.NOT_FOUND, {"error": "Archived movie not found."})


def _entry_id(path: str) -> str:
    return path.removeprefix(f"{PREFIX}/").split("/", 1)[0]


def handle(
    ctx: Any, method: str, path: str, body: dict[str, Any]
) -> tuple[HTTPStatus, dict[str, Any]] | None:
    archive = ctx.movie_archive

    if path == PREFIX and method == "GET":
        return HTTPStatus.OK, {"archive": archive.snapshot()}

    if path == "/api/movies/import" and method == "POST":
        saved = archive.import_entry(body.get("archive"))
        return HTTPStatus.OK, {"archived": saved}

    if not path.startswith(f"{PREFIX}/"):
        return None

    archive_id = _entry_id(path)

    if method == "GET" and path == f"{PREFIX}/{archive_id}":
        try:
            # The full entry, frame data included: this is what the
            # browser saves to disk and hands back later.
            return HTTPStatus.OK, {"archive": archive.read(archive_id)}
        except KeyError:
            return NOT_FOUND

    if method == "DELETE" and path == f"{PREFIX}/{archive_id}":
        if archive.delete(archive_id):
            return HTTPStatus.OK, {"deleted": archive_id}
        return NOT_FOUND

    if method == "POST" and path == f"{PREFIX}/{archive_id}/restore":
        return _restore(ctx, archive_id, body)

    return None


def _restore(
    ctx: Any, archive_id: str, body: dict[str, Any]
) -> tuple[HTTPStatus, dict[str, Any]]:
    try:
        entry = ctx.movie_archive.read(archive_id)
    except KeyError:
        return NOT_FOUND
    pixels = base64.b64decode(entry["pixelsBase64"])
    # Baking switches panel modes over several seconds; hold the
    # frame lock so a concurrent upload cannot restart the relay.
    with ctx.frame_mode_lock:
        baked = ctx.get_client().bake_movie(
            str(body.get("name") or entry["name"]),
            pixels,
            width=int(entry["width"]),
            height=int(entry["height"]),
            frame_count=int(entry["frameCount"]),
            fps=int(entry["fps"]),
            gamma=float(entry.get("gamma", 2.2)),
            saturation=float(entry.get("saturation", 1.0)),
        )
    ctx.publish(baked["status"], "movie:restore")
    return HTTPStatus.OK, baked
