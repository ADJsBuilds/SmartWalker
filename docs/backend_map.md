# Backend Map

## A) Runtime + Framework

- **Language/stack:** Python + FastAPI + SQLAlchemy ORM.
- **App entrypoint:** `backend/app/main.py`
  - `create_app()` registers routers + CORS middleware.
  - lifespan hook calls `init_db()` at startup.
- **Server start command (current Render/backend convention):**
  - `python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- **Config/env source:** `backend/app/core/config.py` (`pydantic-settings`).
- **Database engine/session setup:** `backend/app/db/session.py`.

### Core Env Vars (actively used by backend core flow)

- `DATABASE_URL` (default: `sqlite:///./data/app.db`)
- `STORAGE_DIR` (default: `./data`)
- `CORS_ALLOW_ORIGINS` (list parser supports JSON list or comma-separated string)
- `LOG_LEVEL`
- `INGEST_PERSIST_INTERVAL_SECONDS` (default `5`)
- `INGEST_STORE_FULL_PAYLOAD_EVERY_N_SAMPLES` (default `3`)
- `GEMINI_ENABLED`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_BASE_URL` (report/suggestions generation)
- plus integration-specific keys (LiveAvatar/LiveAgent/Zoom/ElevenLabs/OpenEvidence, etc.) in `backend/app/core/config.py`.

## B) API Surface

Source routers registered in `backend/app/main.py`:

- `health`, `ingest`, `ws`, `patients`, `documents`, `reports`, `suggestions`, `agent`, `integrations`, `carrier`, `liveavatar`, `eleven`

### Registered Endpoints

#### Health
- `GET /health` -> service liveness.

#### Ingest + state
- `POST /api/walker`
- `POST /api/vision`
- `GET /api/state/{resident_id}`

#### WebSocket
- `WS /ws`
- `WS /ws/live?residentId=<optional>`

#### Residents
- `POST /api/residents`
- `GET /api/residents`
- `GET /api/residents/{resident_id}`

#### Documents
- `POST /api/residents/{resident_id}/documents` (multipart upload)
- `GET /api/residents/{resident_id}/documents`
- `GET /api/documents/{doc_id}`

#### Reports + stats
- `POST /api/reports/daily/generate`
- `GET /api/reports/daily/{report_id}/download`
- `GET /api/reports/stats`
- `POST /api/reports/rollups/backfill`

#### Suggestions
- `GET /api/suggestions/exercise-regimen`

#### Agent / coach
- `POST /api/agent/ask`
- `POST /api/coach/script`

#### Integrations
- `POST /api/integrations/openevidence`
- `POST /api/integrations/heygen` (deprecated passthrough)
- `GET /api/heygen/avatars` (returns 410/deprecated)
- `POST /api/heygen/speak` (deprecated path still present)
- `POST /api/liveagent/session/token`
- `POST /api/liveagent/session/start`
- `POST /api/liveagent/session/bootstrap`
- `POST /api/liveagent/session/stop`
- `POST /api/liveagent/session/event`

#### Carrier
- `POST /api/carrier/zoom-invite`

#### LiveAvatar/ElevenLabs
- `POST /api/liveavatar/lite/create`
- `POST /heygen/session/token` (alias)
- `POST /api/liveavatar/lite/start`
- `POST /heygen/session/start` (alias)
- `POST /api/liveavatar/lite/new`
- `POST /api/liveavatar/lite/stop`
- `POST /heygen/session/stop` (alias)
- `GET /api/liveavatar/lite/status/{session_id}`
- `POST /api/liveavatar/lite/interrupt`
- `POST /api/liveavatar/lite/start-listening`
- `POST /api/liveavatar/lite/stop-listening`
- `POST /api/liveavatar/lite/keepalive`
- `POST /api/liveavatar/lite/test-tone`
- `POST /api/liveavatar/lite/speak-text`
- `POST /api/elevenlabs/speak`

#### Eleven conversation endpoints
- `GET /api/eleven/signed-url`
- `POST /api/eleven/session`

### Ingest endpoint schemas (raw extract)

Defined in `backend/app/routers/ingest.py` via Pydantic.

#### `POST /api/walker`

Request model: `WalkerPacket`

- Required:
  - `residentId: str` (alias `resident_id`)
  - `fsrLeft: int` (alias `fsr_left`)
  - `fsrRight: int` (alias `fsr_right`)
- Optional:
  - `deviceId: str | None` (alias `device_id`)
  - `ts: int | None`
  - `tiltDeg: float | None` (alias `tilt_deg`)
  - `steps: int | None`
- Unknown extra fields: ignored (`extra='ignore'`).

Response:
- `200`: `{"ok": true}`
- Validation errors: FastAPI/Pydantic `422`.

#### `POST /api/vision`

Request model: `VisionPacket`

- Required:
  - `residentId: str` (alias `resident_id`)
- Optional:
  - `cameraId: str | None` (alias `camera_id`)
  - `ts: int | None`
  - `fallSuspected: bool` (default `False`, alias `fall_suspected`)
  - `fallCount: int | None` (alias `fall_count`)
  - `totalTimeOnGroundSeconds: float | None` (alias `total_time_on_ground_seconds`)
  - `postureState: str | None` (alias `posture_state`)
  - `stepCount: int | None` (alias `step_count`)
  - `cadenceSpm: float | None` (alias `cadence_spm`)
  - `avgCadenceSpm: float | None` (alias `avg_cadence_spm`)
  - `stepTimeCv: float | None` (alias `step_time_cv`)
  - `stepTimeMean: float | None` (alias `step_time_mean`)
  - `activityState: str | None` (alias `activity_state`)
  - `asymmetryIndex: float | None` (alias `asymmetry_index`)
  - `fallRiskLevel: str | None` (alias `fall_risk_level`)
  - `fallRiskScore: float | None` (alias `fall_risk_score`)
  - `fogStatus: str | None` (alias `fog_status`)
  - `fogEpisodes: int | None` (alias `fog_episodes`)
  - `fogDurationSeconds: float | None` (alias `fog_duration_seconds`)
  - `stepVar: float | None` (alias `step_var`)
  - `personDetected: bool | None` (alias `person_detected`)
  - `confidence: float | None`
  - `sourceFps: float | None` (alias `source_fps`)
  - `inferenceMs: float | None` (alias `inference_ms`)
  - `frameId: str | None` (alias `frame_id`)
- Unknown extra fields: ignored.

Response:
- `200`: `{"ok": true}`
- Validation errors: `422`.

### WebSocket message formats

From `backend/app/routers/ws.py` + `backend/app/routers/ingest.py`:

- On WS connect:
  - sends snapshot:
    - `{"type": "snapshot", "data": [<merged objects>]}` for `/ws`
    - `{"type": "snapshot", "data": [<merged object>]}` or empty for resident-scoped `/ws/live`
- On ingest update:
  - broadcasts merged update:
    - `{"type": "merged_update", "data": <merged object>}`
  - sent to all and resident-specific subscribers.

## C) Database

### DB type + configuration

- SQLAlchemy engine in `backend/app/db/session.py`.
- `DATABASE_URL` decides backend:
  - SQLite default local path if not overridden.
  - Postgres supported via URL.
- `init_db()` (`backend/app/db/init_db.py`) calls:
  - `Path(settings.storage_dir).mkdir(...)`
  - `Base.metadata.create_all(bind=engine)`

### Models / tables (defined in `backend/app/db/models.py`)

- `residents`
- `clinician_documents`
- `document_chunks`
- `walking_sessions`
- `metric_samples`
- `daily_reports`
- `ingest_events`
- `hourly_metric_rollups`
- `daily_metric_rollups`
- `exercise_metric_samples`

### Relationships + constraints

- Multiple tables FK `resident_id` -> `residents.id`.
- `document_chunks.doc_id` -> `clinician_documents.id`.
- Unique constraints:
  - `document_chunks(doc_id, chunk_index)`
  - `daily_reports(resident_id, date)`
  - `hourly_metric_rollups(resident_id, bucket_start_ts)`
  - `daily_metric_rollups(resident_id, date)`

### Indexed columns

- Commonly indexed:
  - `resident_id`, `ts`, `date`, `bucket_start_ts`, `event_type`, etc.
- See `mapped_column(..., index=True)` declarations in model file.

### Persistence behavior (ingest path)

In `backend/app/routers/ingest.py`:

- Every ingest packet updates in-memory state and computes merged packet.
- Broadcast over WS happens immediately.
- DB writes are **throttled/sampled**:
  - `persist_interval_seconds` from config (`INGEST_PERSIST_INTERVAL_SECONDS`).
  - analytics tick can run more often (`persist_interval_seconds // 2`) or on critical events.
  - full raw payload persisted every N sample (`INGEST_STORE_FULL_PAYLOAD_EVERY_N_SAMPLES`), otherwise compact merged payload.
