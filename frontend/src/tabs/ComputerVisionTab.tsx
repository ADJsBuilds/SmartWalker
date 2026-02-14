import { MetricCard } from '../components/MetricCard';
import type { MergedState } from '../types/api';

interface ComputerVisionTabProps {
  residentId: string;
  mergedState?: MergedState;
  onRefresh: () => void;
}

export function ComputerVisionTab({ residentId, mergedState, onRefresh }: ComputerVisionTabProps) {
  const metrics = mergedState?.metrics || {};
  const vision = (mergedState?.vision || {}) as Record<string, unknown>;
  const cadenceSpm = vision.cadenceSpm as number | undefined;
  const stepVar = vision.stepVar as number | undefined;
  const lastUpdated = mergedState?.ts ? new Date(mergedState.ts * 1000).toLocaleTimeString() : 'No data yet';
  const fallSuspected = Boolean(metrics.fallSuspected);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700"
        >
          Refresh Resident State
        </button>
        <button
          type="button"
          onClick={() => window.open(`/cv?residentId=${encodeURIComponent(residentId)}`, 'cvWindow', 'width=1100,height=800')}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-500"
        >
          Open CV Window
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Steps" value={asNumber(metrics.steps)} subtitle={`Resident ${residentId}`} />
        <MetricCard label="Cadence SPM" value={asNumber(cadenceSpm)} />
        <MetricCard label="Step Variability" value={asNumber(stepVar)} accent={stepVar && stepVar > 15 ? 'warn' : 'normal'} />
        <MetricCard label="Tilt Deg" value={asNumber(metrics.tiltDeg)} accent={toNumber(metrics.tiltDeg) > 25 ? 'warn' : 'normal'} />
        <MetricCard label="Balance" value={asFixed(metrics.balance, 2)} />
        <MetricCard label="Fall Suspected" value={fallSuspected ? 'YES' : 'NO'} accent={fallSuspected ? 'danger' : 'good'} />
        <MetricCard label="Reliance" value={asFixed(metrics.reliance, 1)} />
        <MetricCard label="Last Updated" value={lastUpdated} subtitle={mergedState ? 'Live' : 'Waiting for stream'} />
      </div>

      <div className="rounded-2xl border border-slate-700 bg-slate-900 p-5">
        <h3 className="text-lg font-bold text-white">Camera Feed Placeholder</h3>
        <div className="mt-3 flex min-h-[260px] items-center justify-center rounded-xl border-2 border-dashed border-slate-600 bg-slate-950 text-center text-slate-400">
          Computer vision stream panel (hook your camera UI here for demo)
        </div>
      </div>
    </section>
  );
}

function toNumber(value: unknown): number {
  const asNum = Number(value);
  return Number.isFinite(asNum) ? asNum : 0;
}

function asNumber(value: unknown): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return String(Math.round(num * 100) / 100);
}

function asFixed(value: unknown, digits: number): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return num.toFixed(digits);
}
