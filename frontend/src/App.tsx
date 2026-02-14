import { useEffect, useState } from 'react';
import { AdminDrawer } from './components/AdminDrawer';
import { SettingsModal } from './components/layout/SettingsModal';
import { Toasts } from './components/layout/Toasts';
import { useRealtimeState } from './store/realtimeState';
import { GrandmaView } from './views/GrandmaView';
import { ProofView } from './views/ProofView';

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [view, setView] = useState<'grandma' | 'proof'>('grandma');
  const [adminOpen, setAdminOpen] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const { latestMergedByResidentId, activeResidentId, mockMode, sendTestVisionPacket, sendTestWalkerPacket } = useRealtimeState();
  const selectedMerged = latestMergedByResidentId[activeResidentId];

  useEffect(() => {
    let timer: number | null = null;
    if (demoMode) {
      timer = window.setInterval(() => {
        sendTestWalkerPacket();
        sendTestVisionPacket();
      }, 2500);
    }
    return () => {
      if (timer) window.clearInterval(timer);
    };
  }, [demoMode, sendTestVisionPacket, sendTestWalkerPacket]);

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-white sm:p-5">
      <Toasts />
      <div className="mx-auto max-w-7xl space-y-4 pb-10">
        <header className="flex items-center justify-between rounded-2xl bg-slate-900/90 p-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setView('grandma')}
              className={`rounded-xl px-4 py-2 text-sm font-bold ${view === 'grandma' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-200'}`}
            >
              Grandma View
            </button>
            <button
              type="button"
              onClick={() => setView('proof')}
              className={`rounded-xl px-4 py-2 text-sm font-bold ${view === 'proof' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-200'}`}
            >
              Proof View
            </button>
          </div>
          <button type="button" onClick={() => setAdminOpen(true)} className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white">
            Admin
          </button>
        </header>

        <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

        {mockMode ? (
          <div className="rounded-xl border border-amber-600 bg-amber-900/40 p-3 text-sm text-amber-100">
            API unreachable: mock mode active so the demo stays fully usable.
          </div>
        ) : null}

        {view === 'grandma' ? <GrandmaView mergedState={selectedMerged} /> : <ProofView mergedState={selectedMerged} />}
      </div>
      <AdminDrawer
        open={adminOpen}
        onClose={() => setAdminOpen(false)}
        onOpenSettings={() => setSettingsOpen(true)}
        demoMode={demoMode}
        onToggleDemoMode={setDemoMode}
      />
    </main>
  );
}

export default App;
