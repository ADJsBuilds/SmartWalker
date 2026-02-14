# Database Architecture & JSON Representation Guide

## Overview

The backend uses **SQLite** (file-based database) that stores structured data with **JSON text fields** for flexible sensor/vision payloads. This design allows:
- Fast real-time updates (in-memory state)
- Historical persistence (database every 5 seconds)
- Flexible schema (JSON stores any sensor fields)

---

## Database Structure

### 1. **Residents Table** (`residents`)
Simple patient/resident records:
```sql
id: VARCHAR(64)          -- Primary key (UUID string)
name: VARCHAR(200)       -- Optional name
created_at: DATETIME     -- When record was created
```

**Example:**
```
id: "r1"
name: "John Doe"
created_at: 2026-02-13 23:14:53
```

---

### 2. **MetricSamples Table** (`metric_samples`) ⭐ **Main Data Storage**

This is where all sensor/vision data is stored as **JSON strings**:

```sql
id: VARCHAR(64)          -- UUID primary key
resident_id: VARCHAR(64)  -- Foreign key to residents
ts: INTEGER          -- Unix timestamp (indexed for fast queries)
walker_json: TEXT    -- Full walker sensor packet as JSON string
vision_json: TEXT    -- Full vision model packet as JSON string
merged_json: TEXT    -- Computed merged state as JSON string
```

**How JSONs are stored:**

#### `walker_json` - Raw Walker Sensor Data
Stored as a JSON string containing the entire walker packet:
```json
{
  "residentId": "r1",
  "deviceId": "walker-001",
  "ts": 1771053708,
  "fsrLeft": 20,
  "fsrRight": 18,
  "tiltDeg": 5.2,
  "steps": 120,
  "accelX": 0.1,      // Any extra fields preserved
  "accelY": 0.2,
  "accelZ": 9.8
}
```

#### `vision_json` - Raw Vision Model Data
Stored as a JSON string containing the entire vision packet:
```json
{
  "residentId": "r1",
  "cameraId": "cam-001",
  "ts": 1771053708,
  "fallSuspected": false,
  "stepCount": 125,        // Camera step count (more accurate)
  "cadenceSpm": 92.5,
  "stepVar": 9.2,
  "confidence": 0.95,
  "personDetected": true,
  "inferenceMs": 45.2,
  "sourceFps": 30.0
}
```

#### `merged_json` - Computed Merged State
Stored as a JSON string containing the computed/merged result:
```json
{
  "residentId": "r1",
  "ts": 1771053708,
  "walker": {
    "residentId": "r1",
    "fsrLeft": 20,
    "fsrRight": 18,
    "tiltDeg": 5.2,
    "steps": 120
  },
  "vision": {
    "residentId": "r1",
    "stepCount": 125,
    "cadenceSpm": 92.5,
    "stepVar": 9.2,
    "fallSuspected": false
  },
  "metrics": {
    "steps": 125,              // Uses vision.stepCount (prioritized)
    "tiltDeg": 5.2,
    "reliance": 38.0,          // fsrLeft + fsrRight
    "balance": 0.0526,         // (fsrLeft - fsrRight) / total
    "fallSuspected": false     // vision.fallSuspected OR tiltDeg >= 60
  }
}
```

---

## Data Flow

### Step 1: Incoming Packets
When sensors send data:

```python
POST /api/walker
{
  "residentId": "r1",
  "fsrLeft": 20,
  "fsrRight": 18,
  "tiltDeg": 5.2
}
```

**What happens:**
1. Packet validated by Pydantic (`WalkerPacket`)
2. Stored in **in-memory** `walker_state[residentId]` (fast for real-time)
3. Triggers `compute_merged()` to create merged state
4. Broadcasts via WebSocket immediately

### Step 2: Merging Logic
`compute_merged()` function:
- Reads from `walker_state` and `vision_state` (in-memory)
- Computes metrics (balance, reliance, fall detection)
- **Prioritizes vision.stepCount over walker.steps** (camera is more accurate)
- Returns merged dictionary

### Step 3: Database Persistence (Throttled)
Every **5 seconds per resident** (throttled to avoid DB spam):

