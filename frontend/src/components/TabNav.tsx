export type DashboardTab = 'Computer Vision' | 'Patient Data' | 'Live Exercise Dashboard';

interface TabNavProps {
  activeTab: DashboardTab;
  onChange: (tab: DashboardTab) => void;
}

const tabs: DashboardTab[] = ['Computer Vision', 'Patient Data', 'Live Exercise Dashboard'];

export function TabNav({ activeTab, onChange }: TabNavProps) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          className={`rounded-xl px-4 py-3 text-base font-bold transition ${
            activeTab === tab ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
          }`}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}
