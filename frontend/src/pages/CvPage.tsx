import { useEffect, useMemo, useState } from 'react';
import { MetricCard } from '../components/MetricCard';
import { ApiClient } from '../lib/apiClient';
import { getStoredApiBaseUrl } from '../lib/storage';
import { SmartWalkerWsClient } from '../lib/wsClient';
import type { MergedState, WsStatus } from '../types/api';

export function CvPage() {
  const [wsStatus, setWsStatus] = useState<WsStatus>('connecting');
  const [state, setState] = useState<MergedState | null>(null);
  const apiBaseUrl = useMemo(() => getStoredApiBaseUrl(), []);
  const residentId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('residentId') || 'r1';
  }, []);

  useEffect(() => {
    const client = new SmartWalkerWsClient({
      baseUrl: apiBaseUrl,
      residentId,
      onStatus: setWsStatus,
      onMessage: (payload) => {
        if (payload.type === 'snapshot' && Array.isArray(payload.data)) {
          const snapshot = payload.data as MergedState[];
          const match = snapshot.find((item) => item.residentId === residentId);
          if (match) setState(match);
        }
        if (payload.type === 'merged_update' && payload.data && typeof payload.data === 'object' && 'residentId' in payload.data) {
          const merged = payload.data as MergedState;
          if (merged.residentId === residentId) {
            setState(merged);
          }
        }
      },
    });
    client.connect();
    return () => client.close();
  }, [apiBaseUrl, residentId]);

  useEffect(() => {
    const api = new ApiClient(apiBaseUrl);
    api.getState(residentId).then(setState).catch(() => undefined);
  }, [apiBaseUrl, residentId]);

  const metrics = state?.metrics || {};
  const vision = (state?.vision || {}) as Record<string, unknown>;
  const ts = state?.ts ? new Date(state.ts * 1000).toLocaleString() : 'Waiting for data...';
  const fall = Boolean(metrics.fallSuspected);

  return (
    <main className="min-h-screen bg-slate-950 p-5 text-white">
      <header className="mb-4 rounded-xl border border-slate-700 bg-slate-900 p-4">
        <p className="text-sm uppercase tracking-wider text-slate-400">Standalone Computer Vision</p>
        <h1 className="text-3xl font-black">Resident {residentId}</h1>
        <p className="mt-1 text-sm text-slate-300">
          WS: <span className="font-bold">{wsStatus}</span> | Last update: {ts}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Steps" value={toDisplay(metrics.steps)} accent="good" />
        <MetricCard label="Cadence SPM" value={toDisplay(vision.cadenceSpm)} />
        <MetricCard label="Step Var" value={toDisplay(vision.stepVar)} />
        <MetricCard label="Tilt Deg" value={toDisplay(metrics.tiltDeg)} accent={Number(metrics.tiltDeg || 0) > 25 ? 'warn' : 'normal'} />
        <MetricCard label="Balance" value={toDisplay(metrics.balance)} />
        <MetricCard label="Fall" value={fall ? 'YES' : 'NO'} accent={fall ? 'danger' : 'good'} />
      </div>
    </main>
  );
}

function toDisplay(value: unknown): string {
  const num = Number(value);
  return Number.isFinite(num) ? String(Math.round(num * 100) / 100) : '-';
}
