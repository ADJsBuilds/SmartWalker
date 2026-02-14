# SmartWalker Backend

Hackathon-ready FastAPI backend with ingest, websocket streaming, resident data, document upload, retrieval, reports, and integrations.

## Local Run

Use Python 3.11-3.12 for the smoothest install experience (3.13 can require source builds for some deps).

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python -m uvicorn app.main:app --reload --reload-exclude .venv --host 0.0.0.0 --port 8000
```

If you set `CORS_ALLOW_ORIGINS` in `.env`, use one of:
- `CORS_ALLOW_ORIGINS=*`
- `CORS_ALLOW_ORIGINS=http://localhost:3000,http://127.0.0.1:3000`
- `CORS_ALLOW_ORIGINS=["http://localhost:3000","http://127.0.0.1:3000"]`

## Example Ingest Calls

```bash
curl -X POST http://localhost:8000/api/walker \
  -H "Content-Type: application/json" \
  -d '{"residentId":"r1","fsrLeft":20,"fsrRight":18,"tiltDeg":5,"steps":120}'

curl -X POST http://localhost:8000/api/vision \
  -H "Content-Type: application/json" \
  -d '{"residentId":"r1","fallSuspected":false,"cadenceSpm":92.5,"stepVar":9.2}'
```

## WebSocket

- Legacy broadcast stream: `ws://localhost:8000/ws`
- Filtered live stream by resident: `ws://localhost:8000/ws/live?residentId=r1`

## Render Deploy Notes

Use the same start command:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Set environment variables in Render dashboard:
- `APP_ENV=prod`
- `DATABASE_URL` (SQLite default works locally; Postgres URL in prod)
- `STORAGE_DIR`
- `CORS_ALLOW_ORIGINS`
- `LOG_LEVEL`
- `HEYGEN_API_KEY`
- `HEYGEN_BASE_URL`
- `OPENEVIDENCE_API_KEY`
- `OPENEVIDENCE_BASE_URL`
