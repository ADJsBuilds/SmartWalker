import { useState } from 'react';
import { AppShell } from './components/layout/AppShell';
import { SettingsModal } from './components/layout/SettingsModal';
import { Toasts } from './components/layout/Toasts';
import { useRealtimeState } from './store/realtimeState';
import { DebugMode } from './views/DebugMode';
import { DoctorView } from './views/DoctorView';
import { JudgeMode } from './views/JudgeMode';
import { LiveExerciseView } from './views/LiveExerciseView';
import { PatientHomePage } from './views/PatientHomePage';

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { latestMergedByResidentId, activeResidentId, mockMode, mode, setMode } = useRealtimeState();
  const selectedMerged = latestMergedByResidentId[activeResidentId];

  const renderContent = () => {
    if (mode === 'judge') return <JudgeMode mergedState={selectedMerged} />;
    if (mode === 'debug') return <DebugMode mergedState={selectedMerged} />;
    if (mode === 'liveExercise') return <LiveExerciseView />;
    if (mode === 'patientHome') return <PatientHomePage />;
    if (mode === 'doctorView') return <DoctorView />;
    return <JudgeMode mergedState={selectedMerged} />;
  };

  return (
    <>
      <Toasts />
      <AppShell mode={mode} setMode={setMode} onOpenSettings={() => setSettingsOpen(true)}>
        {mockMode ? (
          <div className="mb-4 rounded-xl border border-amber-600 bg-amber-900/40 p-3 text-sm text-amber-100">
            API unreachable: mock mode active so the demo stays fully usable.
          </div>
        ) : null}
        {renderContent()}
      </AppShell>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

export default App;
