"""Read-only ESP32 liveness and bounded USB Serial reconnection."""

from __future__ import annotations

import logging
import threading
import time
from typing import Callable, Protocol


class SerialConnection(Protocol):
    @property
    def is_connected(self) -> bool: ...

    def connect(self) -> None: ...

    def close(self) -> None: ...

    def clear_input_buffer(self) -> None: ...

    def ping(self) -> None: ...

    def read_line(self) -> str | None: ...


class SerialRecoveryManager:
    """Own one Serial handle; never sends or retains an unlock command."""

    def __init__(
        self,
        client: SerialConnection,
        operation_lock: threading.Lock,
        status_probe: Callable[[SerialConnection], object],
        *,
        clock: Callable[[], float] = time.monotonic,
        logger: logging.Logger | None = None,
        ping_timeout: float = 2.0,
        probe_interval: float = 2.0,
        max_ready_age: float = 6.0,
        initial_backoff: float = 0.5,
        max_backoff: float = 5.0,
    ) -> None:
        self.client = client
        self.operation_lock = operation_lock
        self.status_probe = status_probe
        self.clock = clock
        self.logger = logger or logging.getLogger(__name__)
        self.ping_timeout = ping_timeout
        self.probe_interval = probe_interval
        self.max_ready_age = max_ready_age
        self.initial_backoff = initial_backoff
        self.max_backoff = max_backoff
        self._state_lock = threading.Lock()
        self._last_verified_at: float | None = None
        self._next_attempt_at = 0.0
        self._backoff = initial_backoff
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def readiness(self) -> tuple[bool, float | None]:
        """Return cached, time-limited readiness without touching Serial."""
        now = self.clock()
        with self._state_lock:
            verified_at = self._last_verified_at
        if verified_at is None:
            return False, None
        age = max(0.0, now - verified_at)
        return age <= self.max_ready_age, age

    def note_status_success_locked(self) -> None:
        """A complete fresh GET_STATUS is also a liveness observation."""
        with self._state_lock:
            self._last_verified_at = self.clock()

    def invalidate_locked(self, reason: str) -> None:
        """Caller holds operation_lock; no other operation can use this handle."""
        now = self.clock()
        with self._state_lock:
            self._last_verified_at = None
            self._next_attempt_at = now + self._backoff
            self._backoff = min(self._backoff * 2, self.max_backoff)
        try:
            self.client.close()
        except Exception as error:
            self.logger.warning("Unable to close invalid ESP32 Serial handle: %s", error)
        self.logger.warning("ESP32 Serial unavailable: %s", reason)

    def _ping_locked(self) -> None:
        # There is no OPEN response reader in this phase. The operation lock
        # ensures this read-only probe cannot run during an active write.
        self.client.clear_input_buffer()
        self.client.ping()
        deadline = self.clock() + self.ping_timeout
        while self.clock() < deadline:
            line = self.client.read_line()
            if line == "PONG":
                return
            if line is not None and line.startswith("ERROR:"):
                raise RuntimeError(f"ESP32 rejected PING: {line}")
        raise TimeoutError("No fresh ESP32 PONG")

    def step(self) -> bool:
        """Perform at most one probe/connection attempt; return verified readiness."""
        if self._stop_event.is_set():
            return False
        now = self.clock()
        with self._state_lock:
            waiting = now < self._next_attempt_at
        if waiting:
            return self.readiness()[0]
        if not self.operation_lock.acquire(timeout=0.1):
            return self.readiness()[0]
        try:
            ready, _ = self.readiness()
            if ready and self.client.is_connected:
                self._ping_locked()
            else:
                self.client.close()
                self.client.connect()
                self._ping_locked()
                self.status_probe(self.client)
            verified_at = self.clock()
            with self._state_lock:
                self._last_verified_at = verified_at
                self._next_attempt_at = verified_at + self.probe_interval
                self._backoff = self.initial_backoff
            return True
        except Exception as error:
            self.invalidate_locked(str(error))
            return False
        finally:
            self.operation_lock.release()

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(
            target=self._run, name="esp32-serial-recovery", daemon=True
        )
        self._thread.start()

    def _run(self) -> None:
        while not self._stop_event.is_set():
            self.step()
            self._stop_event.wait(0.25)

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=6)
            self._thread = None
        with self.operation_lock:
            try:
                self.client.close()
            except Exception as error:
                self.logger.warning("Unable to close ESP32 Serial handle: %s", error)
            with self._state_lock:
                self._last_verified_at = None
