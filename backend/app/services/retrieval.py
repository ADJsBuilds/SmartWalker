import math
import re
from collections import Counter
from typing import List

from rapidfuzz import fuzz
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.db.models import DocumentChunk


_TOKEN_RE = re.compile(r'[a-zA-Z0-9]+')


def chunk_text(text: str, size: int = 700, overlap: int = 120) -> List[str]:
    if not text:
        return []
    chunks: List[str] = []
    start = 0
    while start < len(text):
        end = min(len(text), start + size)
        chunks.append(text[start:end])
        if end == len(text):
            break
        start = max(end - overlap, start + 1)
    return chunks


def index_document_chunks(db: Session, doc_id: str, resident_id: str, text: str) -> None:
    db.execute(delete(DocumentChunk).where(DocumentChunk.doc_id == doc_id))
    for idx, chunk in enumerate(chunk_text(text)):
        db.add(DocumentChunk(doc_id=doc_id, resident_id=resident_id, chunk_index=idx, text=chunk))


def _tokens(s: str) -> list[str]:
    return [t.lower() for t in _TOKEN_RE.findall(s)]


def _score(query: str, chunk: str) -> float:
    q_tokens = _tokens(query)
    c_tokens = _tokens(chunk)
    if not q_tokens or not c_tokens:
        return 0.0

    qc = Counter(q_tokens)
    cc = Counter(c_tokens)
    overlap = sum(min(v, cc.get(k, 0)) for k, v in qc.items())
    norm = overlap / math.sqrt(len(q_tokens) * len(c_tokens))
    fuzz_score = fuzz.partial_ratio(query, chunk) / 100.0
    return (norm * 0.6) + (fuzz_score * 0.4)


def retrieve_top_chunks(db: Session, resident_id: str, query: str, top_k: int = 4) -> list[dict]:
    rows = db.query(DocumentChunk).filter(DocumentChunk.resident_id == resident_id).all()
    ranked = sorted(rows, key=lambda r: _score(query, r.text), reverse=True)
    out = []
    for row in ranked[:top_k]:
        out.append({'docId': row.doc_id, 'snippet': row.text[:400]})
    return out
