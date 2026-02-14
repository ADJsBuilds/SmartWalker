from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.models import Resident
from app.db.session import get_db

router = APIRouter(tags=['patients'])


class ResidentCreate(BaseModel):
    residentId: str
    name: Optional[str] = None


@router.post('/api/residents')
def create_resident(payload: ResidentCreate, db: Session = Depends(get_db)):
    existing = db.get(Resident, payload.residentId)
    if existing:
        existing.name = payload.name or existing.name
        db.commit()
        db.refresh(existing)
        return {'residentId': existing.id, 'name': existing.name, 'createdAt': existing.created_at}

    resident = Resident(id=payload.residentId, name=payload.name)
    db.add(resident)
    db.commit()
    db.refresh(resident)
    return {'residentId': resident.id, 'name': resident.name, 'createdAt': resident.created_at}


@router.get('/api/residents')
def list_residents(db: Session = Depends(get_db)):
    rows = db.query(Resident).order_by(Resident.created_at.desc()).all()
    return [
        {'residentId': r.id, 'name': r.name, 'createdAt': r.created_at}
        for r in rows
    ]


@router.get('/api/residents/{resident_id}')
def get_resident(resident_id: str, db: Session = Depends(get_db)):
    row = db.get(Resident, resident_id)
    if not row:
        raise HTTPException(status_code=404, detail='resident not found')
    return {'residentId': row.id, 'name': row.name, 'createdAt': row.created_at}
