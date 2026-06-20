"""Cryptographic primitives for Python services.

Mirrors ``@polis/domain`` ``sha256Hex``. Returns a lowercase hex digest.
"""

from __future__ import annotations

import hashlib


def sha256_hex(data: bytes) -> str:
    """Return the lowercase hex SHA-256 digest of ``data``.

    Accepts raw bytes only; callers are responsible for any text encoding so the
    hashing surface is explicit at the call site.
    """
    if not isinstance(data, (bytes, bytearray, memoryview)):
        raise TypeError(f"sha256_hex expects bytes, got {type(data).__name__}")
    return hashlib.sha256(data).hexdigest()
