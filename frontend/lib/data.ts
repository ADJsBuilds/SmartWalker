import { formatISO } from 'date-fns';
import { createAdminClient } from '@/lib/supabase/server';
import type { AlertItem, CheckIn, DailyStat, EventItem, Note, Plan, Resident } from '@/lib/types';

export async function getResidents(): Promise<Resident[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('residents').select('*').order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []) as Resident[];
}

export async function getPlans(): Promise<Plan[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('plans').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []) as Plan[];
}

export async function getAlerts(): Promise<(AlertItem & { resident?: Resident; event?: EventItem })[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('alerts')
    .select('*, residents(*), events(*)')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data || []) as Array<Record<string, unknown>>).map((item) => ({
    ...(item as unknown as AlertItem),
    resident: (item.residents as Resident) || undefined,
    event: (item.events as EventItem) || undefined,
  }));
}

export async function getResidentById(id: string): Promise<Resident | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('residents').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Resident) || null;
}

export async function getDailyStats(id: string, days = 7): Promise<DailyStat[]> {
  const supabase = createAdminClient();
  const start = formatISO(new Date(Date.now() - days * 24 * 60 * 60 * 1000), { representation: 'date' });
  const { data, error } = await supabase
    .from('daily_stats')
    .select('*')
    .eq('resident_id', id)
    .gte('date', start)
    .order('date', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []) as DailyStat[];
}

export async function getResidentEvents(id: string, limit = 100): Promise<EventItem[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('events').select('*').eq('resident_id', id).order('ts', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data || []) as EventItem[];
}

export async function getNotes(id: string): Promise<Note[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('notes').select('*').eq('resident_id', id).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []) as Note[];
}

export async function getCheckins(id: string): Promise<CheckIn[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('checkins').select('*').eq('resident_id', id).order('sent_at', { ascending: false }).limit(20);
  if (error) throw new Error(error.message);
  return (data || []) as CheckIn[];
}
