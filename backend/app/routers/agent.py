from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.services.openevidence import OpenEvidenceClient, normalize_openevidence
from app.services.retrieval import retrieve_top_chunks

router = APIRouter(tags=['agent'])


class AgentAskPayload(BaseModel):
    residentId: str
    question: str
    conversationId: Optional[str] = None


@router.post('/api/agent/ask')
async def ask_agent(payload: AgentAskPayload, db: Session = Depends(get_db)):
    context = retrieve_top_chunks(db, payload.residentId, payload.question, top_k=4)
    context_text = "\n\n".join([c['snippet'] for c in context])

    condensed_query = f"Question: {payload.question}\n\nResident context:\n{context_text[:2000]}"
    evidence_note = 'No external evidence available.'
    citations = []

    try:
        raw = await OpenEvidenceClient().ask({'query': condensed_query, 'metadata': {'residentId': payload.residentId}})
        normalized = normalize_openevidence(raw if isinstance(raw, dict) else {})
        citations = normalized.get('citations', [])[:5]
        findings = normalized.get('findings', [])
        if findings:
            answer = ' '.join(str(f) for f in findings[:3])
            evidence_note = 'External evidence included.'
        else:
            answer = f"Based on uploaded docs: {context[0]['snippet'][:240]}" if context else 'No relevant patient context found.'
    except Exception:
        answer = f"Based on uploaded docs: {context[0]['snippet'][:240]}" if context else 'No relevant patient context found.'

    return {
        'answer': f"{answer}\n\n{evidence_note}",
        'citations': citations,
        'contextUsed': context,
        'heygen': {'textToSpeak': answer[:240]},
    }