- Tables written from ingest:
  - `metric_samples` (sampled raw/merged JSON)
  - `exercise_metric_samples` (normalized row each persisted sample)
  - analytics service writes `ingest_events`, `hourly_metric_rollups`, `daily_metric_rollups`

### JSON fields stored as TEXT

- `metric_samples.walker_json` (JSON string)
- `metric_samples.vision_json`
- `metric_samples.merged_json`
- `daily_reports.summary_json`
- `ingest_events.payload_json`
- other summary/text fields in docs sessions (`summary_json`, etc.)

Serialization/deserialization:
- Uses `json.dumps(...)` on write and `json.loads(...)` when needed in read/compute paths.

## D) In-memory state + merging

From `backend/app/services/merge_state.py`:

- Global dicts:
  - `walker_state: Dict[str, Dict[str, Any]]`
  - `vision_state: Dict[str, Dict[str, Any]]`
  - `merged_state: Dict[str, Dict[str, Any]]`

### Merge logic (`compute_merged`)

Generated merged shape:

```json
{
  "residentId": "string",
  "ts": 1234567890,
  "walker": { "...walker packet..." } | null,
  "vision": { "...vision packet..." } | null,
  "metrics": {
    "steps": "vision.stepCount preferred else walker.steps",
    "tiltDeg": "walker.tiltDeg",
    "reliance": "fsrLeft + fsrRight + 1e-6",
    "balance": "(fsrLeft - fsrRight) / (fsrLeft + fsrRight + 1e-6)",
    "fallSuspected": "vision.fallSuspected OR (tiltDeg >= 60)"
  }
}
```

