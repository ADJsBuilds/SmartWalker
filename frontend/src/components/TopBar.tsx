import { useMemo, useState } from 'react';
import { useAppState } from '../state/AppStateContext';
import { StatusPill } from './StatusPill';

interface TopBarProps {
  knownResidentIds: string[];
}

export function TopBar({ knownResidentIds }: TopBarProps) {
  const { apiStatus, wsStatus, selectedResidentId, setSelectedResidentId, apiBaseUrl, setApiBaseUrl } = useAppState();
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [manualResident, setManualResident] = useState(selectedResidentId);
  const [nextApiUrl, setNextApiUrl] = useState(apiBaseUrl);

  const options = useMemo(() => {
    const uniq = new Set([...knownResidentIds, selectedResidentId]);
    return Array.from(uniq).filter(Boolean);
  }, [knownResidentIds, selectedResidentId]);

  return (
    <>
      <header className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/90 p-4 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-black text-white sm:text-3xl">Smart Assistive Walker</h1>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill label="API" status={apiStatus} />
            <StatusPill label="WS" status={wsStatus} />
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-sm text-slate-300">
              Resident ID
              <select
                className="mt-1 min-w-[220px] rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-base text-white"
                value={selectedResidentId}
                onChange={(event) => setSelectedResidentId(event.target.value)}
              >
                {options.map((residentId) => (
                  <option key={residentId} value={residentId}>
                    {residentId}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col text-sm text-slate-300">
              Manual resident
              <div className="mt-1 flex gap-2">
                <input
                  value={manualResident}
                  onChange={(event) => setManualResident(event.target.value)}
                  className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-base text-white"
                />
                <button
                  type="button"
                  onClick={() => setSelectedResidentId(manualResident || selectedResidentId)}
                  className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white"
                >
                  Use
                </button>
              </div>
            </label>
          </div>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700"
          >
            Settings
          </button>
        </div>
      </header>

      {isSettingsOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-5">
            <h2 className="text-xl font-bold text-white">Settings</h2>
            <p className="mt-1 text-sm text-slate-300">Override backend API base URL at runtime.</p>
            <label className="mt-4 block text-sm text-slate-200">
              API Base URL
              <input
                value={nextApiUrl}
                onChange={(event) => setNextApiUrl(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-base text-white"
                placeholder="http://localhost:8000"
              />
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setNextApiUrl(apiBaseUrl);
                  setSettingsOpen(false);
                }}
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setApiBaseUrl(nextApiUrl);
                  setSettingsOpen(false);
                }}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
