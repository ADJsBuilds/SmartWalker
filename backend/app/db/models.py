import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
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


class IngestEvent(Base):
    __tablename__ = 'ingest_events'

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    resident_id: Mapped[str] = mapped_column(String(64), ForeignKey('residents.id'), index=True)
    ts: Mapped[int] = mapped_column(Integer, index=True)
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    severity: Mapped[str] = mapped_column(String(32), default='info')
    payload_json: Mapped[str] = mapped_column(Text, default='{}')
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class HourlyMetricRollup(Base):
    __tablename__ = 'hourly_metric_rollups'
    __table_args__ = (UniqueConstraint('resident_id', 'bucket_start_ts', name='uq_hourly_rollup_resident_bucket'),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    resident_id: Mapped[str] = mapped_column(String(64), ForeignKey('residents.id'), index=True)
    bucket_start_ts: Mapped[int] = mapped_column(Integer, index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    sample_count: Mapped[int] = mapped_column(Integer, default=0)
    steps_max: Mapped[int] = mapped_column(Integer, default=0)
    cadence_sum: Mapped[float] = mapped_column(Float, default=0.0)
    cadence_count: Mapped[int] = mapped_column(Integer, default=0)
    step_var_sum: Mapped[float] = mapped_column(Float, default=0.0)
    step_var_count: Mapped[int] = mapped_column(Integer, default=0)
    fall_count: Mapped[int] = mapped_column(Integer, default=0)
    tilt_spike_count: Mapped[int] = mapped_column(Integer, default=0)
    heavy_lean_count: Mapped[int] = mapped_column(Integer, default=0)
    inactivity_count: Mapped[int] = mapped_column(Integer, default=0)
    active_seconds: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class DailyMetricRollup(Base):
    __tablename__ = 'daily_metric_rollups'
    __table_args__ = (UniqueConstraint('resident_id', 'date', name='uq_daily_rollup_resident_date'),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    resident_id: Mapped[str] = mapped_column(String(64), ForeignKey('residents.id'), index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    sample_count: Mapped[int] = mapped_column(Integer, default=0)
    steps_max: Mapped[int] = mapped_column(Integer, default=0)
    cadence_sum: Mapped[float] = mapped_column(Float, default=0.0)
    cadence_count: Mapped[int] = mapped_column(Integer, default=0)
    step_var_sum: Mapped[float] = mapped_column(Float, default=0.0)
    step_var_count: Mapped[int] = mapped_column(Integer, default=0)
    fall_count: Mapped[int] = mapped_column(Integer, default=0)
    tilt_spike_count: Mapped[int] = mapped_column(Integer, default=0)
    heavy_lean_count: Mapped[int] = mapped_column(Integer, default=0)
    inactivity_count: Mapped[int] = mapped_column(Integer, default=0)
    active_seconds: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ExerciseMetricSample(Base):
    """
    Normalized table: one row per vision/merged sample.
    Used for live exercise dashboard (recent rows) and aggregate historical data (homepage, doctor view).
    All vision + config fields as columns; optional fields nullable.
    """
    __tablename__ = 'exercise_metric_samples'

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    resident_id: Mapped[str] = mapped_column(String(64), ForeignKey('residents.id'), index=True)
    camera_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    ts: Mapped[int] = mapped_column(Integer, index=True)

    fall_suspected: Mapped[bool] = mapped_column(Boolean, default=False)
    fall_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    total_time_on_ground_seconds: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    posture_state: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    step_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    cadence_spm: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    avg_cadence_spm: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    step_time_cv: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    step_time_mean: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    activity_state: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    asymmetry_index: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    fall_risk_level: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    fall_risk_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    fog_status: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    fog_episodes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    fog_duration_seconds: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    person_detected: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    source_fps: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    frame_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    steps_merged: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    tilt_deg: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    step_var: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
