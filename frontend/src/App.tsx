import { useState } from 'react';
import { SettingsModal } from './components/layout/SettingsModal';
import { Toasts } from './components/layout/Toasts';
import { useRealtimeState } from './store/realtimeState';
import { DebugMode } from './views/DebugMode';
import { JudgeMode } from './views/JudgeMode';

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { latestMergedByResidentId, activeResidentId, mockMode, mode, setMode } = useRealtimeState();
  const selectedMerged = latestMergedByResidentId[activeResidentId];

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-white sm:p-5">
      <Toasts />
      <div className="mx-auto max-w-7xl space-y-4 pb-10">
        <header className="flex items-center justify-between rounded-2xl bg-slate-900/90 p-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMode('judge')}
              className={`rounded-xl px-4 py-2 text-sm font-bold ${mode === 'judge' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-200'}`}
            >
              Judge Mode
            </button>
            <button
              type="button"
              onClick={() => setMode('debug')}
              className={`rounded-xl px-4 py-2 text-sm font-bold ${mode === 'debug' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-200'}`}
            >
              Debug Mode
            </button>
          </div>
          <button type="button" onClick={() => setSettingsOpen(true)} className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white">
            Settings
          </button>
        </header>

        <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

        {mockMode ? (
          <div className="rounded-xl border border-amber-600 bg-amber-900/40 p-3 text-sm text-amber-100">
            API unreachable: mock mode active so the demo stays fully usable.
          </div>
        ) : null}

        {mode === 'debug' ? <DebugMode mergedState={selectedMerged} /> : <JudgeMode mergedState={selectedMerged} />}
      </div>
    </main>
  );
}

export default App;
