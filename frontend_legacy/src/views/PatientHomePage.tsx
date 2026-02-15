import { useMemo } from 'react';
import { MetricCard } from '../components/MetricCard';
import { SocialCard } from '../components/SocialCard';
import { useRealtimeState } from '../store/realtimeState';

export function PatientHomePage() {
  const { activeResidentId, residents, latestMergedByResidentId } = useRealtimeState();
  const merged = latestMergedByResidentId[activeResidentId];
  const metrics = merged?.metrics ?? {};
  const vision = (merged?.vision ?? {}) as Record<string, unknown>;

  const displayName = useMemo(() => {
    const r = residents.find((x) => x.residentId === activeResidentId);
    return r?.name ?? activeResidentId;
  }, [residents, activeResidentId]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  const steps = metrics.steps ?? 0;
  const tiltDeg = metrics.tiltDeg ?? null;
  const balance = metrics.balance ?? null;
  const reliance = metrics.reliance ?? null;
  const fallSuspected = Boolean(metrics.fallSuspected);
  const cadenceSpm = vision.cadenceSpm as number | undefined;
  const stepVar = vision.stepVar as number | undefined;

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-10">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
        <h2 className="text-xl font-bold text-white">
          Hello {displayName}
        </h2>
        <p className="mt-1 text-slate-300">
          {greeting}, today is a great day to use your walker and stay active.
        </p>
      </section>

      <section>
        <h3 className="mb-3 text-lg font-semibold text-white">Health overview</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard label="Steps" value={steps} accent="good" />
          <MetricCard
            label="Tilt (deg)"
            value={tiltDeg != null ? tiltDeg.toFixed(1) : '—'}
            accent={tiltDeg != null && tiltDeg >= 60 ? 'danger' : 'normal'}
          />
          <MetricCard
            label="Balance"
            value={balance != null ? balance.toFixed(2) : '—'}
            accent="normal"
          />
          <MetricCard label="Reliance" value={reliance ?? '—'} accent="normal" />
          {cadenceSpm != null && (
            <MetricCard label="Cadence (spm)" value={cadenceSpm.toFixed(0)} accent="normal" />
          )}
          {stepVar != null && (
            <MetricCard label="Step variance" value={stepVar.toFixed(1)} accent="normal" />
          )}
          {fallSuspected && (
            <MetricCard label="Fall alert" value="Suspected" accent="danger" />
          )}
        </div>
      </section>

      <section>
        <SocialCard />
      </section>
    </div>
  );
}
