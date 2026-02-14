import { useState } from 'react';
import { DebugDrawer } from './components/layout/DebugDrawer';
import { ModeSwitch } from './components/layout/ModeSwitch';
import { SettingsModal } from './components/layout/SettingsModal';
import { TopBar } from './components/layout/TopBar';
import { Toasts } from './components/layout/Toasts';
import { useRealtimeState } from './store/realtimeState';
import { DebugMode } from './views/DebugMode';
import { JudgeMode } from './views/JudgeMode';

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { mode, setMode, latestMergedByResidentId, activeResidentId, mockMode } = useRealtimeState();
  const selectedMerged = latestMergedByResidentId[activeResidentId];

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-white sm:p-6">
      <Toasts />
      <div className="mx-auto max-w-7xl space-y-4 pb-20">
        <TopBar onOpenSettings={() => setSettingsOpen(true)} />
        <ModeSwitch mode={mode} onModeChange={setMode} />
        <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

        {mockMode ? (
          <div className="rounded-xl border border-amber-600 bg-amber-900/40 p-3 text-sm text-amber-100">
            API unreachable: mock mode active so the demo stays fully usable.
          </div>
        ) : null}

        {mode === 'judge' ? <JudgeMode mergedState={selectedMerged} /> : null}
        {mode === 'debug' ? <DebugMode mergedState={selectedMerged} /> : null}
        {mode === 'clinician' ? <DebugMode mergedState={selectedMerged} /> : null}
      </div>
      <DebugDrawer />
    </main>
  );
}

export default App;
