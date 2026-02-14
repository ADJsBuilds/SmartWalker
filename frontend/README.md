# SmartWalker Frontend

Demo-ready React + TypeScript + Tailwind dashboard for Smart Assistive Walker.

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

Default fallback: `http://localhost:8000`

## Routes

- `/` main dashboard with tabs:
  - Computer Vision
  - Patient Data
  - Live Exercise Dashboard
- `/cv` standalone Computer Vision window (independent WebSocket connection)

## Render Deploy

Repository includes a root `render.yaml` blueprint that defines:
- `smartwalker-backend` (Python web service from `backend/`)
- `smartwalker-frontend` (static site from `frontend/`)

After import on Render:
- Update `VITE_API_BASE_URL` to your actual backend URL if service name differs.
- Keep secrets (`HEYGEN_API_KEY`, `OPENEVIDENCE_API_KEY`, etc.) in Render env vars.

## Resilience and Fallbacks

- Missing endpoints (`404/405/501`) show **Not implemented yet** notices.
- HeyGen failures fallback to browser `SpeechSynthesis`.
- Agent failures fallback to local manual response text.
- If backend is unreachable, app enters mock-data mode to remain demoable.
