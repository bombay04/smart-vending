"""Thread-safe ephemeral state for localhost face scan preview/status."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any


TERMINAL_STATES = {"SUCCESS", "ERROR", "CANCELLED"}


@dataclass
class ScanRecord:
    scan_id: str
    state: str = "CAMERA_STARTING"
    challenge: str | None = None
    progress: int = 0
    required: int = 0
    jpeg: bytes | None = None
    preview_version: int = 0
    updated_at: float = field(default_factory=time.monotonic)
    cancelled: threading.Event = field(default_factory=threading.Event)


class FaceScanRegistry:
    def __init__(self, *, retention_seconds: float = 30.0) -> None:
        self.retention_seconds = retention_seconds
        self._lock = threading.Lock()
        self._records: dict[str, ScanRecord] = {}

    def begin(self, scan_id: str) -> bool:
        with self._lock:
            self._purge_locked()
            if scan_id in self._records:
                return False
            self._records[scan_id] = ScanRecord(scan_id)
            return True

    def update(
        self,
        scan_id: str,
        state: str,
        challenge: str | None,
        progress: int,
        required: int,
    ) -> None:
        with self._lock:
            record = self._records.get(scan_id)
            if record is None or record.state in TERMINAL_STATES:
                return
            record.state = state
            record.challenge = challenge
            record.progress = progress
            record.required = required
            record.updated_at = time.monotonic()

    def set_jpeg(self, scan_id: str, jpeg: bytes) -> None:
        with self._lock:
            record = self._records.get(scan_id)
            if record is None or record.state in TERMINAL_STATES:
                return
            record.jpeg = jpeg
            record.preview_version += 1
            record.updated_at = time.monotonic()

    def finish(self, scan_id: str, state: str) -> None:
        with self._lock:
            record = self._records.get(scan_id)
            if record is None:
                return
            record.state = state
            record.jpeg = None
            record.updated_at = time.monotonic()

    def cancel(self, scan_id: str) -> bool:
        with self._lock:
            record = self._records.get(scan_id)
            if record is None:
                return False
            record.cancelled.set()
            if record.state not in TERMINAL_STATES:
                record.state = "CANCELLED"
                record.jpeg = None
                record.updated_at = time.monotonic()
            return True

    def is_cancelled(self, scan_id: str) -> bool:
        with self._lock:
            record = self._records.get(scan_id)
            return record is None or record.cancelled.is_set()

    def status(self, scan_id: str) -> dict[str, Any] | None:
        with self._lock:
            self._purge_locked()
            record = self._records.get(scan_id)
            if record is None:
                return None
            return {
                "state": record.state,
                "challenge": record.challenge,
                "progress": record.progress,
                "required": record.required,
                "previewReady": record.jpeg is not None,
                "previewVersion": record.preview_version,
            }

    def jpeg(self, scan_id: str) -> bytes | None:
        with self._lock:
            record = self._records.get(scan_id)
            return None if record is None else record.jpeg

    def _purge_locked(self) -> None:
        now = time.monotonic()
        expired = [
            scan_id
            for scan_id, record in self._records.items()
            if record.state in TERMINAL_STATES
            and now - record.updated_at >= self.retention_seconds
        ]
        for scan_id in expired:
            del self._records[scan_id]

