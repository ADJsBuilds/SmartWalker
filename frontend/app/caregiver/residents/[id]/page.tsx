import { notFound } from 'next/navigation';
import { getCheckins, getDailyStats, getNotes, getPlans, getResidentById, getResidentEvents } from '@/lib/data';
import { ResidentProfileClient } from '@/components/resident-profile-client';

export default async function ResidentProfilePage({ params }: { params: { id: string } }) {
  const resident = await getResidentById(params.id);
  if (!resident) return notFound();

  const [plans, stats, events, notes, checkins] = await Promise.all([
    getPlans(),
    getDailyStats(params.id),
    getResidentEvents(params.id),
    getNotes(params.id),
    getCheckins(params.id),
  ]);

  return <ResidentProfileClient resident={resident} plans={plans} initialStats={stats} initialEvents={events} initialNotes={notes} initialCheckins={checkins} />;
}
