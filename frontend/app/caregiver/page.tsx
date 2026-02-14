import { formatISO } from 'date-fns';
import { CaregiverOverview } from '@/components/caregiver-overview';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidents } from '@/lib/data';
import type { AlertItem, DailyStat, EventItem } from '@/lib/types';

export default async function CaregiverPage() {
  const residents = await getResidents();
  const supabase = createAdminClient();
  const today = formatISO(new Date(), { representation: 'date' });
  const residentIds = residents.map((r) => r.id);

  const [statsRes, alertsRes, eventsRes] = await Promise.all([
    supabase.from('daily_stats').select('*').eq('date', today).in('resident_id', residentIds),
    supabase.from('alerts').select('*').eq('status', 'active').in('resident_id', residentIds),
    supabase.from('events').select('*').in('resident_id', residentIds).order('ts', { ascending: false }).limit(500),
  ]);

  const statsByResident: Record<string, DailyStat | undefined> = {};
  (statsRes.data || []).forEach((row) => {
    statsByResident[row.resident_id] = row as DailyStat;
  });

  const activeAlertsByResident: Record<string, AlertItem[]> = {};
  (alertsRes.data || []).forEach((row) => {
    const rid = row.resident_id;
    activeAlertsByResident[rid] = [...(activeAlertsByResident[rid] || []), row as AlertItem];
  });

  const latestEventByResident: Record<string, EventItem | undefined> = {};
  (eventsRes.data || []).forEach((row) => {
    if (!latestEventByResident[row.resident_id]) latestEventByResident[row.resident_id] = row as EventItem;
  });

  return <CaregiverOverview data={{ residents, statsByResident, latestEventByResident, activeAlertsByResident }} />;
}
