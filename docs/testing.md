# Backend Testing Guide

## 1) Run automated tests

From repo root:

```bash
python -m pip install -r backend/requirements-dev.txt
python -m pytest -q
```

Notes:
- Tests use isolated temp SQLite DBs via fixtures in `tests/conftest.py`.
- Test env overrides include:
  - `DATABASE_URL=sqlite:///...temp...`
  - `STORAGE_DIR=...temp...`
  - ingest throttling settings for fast test runs.

## 2) Run server against a temporary DB manually

```bash
export DATABASE_URL="sqlite:///$(pwd)/tmp/dev-test.db"
export STORAGE_DIR="$(pwd)/tmp/storage"
mkdir -p "$STORAGE_DIR"
cd backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## 3) Seed one day of dummy data

From repo root:

```bash
python scripts/generate_dummy_day.py \
  --database-url "sqlite:///$(pwd)/tmp/dev-test.db" \
  --resident-id dummy-r1 \
  --date 2026-02-14 \
  --samples 480
```

## 4) Manual ingest smoke tools

Post one walker packet:

```bash
python scripts/post_walker.py --base-url http://localhost:8000 --resident-id r1
```

Post one vision packet:

```bash
python scripts/post_vision.py --base-url http://localhost:8000 --resident-id r1
```

Listen on WS (global):

```bash
python scripts/ws_listen.py --base-url ws://localhost:8000
```

Listen on resident WS:

```bash
python scripts/ws_listen.py --base-url ws://localhost:8000 --resident-id r1
```

## 5) Report PDF generation smoke

Placeholder mode (no prior data required):

```bash
curl -X POST "http://localhost:8000/api/reports/daily/generate?residentId=r1&date=2026-02-14&usePlaceholder=true"
```

Stats check:

```bash
curl "http://localhost:8000/api/reports/stats?residentId=r1&days=1"
```
