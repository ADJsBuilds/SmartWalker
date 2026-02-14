'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export function CaregiverTabs() {
  const pathname = usePathname() || '/caregiver';
  const active: 'residents' | 'alerts' | 'plans' = pathname.startsWith('/caregiver/alerts')
    ? 'alerts'
    : pathname.startsWith('/caregiver/plans')
      ? 'plans'
      : 'residents';

  return (
    <nav className="mt-4 flex gap-2">
      <Tab href="/caregiver" active={active === 'residents'}>
        Residents
      </Tab>
      <Tab href="/caregiver/alerts" active={active === 'alerts'}>
        Alerts
      </Tab>
      <Tab href="/caregiver/plans" active={active === 'plans'}>
        Plans
      </Tab>
    </nav>
  );
}

function Tab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        'rounded-md px-4 py-2 text-sm font-semibold transition-colors',
        active ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700',
      )}
    >
      {children}
    </Link>
  );
}
