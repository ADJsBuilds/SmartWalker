# Backend Map (Verified)

This document is verified against the current code under `backend/app`.

## 1) App Startup

- **App factory symbol:** `create_app()` in `backend/app/main.py`
- **App instance symbol:** `app = create_app()` in `backend/app/main.py`
- **Lifespan hook:** `lifespan()` in `backend/app/main.py`
  - Calls `setup_logging(get_settings().log_level)`
  - Calls `init_db()`
- **DB bootstrap:** `init_db()` in `backend/app/db/init_db.py`
  - Ensures `Path(settings.storage_dir)` exists
  - Runs `Base.metadata.create_all(bind=engine)`
- **Settings source:** `Settings` + `get_settings()` in `backend/app/core/config.py`
  - `get_settings()` is `@lru_cache`d and can be reset in tests with `get_settings.cache_clear()`

## 2) DB Setup + Models

### Engine/session symbols

- `DATABASE_URL`, `engine`, `SessionLocal`, `Base`, `get_db()` in `backend/app/db/session.py`
- SQLite `check_same_thread=False` when URL starts with `sqlite`.

### Tables + model symbols (`backend/app/db/models.py`)

- `Resident` -> `residents`
- `ClinicianDocument` -> `clinician_documents`
- `DocumentChunk` -> `document_chunks`
- `WalkingSession` -> `walking_sessions`
- `MetricSample` -> `metric_samples`
- `DailyReport` -> `daily_reports`
- `IngestEvent` -> `ingest_events`
- `HourlyMetricRollup` -> `hourly_metric_rollups`
- `DailyMetricRollup` -> `daily_metric_rollups`
- `ExerciseMetricSample` -> `exercise_metric_samples`

### Required columns checked for target tables

- `residents`: `id`, `name`, `created_at`
- `metric_samples`: `id`, `resident_id`, `ts`, `walker_json`, `vision_json`, `merged_json`
- `exercise_metric_samples`: `id`, `resident_id`, `camera_id`, `ts`, vision metrics columns, merged metrics columns (`steps_merged`, `tilt_deg`, `step_var`), `created_at`
- `ingest_events`: `id`, `resident_id`, `ts`, `event_type`, `severity`, `payload_json`, `created_at`
- `hourly_metric_rollups`: `id`, `resident_id`, `bucket_start_ts`, `date`, aggregates, `updated_at`
- `daily_metric_rollups`: `id`, `resident_id`, `date`, aggregates, `updated_at`
- `daily_reports`: `id`, `resident_id`, `date`, `pdf_path`, `summary_json`, `created_at`
- `clinician_documents`: `id`, `resident_id`, `filename`, `filepath`, `uploaded_at`, `extracted_text`, `source_type`
- `document_chunks`: `id`, `doc_id`, `resident_id`, `chunk_index`, `text`
- `walking_sessions`: `id`, `resident_id`, `start_ts`, `end_ts`, `summary_json`

### Constraints/indexes (verified in model definitions)

- Unique constraints:
  - `document_chunks`: `(doc_id, chunk_index)`
  - `daily_reports`: `(resident_id, date)`
  - `hourly_metric_rollups`: `(resident_id, bucket_start_ts)`
  - `daily_metric_rollups`: `(resident_id, date)`
- FK relationships:
  - `resident_id` FKs from multiple tables -> `residents.id`
  - `document_chunks.doc_id` -> `clinician_documents.id`
- Indexed columns are declared via `index=True` on `resident_id`, `ts`, `date`, bucket/event keys.

## 3) Ingest (Schemas + Behavior)

Source file: `backend/app/routers/ingest.py`

### Pydantic models

- `WalkerPacket` (`ConfigDict(populate_by_name=True, extra='ignore')`)
  - Required: `residentId: str`, `fsrLeft: int`, `fsrRight: int`
  - Optional: `deviceId: str | None`, `ts: int | None`, `tiltDeg: float | None`, `steps: int | None`
  - Aliases supported: snake_case variants.

- `VisionPacket` (`ConfigDict(populate_by_name=True, extra='ignore')`)
  - Required: `residentId: str`
  - Optional: `cameraId`, `ts`, `fallSuspected`, `fallCount`, `totalTimeOnGroundSeconds`, `postureState`, `stepCount`, `cadenceSpm`, `avgCadenceSpm`, `stepTimeCv`, `stepTimeMean`, `activityState`, `asymmetryIndex`, `fallRiskLevel`, `fallRiskScore`, `fogStatus`, `fogEpisodes`, `fogDurationSeconds`, `stepVar`, `personDetected`, `confidence`, `sourceFps`, `inferenceMs`, `frameId`
  - Aliases supported: snake_case variants.

