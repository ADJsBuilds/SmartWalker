import { useEffect } from 'react';
import { useRealtimeState } from '../../store/realtimeState';

export function Toasts() {
  const { toasts, dismissToast } = useRealtimeState();

  useEffect(() => {
    if (!toasts.length) return;
    const timer = window.setTimeout(() => dismissToast(toasts[toasts.length - 1].id), 3500);
    return () => window.clearTimeout(timer);
  }, [dismissToast, toasts]);

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex max-w-md flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto rounded-xl px-4 py-3 text-sm font-medium shadow-lg ${
            toast.level === 'error'
              ? 'bg-rose-700 text-rose-50'
              : toast.level === 'warn'
                ? 'bg-amber-600 text-amber-50'
                : 'bg-slate-800 text-slate-50'
          }`}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
