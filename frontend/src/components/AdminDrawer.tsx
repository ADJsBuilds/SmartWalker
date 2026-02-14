import { useMemo } from 'react';
import { toWsBaseUrl } from '../lib/storage';
import { useRealtimeState } from '../store/realtimeState';

interface AdminDrawerProps {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  demoMode: boolean;
  onToggleDemoMode: (next: boolean) => void;
}

export function AdminDrawer({ open, onClose, onOpenSettings, demoMode, onToggleDemoMode }: AdminDrawerProps) {
  const {
    apiBaseUrl,
    apiStatus,
    wsStatus,
    activeResidentId,
    residentInput,
    setResidentInput,
    setActiveResidentId,
    residents,
    residentsSupported,
  } = useRealtimeState();
  const wsUrl = useMemo(() => `${toWsBaseUrl(apiBaseUrl)}/ws`, [apiBaseUrl]);

  return (
    <aside
      className={`fixed right-0 top-0 z-40 h-full w-full max-w-md transform border-l border-slate-700 bg-slate-950 p-4 transition ${
        open ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-black text-white">Admin</h3>
        <button type="button" onClick={onClose} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white">
          Close
        </button>
      </div>

      <div className="mt-4 space-y-4">
        <section className="rounded-xl bg-slate-900 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Connections</p>
          <p className="mt-1 text-sm text-slate-200">API: {apiStatus}</p>
          <p className="text-sm text-slate-200">WS: {wsStatus}</p>
          <p className="mt-2 break-all text-xs text-slate-400">API URL: {apiBaseUrl}</p>
          <p className="break-all text-xs text-slate-400">WS URL: {wsUrl}</p>
        </section>

        <section className="rounded-xl bg-slate-900 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Resident</p>
          <p className="mt-1 text-sm text-slate-200">Active: {activeResidentId}</p>
          {residentsSupported && residents.length > 0 ? (
            <select
              value={residentInput}
              onChange={(event) => setResidentInput(event.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              {residents.map((item) => (
                <option key={item.residentId} value={item.residentId}>
                  {item.residentId}
                </option>
              ))}
            </select>
          ) : null}
          <input
            value={residentInput}
            onChange={(event) => setResidentInput(event.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            placeholder="residentId"
          />
          <button type="button" onClick={() => setActiveResidentId(residentInput || activeResidentId)} className="mt-2 rounded-lg bg-sky-600 px-3 py-2 text-sm font-bold text-white">
            Set Active Resident
          </button>
        </section>

        <section className="rounded-xl bg-slate-900 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Demo</p>
          <label className="mt-2 flex items-center justify-between rounded-lg bg-slate-950 px-3 py-2 text-sm text-slate-100">
            Auto simulate packets
            <input type="checkbox" checked={demoMode} onChange={(event) => onToggleDemoMode(event.target.checked)} />
          </label>
          <button type="button" onClick={onOpenSettings} className="mt-3 rounded-lg bg-slate-700 px-3 py-2 text-sm font-bold text-white">
            Open Settings
          </button>
        </section>
      </div>
    </aside>
  );
}
