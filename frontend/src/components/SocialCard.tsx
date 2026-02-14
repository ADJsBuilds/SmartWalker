import { useState } from 'react';
import { ApiError } from '../lib/apiClient';
import { useRealtimeState } from '../store/realtimeState';

const EXAMPLE_EVENTS = [
  { title: 'Morning coffee & chat', time: '9:00 AM', location: 'Main Lounge', date: 'Today' },
  { title: 'Bingo', time: '2:00 PM', location: 'Activity Room A', date: 'Today' },
  { title: 'Garden walk', time: '4:30 PM', location: 'Garden Patio', date: 'Today' },
  { title: 'Movie night', time: '7:00 PM', location: 'Main Lounge', date: 'Tomorrow' },
  { title: 'Exercise group', time: '10:00 AM', location: 'Activity Room B', date: 'Tomorrow' },
];

export function SocialCard() {
  const { apiClient, notify } = useRealtimeState();
  const [zoomLoading, setZoomLoading] = useState<string | null>(null);
  const [zoomResult, setZoomResult] = useState<{ success: boolean; message: string } | null>(null);

  const sendZoomInvite = (contactLabel: string) => {
    setZoomResult(null);
    setZoomLoading(contactLabel);
    const phrase = `Zoom my ${contactLabel}`;
    apiClient
      .requestZoomInvite({ phrase })
      .then((res) => {
        const msg = `Sent Zoom link to ${res.sentTo}.`;
        setZoomResult({ success: true, message: msg });
        notify(msg, 'info');
      })
      .catch((err) => {
        const message =
          err instanceof ApiError && typeof err.details === 'object' && err.details && 'detail' in err.details
            ? String((err.details as { detail: unknown }).detail)
            : err instanceof Error ? err.message : 'Failed to send Zoom invite.';
        setZoomResult({ success: false, message });
        notify(message, 'error');
      })
      .finally(() => setZoomLoading(null));
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
      <h3 className="text-lg font-semibold text-white">Social</h3>
      <p className="mt-1 text-sm text-slate-400">Upcoming events at the nursing home. Use your walker to join.</p>
      <ul className="mt-4 space-y-3">
        {EXAMPLE_EVENTS.map((evt, i) => (
          <li key={i} className="rounded-xl border border-slate-700 bg-slate-950/80 p-3">
            <p className="font-medium text-white">{evt.title}</p>
            <p className="mt-0.5 text-sm text-slate-400">
              {evt.time} · {evt.location} · {evt.date}
            </p>
          </li>
        ))}
      </ul>
      <div className="mt-4 border-t border-slate-700 pt-4">
        <p className="mb-2 text-sm font-medium text-slate-300">Zoom</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={zoomLoading !== null}
            onClick={() => sendZoomInvite('physical therapist')}
            className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {zoomLoading === 'physical therapist' ? 'Sending…' : 'Zoom my physical therapist'}
          </button>
          <button
            type="button"
            disabled={zoomLoading !== null}
            onClick={() => sendZoomInvite('daughter')}
            className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {zoomLoading === 'daughter' ? 'Sending…' : 'Zoom my daughter'}
          </button>
        </div>
        {zoomResult && (
          <p className={`mt-2 text-sm ${zoomResult.success ? 'text-emerald-300' : 'text-rose-300'}`}>
            {zoomResult.message}
          </p>
        )}
      </div>
    </div>
  );
}
