import type { ApiStatus, WsStatus } from '../types/api';

interface StatusPillProps {
  label: string;
  status: ApiStatus | WsStatus;
}

const COLOR_BY_STATUS: Record<string, string> = {
  connected: 'bg-emerald-600',
  offline: 'bg-rose-600',
  degraded: 'bg-amber-600',
  connecting: 'bg-sky-600',
  reconnecting: 'bg-amber-600',
  disconnected: 'bg-slate-600',
};

export function StatusPill({ label, status }: StatusPillProps) {
  return (
    <div className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white ${COLOR_BY_STATUS[status] || 'bg-slate-600'}`}>
      {label}: {status}
    </div>
  );
}
