import { useMemo, useState } from 'react';
import { toWsBaseUrl } from '../../lib/storage';
import { useRealtimeState } from '../../store/realtimeState';

export function DebugDrawer() {
  const {
    apiBaseUrl,
    apiStatus,
    wsStatus,
    activeResidentId,
    simulateFall,
    setSimulateFall,
    lastWalkerTsByResidentId,
    lastVisionTsByResidentId,
    lastMergedTsByResidentId,
    sendTestWalkerPacket,
    sendTestVisionPacket,
  } = useRealtimeState();
  const [open, setOpen] = useState(false);
  const wsUrl = useMemo(() => `${toWsBaseUrl(apiBaseUrl)}/ws`, [apiBaseUrl]);

  const walkerTs = lastWalkerTsByResidentId[activeResidentId];
  const visionTs = lastVisionTsByResidentId[activeResidentId];
  const mergedTs = lastMergedTsByResidentId[activeResidentId];

  return (
    <aside className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-700 bg-slate-900/95 shadow-2xl">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-bold text-white"
      >
        <span>Debug Drawer</span>
        <span>{open ? 'Hide' : 'Show'}</span>
      </button>
      {open ? (
        <div className="grid gap-3 px-4 pb-4 md:grid-cols-2 xl:grid-cols-4">
          <Block title="Connection">
            <Row label="API URL" value={apiBaseUrl} />
            <Row label="WS URL" value={wsUrl} />
            <Row label="API status" value={apiStatus} />
            <Row label="WS status" value={wsStatus} />
          </Block>

          <Block title="Timestamps">
            <Row label="Last walker ts" value={formatTs(walkerTs)} />
            <Row label="Last vision ts" value={formatTs(visionTs)} />
            <Row label="Last merged ts" value={formatTs(mergedTs)} />
          </Block>

          <Block title="Simulation">
            <label className="flex items-center justify-between rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-100">
              Simulate fall
              <input type="checkbox" checked={simulateFall} onChange={(e) => setSimulateFall(e.target.checked)} />
            </label>
            <p className="mt-2 text-xs text-slate-400">When enabled, test packets send dangerous tilt/fall flags.</p>
          </Block>

          <Block title="Test Packets">
            <button type="button" onClick={sendTestWalkerPacket} className="w-full rounded-lg bg-sky-600 px-3 py-2 text-sm font-bold text-white">
              Send test walker packet
            </button>
            <button
              type="button"
              onClick={sendTestVisionPacket}
              className="mt-2 w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white"
            >
              Send test vision packet
            </button>
          </Block>
        </div>
      ) : null}
    </aside>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-700 bg-slate-950 p-3">
      <h4 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-300">{title}</h4>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p className="mb-1 text-xs text-slate-300">
      <span className="font-semibold text-slate-400">{label}: </span>
      {value}
    </p>
  );
}

function formatTs(ts: number | undefined): string {
  if (!ts) return '-';
  return new Date(ts * 1000).toLocaleTimeString();
}
