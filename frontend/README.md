# SmartWalker Frontend

Mode-based demo frontend for Smart Assistive Walker, optimized for:
- Judge Mode (elder-friendly, iPad-mounted)
- Debug Mode (engineer integration console)
- Standalone CV window (`/cv`)

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

- `/` mode switch UI (Judge default, Debug one click away)
- `/cv` standalone CV window (independent websocket)

## Resilience and Fallbacks

- Missing endpoints (`404/405/501`) show **Not implemented yet** notices.
- HeyGen failures fallback to browser `SpeechSynthesis`.
- Agent failures fallback to local manual response text.
- If backend is unreachable, app enters mock-data mode to remain demoable.

## Mode Summary

- **Judge Mode**
  - Start/Stop walk flow
  - Huge step count and safety banner
  - Minimal key metrics
  - Coach panel (HeyGen + speech fallback)
- **Debug Mode**
  - Camera placeholder + open CV window
  - Grouped metric cards
  - Event log table
  - Raw merged JSON with copy
  - Staleness indicators and timestamps
- **Debug Drawer (both modes)**
  - API/WS URLs + status
  - Last walker/vision/merged timestamps
  - Test packet buttons
  - Simulate fall toggle