## E) Report/PDF + stats

### Report endpoints/services

- Endpoint: `POST /api/reports/daily/generate` (`backend/app/routers/reports.py`)
  - Inputs:
    - `residentId` (query)
    - `date` (`YYYY-MM-DD`, query)
    - `usePlaceholder` (bool query, optional, default false)
  - Workflow:
    - reads day data from `daily_metric_rollups` if present, else from `metric_samples`, or placeholder mode
    - computes stats/struggles/suggestions
    - optional Gemini narrative generation (if enabled)
    - writes PDF via `build_daily_pdf(...)`
    - upserts `daily_reports`
  - Returns: `{"pdfPath": "...", "reportId": "...", "usedPlaceholderData": bool}`

- Endpoint: `GET /api/reports/daily/{report_id}/download`
  - serves PDF file via `FileResponse`
  - cache-control headers set to no-cache.

### Stats currently computed

From reports + analytics:

- `samples`
- `steps` (max observed in day/bucket)
- `cadenceSpm_avg`
- `stepVar_avg`
- `fallSuspected_count`
- `tilt_spikes`
- `heavy_lean_count` (rollups/events path)
- `inactivity_count` (rollups/events path)
- `active_seconds`

And event stream:
- `fall`
- `near-fall`
- `heavy-lean`
- `inactivity`

Endpoint: `GET /api/reports/stats?residentId=<id>&days=<1..30>`
returns chart-ready `daily`, `hourly`, and `events`.

## Additional note: defined but not mounted

- `backend/app/routers/exercise_metrics.py` defines:
  - `/api/exercise-metrics/live`
  - `/api/exercise-metrics/aggregates`
  - `/api/exercise-metrics/summary`
- As of current `backend/app/main.py`, this router is **not included** in `create_app()`, so these routes are not currently active.
