# SmartWalker Frontend

Judge-ready frontend for Smart Assistive Walker with:
- Grandma View (iPad-first, minimal)
- Proof View (Live Signals + Clinical Value)
- Admin drawer (resident, settings, demo mode)

## Install and Run

From project root:

```bash
cd frontend
npm install
npm run dev -- --host 0.0.0.0 --port 5173
```

Frontend local URL:
- `http://localhost:5173`

## iPad Demo Access

1. Find your laptop IP on the same Wi-Fi (example: `192.168.1.55`)
2. Open on iPad:
   - `http://LAPTOP_IP:5173`
3. In app Settings modal, set API Base URL to:
   - `http://LAPTOP_IP:8000`

## API Base URL

Config sources:
- `VITE_API_BASE_URL` (build-time default)
- Settings modal override (runtime, stored in `localStorage`)

Default fallback: `https://smartwalker-back.onrender.com`

## Routes

- `/` Grandma View by default, Proof View one tap away
- `/cv` standalone CV window (independent websocket)
- `/user` production user-facing LiveAvatar screen (full-screen avatar + orange press-to-talk button)
- `/liveavatar-test` LiveAvatar bootstrap + LiveKit connection test page
- `/voice-agent-playground` ElevenLabs Agents websocket playground (text-first + contextual updates)

## ElevenLabs + LiveAvatar LITE Bridge

The main page (`/`) includes a bridge panel that:
1) streams microphone audio to ElevenLabs agent websocket,
2) plays agent audio locally,
3) converts/forwards agent audio to LiveAvatar LITE websocket via `agent.speak`,
4) renders avatar video from LiveKit.

Required backend env vars for this bridge:
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_AGENT_ID`
- `LIVEAVATAR_API_KEY`
- `LIVEAVATAR_AVATAR_ID`

## LiveAvatar Test Page

`/liveavatar-test` performs:
1) `POST /api/liveagent/session/bootstrap`
2) connect with `livekit-client` using `livekitUrl` + `livekitClientToken`
3) render subscribed tracks and show status/events

If a connect attempt fails with token auth errors (`401`/invalid token), the page automatically retries bootstrap once and reconnects.

## Demo Layout

- **Grandma View**
  - Idle + Walking states with large controls
  - Safety banner + three key metrics
  - Coach card (Play Coach + Talk to Coach)
- **Proof View**
  - Live Signals: walker + vision columns, freshness, event log, raw JSON
  - Clinical Value: documents upload/list/preview and daily reports
- **Admin Drawer**
  - Hidden from judges by default
  - Resident selection, API/WS status, settings access, demo packet simulation toggle
