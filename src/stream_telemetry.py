"""Thread-safe delivery counters for the realtime UDP relay."""

from __future__ import annotations

import threading
from collections import deque
from typing import Any

SAMPLE_WINDOW = 240
LATE_THRESHOLD_SECONDS = 0.0015


class StreamTelemetry:
    """Tracks send cadence for the stream loop and reports it as a dict."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._last_sent_version: int | None = None
        self._started_at: float | None = None
        self._last_send_at: float | None = None
        self._first_unique_at: float | None = None
        self._last_unique_at: float | None = None
        self._sent_frames = 0
        self._unique_frames = 0
        self._repeated_frames = 0
        self._late_frames = 0
        self._missed_deadlines = 0
        self._gaps_ms: deque[float] = deque(maxlen=SAMPLE_WINDOW)
        self._unique_gaps_ms: deque[float] = deque(maxlen=SAMPLE_WINDOW)
        self._lateness_ms: deque[float] = deque(maxlen=SAMPLE_WINDOW)

    def reset(self) -> None:
        with self._lock:
            self._last_sent_version = None
            self._started_at = None
            self._last_send_at = None
            self._first_unique_at = None
            self._last_unique_at = None
            self._sent_frames = 0
            self._unique_frames = 0
            self._repeated_frames = 0
            self._late_frames = 0
            self._missed_deadlines = 0
            self._gaps_ms.clear()
            self._unique_gaps_ms.clear()
            self._lateness_ms.clear()

    def record_delivery(
        self,
        sent_at: float,
        deadline: float,
        frame_version: int,
        interval: float,
    ) -> None:
        with self._lock:
            if self._started_at is None:
                self._started_at = sent_at
            if self._last_send_at is not None:
                self._gaps_ms.append((sent_at - self._last_send_at) * 1000)
            lateness = max(0.0, sent_at - deadline)
            self._lateness_ms.append(lateness * 1000)
            self._sent_frames += 1
            if frame_version == self._last_sent_version:
                self._repeated_frames += 1
            else:
                self._unique_frames += 1
                # Repeats are idle keepalives; smoothness on the wall is
                # the cadence of fresh content, tracked separately.
                if self._last_unique_at is not None:
                    self._unique_gaps_ms.append(
                        (sent_at - self._last_unique_at) * 1000
                    )
                else:
                    self._first_unique_at = sent_at
                self._last_unique_at = sent_at
            if lateness > LATE_THRESHOLD_SECONDS:
                self._late_frames += 1
            if lateness > interval:
                self._missed_deadlines += int(lateness // interval)
            self._last_sent_version = frame_version
            self._last_send_at = sent_at

    @staticmethod
    def _percentile(values: deque[float], fraction: float) -> float:
        if not values:
            return 0.0
        ordered = sorted(values)
        index = min(len(ordered) - 1, round((len(ordered) - 1) * fraction))
        return ordered[index]

    def snapshot(self, target_fps: float) -> dict[str, Any]:
        with self._lock:
            elapsed = (
                (self._last_send_at - self._started_at)
                if self._last_send_at is not None
                and self._started_at is not None
                else 0.0
            )
            actual_fps = (
                (self._sent_frames - 1) / elapsed
                if self._sent_frames > 1 and elapsed > 0
                else 0.0
            )
            unique_elapsed = (
                (self._last_unique_at - self._first_unique_at)
                if self._last_unique_at is not None
                and self._first_unique_at is not None
                else 0.0
            )
            unique_fps = (
                (self._unique_frames - 1) / unique_elapsed
                if self._unique_frames > 1 and unique_elapsed > 0
                else 0.0
            )
            return {
                "targetFps": target_fps,
                "actualFps": round(actual_fps, 2),
                "uniqueFps": round(unique_fps, 2),
                "sentFrames": self._sent_frames,
                "uniqueFrames": self._unique_frames,
                "repeatedFrames": self._repeated_frames,
                "lateFrames": self._late_frames,
                "missedDeadlines": self._missed_deadlines,
                "p95GapMs": round(self._percentile(self._gaps_ms, 0.95), 3),
                "maxGapMs": round(max(self._gaps_ms, default=0.0), 3),
                "p95UniqueGapMs": round(
                    self._percentile(self._unique_gaps_ms, 0.95), 3
                ),
                "maxUniqueGapMs": round(
                    max(self._unique_gaps_ms, default=0.0), 3
                ),
                "p95LatenessMs": round(
                    self._percentile(self._lateness_ms, 0.95), 3
                ),
            }
