"""psycopg3 connection pool backed by ``DATABASE_URL``.

The pool is created lazily on first use so importing the module (e.g. in tests)
does not require a live database. ``pool.connection()`` handles commit on
success and rollback on exception automatically.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager

from psycopg import Connection
from psycopg_pool import ConnectionPool

_pool: ConnectionPool | None = None


def _get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        url = os.environ.get("DATABASE_URL")
        if not url:
            raise RuntimeError("DATABASE_URL is required")
        _pool = ConnectionPool(
            conninfo=url,
            min_size=1,
            max_size=8,
            timeout=5.0,
            open=True,
        )
    return _pool


@contextmanager
def get_conn() -> Iterator[Connection]:
    """Yield a pooled connection; auto-commit on success, rollback on error."""
    pool = _get_pool()
    with pool.connection() as conn:
        yield conn