### Ingest endpoints + responses

- `post_walker()` -> `POST /api/walker`
  - `200 {"ok": true}`
  - Validation errors handled by FastAPI (`422`)
- `post_vision()` -> `POST /api/vision`
  - `200 {"ok": true}`
  - Validation errors (`422`)

### Persistence throttling logic

- In `_update_and_push(...)`:
  - `persist_interval_seconds = INGEST_PERSIST_INTERVAL_SECONDS` (default 5)
  - `full_payload_every = INGEST_STORE_FULL_PAYLOAD_EVERY_N_SAMPLES` (default 3)
  - `analytics_interval_seconds = max(1, persist_interval_seconds // 2)`
- Writes:
  - Always computes merged + broadcasts WS update.
  - Creates resident row if needed (`db.add(Resident...)` + `db.flush()`).
  - Analytics tick (events/rollups) runs on critical packets or interval.
  - Sample writes to `metric_samples` only if interval elapsed.
  - On each sample write also writes normalized `exercise_metric_samples`.
  - Full raw JSON stored every Nth sample; compact payload otherwise.

### Tables touched on ingest path

- `residents`
- `metric_samples`
- `exercise_metric_samples`
- `ingest_events` (via analytics service)
- `hourly_metric_rollups` (via analytics service)
- `daily_metric_rollups` (via analytics service)

## 4) In-Memory State + Merge

Source file: `backend/app/services/merge_state.py`

- State dicts:
  - `walker_state`
  - `vision_state`
  - `merged_state`
- Merge function: `compute_merged(resident_id)`
  - `steps` prioritizes vision step count over walker steps.
  - `reliance = fsrLeft + fsrRight + 1e-6`
  - `balance = (fsrLeft - fsrRight)/reliance`
  - `fallSuspected = vision.fallSuspected or (tiltDeg >= 60)`

### State endpoint

- `get_state()` -> `GET /api/state/{resident_id}` in `backend/app/routers/ingest.py`
  - Returns merged object if present, else `{"error": "no state yet"}`.

## 5) WebSocket Behavior

Source: `backend/app/routers/ws.py`, `backend/app/services/ws_manager.py`

- Endpoints:
  - `/ws` (global)
  - `/ws/live?residentId=<optional>`
- On connect:
  - Sends `{"type":"snapshot","data":[...]}`
  - Global gets all merged states; resident-scoped gets one resident list or empty list.
- On ingest:
  - `_update_and_push()` broadcasts:
    - `{"type":"merged_update","data": <merged_object>}`
  - Sent to all connections and resident-filtered subscribers.

## 6) Reports / PDF / Stats

Source: `backend/app/routers/reports.py`, `backend/app/services/report_pdf.py`, `backend/app/services/storage.py`

- `generate_daily_report()` -> `POST /api/reports/daily/generate`
  - Query params: `residentId`, `date`, `usePlaceholder` (optional bool)
  - If `usePlaceholder=true`, uses deterministic hardcoded sample stats.
  - Else prefers `DailyMetricRollup` for day if available, fallback to `MetricSample` scan.
  - Generates PDF via `build_daily_pdf(...)` and stores/updates `DailyReport`.
  - Returns: `{"pdfPath","reportId","usedPlaceholderData"}`
- `download_report()` -> `GET /api/reports/daily/{report_id}/download`
  - Returns file with no-cache headers.
- `report_stats()` -> `GET /api/reports/stats`
  - Returns chart-ready `daily`, `hourly`, `events`.
- `backfill_rollups()` -> `POST /api/reports/rollups/backfill`
  - Recomputes daily/hourly rollups from `metric_samples`.

PDF output path:
- `resident_report_path()` in `backend/app/services/storage.py`
- `<STORAGE_DIR>/residents/<resident_id>/reports/<date>.pdf`

## 7) Router Mount Mismatch Check

### Verified mismatch

- `backend/app/routers/exercise_metrics.py` defines routes:
  - `/api/exercise-metrics/live`
  - `/api/exercise-metrics/aggregates`
  - `/api/exercise-metrics/summary`
- **Not mounted** in `backend/app/main.py` (`exercise_metrics.router` is not included).

Status:
- Currently effectively disabled/unreachable unless router is mounted.
