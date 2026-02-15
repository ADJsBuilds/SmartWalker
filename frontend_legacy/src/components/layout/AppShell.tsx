import type { AppMode } from '../../types/api';

interface AppShellProps {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  onOpenSettings: () => void;
  children: React.ReactNode;
}

const TAB_ITEMS: Array<{ id: AppMode; label: string }> = [
  { id: 'judge', label: 'Judge Mode' },
  { id: 'debug', label: 'Debug Mode' },
  { id: 'liveExercise', label: 'Live Exercise' },
  { id: 'patientHome', label: 'Patient Home Page' },
  { id: 'doctorView', label: 'Doctor View' },
];

export function AppShell({ mode, setMode, onOpenSettings, children }: AppShellProps) {
  return (
    <div className="flex min-h-screen bg-slate-950 text-white">
      <aside className="flex w-56 flex-shrink-0 flex-col border-r border-slate-800 bg-slate-900/90">
        <div className="p-4">
          <h1 className="text-lg font-bold text-white">SmartWalker</h1>
        </div>
        <nav className="flex-1 space-y-0.5 p-2">
          {TAB_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setMode(item.id)}
              className={`w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
                mode === item.id ? 'bg-sky-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="border-t border-slate-800 p-2">
          <button
            type="button"
            onClick={onOpenSettings}
            className="w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            Settings
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 sm:p-5 md:p-6">{children}</main>
    </div>
  );
}