```python
# In _update_and_push()
db.add(MetricSample(
    resident_id=resident_id,
    ts=merged['ts'],
    walker_json=json.dumps(walker_state[resident_id]),  # Convert dict → JSON string
    vision_json=json.dumps(vision_state[resident_id]), # Convert dict → JSON string
    merged_json=json.dumps(merged)                     # Convert dict → JSON string
))
db.commit()
```

**Why JSON strings?**
- SQLite `TEXT` column stores the JSON as a string
- Python `json.dumps()` converts Python dict → JSON string for storage
- Python `json.loads()` converts JSON string → Python dict when reading

---

## Other Tables with JSON Fields

### 3. **WalkingSession** (`walking_sessions`)
Stores session summaries:
```sql
summary_json: TEXT  -- JSON string with session stats
```

**Example:**
```json
{
  "totalSteps": 500,
  "avgCadence": 88.5,
  "fallEvents": 0,
  "durationSeconds": 3600
}
```

### 4. **DailyReport** (`daily_reports`)
Stores daily report metadata:
```sql
summary_json: TEXT  -- JSON string with report stats
```

**Example:**
```json
{
  "stats": {
    "samples": 720,
    "steps": 500,
    "cadenceSpm_avg": 88.5,
    "stepVar_avg": 9.2,
    "fallSuspected_count": 0
  },
  "struggles": ["High step variability"],
  "suggestions": ["Schedule supervised gait practice"]
}
```

### 5. **ClinicianDocument** (`clinician_documents`)
Stores uploaded PDFs:
```sql
extracted_text: TEXT  -- Plain text extracted from PDF (not JSON)
```

### 6. **DocumentChunk** (`document_chunks`)
Stores text chunks for retrieval:
```sql
text: TEXT  -- Plain text chunk (not JSON)
```

---

## How to Query JSON Data

### Python (SQLAlchemy)
```python
from sqlalchemy.orm import Session
import json

# Get recent samples
samples = db.query(MetricSample).filter(
    MetricSample.resident_id == "r1"
).order_by(MetricSample.ts.desc()).limit(10).all()

for sample in samples:
    # Parse JSON strings back to Python dicts
    walker = json.loads(sample.walker_json)
    vision = json.loads(sample.vision_json)
    merged = json.loads(sample.merged_json)
    
    print(f"Steps: {merged['metrics']['steps']}")
    print(f"Tilt: {walker.get('tiltDeg')}")
```

### Raw SQL (SQLite)
```sql
-- Get all walker data for a resident
SELECT ts, walker_json FROM metric_samples 
WHERE resident_id = 'r1' 
ORDER BY ts DESC;

-- Parse JSON in SQLite (if JSON1 extension available)
SELECT 
  ts,
  json_extract(walker_json, '$.tiltDeg') as tilt,
  json_extract(merged_json, '$.metrics.steps') as steps
FROM metric_samples
WHERE resident_id = 'r1';
```

---

## Why This Design?

### ✅ Advantages:
1. **Flexible Schema**: Can store any sensor fields without schema changes
2. **Fast Real-time**: In-memory state for WebSocket (no DB latency)
3. **Historical Data**: Throttled persistence keeps history without spam
4. **Easy Migration**: Can switch to Postgres later (same JSON columns)

### ⚠️ Trade-offs:
1. **No JSON Queries**: Can't easily query inside JSON (unless using Postgres JSONB)
2. **Storage Size**: JSON strings take more space than normalized columns
3. **Type Safety**: JSON fields aren't type-checked by database

---

## Current Data Flow Summary

```
Sensor/Vision → POST /api/walker or /api/vision
                ↓
         In-memory state (walker_state, vision_state)
                ↓
         compute_merged() → merged_state
                ↓
         WebSocket broadcast (real-time)
                ↓
         Every 5 seconds: Save to DB
                ↓
         metric_samples table (JSON strings)
```

---

## Example: Reading Historical Data

```python
# Get all steps for a resident today
from datetime import datetime
import json

start_ts = int(datetime.now().replace(hour=0, minute=0, second=0).timestamp())
samples = db.query(MetricSample).filter(
    MetricSample.resident_id == "r1",
    MetricSample.ts >= start_ts
).all()

steps_history = []
for sample in samples:
    merged = json.loads(sample.merged_json)
    steps_history.append({
        'timestamp': sample.ts,
        'steps': merged['metrics']['steps']
    })
```

This is how daily reports are generated - by querying `metric_samples` and parsing the JSON fields!
