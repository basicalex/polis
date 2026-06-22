"""Retrieval over approved evidence-vault sources (spec §6.3 / §12).

Keyword ``ILIKE`` retrieval — deterministic, no embeddings in M5. Only approved,
public claims backed by official/legal sources are returned.
"""

from polis_core import RetrievalChunk, extract_keywords
from polis_core.models import ConfidenceState
from psycopg import Connection
from psycopg.rows import dict_row

APPROVED_SOURCE_TYPES = ("official", "legal")

_RETRIEVE_SQL = """
SELECT c.id AS claim_id, c.text, c.confidence_state, c.confidence,
       el.id AS evidence_link_id, el.source_id, s.title AS source_title,
       s.source_type, s.url AS source_url
FROM claims c
JOIN evidence_links el ON el.claim_id = c.id
JOIN sources s ON s.id = el.source_id
WHERE c.review_state = 'approved'
  AND c.visibility = 'public'
  AND s.source_type IN ('official','legal')
  AND (c.text ILIKE ANY(%s) OR s.title ILIKE ANY(%s))
ORDER BY c.confidence DESC
LIMIT 5
"""


def retrieve(conn: Connection, question: str) -> list[RetrievalChunk]:
    """Return approved public chunks whose claim text or source title matches.

    Empty keyword list (after stopword filtering) returns no chunks.
    """
    keywords = extract_keywords(question)
    if not keywords:
        return []
    patts = [f"%{k}%" for k in keywords]
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(_RETRIEVE_SQL, (patts, patts))
        rows = cur.fetchall()
    return [
        RetrievalChunk(
            claimId=row["claim_id"],
            text=row["text"],
            confidenceState=ConfidenceState(row["confidence_state"]),
            evidenceLinkId=row["evidence_link_id"],
            sourceId=row["source_id"],
            sourceTitle=row["source_title"],
            sourceType=row["source_type"],
            sourceUrl=row["source_url"],
        )
        for row in rows
    ]
