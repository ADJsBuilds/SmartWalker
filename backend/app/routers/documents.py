from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.db.models import ClinicianDocument, Resident
from app.db.session import get_db
from app.services.pdf_extract import extract_pdf_text
from app.services.retrieval import index_document_chunks
from app.services.storage import save_resident_document

router = APIRouter(tags=['documents'])


@router.post('/api/residents/{resident_id}/documents')
async def upload_document(resident_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    resident = db.get(Resident, resident_id)
    if not resident:
        raise HTTPException(status_code=404, detail='resident not found')

    path = await save_resident_document(resident_id, file)
    text = extract_pdf_text(path)

    row = ClinicianDocument(
        resident_id=resident_id,
        filename=file.filename or Path(path).name,
        filepath=path,
        extracted_text=text,
        source_type='pdf',
    )
    db.add(row)
    db.flush()

    index_document_chunks(db, row.id, resident_id, text)
    db.commit()
    db.refresh(row)

    return {
        'docId': row.id,
        'residentId': row.resident_id,
        'filename': row.filename,
        'uploadedAt': row.uploaded_at,
    }


@router.get('/api/residents/{resident_id}/documents')
def list_documents(resident_id: str, db: Session = Depends(get_db)):
    rows = (
        db.query(ClinicianDocument)
        .filter(ClinicianDocument.resident_id == resident_id)
        .order_by(ClinicianDocument.uploaded_at.desc())
        .all()
    )
    return [
        {
            'docId': d.id,
            'filename': d.filename,
            'sourceType': d.source_type,
            'uploadedAt': d.uploaded_at,
        }
        for d in rows
    ]


@router.get('/api/documents/{doc_id}')
def get_document(doc_id: str, db: Session = Depends(get_db)):
    row = db.get(ClinicianDocument, doc_id)
    if not row:
        raise HTTPException(status_code=404, detail='document not found')
    return {
        'docId': row.id,
        'residentId': row.resident_id,
        'filename': row.filename,
        'filepath': row.filepath,
        'uploadedAt': row.uploaded_at,
        'textPreview': (row.extracted_text or '')[:1200],
    }
