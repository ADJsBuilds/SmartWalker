import type { AppMode } from '../../types/api';

interface ModeSwitchProps {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
}

const modes: Array<{ id: AppMode; label: string }> = [
  { id: 'judge', label: 'Judge Mode' },
  { id: 'debug', label: 'Debug Mode' },
  { id: 'carier', label: 'Carier Mode' },
  { id: 'clinician', label: 'Clinician' },
];

export function ModeSwitch({ mode, onModeChange }: ModeSwitchProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {modes.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onModeChange(item.id)}
          className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
            item.id === mode ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
