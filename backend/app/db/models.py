import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Resident(Base):
    __tablename__ = 'residents'

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ClinicianDocument(Base):
    __tablename__ = 'clinician_documents'

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    resident_id: Mapped[str] = mapped_column(String(64), ForeignKey('residents.id'), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    filepath: Mapped[str] = mapped_column(String(512))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    extracted_text: Mapped[str] = mapped_column(Text, default='')
    source_type: Mapped[str] = mapped_column(String(32), default='pdf')

    resident = relationship('Resident')


class DocumentChunk(Base):
    __tablename__ = 'document_chunks'
    __table_args__ = (UniqueConstraint('doc_id', 'chunk_index', name='uq_doc_chunk_index'),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    doc_id: Mapped[str] = mapped_column(String(64), ForeignKey('clinician_documents.id'), index=True)
    resident_id: Mapped[str] = mapped_column(String(64), ForeignKey('residents.id'), index=True)
    chunk_index: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)


class WalkingSession(Base):
    __tablename__ = 'walking_sessions'

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    resident_id: Mapped[str] = mapped_column(String(64), ForeignKey('residents.id'), index=True)
    start_ts: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    end_ts: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    summary_json: Mapped[str] = mapped_column(Text, default='{}')


class MetricSample(Base):
    __tablename__ = 'metric_samples'

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    resident_id: Mapped[str] = mapped_column(String(64), ForeignKey('residents.id'), index=True)
    ts: Mapped[int] = mapped_column(Integer, index=True)
    walker_json: Mapped[str] = mapped_column(Text, default='{}')
    vision_json: Mapped[str] = mapped_column(Text, default='{}')
    merged_json: Mapped[str] = mapped_column(Text, default='{}')


class DailyReport(Base):
    __tablename__ = 'daily_reports'
    __table_args__ = (UniqueConstraint('resident_id', 'date', name='uq_daily_report_resident_date'),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    resident_id: Mapped[str] = mapped_column(String(64), ForeignKey('residents.id'), index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    pdf_path: Mapped[str] = mapped_column(String(512))
    summary_json: Mapped[str] = mapped_column(Text, default='{}')
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
