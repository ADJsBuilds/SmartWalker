import { useState } from 'react';
import { useRealtimeState } from '../../store/realtimeState';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { apiBaseUrl, setApiBaseUrl } = useRealtimeState();
  const [input, setInput] = useState(apiBaseUrl);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-5">
        <h2 className="text-xl font-bold text-white">Settings</h2>
        <p className="mt-1 text-sm text-slate-300">Override API base URL at runtime. Saved in localStorage.</p>
        <label className="mt-4 block text-sm text-slate-200">
          API Base URL
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-base text-white"
            placeholder="https://smartwalker-back.onrender.com"
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              setApiBaseUrl(input);
              onClose();
            }}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
