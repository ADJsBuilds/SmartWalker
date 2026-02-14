import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function POST(req: Request) {
  const supabase = createAdminClient();
  const body = await req.json();
  const title = String(body.title || '').trim();
  const dailyStepGoal = Number(body.dailyStepGoal);
  const exercises = Array.isArray(body.exercises) ? body.exercises : [];
  if (!title || !Number.isFinite(dailyStepGoal)) {
    return NextResponse.json({ ok: false, error: 'title and dailyStepGoal required' }, { status: 400 });
  }
  const { error } = await supabase.from('plans').insert({
    title,
    daily_step_goal: dailyStepGoal,
    exercises,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
