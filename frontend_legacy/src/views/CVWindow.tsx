import { useEffect, useMemo, useState } from 'react';
import { MetricCard } from '../components/MetricCard';
import { ApiClient } from '../lib/apiClient';
import { getStoredApiBaseUrl } from '../lib/storage';
import { SmartWalkerWsClient } from '../lib/wsClient';
import type { MergedState, WsStatus } from '../types/api';

export function CVWindow() {
  const [wsStatus, setWsStatus] = useState<WsStatus>('connecting');
  const [state, setState] = useState<MergedState | null>(null);
  const apiBaseUrl = useMemo(() => getStoredApiBaseUrl(), []);
  const residentId = useMemo(() => new URLSearchParams(window.location.search).get('residentId') || 'r1', []);

  useEffect(() => {
    const ws = new SmartWalkerWsClient({
      baseUrl: apiBaseUrl,
      residentId,
      onStatus: setWsStatus,
      onMessage: (payload) => {
        if (payload.type === 'snapshot' && Array.isArray(payload.data)) {
          const hit = (payload.data as MergedState[]).find((entry) => entry.residentId === residentId);
          if (hit) setState(hit);
          return;
        }
        if (payload.type === 'merged_update' && payload.data && typeof payload.data === 'object' && 'residentId' in payload.data) {
          const merged = payload.data as MergedState;
          if (merged.residentId === residentId) setState(merged);
        }
      },
    });
    ws.connect();
    return () => ws.close();
  }, [apiBaseUrl, residentId]);

  useEffect(() => {
    const api = new ApiClient(apiBaseUrl);
    api.getState(residentId).then(setState).catch(() => undefined);
  }, [apiBaseUrl, residentId]);

  const metrics = state?.metrics || {};
  const vision = (state?.vision || {}) as Record<string, unknown>;
  const fall = Boolean(metrics.fallSuspected);

  return (
    <main className="min-h-screen bg-slate-950 p-5 text-white">
      <header className="rounded-xl bg-slate-900 p-4">
        <p className="text-xs uppercase tracking-wide text-slate-400">CV Window - Independent websocket</p>
        <h1 className="text-4xl font-black">Resident {residentId}</h1>
        <p className="text-sm text-slate-300">WS: {wsStatus} | Last updated: {state?.ts ? new Date(state.ts * 1000).toLocaleString() : '-'}</p>
      </header>

      <div className={`mt-4 rounded-xl px-4 py-3 text-center text-2xl font-black ${fall ? 'bg-rose-700 text-white' : 'bg-emerald-700 text-white'}`}>
        {fall ? 'Possible fall detected' : 'All good'}
      </div>

      <div className="mt-4 flex min-h-[260px] items-center justify-center rounded-xl border-2 border-dashed border-slate-600 bg-slate-900">
        Camera placeholder
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Steps (Camera)" value={disp(vision.stepCount ?? metrics.steps)} />
        <MetricCard label="Cadence" value={disp(vision.cadenceSpm)} />
        <MetricCard label="StepVar" value={disp(vision.stepVar)} />
        <MetricCard label="Tilt" value={disp(metrics.tiltDeg)} />
        <MetricCard label="Balance" value={disp(metrics.balance)} />
      </div>
    </main>
  );
}

function disp(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '-';
}
