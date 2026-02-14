import { useEffect, useState } from 'react';
import { useRealtimeState } from '../../store/realtimeState';

interface TopBarProps {
  onOpenSettings: () => void;
}

export function TopBar({ onOpenSettings }: TopBarProps) {
  const {
    activeResidentId,
    residentInput,
    setResidentInput,
    setActiveResidentId,
    residents,
    residentsSupported,
    apiStatus,
    wsStatus,
    lastUpdatedByResidentId,
  } = useRealtimeState();
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const ts = lastUpdatedByResidentId[activeResidentId];
      setSeconds(ts ? Math.floor((Date.now() - ts) / 1000) : 0);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [activeResidentId, lastUpdatedByResidentId]);

  return (
    <header className="rounded-2xl bg-slate-900/90 p-4 shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-400">Smart Assistive Walker</p>
          <h1 className="text-2xl font-black text-white">Realtime Demo Console</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge label={`Active: ${activeResidentId}`} tone="blue" />
          <Badge label={`API ${apiStatus}`} tone={apiStatus === 'connected' ? 'green' : apiStatus === 'offline' ? 'red' : 'amber'} />
          <Badge label={`WS ${wsStatus}`} tone={wsStatus === 'connected' ? 'green' : wsStatus === 'connecting' ? 'blue' : 'amber'} />
          <Badge label={`Last update ${seconds}s ago`} tone={seconds > 5 ? 'amber' : 'slate'} />
          <button type="button" onClick={onOpenSettings} className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white">
            Settings
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950 p-3">
        <p className="mb-2 text-sm font-semibold text-slate-200">Resident Selection</p>
        <div className="flex flex-wrap items-end gap-3">
          {residentsSupported && residents.length > 0 ? (
            <label className="text-xs uppercase tracking-wide text-slate-400">
              Residents
              <select
                value={residentInput}
                onChange={(event) => setResidentInput(event.target.value)}
                className="mt-1 block min-w-[220px] rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
              >
                {residents.map((resident) => (
                  <option key={resident.residentId} value={resident.residentId}>
                    {resident.residentId} {resident.name ? `- ${resident.name}` : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-sm text-amber-300">Residents endpoint unavailable; manual resident entry enabled.</p>
          )}

          <label className="text-xs uppercase tracking-wide text-slate-400">
            Manual residentId
            <input
              value={residentInput}
              onChange={(event) => setResidentInput(event.target.value)}
              className="mt-1 block min-w-[220px] rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
              placeholder="e.g. r1"
            />
          </label>

          <button
            type="button"
            onClick={() => setActiveResidentId((residentInput || activeResidentId).trim())}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white"
          >
            Set Active
          </button>
        </div>
      </div>
    </header>
  );
}

function Badge({ label, tone }: { label: string; tone: 'green' | 'red' | 'amber' | 'blue' | 'slate' }) {
  const bg =
    tone === 'green'
      ? 'bg-emerald-700'
      : tone === 'red'
        ? 'bg-rose-700'
        : tone === 'amber'
          ? 'bg-amber-700'
          : tone === 'blue'
            ? 'bg-sky-700'
            : 'bg-slate-700';
  return <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white ${bg}`}>{label}</span>;
}
