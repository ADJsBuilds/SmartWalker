import { CaregiverTabs } from '@/components/caregiver-tabs';

export const dynamic = 'force-dynamic';

export default function CaregiverLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-screen max-w-7xl p-4 md:p-6">
      <header className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <p className="text-xs uppercase tracking-wide text-slate-400">Smart Walker</p>
        <h1 className="text-2xl font-bold text-white">Caregiver / Physiotherapist Dashboard</h1>
        <CaregiverTabs />
      </header>
      <main className="mt-4">{children}</main>
    </div>
  );
}
