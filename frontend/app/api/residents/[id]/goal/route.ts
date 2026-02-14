import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createAdminClient();
  const body = await req.json();
  const dailyStepGoal = Number(body.dailyStepGoal);
  if (!Number.isFinite(dailyStepGoal) || dailyStepGoal <= 0) {
    return NextResponse.json({ ok: false, error: 'Invalid dailyStepGoal' }, { status: 400 });
  }
  const { error } = await supabase.from('residents').update({ daily_step_goal: dailyStepGoal }).eq('id', params.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
