import { useMemo, useState } from 'react';
import { TopBar } from './components/TopBar';
import { TabNav, type DashboardTab } from './components/TabNav';
import { useAppState } from './state/AppStateContext';
import { ComputerVisionTab } from './tabs/ComputerVisionTab';
import { LiveExerciseTab } from './tabs/LiveExerciseTab';
import { PatientDataTab } from './tabs/PatientDataTab';

export function App() {
  const [activeTab, setActiveTab] = useState<DashboardTab>('Computer Vision');
  const { latestMergedByResidentId, selectedResidentId, setSelectedResidentId, refreshState, friendlyError, mockMode } = useAppState();

  const knownResidentIds = useMemo(() => Object.keys(latestMergedByResidentId), [latestMergedByResidentId]);
  const selectedMerged = latestMergedByResidentId[selectedResidentId];

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-white sm:p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <TopBar knownResidentIds={knownResidentIds} />

        {mockMode ? (
          <div className="rounded-xl border border-amber-600 bg-amber-900/40 p-3 text-sm text-amber-100">
            Mock data mode active. Backend is unreachable or partially unavailable, but UI remains demo-ready.
          </div>
        ) : null}

        {friendlyError ? (
          <div className="rounded-xl border border-rose-600 bg-rose-900/40 p-3 text-sm text-rose-100">{friendlyError}</div>
        ) : null}

        <TabNav activeTab={activeTab} onChange={setActiveTab} />

        {activeTab === 'Computer Vision' ? (
          <ComputerVisionTab residentId={selectedResidentId} mergedState={selectedMerged} onRefresh={() => refreshState(selectedResidentId)} />
        ) : null}
        {activeTab === 'Patient Data' ? (
          <PatientDataTab residentId={selectedResidentId} onResidentSelected={setSelectedResidentId} />
        ) : null}
        {activeTab === 'Live Exercise Dashboard' ? <LiveExerciseTab residentId={selectedResidentId} mergedState={selectedMerged} /> : null}
      </div>
    </main>
  );
}

export default App;
