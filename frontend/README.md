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

Default fallback: `http://localhost:8000`

## Routes

- `/` Grandma View by default, Proof View one tap away
- `/cv` standalone CV window (independent websocket)

## Resilience and Fallbacks

- Missing endpoints (`404/405/501`) show **Not implemented yet** notices.
- HeyGen failures fallback to browser `SpeechSynthesis`.
- Agent failures fallback to local manual response text.
- If backend is unreachable, app enters mock-data mode to remain demoable.

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
