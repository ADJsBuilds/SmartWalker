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
- `LIVEAVATAR_API_KEY` (required UUID developer key for LiveAvatar provider calls)
- `LIVEAVATAR_BASE_URL` (default: `https://api.liveavatar.com`)
- `LIVEAVATAR_AVATAR_ID` (required if not passed in request payload)
- `LIVEAVATAR_LANGUAGE` (optional, default: `en`)
- `LIVEAVATAR_INTERACTIVITY_TYPE` (optional, default: `PUSH_TO_TALK`)
- `INCLUDE_PROVIDER_RAW` (optional, default: `false`; include provider raw payloads in API responses)
- `OPENEVIDENCE_API_KEY`
- `OPENEVIDENCE_BASE_URL`
- `GEMINI_API_KEY` (optional; required for Gemini-backed narrative/script generation)
- `GEMINI_ENABLED` (optional, default: `false`; set `true` to enable Gemini calls)
- `GEMINI_MODEL` (optional, default: `gemini-3-flash`)
- `GEMINI_BASE_URL` (optional, default: `https://generativelanguage.googleapis.com/v1beta`)
- `COACH_SCRIPT_COOLDOWN_SECONDS` (optional, default: `8`)

## LiveAvatar API (Current Flow)

The backend follows the strict sequence:
1) `POST /v1/sessions/token` with `X-API-KEY`
2) `POST /v1/sessions/start` with `X-API-KEY` + `Authorization: Bearer <session_token>`
3) return clean payload to frontend (`livekitUrl`, `livekitClientToken`, `sessionId`)

### Curl: `/api/liveagent/session/token`

```bash
curl -X POST http://localhost:8000/api/liveagent/session/token \
  -H "Content-Type: application/json" \
  -d '{
    "residentId": "r1",
    "mode": "FULL",
    "avatarId": "9a4f4b1f-86f9-4acf-9a37-b81c21ae95e4",
    "interactivityType": "PUSH_TO_TALK",
    "language": "en"
  }'
```

### Curl: `/api/liveagent/session/start`

```bash
curl -X POST http://localhost:8000/api/liveagent/session/start \
  -H "Content-Type: application/json" \
  -d '{
    "sessionToken": "<session_token_from_previous_call>",
    "sessionId": "<session_id_from_previous_call>"
  }'
```

### Curl: `/api/liveagent/session/bootstrap`

```bash
curl -X POST http://localhost:8000/api/liveagent/session/bootstrap \
  -H "Content-Type: application/json" \
  -d '{
    "residentId": "r1",
    "mode": "FULL",
    "avatarId": "9a4f4b1f-86f9-4acf-9a37-b81c21ae95e4",
    "interactivityType": "PUSH_TO_TALK",
    "language": "en"
  }'
```

Expected happy-path fields:
- `ok: true`
- `sessionId`
- `livekitUrl`
- `livekitClientToken`
- `maxSessionDuration`

Deprecated endpoints:
- `/api/integrations/heygen`
- `/api/heygen/avatars`
- `/api/heygen/speak`

## Coach Script Generator

`POST /api/coach/script` builds short therapist-style speech text for LiveAvatar.

Example:

```bash
curl -X POST http://localhost:8000/api/coach/script \
  -H "Content-Type: application/json" \
  -d '{
    "residentId": "r1",
    "goal": "encourage",
    "tone": "calm",
    "userPrompt": "Can we speed up a little?",
    "context": {
      "steps": 128,
      "tiltDeg": 8.5,
      "balance": 0.12,
      "cadence": 82,
      "fallSuspected": false,
      "sessionPhase": "walking"
    }
  }'
```

Response shape:
- `script` (max 2 sentences, <= 220 chars)
- `intent`
- `safetyFlags`
- `meta`
- `reason`
