import { useMemo, useState } from 'react';
import { CoachCard } from '../components/CoachCard';
import type { MergedState } from '../types/api';

interface GrandmaViewProps {
  mergedState?: MergedState;
}

export function GrandmaView({ mergedState }: GrandmaViewProps) {
  const [walking, setWalking] = useState(false);
  const metrics = mergedState?.metrics || {};
  const vision = (mergedState?.vision || {}) as Record<string, unknown>;
  const steps = Number(metrics.steps || 0);
  const fall = Boolean(metrics.fallSuspected);
  const residentId = mergedState?.residentId || 'r1';

  const todayProgress = useMemo(() => Math.max(0, Math.min(100, Math.round((steps / 500) * 100))), [steps]);

  return (
    <section className="mx-auto max-w-4xl space-y-5 pb-24">
      <div className="rounded-3xl bg-slate-900/95 p-6 sm:p-8">
        {!walking ? (
          <div className="space-y-5 text-center">
            <p className="text-lg text-slate-300">Ready for a walk?</p>
            <button type="button" onClick={() => setWalking(true)} className="w-full rounded-3xl bg-emerald-600 px-8 py-8 text-4xl font-black text-white sm:text-5xl">
              Start Walk
            </button>
            <p className="text-sm text-slate-300">Steps today: {steps} ({todayProgress}% of goal)</p>
          </div>
        ) : (
          <div className="space-y-5 text-center">
            <p className="text-sm uppercase tracking-widest text-slate-300">Walking</p>
            <p className="text-8xl font-black leading-none text-white sm:text-9xl">{steps}</p>
            <p className="text-sm text-slate-300">Steps</p>
            <div className={`rounded-2xl px-4 py-4 text-2xl font-black ${fall ? 'bg-rose-700 text-white' : 'bg-emerald-700 text-white'}`}>
              {fall ? 'Possible fall detected' : 'You are safe'}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <BigMetric label="Cadence SPM" value={fmt(vision.cadenceSpm)} />
              <BigMetric label="Step Var" value={fmt(vision.stepVar)} />
              <BigMetric label="Tilt Deg" value={fmt(metrics.tiltDeg)} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => document.getElementById('coach-card')?.scrollIntoView({ behavior: 'smooth' })} className="rounded-2xl bg-indigo-600 px-6 py-4 text-2xl font-black text-white">
                Talk to Coach
              </button>
              <button type="button" onClick={() => setWalking(false)} className="rounded-2xl bg-slate-700 px-6 py-4 text-2xl font-black text-white">
                Stop Walk
              </button>
            </div>
          </div>
        )}
      </div>

      <div id="coach-card">
        <CoachCard residentId={residentId} metrics={metrics as Record<string, unknown>} />
      </div>
    </section>
  );
}

function BigMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-800 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-2 text-4xl font-black text-white">{value}</p>
    </div>
  );
}

function fmt(value: unknown): string {
  const num = Number(value);
  return Number.isFinite(num) ? String(Math.round(num * 100) / 100) : '-';
}
