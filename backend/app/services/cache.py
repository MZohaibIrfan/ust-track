"""Process-local TTL cache for read-mostly catalog payloads."""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")

_STORE: dict[str, tuple[float, object]] = {}
DEFAULT_TTL = 300.0


def cached(key: str, loader: Callable[[], T], ttl: float = DEFAULT_TTL) -> T:
    now = time.monotonic()
    hit = _STORE.get(key)
    if hit is not None and now - hit[0] < ttl:
        return hit[1]  # type: ignore[return-value]
    value = loader()
    _STORE[key] = (now, value)
    return value


def forget(key: str) -> None:
    _STORE.pop(key, None)
