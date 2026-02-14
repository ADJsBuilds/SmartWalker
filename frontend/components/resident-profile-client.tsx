'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CheckInComposer } from '@/components/checkin-modal';
import { EventTimeline } from '@/components/event-timeline';
import { StepsChart } from '@/components/steps-chart';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { CheckIn, DailyStat, EventItem, Note, Plan, Resident } from '@/lib/types';

type Tab = 'activity' | 'safety' | 'plan' | 'notes';

export function ResidentProfileClient({
  resident,
  plans,
  initialStats,
  initialEvents,
  initialNotes,
  initialCheckins,
}: {
  resident: Resident;
  plans: Plan[];
  initialStats: DailyStat[];
  initialEvents: EventItem[];
  initialNotes: Note[];
  initialCheckins: CheckIn[];
}) {
  const [tab, setTab] = useState<Tab>('activity');
  const [events, setEvents] = useState(initialEvents);
  const [notes, setNotes] = useState(initialNotes);
  const [checkins, setCheckins] = useState(initialCheckins);
  const [goalInput, setGoalInput] = useState(String(resident.daily_step_goal));
  const [noteBody, setNoteBody] = useState('');

  useEffect(() => {
    const supabase = getSupabaseClient();
    const alertsChannel = supabase
      .channel(`resident-events-${resident.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `resident_id=eq.${resident.id}` }, async () => {
        const { data } = await supabase.from('events').select('*').eq('resident_id', resident.id).order('ts', { ascending: false }).limit(100);
        setEvents((data || []) as EventItem[]);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(alertsChannel);
    };
  }, [resident.id]);

  const currentPlan = plans.find((p) => p.id === resident.plan_id);
  const recent24h = useMemo(() => events.filter((e) => Date.now() - +new Date(e.ts) < 24 * 60 * 60 * 1000), [events]);
  const falls7d = events.filter((e) => e.type === 'fall').length;
  const nearFalls7d = events.filter((e) => e.type === 'near_fall').length;
  const heavyLean7d = events.filter((e) => e.type === 'heavy_lean').length;
  const stabilityScore = Math.max(0, 100 - falls7d * 20 - nearFalls7d * 10 - heavyLean7d * 5);

  async function saveGoal() {
    await fetch(`/api/residents/${resident.id}/goal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dailyStepGoal: Number(goalInput) }),
    });
  }

  async function addNote() {
    if (!noteBody.trim()) return;
    await fetch('/api/notes/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ residentId: resident.id, body: noteBody }),
    });
    setNotes((prev) => [{ id: `tmp-${Date.now()}`, resident_id: resident.id, caregiver_id: 'demo', body: noteBody, created_at: new Date().toISOString() }, ...prev]);
    setNoteBody('');
  }

  async function mockRespond(checkinId: string) {
    await fetch(`/api/checkins/${checkinId}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ responseBody: 'Yes, I completed my exercises and feel okay.' }),
    });
    setCheckins((prev) =>
      prev.map((c) =>
        c.id === checkinId ? { ...c, status: 'responded', response_body: 'Yes, I completed my exercises and feel okay.', responded_at: new Date().toISOString() } : c,
      ),
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{resident.name}</CardTitle>
          <p className="text-sm text-slate-400">Room {resident.room}</p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <TabButton active={tab === 'activity'} onClick={() => setTab('activity')}>Activity</TabButton>
            <TabButton active={tab === 'safety'} onClick={() => setTab('safety')}>Safety / Mobility</TabButton>
            <TabButton active={tab === 'plan'} onClick={() => setTab('plan')}>Plan / Goals</TabButton>
            <TabButton active={tab === 'notes'} onClick={() => setTab('notes')}>Notes</TabButton>
          </div>
        </CardContent>
      </Card>

      {tab === 'activity' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>7-day Steps</CardTitle></CardHeader>
            <CardContent><StepsChart stats={initialStats} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Sessions (MVP)</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {initialStats.map((s) => (
                <div key={s.id} className="rounded-md border border-slate-800 p-2 text-sm">
                  {s.date}: {s.steps} steps, {s.walking_minutes} min
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Event Timeline (24h)</CardTitle></CardHeader>
            <CardContent><EventTimeline events={recent24h} /></CardContent>
          </Card>
        </div>
      ) : null}

      {tab === 'safety' ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Metric title="Falls (7d)" value={String(falls7d)} />
          <Metric title="Near-falls (7d)" value={String(nearFalls7d)} />
          <Metric title="Heavy-lean (7d)" value={String(heavyLean7d)} />
          <Metric title="Stability score" value={`${stabilityScore}`} />
        </div>
      ) : null}

      {tab === 'plan' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Daily Goal</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Input type="number" value={goalInput} onChange={(e) => setGoalInput(e.target.value)} />
              <Button onClick={saveGoal}>Save goal</Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Assigned Plan</CardTitle></CardHeader>
            <CardContent>
              {currentPlan ? (
                <>
                  <p className="font-semibold">{currentPlan.title}</p>
                  <p className="text-sm text-slate-300">Goal suggestion: {currentPlan.daily_step_goal}</p>
                  <pre className="mt-2 text-xs text-slate-400">{JSON.stringify(currentPlan.exercises, null, 2)}</pre>
                </>
              ) : (
                <p className="text-sm text-slate-400">No plan assigned yet.</p>
              )}
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Adherence summary</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-slate-300">
                Avg adherence (7d):{' '}
                {initialStats.length ? Math.round(initialStats.reduce((acc, s) => acc + s.adherence_percent, 0) / initialStats.length) : 0}%
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === 'notes' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Caregiver Notes</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Textarea value={noteBody} onChange={(e) => setNoteBody(e.target.value)} placeholder="Add note..." />
              <Button onClick={addNote}>Add Note</Button>
              <div className="space-y-2">
                {notes.map((n) => (
                  <div key={n.id} className="rounded-md border border-slate-800 p-2 text-sm">
                    {n.body}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Check-ins (last 5)</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <CheckInComposer residentId={resident.id} />
              {checkins.slice(0, 5).map((c) => (
                <div key={c.id} className="rounded-md border border-slate-800 p-2 text-sm">
                  <p className="font-semibold">{c.prompt_body}</p>
                  <p className="text-xs text-slate-400">{c.status}</p>
                  {c.response_body ? <p className="mt-1 text-slate-300">{c.response_body}</p> : null}
                  {!c.response_body ? (
                    <Button className="mt-2" size="sm" variant="secondary" onClick={() => mockRespond(c.id)}>
                      Record demo response
                    </Button>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent><p className="text-4xl font-bold">{value}</p></CardContent>
    </Card>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-md px-3 py-2 text-sm font-semibold ${active ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-200'}`}>
      {children}
    </button>
  );
}
