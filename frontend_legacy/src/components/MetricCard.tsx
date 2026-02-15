interface MetricCardProps {
  label: string;
  value: string | number;
  accent?: 'normal' | 'good' | 'warn' | 'danger';
  subtitle?: string;
}

const ACCENT_MAP = {
  normal: 'border-slate-700',
  good: 'border-emerald-500',
  warn: 'border-amber-500',
  danger: 'border-rose-500',
};

export function MetricCard({ label, value, subtitle, accent = 'normal' }: MetricCardProps) {
  return (
    <div className={`rounded-xl border-2 ${ACCENT_MAP[accent]} bg-slate-900 p-4 shadow-md`}>
      <p className="text-sm font-semibold uppercase tracking-wider text-slate-300">{label}</p>
      <p className="mt-2 text-4xl font-extrabold text-white">{value}</p>
      {subtitle ? <p className="mt-1 text-sm text-slate-400">{subtitle}</p> : null}
    </div>
  );
}
